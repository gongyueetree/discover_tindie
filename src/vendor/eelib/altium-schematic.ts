import * as CFB from "cfb";

import { altiumPage, type AltiumPage } from "./altium-page";
import { altiumFields, altiumSchematicRecords, altiumText, isAltiumAsciiSchematic } from "@/vendor/canon/lib/eda/altium-native";
import { altiumProperties } from "@/vendor/canon/lib/eda/altium-records";
import type { Circle, Ink, Path, SheetDrawing, SheetHit, SymbolHit, Text } from "./kicad-schematic";

/**
 * An Altium SchDoc as the viewer's drawing primitives (the same `SheetDrawing`
 * a KiCad or EAGLE sheet gives): each component drawn from the primitives the
 * sheet stores for it — only the part (`CURRENTPARTID`) and display mode
 * placed, as Altium draws a multi-part component — with its pins (names and
 * designators where Altium shows them, dot and clock symbols), its designator
 * (with the part letter) and its shown parameters; wires with the net the
 * reading gave them, buses, junctions, net labels, power ports in their
 * styles, ports, sheet symbols with their entries (each opens its sheet),
 * texts, text frames, notes, no-ERC marks and the sheet's own drawing; then
 * the page — Altium's border and reference zones, its template's drawing, or
 * a plain title block with the sheet's own values.
 *
 * The records are read from the SchDoc itself (the same FileHeader records
 * the IR is read from, core/eda/altium-native.ts). In a SchDoc, a component's
 * primitives are stored where they are placed — already turned and mirrored —
 * so nothing here re-applies a component's orientation. Altium is y up in
 * 10-mil units; the drawing is millimetres, y down from the page's top.
 * Nothing is inferred: what this reader does not draw (images, IEEE symbols,
 * harnesses, binary records) is counted in `skipped`.
 *
 * The record and field names follow Altium's published file format as
 * documented by the open-source readers of it; no code is taken from them.
 */
type Props = Record<string, string>;
type XY = [number, number];

const UNIT = 0.254;
const LINE = 0.1524;
/** Altium's line widths (smallest, small, medium, large), in mm. */
const WIDTHS = [0.1, LINE, 0.45, 0.75];
/** Altium font sizes are points; about 6 mil of glyph height per point reads as Altium shows its sheets. */
const POINT = 0.1524;
const DEFAULT_FONT = { size: 10 * POINT, bold: false, italic: false };
const PIN_TEXT = 1.4;
const JUNCTION_R = 0.45;
const NO_ERC = 0.8;
const MAX_POINTS = 10_000;

const num = (p: Props | undefined, key: string, fallback = 0) => {
  const value = Number(p?.[key]);
  return p?.[key] !== undefined && Number.isFinite(value) ? value : fallback;
};
/** A coordinate in mm: the 10-mil value plus its fraction (1/100000). */
const coord = (p: Props, key: string) => (num(p, key) + num(p, `${key}_FRAC`) / 100000) * UNIT;
const yes = (value: string | undefined) => value === "T" || value === "TRUE";
const round = (value: number) => Math.round(value * 1000) / 1000;

/** An Altium colour (BGR integer) is dark: a fill drawn in ink, not the body's colour. */
const dark = (value: string | undefined) => {
  const colour = Number(value ?? 0);
  if (!Number.isFinite(colour)) return false;
  const [r, g, b] = [colour & 0xff, (colour >> 8) & 0xff, (colour >> 16) & 0xff];
  return 0.299 * r + 0.587 * g + 0.114 * b < 110;
};

type Raw = {
  paths: (Omit<Path, "d"> & { pts: XY[] })[];
  circles: (Omit<Circle, "x" | "y"> & { c: XY })[];
  texts: (Omit<Text, "x" | "y"> & { a: XY })[];
  skipped: Record<string, number>;
};

/** Text placement from Altium's orientation (quarter turns) and justification (0 bottom-left … 8 top-right), kept readable. */
function placement(orientation: number, justification: number): Pick<Text, "angle" | "h" | "v"> {
  const hs: Text["h"][] = ["start", "middle", "end"];
  const vs: Text["v"][] = ["bottom", "middle", "top"];
  let h = hs[justification % 3] ?? "start";
  let v = vs[Math.floor(justification / 3)] ?? "bottom";
  const turn = ((orientation % 4) + 4) % 4;
  if (turn >= 2) {
    h = h === "start" ? "end" : h === "end" ? "start" : h;
    v = v === "top" ? "bottom" : v === "bottom" ? "top" : v;
  }
  return { angle: turn % 2 === 1 ? 90 : 0, h, v };
}

