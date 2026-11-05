/**
 * JLCEDA / EasyEDA Pro schematics (.esch inside a .epro project) as the viewer's drawing primitives
 * (the same SheetDrawing the KiCad / EAGLE / Altium / EasyEDA Standard drawers produce): each
 * component drawn from its symbol (.esym: pins with names and numbers, rectangles, polylines,
 * circles, ellipses, arcs, texts), placed, rotated and mirrored as the sheet's COMPONENT record
 * says; its fields (designator, name, net flag names) where the sheet puts them; wires with their
 * net labels, junctions, no-connect marks, the sheet's own notes and boxes, and the drawing frame
 * with its title block. Tindie addition; eelib has no drawer for EasyEDA Pro.
 *
 * Units are 10 mil (0.254 mm) with y up; the drawing is flipped to the viewer's y down. A field
 * whose value is not on the sheet comes from the symbol, then from the project's device (its
 * `={Other Field}` references resolved). Nothing is guessed: a record this reader does not draw is
 * counted in `skipped`.
 */
import type { Ink, Path, SheetDrawing, Text, SymbolHit } from "@/vendor/eelib/kicad-schematic";
import {
  arcThrough,
  circlePoints,
  num,
  readRecords,
  readStyles,
  readSymbol,
  rectPoints,
  symbolUnit,
  text,
  truthy,
  type FontStyle,
  type LineStyle,
  type ProRecord,
  type ProSymbol,
  type XY,
} from "@/vendor/canon/lib/eda/jlcpro-records";

const MM = 0.254;
const MARGIN = 5;
/** EasyEDA draws a font size of 10 at 10 / 1.1 units; the viewer's size is the font size in mm. */
const fontMm = (size: number | undefined) => Math.max(0.6, ((size ?? 10) / 1.1) * MM * 0.9);
const strokeMm = (width: number | undefined) => Math.max(0.1, (width ?? 1) * MM * 0.6);

type RawPath = { d: XY[]; ink: Ink; w: number; closed?: true; fill?: "body" | "ink"; dash?: Path["dash"]; net?: string };
type Raw = {
  paths: RawPath[];
  circles: { c: XY; r: number; ink: Ink; w: number; fill?: "body" | "ink" }[];
  texts: { at: XY; t: string; size: number; angle: 0 | 90; h: Text["h"]; v: Text["v"]; ink: Ink; bold?: true }[];
  symbols: { reference: string; value: string; box: [number, number, number, number] }[];
  nets: Set<string>;
  skipped: Record<string, number>;
};
const skip = (raw: Raw, what: string) => (raw.skipped[what] = (raw.skipped[what] ?? 0) + 1);

/** A component's placement: local (symbol) point → sheet point; mirror flips the symbol's x before it turns. */
type Place = { x: number; y: number; rotation: number; mirror: boolean };
const IDENTITY: Place = { x: 0, y: 0, rotation: 0, mirror: false };
function apply(place: Place, [u, v]: XY): XY {
  const t = (place.rotation * Math.PI) / 180;
  const x = place.mirror ? -u : u;
  return [place.x + x * Math.cos(t) - v * Math.sin(t), place.y + x * Math.sin(t) + v * Math.cos(t)];
}

const H: Text["h"][] = ["start", "middle", "end"];
const V: Text["v"][] = ["top", "middle", "bottom"];
const flipH = (h: Text["h"]): Text["h"] => (h === "start" ? "end" : h === "end" ? "start" : h);
const flipV = (v: Text["v"]): Text["v"] => (v === "top" ? "bottom" : v === "bottom" ? "top" : v);