type Font = { size: number; bold: boolean; italic: boolean };
function fontsOf(sheet: Props | undefined): Map<number, Font> {
  const fonts = new Map<number, Font>();
  const count = Math.min(num(sheet, "FONTIDCOUNT"), 256);
  for (let id = 1; id <= count; id += 1) {
    const size = num(sheet, `SIZE${id}`, 10) || 10;
    fonts.set(id, { size: round(Math.min(Math.max(size, 4), 72) * POINT), bold: yes(sheet?.[`BOLD${id}`]), italic: yes(sheet?.[`ITALIC${id}`]) });
  }
  return fonts;
}

/** Each record's children (by OWNERINDEX), once. */
function ownership(records: Props[]) {
  const owned = new Map<number, number[]>();
  records.forEach((record, index) => {
    if (record.OWNERINDEX === undefined) return;
    const owner = Number(record.OWNERINDEX);
    if (!Number.isInteger(owner)) return;
    owned.set(owner, [...(owned.get(owner) ?? []), index]);
  });
  return owned;
}

const unitPoints = (p: Props): XY[] => Array.from({ length: Math.min(num(p, "LOCATIONCOUNT"), MAX_POINTS) }, (_, i) => [coord(p, `X${i + 1}`), coord(p, `Y${i + 1}`)] as XY);
const location = (p: Props): XY => [coord(p, "LOCATION.X"), coord(p, "LOCATION.Y")];
const corner = (p: Props): XY => [coord(p, "CORNER.X"), coord(p, "CORNER.Y")];
const widthOf = (p: Props) => WIDTHS[num(p, "LINEWIDTH")] ?? LINE;
const dashOf = (p: Props): Path["dash"] | undefined => (num(p, "LINESTYLE") === 1 ? "dash" : num(p, "LINESTYLE") === 2 ? "dot" : num(p, "LINESTYLE") === 3 ? "dash_dot" : undefined);

/** An arc's points: centre, radii (x, y) and angles in degrees, counter-clockwise (y up). */
function arc([cx, cy]: XY, rx: number, ry: number, start: number, end: number, segments = 48): XY[] {
  let sweep = (((end - start) % 360) + 360) % 360;
  if (sweep === 0) sweep = 360;
  const n = Math.max(4, Math.ceil((segments * sweep) / 360));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((start + (sweep * i) / n) * Math.PI) / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as XY;
  });
}

function bezier(points: XY[]): XY[] {
  const out: XY[] = [];
  for (let i = 0; i + 3 < points.length; i += 3) {
    const [p0, p1, p2, p3] = [points[i]!, points[i + 1]!, points[i + 2]!, points[i + 3]!];
    for (let k = i === 0 ? 0 : 1; k <= 16; k += 1) {
      const t = k / 16;
      const u = 1 - t;
      out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    }
  }
  return out.length ? out : points;
}

/** A filled shape's fill: a dark Altium fill is drawn in ink (an arrow, a dot), a light one as the body. */
const fillOf = (p: Props, ink: Ink): Pick<Path, "fill"> => (yes(p.ISSOLID) && !yes(p.TRANSPARENT) ? { fill: dark(p.AREACOLOR) || ink === "pin" ? "ink" : "body" } : {});

/** One drawn primitive (a symbol's or the sheet's own); the points it covers. */
function drawShape(out: Raw, p: Props, ink: Ink): XY[] {
  const w = widthOf(p);
  const dash = dashOf(p);
  const push = (pts: XY[], closed: boolean, extra: Partial<Path> = {}) => {
    if (pts.length < 2) return [];
    out.paths.push({ pts, ink, w, ...(closed ? { closed: true as const } : {}), ...(dash ? { dash } : {}), ...extra });
    return pts;
  };
  switch (p.RECORD) {
    case "5":
      return push(bezier(unitPoints(p)), false);
    case "6":
      return push(unitPoints(p), false);
    case "7":
      return push(unitPoints(p), true, fillOf(p, ink));
    case "13":
      return push([location(p), corner(p)], false);
    case "14": {
      const [[x1, y1], [x2, y2]] = [location(p), corner(p)];
      return push([[x1, y1], [x2, y1], [x2, y2], [x1, y2]], true, fillOf(p, ink));
    }
    case "10": {
      const [[x1, y1], [x2, y2]] = [location(p), corner(p)];
      const [l, r, b, t] = [Math.min(x1, x2), Math.max(x1, x2), Math.min(y1, y2), Math.max(y1, y2)];
      const rx = Math.min(coord(p, "CORNERXRADIUS"), (r - l) / 2);
      const ry = Math.min(coord(p, "CORNERYRADIUS"), (t - b) / 2);
      const pts = [...arc([r - rx, t - ry], rx, ry, 0, 90, 8), ...arc([l + rx, t - ry], rx, ry, 90, 180, 8), ...arc([l + rx, b + ry], rx, ry, 180, 270, 8), ...arc([r - rx, b + ry], rx, ry, 270, 360, 8)];
      return push(pts, true, fillOf(p, ink));
    }
    case "8": {
      const c = location(p);
      const rx = coord(p, "RADIUS");
      const ry = p.SECONDARYRADIUS !== undefined ? coord(p, "SECONDARYRADIUS") : rx;
      return push(arc(c, rx, ry, 0, 360).slice(0, -1), true, fillOf(p, ink));
    }
    case "11":
    case "12": {
      const c = location(p);
      const rx = coord(p, "RADIUS");
      const ry = p.RECORD === "11" && p.SECONDARYRADIUS !== undefined ? coord(p, "SECONDARYRADIUS") : rx;
      return push(arc(c, rx, ry, num(p, "STARTANGLE"), p.ENDANGLE === undefined ? 360 : num(p, "ENDANGLE")), false);
    }
    case "9": {
      const c = location(p);
      const r = coord(p, "RADIUS");
      const pts = arc(c, r, r, num(p, "STARTANGLE"), p.ENDANGLE === undefined ? 360 : num(p, "ENDANGLE"));
      return push([c, ...pts], true, fillOf(p, ink));
    }
    default:
      return [];
  }
}