/** A text kept readable (reading left to right or bottom to top), as EasyEDA shows it. */
function pushText(raw: Raw, at: XY, rotation: number, font: FontStyle | undefined, value: string, ink: Ink, mirror = false) {
  if (!value.trim()) return;
  const r = (((Math.round(rotation / 90) * 90) % 360) + 360) % 360;
  let h = H[font?.h ?? 0] ?? "start";
  let v = V[font?.v ?? 2] ?? "bottom";
  if (mirror) h = flipH(h);
  if (r === 180 || r === 270) {
    h = flipH(h);
    v = flipV(v);
  }
  raw.texts.push({ at, t: value, size: fontMm(font?.size), angle: r === 90 || r === 270 ? 90 : 0, h, v, ink, ...(font?.bold ? { bold: true as const } : {}) });
}

const dashOf = (style: LineStyle | undefined): Path["dash"] | undefined =>
  !style?.dash ? undefined : style.dash === 2 ? "dot" : style.dash === 3 ? "dash_dot" : "dash";
const filled = (style: LineStyle | undefined) => !!style?.fill && !/^(none|transparent)$/i.test(style.fill);

/** The sheet's own colours as the viewer's inks: grey drawing aids, dark red headings, otherwise `fallback`. */
function inkOf(color: string | undefined, fallback: Ink): Ink {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color ?? "");
  if (!m) return fallback;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => parseInt(v!, 16)) as [number, number, number];
  if (Math.max(r, g, b) - Math.min(r, g, b) < 24 && r > 40 && r < 230) return "graphic";
  if (r > g + 60 && r > b + 60) return "sheet";
  return fallback;
}

/** One drawing record (RECT, CIRCLE, ELLIPSE, POLY, ARC, TEXT), in a symbol or on the sheet; `byColor`: inks from the record's own colours. */
function drawShape(raw: Raw, r: ProRecord, place: Place, lines: Map<string, LineStyle>, fonts: Map<string, FontStyle>, baseInk: Ink, textInk: Ink, byColor = false): boolean {
  const T = (p: XY) => apply(place, p);
  const styleIndex = r[0] === "RECT" ? 9 : r[0] === "CIRCLE" ? 5 : r[0] === "ELLIPSE" ? 7 : r[0] === "POLY" ? 4 : r[0] === "ARC" ? 8 : -1;
  const ink = byColor && styleIndex > 0 ? inkOf(lines.get(text(r[styleIndex]))?.color, baseInk) : baseInk;
  switch (r[0]) {
    case "RECT": {
      // id, x1, y1, x2, y2, rx, ry, rotation, line style
      const [x1, y1, x2, y2] = [num(r[2]), num(r[3]), num(r[4]), num(r[5])];
      if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined || x1 === x2 || y1 === y2) return true;
      const style = lines.get(text(r[9]));
      const pts = rectPoints(Math.min(x1, x2), Math.max(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), 0, num(r[6]) ?? 0);
      const turned = num(r[8]) ? pts.map((p) => rotateAbout(p, [x1, y1], num(r[8])!)) : pts;
      raw.paths.push({ d: turned.map(T), ink, w: strokeMm(style?.width), closed: true, ...(filled(style) && ink === "body" ? { fill: "body" as const } : {}), ...(dashOf(style) ? { dash: dashOf(style) } : {}) });
      return true;
    }
    case "CIRCLE": {
      // id, cx, cy, r, line style
      const [cx, cy, radius] = [num(r[2]), num(r[3]), num(r[4])];
      if (cx === undefined || cy === undefined || !radius) return true;
      const style = lines.get(text(r[5]));
      raw.circles.push({ c: T([cx, cy]), r: radius, ink, w: strokeMm(style?.width), ...(filled(style) ? { fill: "ink" as const } : {}) });
      return true;
    }
    case "ELLIPSE": {
      // id, cx, cy, rx, ry, rotation, line style
      const [cx, cy, rx, ry] = [num(r[2]), num(r[3]), num(r[4]), num(r[5])];
      if (cx === undefined || cy === undefined || !rx || !ry) return true;
      const style = lines.get(text(r[7]));
      if (Math.abs(rx - ry) < 1e-9) raw.circles.push({ c: T([cx, cy]), r: rx, ink, w: strokeMm(style?.width), ...(filled(style) ? { fill: "ink" as const } : {}) });
      else {
        const t = ((num(r[6]) ?? 0) * Math.PI) / 180;
        const d: XY[] = Array.from({ length: 49 }, (_, k) => {
          const a = (k * Math.PI) / 24;
          const [u, v] = [rx * Math.cos(a), ry * Math.sin(a)];
          return T([cx + u * Math.cos(t) - v * Math.sin(t), cy + u * Math.sin(t) + v * Math.cos(t)]);
        });
        raw.paths.push({ d, ink, w: strokeMm(style?.width), closed: true });
      }
      return true;
    }
    case "POLY": {
      // id, [x y …], closed, line style
      const values = Array.isArray(r[2]) ? (r[2] as unknown[]).map(num) : [];
      const d: XY[] = [];
      for (let k = 0; k + 1 < values.length; k += 2) if (values[k] !== undefined && values[k + 1] !== undefined) d.push([values[k]!, values[k + 1]!]);
      if (d.length < 2) return true;
      const style = lines.get(text(r[4]));
      const closed = truthy(r[3]) === true;
      raw.paths.push({ d: d.map(T), ink, w: strokeMm(style?.width), ...(closed ? { closed: true as const } : {}), ...(closed && filled(style) ? { fill: "ink" as const } : {}), ...(dashOf(style) ? { dash: dashOf(style) } : {}) });
      return true;
    }
    case "ARC": {
      // id, start, middle, end, line style
      const v = [2, 3, 4, 5, 6, 7].map((k) => num(r[k]));
      if (v.some((n) => n === undefined)) return true;
      const style = lines.get(text(r[8]));
      raw.paths.push({ d: arcThrough([v[0]!, v[1]!], [v[2]!, v[3]!], [v[4]!, v[5]!]).map(T), ink, w: strokeMm(style?.width), ...(dashOf(style) ? { dash: dashOf(style) } : {}) });
      return true;
    }
    case "TEXT": {
      // id, x, y, rotation, text, font style
      const [x, y] = [num(r[2]), num(r[3])];
      if (x === undefined || y === undefined) return true;
      const font = fonts.get(text(r[6]));
      pushText(raw, T([x, y]), (num(r[4]) ?? 0) + place.rotation, font, text(r[5]), byColor ? inkOf(font?.color, textInk) : textInk, place.mirror);
      return true;
    }
    default:
      return false;
  }
}