/** A text: anchored where the record says, in its font, kept readable. */
function pushText(out: Raw, p: Props, t: string, ink: Ink, fonts: Map<number, Font>, at: XY = location(p)) {
  if (!t) return;
  const font = fonts.get(num(p, "FONTID", 1)) ?? DEFAULT_FONT;
  out.texts.push({ a: at, t, size: font.size, ink, ...placement(num(p, "ORIENTATION"), num(p, "JUSTIFICATION")), ...(font.bold ? { bold: true as const } : {}), ...(font.italic ? { italic: true as const } : {}) });
}

/** A text's special string (`=Title`, `.Title`) read from the sheet's parameters; unknown ones as written. */
const special = (text: string, sheet: Record<string, string>) => {
  const match = /^[=.](.+)$/.exec(text.trim());
  const name = match?.[1]?.trim().toUpperCase();
  return name && sheet[name] !== undefined ? sheet[name]! : text;
};

/** A pin: its line from the body out to the connection end, dot and clock symbols, its name inside and designator above. */
function drawPin(out: Raw, p: Props, covered: XY[]) {
  const conglomerate = num(p, "PINCONGLOMERATE");
  const hidden = (conglomerate & 0x04) !== 0;
  if (hidden) return;
  const turn = conglomerate & 0x03;
  const dir: XY = [[1, 0], [0, 1], [-1, 0], [0, -1]][turn] as XY;
  const length = coord(p, "PINLENGTH");
  const body = location(p);
  const end: XY = [body[0] + dir[0] * length, body[1] + dir[1] * length];
  covered.push(body, end);
  const dot = num(p, "SYMBOL_OUTEREDGE") === 1;
  const bubble = dot ? 0.6 : 0;
  out.paths.push({ pts: [[body[0] + dir[0] * bubble * 2, body[1] + dir[1] * bubble * 2], end], ink: "pin", w: LINE });
  if (dot) out.circles.push({ c: [body[0] + dir[0] * bubble, body[1] + dir[1] * bubble], r: bubble, ink: "pin", w: LINE });
  const up: XY = [-dir[1], dir[0]];
  if (num(p, "SYMBOL_INNEREDGE") === 3) {
    out.paths.push({ pts: [[body[0] + up[0] * 0.6, body[1] + up[1] * 0.6], [body[0] - dir[0] * 1, body[1] - dir[1] * 1], [body[0] - up[0] * 0.6, body[1] - up[1] * 0.6]], ink: "pin", w: LINE });
  }
  const vertical = turn % 2 === 1;
  const name = altiumText(p.NAME ?? "");
  if (conglomerate & 0x08 && name) {
    // Inside the body, reading away from the pin.
    const at: XY = [body[0] - dir[0] * (num(p, "SYMBOL_INNEREDGE") === 3 ? 1.6 : 0.6), body[1] - dir[1] * (num(p, "SYMBOL_INNEREDGE") === 3 ? 1.6 : 0.6)];
    const towardsEnd = vertical ? dir[1] > 0 : dir[0] > 0;
    out.texts.push({ a: at, t: name, size: PIN_TEXT, ink: "pinName", angle: vertical ? 90 : 0, h: towardsEnd ? "end" : "start", v: "middle" });
    if ((p.NAME ?? "").includes("\\")) {
      // Altium's overbar (a backslash after each letter): a line over the name, as wide as the letters it covers.
      const letters = name.length * PIN_TEXT * 0.6;
      const over = PIN_TEXT * 0.65;
      const from: XY = vertical ? [at[0] - over, at[1]] : [at[0], at[1] + over];
      const to: XY = vertical ? [from[0], from[1] + (towardsEnd ? -letters : letters)] : [from[0] + (towardsEnd ? -letters : letters), from[1]];
      out.paths.push({ pts: [from, to], ink: "pinName", w: 0.1 });
    }
  }
  const designator = p.DESIGNATOR ?? "";
  if (conglomerate & 0x10 && designator && length > 0) {
    const mid: XY = [(body[0] + end[0]) / 2 + up[0] * 0.25, (body[1] + end[1]) / 2 + up[1] * 0.25];
    out.texts.push({ a: mid, t: designator, size: PIN_TEXT * 0.9, ink: "pinNumber", angle: vertical ? 90 : 0, h: "middle", v: "bottom" });
  }
}

/** A power port: its stem, then its symbol by style, then its net's name beyond it. */
function drawPower(out: Raw, p: Props, fonts: Map<number, Font>) {
  const at = location(p);
  const turn = ((num(p, "ORIENTATION") % 4) + 4) % 4;
  const dir: XY = [[1, 0], [0, 1], [-1, 0], [0, -1]][turn] as XY;
  const side: XY = [-dir[1], dir[0]];
  const along = (d: number, s = 0): XY => [at[0] + dir[0] * d + side[0] * s, at[1] + dir[1] * d + side[1] * s];
  const style = num(p, "STYLE", 2);
  const ink: Ink = "global";
  const stem = style === 0 || style === 1 || style === 3 || style === 7 ? 2.54 : 2.54;
  out.paths.push({ pts: [at, along(stem)], ink, w: LINE });
  let reach = stem;
  if (style === 0) {
    out.circles.push({ c: along(stem + 0.6), r: 0.6, ink, w: LINE });
    reach = stem + 1.2;
  } else if (style === 1 || style === 7) {
    out.paths.push({ pts: [along(stem, -0.9), along(stem + 1.3), along(stem, 0.9)], ink, w: LINE, closed: true, fill: "ink" });
    reach = stem + 1.3;
  } else if (style === 3) {
    out.paths.push({ pts: Array.from({ length: 13 }, (_, i) => along(stem + 0.4 * Math.sin((i / 12) * Math.PI * 2), -1.3 + (2.6 * i) / 12)), ink, w: LINE });
    reach = stem + 0.4;
  } else if (style === 4 || style === 8) {
    for (const [d, s] of [[0, 2.5], [0.6, 1.7], [1.2, 0.9], [1.8, 0.2]] as const) out.paths.push({ pts: [along(stem + d, -s), along(stem + d, s)], ink, w: LINE });
    reach = stem + 1.8;
  } else if (style === 5) {
    out.paths.push({ pts: [along(stem, -2), along(stem, 2), along(stem + 2), along(stem, -2)], ink, w: LINE, closed: true });
    reach = stem + 2;
  } else if (style === 6 || style === 9) {
    out.paths.push({ pts: [along(stem, -2), along(stem, 2)], ink, w: LINE });
    for (const s of [-2, -0.7, 0.6]) out.paths.push({ pts: [along(stem, s), along(stem + 1.2, s - 1)], ink, w: LINE });
    reach = stem + 1.2;
  } else {
    // A bar (2, 10) and anything else.
    out.paths.push({ pts: [along(stem, -2), along(stem, 2)], ink, w: LINE * 2 });
  }
  if (p.SHOWNETNAME === "F" || p.SHOWNETNAME === "FALSE") return;
  const name = altiumText(p.TEXT ?? "");
  const font = fonts.get(num(p, "FONTID", 1)) ?? DEFAULT_FONT;
  const anchor = along(reach + 0.5);
  out.texts.push({ a: anchor, t: name, size: font.size, ink, angle: 0, h: dir[0] > 0 ? "start" : dir[0] < 0 ? "end" : "middle", v: dir[1] > 0 ? "bottom" : dir[1] < 0 ? "top" : "middle" });
}

/** A port: its outline by style (arrows at the ends it points to), its name inside. */
function drawPort(out: Raw, p: Props, fonts: Map<number, Font>) {
  const [x, y] = location(p);
  const width = coord(p, "WIDTH") || 12.7;
  const half = (coord(p, "HEIGHT") || 2.54) / 2;
  const style = num(p, "STYLE");
  const vertical = style >= 4;
  const ends = style % 4; // 0 none, 1 left/top, 2 right/bottom, 3 both
  const tip = Math.min(half, width / 4);
  const local: XY[] = [];
  // Along the port (0 … width) and across it (−half … half), then laid horizontally or vertically.
  local.push(...(ends === 1 || ends === 3 ? ([[0, 0], [tip, half]] as XY[]) : ([[0, half]] as XY[])));
  local.push(...(ends === 2 || ends === 3 ? ([[width - tip, half], [width, 0], [width - tip, -half]] as XY[]) : ([[width, half], [width, -half]] as XY[])));
  local.push(...(ends === 1 || ends === 3 ? ([[tip, -half]] as XY[]) : ([[0, -half]] as XY[])));
  const pts = local.map(([a, c]) => (vertical ? ([x + c, y + a] as XY) : ([x + a, y + c] as XY)));
  out.paths.push({ pts, ink: "hier", w: LINE, closed: true });
  const font = fonts.get(num(p, "FONTID", 1)) ?? DEFAULT_FONT;
  const centre: XY = vertical ? [x, y + width / 2] : [x + width / 2, y];
  out.texts.push({ a: centre, t: altiumText(p.NAME ?? ""), size: Math.min(font.size, half * 1.6), ink: "hier", angle: vertical ? 90 : 0, h: "middle", v: "middle" });
}