function rotateAbout([x, y]: XY, [cx, cy]: XY, degrees: number): XY {
  const t = (degrees * Math.PI) / 180;
  return [cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t), cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t)];
}

type Attr = { key: string; value: unknown; keyVisible?: boolean; visible?: boolean; at?: XY; rotation?: number; font: string };
/** ATTR: id, parent, key, value, key visible, value visible, x, y, rotation, font style. */
function readAttr(r: ProRecord): Attr {
  const [x, y] = [num(r[7]), num(r[8])];
  return { key: text(r[3]), value: r[4], keyVisible: truthy(r[5]), visible: truthy(r[6]), at: x !== undefined && y !== undefined ? [x, y] : undefined, rotation: num(r[9]), font: text(r[10]) };
}

/** A device's or component's field value, its `={Other}` references resolved. */
function resolveValue(value: string, lookup: (key: string) => string | undefined, depth = 0): string {
  if (!value.startsWith("=") || depth > 4) return value;
  return value.slice(1).replace(/\{([^}]+)\}/g, (_, key: string) => resolveValue(lookup(key) ?? "", lookup, depth + 1));
}

type Project = { sheetNames: Map<string, string>; devices: Map<string, Record<string, string>> };

function readProject(inputs: readonly { path: string; bytes: Uint8Array }[]): Project {
  const sheetNames = new Map<string, string>();
  const devices = new Map<string, Record<string, string>>();
  for (const input of inputs) {
    if (!/(^|\/)project\.json$/i.test(input.path) || input.bytes.length > 20 * 1024 * 1024) continue;
    let manifest: any;
    try {
      manifest = JSON.parse(new TextDecoder().decode(input.bytes));
    } catch {
      continue;
    }
    for (const [id, schematic] of Object.entries<any>(manifest?.schematics ?? {}))
      for (const sheet of Array.isArray(schematic?.sheets) ? schematic.sheets : []) if (sheet?.id !== undefined) sheetNames.set(`${id}/${sheet.id}`, text(sheet.name) || text(sheet.id));
    for (const [id, device] of Object.entries<any>(manifest?.devices ?? {})) {
      const attributes: Record<string, string> = {};
      for (const [key, value] of Object.entries(device?.attributes ?? {})) attributes[key] = text(value);
      devices.set(id, attributes);
    }
  }
  return { sheetNames, devices };
}

const stem = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "");

function bounds(points: XY[]): [number, number, number, number] | null {
  if (!points.length) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** The drawing frame (a symbol of type 20): border, zone ticks and letters, and the title block's table. */
function drawFrame(raw: Raw, place: Place, attrs: Map<string, Attr>, symbol: ProSymbol | undefined, partName: string) {
  const value = (key: string) => text(attrs.get(key)?.value);
  const W = num(value("Width")),
    Hh = num(value("Height"));
  if (!W || !Hh) return;
  const at = (x: number, y: number): XY => [place.x + x, place.y + y];
  const blade = num(value("Blade Width")) ?? 10;
  if (value("Border") !== "0") {
    raw.paths.push({ d: rectPoints(0, Hh, W, Hh).map(([x, y]) => at(x, y)), ink: "frame", w: 0.15, closed: true });
    raw.paths.push({ d: rectPoints(blade, Hh - blade, W - 2 * blade, Hh - 2 * blade).map(([x, y]) => at(x, y)), ink: "frame", w: 0.15, closed: true });
    const nx = Math.max(1, Math.min(26, num(value("X Region Count")) ?? 0)),
      ny = Math.max(1, Math.min(26, num(value("Y Region Count")) ?? 0));
    const font: FontStyle = { size: 10, h: 1, v: 1 };
    for (let k = 0; k < nx; k++) {
      const [x0, x1] = [blade + ((W - 2 * blade) * k) / nx, blade + ((W - 2 * blade) * (k + 1)) / nx];
      if (k) for (const [y0, y1] of [[0, blade], [Hh - blade, Hh]]) raw.paths.push({ d: [at(x0, y0), at(x0, y1)], ink: "frame", w: 0.15 });
      for (const y of [blade / 2, Hh - blade / 2]) pushText(raw, at((x0 + x1) / 2, y), 0, font, String(k + 1), "frame");
    }
    for (let k = 0; k < ny; k++) {
      const [y1, y0] = [Hh - blade - ((Hh - 2 * blade) * k) / ny, Hh - blade - ((Hh - 2 * blade) * (k + 1)) / ny];
      if (k) for (const [x0, x1] of [[0, blade], [W - blade, W]]) raw.paths.push({ d: [at(x0, y1), at(x1, y1)], ink: "frame", w: 0.15 });
      for (const x of [blade / 2, W - blade / 2]) pushText(raw, at(x, (y0 + y1) / 2), 0, font, String.fromCharCode(65 + k), "frame");
    }
  }
  if (!symbol || value("Title Block") === "0") return;
  // The title block sits where the sheet puts its fields: the sheet's field positions less the symbol's.
  const records = symbolUnit(symbol, partName);
  let offset: XY | undefined;
  for (const r of records) {
    if (r[0] !== "ATTR") continue;
    const own = readAttr(r);
    const placed = attrs.get(own.key)?.at;
    if (own.at && placed) {
      offset = [placed[0] - own.at[0], placed[1] - own.at[1]];
      break;
    }
  }
  if (!offset) return;
  const O = (x: number, y: number) => at(x + offset![0], y + offset![1]);
  const lookup = (key: string) => (attrs.has(key) ? text(attrs.get(key)!.value) : undefined);
  for (const table of records.filter((r) => r[0] === "TABLE")) {
    // TABLE: id, x, y (top left), row heights, column widths
    const [tx, ty] = [num(table[2]), num(table[3])];
    const rows = Array.isArray(table[4]) ? (table[4] as unknown[]).map((v) => num(v) ?? 0) : [];
    const cols = Array.isArray(table[5]) ? (table[5] as unknown[]).map((v) => num(v) ?? 0) : [];
    if (tx === undefined || ty === undefined || !rows.length || !cols.length) continue;
    const rowTop = (i: number) => ty - rows.slice(0, i).reduce((s, v) => s + v, 0);
    const colLeft = (i: number) => tx + cols.slice(0, i).reduce((s, v) => s + v, 0);
    for (const cell of records) {
      // TABEL_CELL: id, table, text, row, column, row span, column span, four border styles, font style
      if (cell[0] !== "TABEL_CELL" || text(cell[2]) !== text(table[1])) continue;
      const [row, col, rs, cs] = [num(cell[4]) ?? 0, num(cell[5]) ?? 0, num(cell[6]) ?? 1, num(cell[7]) ?? 1];
      const [x0, x1, y0, y1] = [colLeft(col), colLeft(col + cs), rowTop(row), rowTop(row + rs)];
      raw.paths.push({ d: [O(x0, y0), O(x1, y0), O(x1, y1), O(x0, y1), O(x0, y0)], ink: "frame", w: 0.12, closed: true });
      const content = resolveValue(text(cell[3]), lookup);
      const font = symbol.fonts.get(text(cell[12]));
      if (content) pushText(raw, O(x0 + 4, (y0 + y1) / 2), 0, { ...font, h: 0, v: 1 }, content, "frame");
    }
  }
}

function drawSheet(records: ProRecord[], name: string, file: string, symbols: Map<string, ProSymbol | null>, loadSymbol: (id: string) => ProSymbol | null, project: Project): SheetDrawing {
  const raw: Raw = { paths: [], circles: [], texts: [], symbols: [], nets: new Set(), skipped: {} };
  const { fonts, lines } = readStyles(records);
  const attrsOf = new Map<string, Map<string, Attr>>();
  for (const r of records) {
    if (r[0] !== "ATTR") continue;
    const parent = text(r[2]);
    const a = readAttr(r);
    (attrsOf.get(parent) ?? attrsOf.set(parent, new Map()).get(parent)!).set(a.key, a);
  }
  const symbolOf = (id: string) => {
    if (!symbols.has(id)) symbols.set(id, loadSymbol(id));
    return symbols.get(id) ?? null;
  };
  /** Pin ends by component id + pin id, for no-connect marks. */
  const pinEnds = new Map<string, XY>();

  for (const r of records) {
    const kind = r[0];
    if (kind === "COMPONENT") {
      // COMPONENT: id, part name, x, y, rotation, mirror
      const id = text(r[1]);
      const attrs = attrsOf.get(id) ?? new Map<string, Attr>();
      const device = project.devices.get(text(attrs.get("Device")?.value)) ?? {};
      const symbolId = text(attrs.get("Symbol")?.value) || device.Symbol || "";
      const symbol = symbolId ? symbolOf(symbolId) : null;
      const place: Place = { x: num(r[3]) ?? 0, y: num(r[4]) ?? 0, rotation: num(r[5]) ?? 0, mirror: truthy(r[6]) === true };
      const partName = text(r[2]);
      if (symbol?.type === 20 || attrs.has("Width") && attrs.has("Height") && !symbol?.parts.size) {
        drawFrame(raw, place, attrs, symbol ?? undefined, partName);
        continue;
      }
      if (!symbol) {
        skip(raw, "symbol not in project");
        continue;
      }
      const unit = symbolUnit(symbol, partName);
      const symbolAttrs = new Map<string, Attr>();
      const pinAttrs = new Map<string, Map<string, Attr>>();
      for (const s of unit) {
        if (s[0] !== "ATTR") continue;
        const a = readAttr(s);
        const parent = text(s[2]);
        if (!parent) symbolAttrs.set(a.key, a);
        else (pinAttrs.get(parent) ?? pinAttrs.set(parent, new Map()).get(parent)!).set(a.key, a);
      }
      const netFlag = symbol.type === 18 || symbol.type === 19;
      const from = raw.paths.length;
      const fromCircles = raw.circles.length;
      for (const s of unit) {
        if (s[0] === "PIN") {
          // PIN: id, shown, electric type, x, y, length, rotation
          if (truthy(s[2]) === false) continue;
          const [x, y, length] = [num(s[4]), num(s[5]), num(s[6]) ?? 0];
          if (x === undefined || y === undefined) continue;
          const rot = ((num(s[7]) ?? 0) * Math.PI) / 180;
          const end = apply(place, [x, y]);
          pinEnds.set(id + text(s[1]), end);
          if (length) raw.paths.push({ d: [end, apply(place, [x + length * Math.cos(rot), y + length * Math.sin(rot)])], ink: "pin", w: strokeMm(1) });
          const own = pinAttrs.get(text(s[1]));
          for (const [key, ink] of [["NAME", "pinName"], ["NUMBER", "pinNumber"]] as const) {
            const a = own?.get(key);
            if (!a?.at || !a.visible) continue;
            pushText(raw, apply(place, a.at), (a.rotation ?? 0) + place.rotation, symbol.fonts.get(a.font), text(a.value), ink, place.mirror);
          }
        } else if (s[0] === "ATTR" || s[0] === "OBJ" || s[0] === "HEAD" || s[0] === "DOCTYPE" || s[0] === "FONTSTYLE" || s[0] === "LINESTYLE") {
          if (s[0] === "OBJ") skip(raw, "image");
        } else if (!drawShape(raw, s, place, symbol.lines, symbol.fonts, netFlag ? "global" : "body", netFlag ? "global" : "body")) skip(raw, text(s[0]));
      }
      // Fields: the sheet's value and placement, else the symbol's, else the device's.
      const lookup = (key: string): string | undefined => {
        const own = attrs.get(key)?.value;
        if (own !== null && own !== undefined && own !== "") return text(own);
        const sym = symbolAttrs.get(key)?.value;
        if (sym !== null && sym !== undefined && sym !== "") return text(sym);
        return device[key];
      };
      const value = (key: string) => resolveValue(lookup(key) ?? "", lookup);
      const keys = new Set([...attrs.keys(), ...symbolAttrs.keys()]);
      for (const key of keys) {
        if (/^(Symbol|Device|Footprint|Unique ID|Reuse Block|Group ID|Channel ID|Relevance|Description)$/.test(key)) continue;
        const own = attrs.get(key);
        const sym = symbolAttrs.get(key);
        const visible = own?.visible ?? sym?.visible ?? false;
        if (!visible) continue;
        const at = own?.at ?? (sym?.at ? apply(place, sym.at) : undefined);
        if (!at) continue;
        const font = own?.font && fonts.has(own.font) ? fonts.get(own.font) : sym ? symbol.fonts.get(sym.font) : undefined;
        const rotation = own?.at ? own.rotation ?? 0 : (sym?.rotation ?? 0) + place.rotation;
        const shown = value(key);
        const label = (own?.keyVisible ?? sym?.keyVisible) ? `${key}: ${shown}` : shown;
        const ink: Ink = key === "Designator" ? "field" : key === "Global Net Name" || netFlag ? "global" : "fieldOther";
        pushText(raw, at, rotation, font, label, ink, own?.at ? false : place.mirror);
      }
      if (netFlag) {
        const net = value("Global Net Name") || value("Name");
        if (net) raw.nets.add(net);
      } else {
        const box = bounds([...raw.paths.slice(from).flatMap((p) => p.d), ...raw.circles.slice(fromCircles).flatMap((c) => [[c.c[0] - c.r, c.c[1] - c.r], [c.c[0] + c.r, c.c[1] + c.r]] as XY[])]);
        if (box) raw.symbols.push({ reference: value("Designator"), value: value("Value") || value("Name"), box });
      }
    } else if (kind === "WIRE") {
      // WIRE: id, [[x y x y …], …], line style
      const id = text(r[1]);
      const net = text(attrsOf.get(id)?.get("NET")?.value);
      const style = lines.get(text(r[3]));
      for (const line of Array.isArray(r[2]) ? (r[2] as unknown[]) : []) {
        if (!Array.isArray(line)) continue;
        const values = line.map(num);
        const d: XY[] = [];
        for (let k = 0; k + 1 < values.length; k += 2) if (values[k] !== undefined && values[k + 1] !== undefined) d.push([values[k]!, values[k + 1]!]);
        if (d.length >= 2) raw.paths.push({ d, ink: "wire", w: strokeMm(style?.width), ...(net ? { net } : {}) });
      }
      if (net) raw.nets.add(net);
      const label = attrsOf.get(id)?.get("NET");
      if (label?.visible && label.at && net) pushText(raw, label.at, label.rotation ?? 0, fonts.get(label.font), net, "label");
    } else if (kind === "BUS") {
      for (const line of Array.isArray(r[2]) ? (r[2] as unknown[]) : []) {
        const values = Array.isArray(line) ? line.map(num) : [];
        const d: XY[] = [];
        for (let k = 0; k + 1 < values.length; k += 2) if (values[k] !== undefined && values[k + 1] !== undefined) d.push([values[k]!, values[k + 1]!]);
        if (d.length >= 2) raw.paths.push({ d, ink: "bus", w: 0.3 });
      }
    } else if (["RECT", "CIRCLE", "ELLIPSE", "POLY", "ARC", "TEXT"].includes(text(kind))) drawShape(raw, r, IDENTITY, lines, fonts, "note", "note", true);
    else if (kind === "OBJ") skip(raw, "image");
    else if (!["DOCTYPE", "HEAD", "ATTR", "FONTSTYLE", "LINESTYLE"].includes(text(kind))) skip(raw, text(kind) || "empty");
  }

  // No-connect marks on the pins the sheet flags.
  for (const [parent, attrs] of attrsOf) {
    if (!/^(yes|true|1)$/i.test(text(attrs.get("NO_CONNECT")?.value))) continue;
    const end = pinEnds.get(parent);
    if (!end) continue;
    const s = 4;
    raw.paths.push({ d: [[end[0] - s, end[1] - s], [end[0] + s, end[1] + s]], ink: "noConnect", w: 0.15 });
    raw.paths.push({ d: [[end[0] - s, end[1] + s], [end[0] + s, end[1] - s]], ink: "noConnect", w: 0.15 });
  }
  junctions(raw);

  // Units → mm, y flipped, the drawing moved so it starts at the page margin.
  const all = bounds([...raw.paths.flatMap((p) => p.d), ...raw.circles.map((c) => c.c)]) ?? [0, 0, 0, 0];
  const [ox, top] = [all[0], all[3]];
  const X = (v: number) => Math.round(((v - ox) * MM + MARGIN) * 1000) / 1000;
  const Y = (v: number) => Math.round(((top - v) * MM + MARGIN) * 1000) / 1000;
  const paths: Path[] = raw.paths.map((p) => ({ d: p.d.flatMap(([x, y]) => [X(x), Y(y)]), ink: p.ink, w: p.w, ...(p.closed ? { closed: true as const } : {}), ...(p.fill ? { fill: p.fill } : {}), ...(p.dash ? { dash: p.dash } : {}), ...(p.net ? { net: p.net } : {}) }));
  const circles = raw.circles.map((c) => ({ x: X(c.c[0]), y: Y(c.c[1]), r: c.r * MM, ink: c.ink, w: c.w, ...(c.fill ? { fill: c.fill } : {}) }));
  const texts: Text[] = raw.texts.map((t) => ({ x: X(t.at[0]), y: Y(t.at[1]), t: t.t, size: t.size, angle: t.angle, h: t.h, v: t.v, ink: t.ink, ...(t.bold ? { bold: true as const } : {}) }));
  const symbolsHit: SymbolHit[] = raw.symbols.map((s) => ({ reference: s.reference, value: s.value, box: [X(s.box[0]), Y(s.box[3]), X(s.box[2]), Y(s.box[1])] }));
  return {
    file,
    name,
    paper: { size: "EasyEDA Pro", width: (all[2] - all[0]) * MM + 2 * MARGIN, height: (all[3] - all[1]) * MM + 2 * MARGIN },
    titleBlock: { title: name, date: "", rev: "", company: "", comments: [] },
    frame: false,
    paths,
    circles,
    texts,
    symbols: symbolsHit,
    sheets: [],
    nets: [...raw.nets].sort(),
    skipped: raw.skipped,
  } as SheetDrawing;
}

/** Junction dots where three or more wire ends meet, or a wire ends on another wire's middle (EasyEDA stores none). */
function junctions(raw: Raw) {
  const key = ([x, y]: XY) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const segments: [XY, XY][] = [];
  const ends = new Map<string, { at: XY; count: number }>();
  for (const p of raw.paths) {
    if (p.ink !== "wire") continue;
    for (let k = 1; k < p.d.length; k++) segments.push([p.d[k - 1]!, p.d[k]!]);
    for (const at of [p.d[0]!, p.d[p.d.length - 1]!]) {
      const entry = ends.get(key(at)) ?? { at, count: 0 };
      entry.count += 1;
      ends.set(key(at), entry);
    }
    // A wire's own bends are not junctions; its interior vertices count once each.
  }
  const onMiddle = (at: XY) =>
    segments.some(([a, b]) => {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
      const len = Math.hypot(dx, dy);
      if (!len) return false;
      const t = ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (len * len);
      if (t <= 1e-6 || t >= 1 - 1e-6) return false;
      return Math.abs((at[0] - a[0]) * dy - (at[1] - a[1]) * dx) / len < 0.01;
    });
  for (const { at, count } of ends.values()) if (count >= 3 || onMiddle(at)) raw.circles.push({ c: at, r: 2, ink: "junction", w: 0, fill: "ink" });
}

/** Every EasyEDA Pro schematic sheet among the project's files (.esch with their .esym symbols), in sheet order. */
export function jlcProSheets(inputs: readonly { path: string; bytes: Uint8Array }[]): SheetDrawing[] {
  const sheets = inputs.filter((a) => /\.esch$/i.test(a.path) && a.bytes.length < 40 * 1024 * 1024);
  if (!sheets.length) return [];
  const symbolFiles = new Map<string, Uint8Array>();
  for (const a of inputs) if (/\.esym$/i.test(a.path)) symbolFiles.set(stem(a.path), a.bytes);
  const project = readProject(inputs);
  const symbols = new Map<string, ProSymbol | null>();
  const loadSymbol = (id: string) => {
    const bytes = symbolFiles.get(id);
    if (!bytes) return null;
    try {
      return readSymbol(bytes);
    } catch {
      return null;
    }
  };
  const ordered = [...sheets].sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return ordered.flatMap((a) => {
    const records = readRecords(a.bytes);
    if (records[0]?.[0] !== "DOCTYPE" || text(records[0][1]) !== "SCH") return [];
    const parts = a.path.split("/");
    const name = project.sheetNames.get(`${parts.at(-2) ?? ""}/${stem(a.path)}`) ?? stem(a.path);
    try {
      return [drawSheet(records, name, a.path, symbols, loadSymbol, project)];
    } catch {
      return [];
    }
  });
}