/** A sheet symbol's entry: a small arrow on the box's side and its name inside the box. */
function drawEntry(out: Raw, entry: Props, box: { x: number; y: number; w: number; h: number }, fonts: Map<number, Font>) {
  const along = (num(entry, "DISTANCEFROMTOP") + num(entry, "DISTANCEFROMTOP_FRAC1") / 1_000_000) * 2.54;
  const side = num(entry, "SIDE");
  const at: XY = side === 0 ? [box.x, box.y - along] : side === 1 ? [box.x + box.w, box.y - along] : side === 2 ? [box.x + along, box.y] : [box.x + along, box.y - box.h];
  const inward: XY = side === 0 ? [1, 0] : side === 1 ? [-1, 0] : side === 2 ? [0, -1] : [0, 1];
  const across: XY = [-inward[1], inward[0]];
  const size = 1.2;
  const point = (d: number, s: number): XY => [at[0] + inward[0] * d + across[0] * s, at[1] + inward[1] * d + across[1] * s];
  out.paths.push({ pts: [point(0, -size / 2), point(size * 1.6, -size / 2), point(size * 2.2, 0), point(size * 1.6, size / 2), point(0, size / 2)], ink: "hier", w: LINE, closed: true });
  const font = fonts.get(num(entry, "TEXTFONTID", num(entry, "FONTID", 1))) ?? DEFAULT_FONT;
  const vertical = side >= 2;
  const name = altiumText(entry.NAME ?? "");
  const anchor = point(size * 2.6, 0);
  out.texts.push({ a: anchor, t: name, size: font.size, ink: "hier", angle: vertical ? 90 : 0, h: (vertical ? inward[1] < 0 : inward[0] > 0) ? "start" : "end", v: "middle" });
}

export type AltiumSheet = { drawing: SheetDrawing; children: { file: string; name: string }[] };

/** The FileHeader records of a SchDoc (compound file or Schematic ASCII), or null when it is neither. */
function recordsOf(bytes: Uint8Array): Props[] | null {
  if (isAltiumAsciiSchematic(bytes)) {
    const text = new TextDecoder("windows-1252").decode(bytes);
    return text.split(/\r?\n/).filter((line) => line.trim()).slice(1).map((line) => altiumProperties(new TextEncoder().encode(line)) as Props);
  }
  const container = CFB.read(bytes, { type: "array" });
  const index = container.FullPaths.findIndex((path) => path.toLowerCase().endsWith("/fileheader"));
  if (index < 0) return null;
  return altiumSchematicRecords(new Uint8Array(container.FileIndex[index]!.content as Uint8Array)).records as Props[];
}

/**
 * Draws one SchDoc. `netOf` names a wire's net by its record index (what the
 * reading resolved, so highlighting follows the IR's nets). Null when the file
 * holds no schematic records.
 */
export function drawAltiumSchematic(bytes: Uint8Array, file: string, netOf: (index: number) => string | undefined = () => undefined): AltiumSheet | null {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("AD schematic exceeds 64 MiB limit");
  const records = recordsOf(bytes);
  if (!records?.length) return null;
  let page: AltiumPage | null = null;
  try {
    page = isAltiumAsciiSchematic(bytes) ? null : altiumPage(bytes);
  } catch {
    page = null;
  }
  const sheetRecord = records.find((record) => record.RECORD === "31");
  const fonts = fontsOf(sheetRecord);
  const owned = ownership(records);
  const childrenOf = (index: number) => (owned.get(index) ?? []).map((i) => ({ index: i, record: records[i]! }));
  const out: Raw = { paths: [], circles: [], texts: [], skipped: {} };
  const skip = (kind: string) => (out.skipped[kind] = (out.skipped[kind] ?? 0) + 1);
  const symbols: { reference: string; value: string; pts: XY[] }[] = [];
  const sheets: { name: string; file: string; pts: XY[] }[] = [];
  const nets = new Set<string>();

  // The sheet's own parameters (Title, DocumentNumber, Revision …), for special strings and the title block.
  const sheetParameters: Record<string, string> = {};
  records.forEach((record) => {
    if (record.RECORD === "41" && record.OWNERINDEX === undefined && record.NAME) sheetParameters[record.NAME.toUpperCase()] = record.TEXT ?? "";
  });

  const component = new Map<number, Props>();
  records.forEach((record, index) => {
    if (record.RECORD === "1") component.set(index, record);
  });
  const template = new Set<number>();
  records.forEach((record, index) => {
    if (record.RECORD === "39") template.add(index);
  });
  // Which records belong to a component's part not shown (another part, another display mode), or below one that is not drawn.
  const shown = (record: Props): boolean => {
    const owner = record.OWNERINDEX === undefined ? undefined : component.get(Number(record.OWNERINDEX));
    if (!owner) return true;
    const part = num(record, "OWNERPARTID", -1);
    if (part > 0 && part !== (num(owner, "CURRENTPARTID") || 1)) return false;
    return num(record, "OWNERPARTDISPLAYMODE") === num(owner, "DISPLAYMODE");
  };

  // Components: their primitives, pins, designator and shown parameters.
  for (const [index, record] of component) {
    const covered: XY[] = [];
    const children = childrenOf(index).filter(({ record: child }) => shown(child));
    const fields = altiumFields(childrenOf(index).map(({ record: child }) => child).filter((child) => ["34", "41"].includes(child.RECORD ?? "") && child.NAME));
    const parts = num(record, "PARTCOUNT") - 1;
    const letter = parts > 1 ? String.fromCharCode(64 + Math.min(Math.max(num(record, "CURRENTPARTID") || 1, 1), 26)) : "";
    const reference = fields.DESIGNATOR || record.DESIGNATOR || "?";
    for (const { record: child } of children) {
      switch (child.RECORD) {
        case "2":
          drawPin(out, child, covered);
          break;
        case "34":
          if (!yes(child.ISHIDDEN)) pushText(out, child, `${child.TEXT || reference}${letter}`, "field", fonts);
          break;
        case "41":
          if (!yes(child.ISHIDDEN) && child.NAME) pushText(out, child, fields[child.NAME.toUpperCase()] ?? child.TEXT ?? "", child.NAME.toUpperCase() === "COMMENT" ? "field" : "fieldOther", fonts);
          break;
        case "4":
          pushText(out, child, altiumText(special(child.TEXT ?? "", fields)), "body", fonts);
          break;
        case "44":
        case "45":
        case "46":
        case "47":
        case "48":
          break;
        case "3":
          skip("ieee_symbol");
          break;
        case "30":
          skip("image");
          break;
        default:
          covered.push(...drawShape(out, child, "body"));
      }
    }
    if (covered.length) symbols.push({ reference, value: fields.COMMENT || record.LIBREFERENCE || "", pts: covered });
  }

  const children: { file: string; name: string }[] = [];
  records.forEach((record, index) => {
    const owner = record.OWNERINDEX === undefined ? undefined : Number(record.OWNERINDEX);
    if (owner !== undefined && component.has(owner)) return;
    const fromTemplate = owner !== undefined && template.has(owner);
    const ink: Ink = fromTemplate ? "frame" : "note";
    switch (record.RECORD) {
      case "27": {
        const net = netOf(index);
        if (net) nets.add(net);
        const pts = unitPoints(record);
        if (pts.length >= 2) out.paths.push({ pts, ink: "wire", w: LINE, ...(net ? { net } : {}) });
        break;
      }
      case "26": {
        const pts = unitPoints(record);
        if (pts.length >= 2) out.paths.push({ pts, ink: "bus", w: LINE * 3 });
        break;
      }
      case "37":
        out.paths.push({ pts: [location(record), corner(record)], ink: "bus", w: LINE * 2 });
        break;
      case "29":
        out.circles.push({ c: location(record), r: JUNCTION_R, ink: "junction", w: 0, fill: "ink" });
        break;
      case "25":
        pushText(out, record, altiumText(record.TEXT ?? ""), "label", fonts);
        break;
      case "17":
        drawPower(out, record, fonts);
        break;
      case "18":
        drawPort(out, record, fonts);
        break;
      case "22": {
        const [x, y] = location(record);
        out.paths.push({ pts: [[x - NO_ERC, y - NO_ERC], [x + NO_ERC, y + NO_ERC]], ink: "noConnect", w: LINE * 1.5 }, { pts: [[x - NO_ERC, y + NO_ERC], [x + NO_ERC, y - NO_ERC]], ink: "noConnect", w: LINE * 1.5 });
        break;
      }
      case "15": {
        const [x, y] = location(record);
        const [w, h] = [coord(record, "XSIZE"), coord(record, "YSIZE")];
        const box: XY[] = [[x, y], [x + w, y], [x + w, y - h], [x, y - h]];
        out.paths.push({ pts: box, ink: "sheet", w: LINE * 1.5, closed: true, ...(yes(record.ISSOLID) ? { fill: "body" as const } : {}) });
        let name = "";
        let target = "";
        for (const { record: child } of childrenOf(index)) {
          if (child.RECORD === "32") {
            name = altiumText(child.TEXT ?? "");
            if (!yes(child.ISHIDDEN)) pushText(out, child, name, "sheetName", fonts);
          } else if (child.RECORD === "33") {
            target = (child.TEXT ?? "").replace(/\\/g, "/");
            if (!yes(child.ISHIDDEN)) pushText(out, child, target.split("/").pop() ?? target, "sheetFile", fonts);
          } else if (child.RECORD === "16") drawEntry(out, child, { x, y, w, h }, fonts);
        }
        if (target) {
          sheets.push({ name: name || target, file: target, pts: box });
          children.push({ file: target, name: name || target.replace(/\.[^.]+$/, "") });
        }
        break;
      }
      case "4":
        if (!yes(record.ISHIDDEN)) pushText(out, record, altiumText(special(record.TEXT ?? "", sheetParameters)), fromTemplate ? "frame" : "note", fonts);
        break;
      case "28":
      case "209": {
        const [[x1, y1], [x2, y2]] = [location(record), corner(record)];
        if (record.RECORD === "209" || yes(record.SHOWBORDER)) out.paths.push({ pts: [[x1, y1], [x2, y1], [x2, y2], [x1, y2]], ink, w: LINE, closed: true });
        const font = fonts.get(num(record, "FONTID", 1)) ?? DEFAULT_FONT;
        const lines = (record.TEXT ?? "").split(/~1/).map((line) => line.replace(/~~/g, "~"));
        const [left, top] = [Math.min(x1, x2) + 0.5, Math.max(y1, y2) - 0.5];
        lines.slice(0, 200).forEach((line, i) => {
          if (line) out.texts.push({ a: [left, top - i * font.size * 1.4], t: line, size: font.size, ink, angle: 0, h: "start", v: "top" });
        });
        break;
      }
      case "41":
        if (owner === undefined && !yes(record.ISHIDDEN) && record.TEXT && record["LOCATION.X"] !== undefined) pushText(out, record, record.TEXT, "note", fonts);
        break;
      case "3":
        skip("ieee_symbol");
        break;
      case "30":
        skip("image");
        break;
      case "binary":
        skip("binary_record");
        break;
      case "5":
      case "6":
      case "7":
      case "8":
      case "9":
      case "10":
      case "11":
      case "12":
      case "13":
      case "14":
        if (owner === undefined || fromTemplate) drawShape(out, record, ink);
        break;
      default:
        if (record.RECORD && Number(record.RECORD) >= 215 && Number(record.RECORD) <= 218) skip("harness");
    }
  });

  // The page: Altium's sheet when its record is read, else the drawing's extent with a margin.
  const all: XY[] = [...out.paths.flatMap((path) => path.pts), ...out.circles.map((circle) => circle.c), ...out.texts.map((text) => text.a)];
  const extent = all.reduce((box, [x, y]) => ({ minX: Math.min(box.minX, x), maxX: Math.max(box.maxX, x), minY: Math.min(box.minY, y), maxY: Math.max(box.maxY, y) }), { minX: 0, maxX: 10, minY: 0, maxY: 10 });
  const width = page?.width ?? round(extent.maxX + 10);
  const height = page?.height ?? round(extent.maxY + 10);
  const toPage = ([x, y]: XY): XY => [round(x), round(height - y)];

  const paths: Path[] = out.paths.map(({ pts, ...rest }) => ({ ...rest, w: round(rest.w), d: pts.flatMap(toPage) }));
  const texts: Text[] = out.texts.map(({ a, ...rest }) => {
    const [x, y] = toPage(a);
    return { ...rest, size: round(rest.size), x, y };
  });
  const circles: Circle[] = out.circles.map(({ c, ...rest }) => {
    const [x, y] = toPage(c);
    return { ...rest, r: round(rest.r), x, y };
  });
  const frame = (pts: XY[]) => [Math.min(...pts.map(([x]) => x)), Math.min(...pts.map(([, y]) => y)), Math.max(...pts.map(([x]) => x)), Math.max(...pts.map(([, y]) => y))] as [number, number, number, number];
  const symbolHits: SymbolHit[] = symbols.map(({ reference, value, pts }) => ({ reference, value, box: frame(pts.map(toPage)) }));
  const sheetHits: SheetHit[] = sheets.map(({ name, file: target, pts }) => ({ name, file: target, box: frame(pts.map(toPage)) }));

  drawBorder(paths, texts, page, width, height, template.size > 0 ? null : { title: special(sheetParameters.TITLE ?? "", sheetParameters), number: sheetParameters.DOCUMENTNUMBER ?? sheetParameters.SHEETNUMBER ?? "", revision: sheetParameters.REVISION ?? "", date: sheetParameters.DATE ?? "", file }, yes(sheetRecord?.TITLEBLOCKON) || sheetRecord?.TITLEBLOCKON === undefined);

  const name = file.replace(/\.[^.]+$/, "");
  return {
    drawing: {
      file,
      name,
      paper: { size: page?.size ?? "User", width, height },
      titleBlock: { title: sheetParameters.TITLE ?? name, date: sheetParameters.DATE ?? "", rev: sheetParameters.REVISION ?? "", company: sheetParameters.COMPANYNAME ?? sheetParameters.ORGANIZATION ?? "", comments: [] },
      frame: false,
      paths,
      circles,
      texts,
      symbols: symbolHits,
      sheets: sheetHits,
      nets: [...nets].filter(Boolean).sort(),
      skipped: out.skipped,
    },
    children,
  };
}

/**
 * Altium's page: the outer edge, the border inside its margin with the
 * reference zones (column numbers along the top and bottom, row letters down
 * the sides), and — when the sheet has no template of its own — a plain title
 * block holding the sheet's values (no captions: the drawing carries no copy).
 */
function drawBorder(paths: Path[], texts: Text[], page: AltiumPage | null, width: number, height: number, block: { title: string; number: string; revision: string; date: string; file: string } | null, titleBlockOn: boolean) {
  const rect = (x: number, y: number, w: number, h: number, ink: Ink = "frame") => paths.push({ d: [x, y, x + w, y, x + w, y + h, x, y + h].map(round), ink, w: 0.2, closed: true });
  rect(0, 0, width, height);
  if (!page || !page.border) return;
  const m = page.margin;
  rect(m, m, width - 2 * m, height - 2 * m);
  if (page.zones) {
    const [columns, rows] = page.zones;
    const zone = Math.max(m * 0.8, 2);
    const inner = { x: m + zone, y: m + zone, w: width - 2 * (m + zone), h: height - 2 * (m + zone) };
    rect(inner.x, inner.y, inner.w, inner.h);
    for (let i = 0; i < columns; i += 1) {
      const x = inner.x + (inner.w * (i + 0.5)) / columns;
      for (const y of [m + zone / 2, height - m - zone / 2]) texts.push({ x: round(x), y: round(y), t: String(i + 1), size: 1.8, angle: 0, h: "middle", v: "middle", ink: "frame" });
      if (i > 0) {
        const xi = round(inner.x + (inner.w * i) / columns);
        paths.push({ d: [xi, m, xi, m + zone].map(round), ink: "frame", w: 0.2 }, { d: [xi, height - m - zone, xi, height - m].map(round), ink: "frame", w: 0.2 });
      }
    }
    for (let j = 0; j < rows; j += 1) {
      const y = inner.y + (inner.h * (j + 0.5)) / rows;
      for (const x of [m + zone / 2, width - m - zone / 2]) texts.push({ x: round(x), y: round(y), t: String.fromCharCode(65 + (j % 26)), size: 1.8, angle: 0, h: "middle", v: "middle", ink: "frame" });
      if (j > 0) {
        const yj = round(inner.y + (inner.h * j) / rows);
        paths.push({ d: [m, yj, m + zone, yj].map(round), ink: "frame", w: 0.2 }, { d: [width - m - zone, yj, width - m, yj].map(round), ink: "frame", w: 0.2 });
      }
    }
  }
  if (!block || !titleBlockOn) return;
  const inset = page.zones ? Math.max(m * 0.8, 2) : 0;
  const [bw, bh] = [Math.min(88.9, width * 0.4), 20.32];
  const [x, y] = [width - m - inset - bw, height - m - inset - bh];
  rect(x, y, bw, bh);
  paths.push({ d: [x, y + bh * 0.45, x + bw, y + bh * 0.45].map(round), ink: "frame", w: 0.2 }, { d: [x, y + bh * 0.72, x + bw, y + bh * 0.72].map(round), ink: "frame", w: 0.2 }, { d: [x + bw * 0.6, y + bh * 0.45, x + bw * 0.6, y + bh].map(round), ink: "frame", w: 0.2 });
  const text = (tx: number, ty: number, t: string, size: number, bold = false) => {
    if (t) texts.push({ x: round(tx), y: round(ty), t, size, angle: 0, h: "start", v: "middle", ink: "frame", ...(bold ? { bold: true as const } : {}) });
  };
  text(x + 1.5, y + bh * 0.225, block.title, 2.5, true);
  text(x + 1.5, y + bh * 0.585, block.number, 1.6);
  text(x + bw * 0.6 + 1.5, y + bh * 0.585, block.revision, 1.6);
  text(x + 1.5, y + bh * 0.86, block.file, 1.4);
  text(x + bw * 0.6 + 1.5, y + bh * 0.86, block.date, 1.4);
}
