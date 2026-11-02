import { atom, childValue, directChildren, firstChild, head, parseSExpression, rootExpression, type SList } from "../canon/lib/eda/sexpr";
import { arcPoints } from "../canon/lib/eda/view-geometry";

/**
 * A KiCad schematic sheet as drawing primitives, laid out the way Eeschema
 * lays it out: library symbols placed with their instance's rotation and
 * mirror, pins with their names and numbers, fields where KiCad puts them,
 * labels in their shapes, sheets with their pins, the page frame and title
 * block. Read from the `.kicad_sch` source itself — the Canonical IR keeps
 * connectivity, not appearance.
 *
 * Coordinates are the schematic's own millimetres, y down. Colours are roles
 * (`Ink`), which the page maps to KiCad's colours; no text here is copy.
 * Nothing is inferred: an item this reader does not draw is counted in
 * `skipped`, not approximated.
 */
export type Ink =
  | "wire" | "bus" | "junction" | "body" | "pin" | "pinName" | "pinNumber" | "field" | "fieldOther"
  | "label" | "global" | "hier" | "noConnect" | "note" | "sheet" | "sheetName" | "sheetFile" | "frame";
export type Dash = "dash" | "dot" | "dash_dot" | "dash_dot_dot";
export type Path = { d: number[]; ink: Ink; w: number; closed?: true; fill?: "body" | "ink"; dash?: Dash; net?: string };
export type Circle = { x: number; y: number; r: number; ink: Ink; w: number; fill?: "body" | "ink" };
export type Text = {
  x: number;
  y: number;
  t: string;
  size: number;
  /** 0 reads left to right; 90 reads bottom to top. KiCad keeps schematic text readable. */
  angle: 0 | 90;
  h: "start" | "middle" | "end";
  v: "top" | "middle" | "bottom";
  ink: Ink;
  bold?: true;
  italic?: true;
};
export type SymbolHit = { reference: string; value: string; box: [number, number, number, number] };
export type SheetHit = {
  name: string;
  file: string;
  box: [number, number, number, number];
  /** The page it opens: the drawing of this placement (view.ts), or a page of a drawing cut into pages (protopcb/schematic.ts sheetPages). */
  page?: number;
  /**
   * Why it opens nothing (view.ts): `absent` — the project's files do not hold the sheet it names; `unreadable` — they
   * do, and it could not be drawn; `recursive` — it places a sheet above itself; `limit` — past the placements drawn.
   */
  missing?: "absent" | "unreadable" | "recursive" | "limit";
};
export type TitleBlock = { title: string; date: string; rev: string; company: string; comments: string[] };
export type SheetDrawing = {
  file: string;
  name: string;
  /** Where the sheet sits in the project's hierarchy, as KiCad writes it: `/` for the root, `/Power/` for a sheet it places (view.ts). */
  path?: string;
  /** The drawing of the sheet that places this one (its index in the view's list); absent for the root and for sheets nothing places. */
  parent?: number;
  paper: { size: string; width: number; height: number };
  titleBlock: TitleBlock;
  /** false: the drawing carries its own frame (EAGLE's, eagle-schematic.ts) and the viewer draws no KiCad page border. */
  frame?: false;
  paths: Path[];
  circles: Circle[];
  texts: Text[];
  symbols: SymbolHit[];
  sheets: SheetHit[];
  /** The nets drawn on this sheet's wires, for the net list beside it. */
  nets: string[];
  netPins?: Record<string, {reference:string;number:string;value:string}[]>;
  skipped: Record<string, number>;
};

/** KiCad's defaults, in millimetres. */
const LINE = 0.1524;
const BUS = 0.3048;
const TEXT = 1.27;
const PIN_NAME_OFFSET = 0.508;
const JUNCTION = 0.9144;
const NO_CONNECT = 0.635;
const TEXT_MARGIN = 0.254;
const MAX_TOKENS = 6_000_000;

const PAPER: Record<string, [number, number]> = {
  A5: [210, 148], A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841],
  A: [279.4, 215.9], B: [431.8, 279.4], C: [558.8, 431.8], D: [863.6, 558.8], E: [1117.6, 863.6],
  USLetter: [279.4, 215.9], USLegal: [355.6, 215.9], USLedger: [431.8, 279.4],
};

type XY = [number, number];
/** A 2×2 transform on y-down offsets: x' = a·x + b·y, y' = c·x + d·y. */
type M = [number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1];
const apply = (m: M, [x, y]: XY): XY => [m[0] * x + m[1] * y, m[2] * x + m[3] * y];
const times = (p: M, q: M): M => [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3]];
/** A counter-clockwise turn as seen on screen (y down). */
const turn = (degrees: number): M => {
  const r = (degrees * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e6) / 1e6;
  const s = Math.round(Math.sin(r) * 1e6) / 1e6;
  return [c, s, -s, c];
};
const MIRROR_X: M = [1, 0, 0, -1];
const MIRROR_Y: M = [-1, 0, 0, 1];
const round = (value: number) => Math.round(value * 1000) / 1000;

const num = (value: string | undefined, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const at = (node: SList | undefined): { x: number; y: number; angle: number } => ({
  x: num(atom(node?.items[1])),
  y: num(atom(node?.items[2])),
  angle: num(atom(node?.items[3])),
});
const xy = (node: SList | undefined): XY => [num(atom(node?.items[1])), num(atom(node?.items[2]))];
const points = (node: SList): XY[] => directChildren(firstChild(node, "pts") ?? node, "xy").map(xy);
/** A flag written either bare (`hide`) or as a list (`(hide yes)`), as KiCad's versions do. */
const flag = (node: SList | undefined, name: string): boolean =>
  !!node && node.items.some((item) => (item.kind === "atom" && item.value === name) || (item.kind === "list" && head(item) === name && atom(item.items[1]) !== "no"));

type Effects = { size: number; h: "left" | "right" | "center"; v: "top" | "bottom" | "center"; hidden: boolean; bold: boolean; italic: boolean };
function effectsOf(node: SList | undefined): Effects {
  const effects = node && firstChild(node, "effects");
  const font = effects && firstChild(effects, "font");
  const size = firstChild(font ?? ({ items: [] } as unknown as SList), "size");
  const justify = effects && firstChild(effects, "justify");
  const words = new Set((justify?.items.slice(1) ?? []).map((item) => atom(item)));
  return {
    size: num(atom(size?.items[2]) ?? atom(size?.items[1]), TEXT) || TEXT,
    h: words.has("left") ? "left" : words.has("right") ? "right" : "center",
    v: words.has("top") ? "top" : words.has("bottom") ? "bottom" : "center",
    hidden: flag(effects, "hide") || flag(node, "hide"),
    bold: flag(font, "bold"),
    italic: flag(font, "italic"),
  };
}

const H: Record<Effects["h"], Text["h"]> = { left: "start", center: "middle", right: "end" };
const V: Record<Effects["v"], Text["v"]> = { top: "top", center: "middle", bottom: "bottom" };
const flipH = (h: Text["h"]): Text["h"] => (h === "start" ? "end" : h === "end" ? "start" : h);
const flipV = (v: Text["v"]): Text["v"] => (v === "top" ? "bottom" : v === "bottom" ? "top" : v);

/**
 * Where KiCad draws a text that belongs to a transformed item (a symbol's
 * field): anchored where the file says, kept readable — a vertical text on a
 * symbol turned a quarter is drawn horizontal and the other way round — with
 * its justification turned so the text covers the same box KiCad's does.
 */
function placeText(x: number, y: number, angle: number, effects: Effects, m: M): Pick<Text, "x" | "y" | "angle" | "h" | "v"> {
  const vertical = Math.round(((angle % 180) + 180) % 180) === 90;
  const along: XY = vertical ? [0, -1] : [1, 0];
  const up: XY = vertical ? [-1, 0] : [0, -1];
  const turned = Math.abs(m[1]) > 0.5;
  const drawn: 0 | 90 = vertical !== turned ? 90 : 0;
  const drawAlong: XY = drawn === 90 ? [0, -1] : [1, 0];
  const drawUp: XY = drawn === 90 ? [-1, 0] : [0, -1];
  const a = apply(m, along);
  const u = apply(m, up);
  let h = H[effects.h];
  let v = V[effects.v];
  if (a[0] * drawAlong[0] + a[1] * drawAlong[1] < 0) h = flipH(h);
  if (u[0] * drawUp[0] + u[1] * drawUp[1] < 0) v = flipV(v);
  return { x: round(x), y: round(y), angle: drawn, h, v };
}

/** A text not attached to a symbol: drawn at its own angle, kept readable (180 reads as 0, 270 as 90). */
function freeText(x: number, y: number, angle: number, effects: Effects): Pick<Text, "x" | "y" | "angle" | "h" | "v"> {
  const a = ((Math.round(angle) % 360) + 360) % 360;
  const flipped = a === 180 || a === 270;
  return { x: round(x), y: round(y), angle: a === 90 || a === 270 ? 90 : 0, h: flipped ? flipH(H[effects.h]) : H[effects.h], v: V[effects.v] };
}

function strokeOf(node: SList, fallback: number): { w: number; dash?: Dash } {
  const stroke = firstChild(node, "stroke");
  const width = num(childValue(stroke ?? node, "width"), 0);
  const type = stroke ? childValue(stroke, "type") : undefined;
  return { w: width > 0 ? width : fallback, ...(type && ["dash", "dot", "dash_dot", "dash_dot_dot"].includes(type) ? { dash: type as Dash } : {}) };
}

function fillOf(node: SList): "body" | "ink" | undefined {
  const fill = firstChild(node, "fill");
  const type = fill ? (childValue(fill, "type") ?? atom(fill.items[1])) : undefined;
  if (type === "background") return "body";
  if (type === "outline") return "ink";
  if (type === "color") {
    const color = firstChild(fill!, "color");
    return color && num(atom(color.items[4]), 0) > 0 ? "body" : undefined;
  }
  return undefined;
}

const flat = (list: XY[]) => list.flatMap(([x, y]) => [round(x), round(y)]);
const circlePoints = (cx: number, cy: number, r: number): XY[] => Array.from({ length: 33 }, (_, i) => [cx + r * Math.cos((i * Math.PI) / 16), cy + r * Math.sin((i * Math.PI) / 16)]);

/** A graphic primitive in its own frame: points (closed or not), fill and stroke. */
function shapePoints(node: SList, kind: string, flipY: boolean): { pts: XY[]; closed: boolean } | null {
  const f = ([x, y]: XY): XY => (flipY ? [x, -y] : [x, y]);
  switch (kind) {
    case "rectangle": {
      const [a, b] = [f(xy(firstChild(node, "start"))), f(xy(firstChild(node, "end")))];
      return { pts: [a, [b[0], a[1]], b, [a[0], b[1]]], closed: true };
    }
    case "polyline":
      return { pts: points(node).map(f), closed: false };
    case "bezier": {
      const [p0, p1, p2, p3] = points(node).map(f);
      if (!p0 || !p1 || !p2 || !p3) return null;
      const curve: XY[] = Array.from({ length: 17 }, (_, i) => {
        const t = i / 16;
        const k = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3];
        return [k[0]! * p0[0] + k[1]! * p1[0] + k[2]! * p2[0] + k[3]! * p3[0], k[0]! * p0[1] + k[1]! * p1[1] + k[2]! * p2[1] + k[3]! * p3[1]];
      });
      return { pts: curve, closed: false };
    }
    case "circle": {
      const [cx, cy] = f(xy(firstChild(node, "center")));
      const r = num(childValue(node, "radius"));
      return { pts: circlePoints(cx, cy, r).slice(0, -1), closed: true };
    }
    case "arc": {
      const mid = firstChild(node, "mid");
      if (!mid) return null;
      const [a, m, b] = [f(xy(firstChild(node, "start"))), f(xy(mid)), f(xy(firstChild(node, "end")))];
      return { pts: arcPoints({ x: a[0], y: a[1] }, { x: m[0], y: m[1] }, { x: b[0], y: b[1] }).map((p: { x: number; y: number }) => [p.x, p.y] as XY), closed: false };
    }
    default:
      return null;
  }
}

/** The library symbol an instance names, from the sheet's embedded `lib_symbols`. */
export function librarySymbols(root: SList): Map<string, SList> {
  const lib = firstChild(root, "lib_symbols");
  return new Map((lib ? directChildren(lib, "symbol") : []).map((symbol) => [atom(symbol.items[1]) ?? "", symbol]));
}

/** The units of a library symbol to draw for an instance: the shared unit 0 and its own, in its body style. */
export function unitsOf(symbol: SList, unit: number, bodyStyle: number): SList[] {
  return [symbol, ...directChildren(symbol, "symbol")].filter((part) => {
    if (part === symbol) return true;
    const suffix = (atom(part.items[1]) ?? "").match(/_(\d+)_(\d+)$/);
    if (!suffix) return true;
    const [u, style] = [Number(suffix[1]), Number(suffix[2])];
    return (u === 0 || u === unit) && (style === 0 || style === bodyStyle);
  });
}

class Sheet {
  paths: Path[] = [];
  circles: Circle[] = [];
  texts: Text[] = [];
  symbols: SymbolHit[] = [];
  sheets: SheetHit[] = [];
  skipped: Record<string, number> = {};
  skip(kind: string) {
    this.skipped[kind] = (this.skipped[kind] ?? 0) + 1;
  }
  line(pts: XY[], ink: Ink, w: number, extra: Partial<Path> = {}) {
    if (pts.length >= 2) this.paths.push({ d: flat(pts), ink, w: round(w), ...extra });
  }
  text(t: string, size: number, place: Pick<Text, "x" | "y" | "angle" | "h" | "v">, ink: Ink, effects?: Pick<Effects, "bold" | "italic">) {
    if (!t) return;
    this.texts.push({ t, size: round(size), ...place, ink, ...(effects?.bold ? { bold: true } : {}), ...(effects?.italic ? { italic: true } : {}) });
  }
}

/** A rough text advance, for sizing label outlines: KiCad's font is about this wide. */
const advance = (text: string, size: number) => text.replace(/~\{([^}]*)\}/g, "$1").length * size * 0.82;

/**
 * Which placement of a sheet is drawn (a sheet placed twice is two placements, each with its own references): its
 * KiCad path, `/root-uuid/sheet-uuid/…`, as KiCad 7+ writes it in each symbol's `instances`; and, for a KiCad 6
 * project, the root's `symbol_instances` with the path they are keyed by (the same path without the root's uuid).
 */
export type SheetInstance = { path: string; legacyPath: string; legacy?: ReadonlyMap<string, string> };

/** A symbol's reference in one placement of its sheet, where the file records one; else undefined (its Reference field stands). */
function instanceReference(symbol: SList, instance: SheetInstance | undefined): string | undefined {
  if (!instance) return undefined;
  for (const instances of directChildren(symbol, "instances")) {
    for (const project of directChildren(instances, "project")) {
      for (const path of directChildren(project, "path")) {
        if (atom(path.items[1]) === instance.path) {
          const reference = childValue(path, "reference");
          if (reference) return reference;
        }
      }
    }
  }
  const uuid = childValue(symbol, "uuid");
  return uuid ? instance.legacy?.get(`${instance.legacyPath}/${uuid}`) : undefined;
}

function drawSymbol(out: Sheet, instance: SList, library: Map<string, SList>, placement?: SheetInstance) {
  const name = childValue(instance, "lib_id") ?? "";
  const position = at(firstChild(instance, "at"));
  const origin: XY = [position.x, position.y];
  const mirror = childValue(instance, "mirror");
  let m: M = turn(position.angle);
  if (mirror === "x") m = times(MIRROR_X, m);
  if (mirror === "y") m = times(MIRROR_Y, m);
  const place = (p: XY): XY => {
    const [x, y] = apply(m, p);
    return [origin[0] + x, origin[1] + y];
  };
  const properties = new Map(directChildren(instance, "property").map((property) => [atom(property.items[1]) ?? "", property]));
  const reference = instanceReference(instance, placement) ?? atom(properties.get("Reference")?.items[2]) ?? "";
  const value = atom(properties.get("Value")?.items[2]) ?? "";
  const symbol = library.get(childValue(instance, "lib_name") ?? name) ?? library.get(name);
  const covered: XY[] = [];

  if (!symbol) {
    out.skip("symbol_without_definition");
  } else {
    const power = !!firstChild(symbol, "power");
    const names = firstChild(symbol, "pin_names");
    const numbers = firstChild(symbol, "pin_numbers");
    const nameOffset = names ? num(childValue(names, "offset"), PIN_NAME_OFFSET) : PIN_NAME_OFFSET;
    const showNames = !flag(names, "hide");
    const showNumbers = !flag(numbers, "hide");
    const unit = num(childValue(instance, "unit"), 1);
    const bodyStyle = num(childValue(instance, "body_style") ?? childValue(instance, "convert"), 1);

    for (const part of unitsOf(symbol, unit, bodyStyle)) {
      for (const node of directChildren(part)) {
        const kind = head(node) ?? "";
        if (kind === "pin") {
          if (flag(node, "hide")) continue;
          const pin = at(firstChild(node, "at"));
          const length = num(childValue(node, "length"), 2.54);
          const rad = (pin.angle * Math.PI) / 180;
          const local: XY = [pin.x, -pin.y];
          const dir: XY = [Math.round(Math.cos(rad)), -Math.round(Math.sin(rad))];
          const start = place(local);
          const end = place([local[0] + dir[0] * length, local[1] + dir[1] * length]);
          const d = apply(m, dir);
          const style = atom(node.items[2]) ?? "line";
          covered.push(start, end);
          if (length > 0) {
            const bubble = style.includes("inverted") ? 0.3175 : 0;
            const stop: XY = [end[0] - d[0] * bubble * 2, end[1] - d[1] * bubble * 2];
            out.line([start, stop], "pin", LINE);
            if (bubble) out.circles.push({ x: round(end[0] - d[0] * bubble), y: round(end[1] - d[1] * bubble), r: bubble, ink: "pin", w: LINE });
            if (style.includes("clock")) {
              const n: XY = [-d[1], d[0]];
              out.line([[end[0] + n[0] * 0.5, end[1] + n[1] * 0.5], [end[0] + d[0] * 0.5, end[1] + d[1] * 0.5], [end[0] - n[0] * 0.5, end[1] - n[1] * 0.5]], "pin", LINE);
            }
          }
          const pinName = atom(firstChild(node, "name")?.items[1]) ?? "";
          const pinNumber = atom(firstChild(node, "number")?.items[1]) ?? "";
          const nameSize = effectsOf(firstChild(node, "name")).size;
          const numberSize = effectsOf(firstChild(node, "number")).size;
          const horizontal = Math.abs(d[0]) > 0.5;
          const angle: 0 | 90 = horizontal ? 0 : 90;
          // Along the pin, towards the body: + is the text's reading direction.
          const forward = horizontal ? d[0] > 0 : d[1] < 0;
          const mid: XY = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
          const above = (p: XY, by: number): XY => (horizontal ? [p[0], p[1] - by] : [p[0] - by, p[1]]);
          const below = (p: XY, by: number): XY => (horizontal ? [p[0], p[1] + by] : [p[0] + by, p[1]]);
          if (showNames && pinName && pinName !== "~" && !power) {
            if (nameOffset > 0) {
              const p: XY = [end[0] + d[0] * nameOffset, end[1] + d[1] * nameOffset];
              out.text(pinName, nameSize, { x: round(p[0]), y: round(p[1]), angle, h: forward ? "start" : "end", v: "middle" }, "pinName");
            } else {
              const p = above(mid, TEXT_MARGIN);
              out.text(pinName, nameSize, { x: round(p[0]), y: round(p[1]), angle, h: "middle", v: "bottom" }, "pinName");
            }
          }
          if (showNumbers && pinNumber && !power && length > 0) {
            const p = nameOffset > 0 || !showNames ? above(mid, TEXT_MARGIN) : below(mid, TEXT_MARGIN);
            out.text(pinNumber, numberSize, { x: round(p[0]), y: round(p[1]), angle, h: "middle", v: nameOffset > 0 || !showNames ? "bottom" : "top" }, "pinNumber");
          }
          continue;
        }
        if (kind === "text") {
          const effects = effectsOf(node);
          if (effects.hidden) continue;
          const p = at(firstChild(node, "at"));
          const [x, y] = place([p.x, -p.y]);
          // Library text angles are in tenths of a degree in older files; KiCad 6+ writes degrees.
          out.text(atom(node.items[1]) ?? "", effects.size, placeText(x, y, p.angle > 360 ? p.angle / 10 : p.angle, effects, m), "body", effects);
          continue;
        }
        const shape = shapePoints(node, kind, true);
        if (!shape) {
          if (!["property", "pin_names", "pin_numbers", "exclude_from_sim", "in_bom", "on_board", "in_pos_files", "power", "symbol", "embedded_fonts", "duplicate_pin_numbers_are_jumpers", "unit_name", "body_styles", "jumper_pin_groups"].includes(kind)) out.skip(`symbol_${kind}`);
          continue;
        }
        const placed = shape.pts.map(place);
        covered.push(...placed);
        const fill = fillOf(node);
        out.line(shape.closed ? placed : placed, "body", strokeOf(node, LINE).w, { ...(shape.closed ? { closed: true as const } : {}), ...(fill ? { fill } : {}) });
      }
    }
  }

  for (const [key, property] of properties) {
    const effects = effectsOf(property);
    // The Reference field shows this placement's reference.
    const text = key === "Reference" && reference ? reference : (atom(property.items[2]) ?? "");
    if (effects.hidden || !text || key === "Footprint" || key === "Datasheet") continue;
    const p = at(firstChild(property, "at"));
    const shown = flag(property, "show_name") ? `${key}: ${text}` : text;
    out.text(shown, effects.size, placeText(p.x, p.y, p.angle, effects, m), key === "Reference" || key === "Value" ? "field" : "fieldOther", effects);
  }

  if (reference && !reference.startsWith("#") && covered.length > 0) {
    const xs = covered.map(([x]) => x);
    const ys = covered.map(([, y]) => y);
    out.symbols.push({ reference, value, box: [round(Math.min(...xs)), round(Math.min(...ys)), round(Math.max(...xs)), round(Math.max(...ys))] });
  }
}

/** Label outlines (global and hierarchical), along `d` from the connection point. */
function labelShape(shape: string, length: number, half: number): XY[] {
  switch (shape) {
    case "input":
      return [[0, 0], [half, -half], [length, -half], [length, half], [half, half]];
    case "output":
      return [[0, -half], [length - half, -half], [length, 0], [length - half, half], [0, half]];
    case "bidirectional":
    case "tri_state":
      return [[0, 0], [half, -half], [length - half, -half], [length, 0], [length - half, half], [half, half]];
    default:
      return [[0, -half], [length, -half], [length, half], [0, half]];
  }
}

type Label = { name: string; p: { x: number; y: number; angle: number }; effects: Effects; shape: string };
const labelOf = (node: SList, shape: string | undefined): Label => ({
  name: atom(node.items[1]) ?? "",
  p: at(firstChild(node, "at")),
  effects: effectsOf(node),
  shape: shape ?? "passive",
});

function drawLabel(out: Sheet, { name, p, effects, shape }: Label, kind: "label" | "global_label" | "hierarchical_label" | "sheet_pin") {
  const a = ((Math.round(p.angle) % 360) + 360) % 360;
  const d: XY = [Math.round(Math.cos((a * Math.PI) / 180)), -Math.round(Math.sin((a * Math.PI) / 180))];
  const n: XY = [-d[1], d[0]];
  const to = (along: number, across: number): XY => [p.x + d[0] * along + n[0] * across, p.y + d[1] * along + n[1] * across];
  const vertical = a === 90 || a === 270;
  // Text reads left to right (or bottom to top); along `d` it starts at the near end when `d` points that way.
  const forward = vertical ? d[1] < 0 : d[0] > 0;
  if (kind === "label") {
    const offset = TEXT_MARGIN * 0.5;
    const anchor: XY = vertical ? [p.x - offset, p.y] : [p.x, p.y - offset];
    out.text(name, effects.size, { x: round(anchor[0]), y: round(anchor[1]), angle: vertical ? 90 : 0, h: forward ? "start" : "end", v: "bottom" }, "label", effects);
    return;
  }
  const half = effects.size * 0.75;
  if (kind === "global_label") {
    const length = advance(name, effects.size) + half * 2 + effects.size * 0.6;
    out.line(labelShape(shape, length, half).map(([x, y]) => to(x, y)), "global", LINE, { closed: true });
    const c = to(length / 2 + (shape === "input" ? half / 3 : shape === "output" ? -half / 3 : 0), 0);
    out.text(name, effects.size, { x: round(c[0]), y: round(c[1]), angle: vertical ? 90 : 0, h: "middle", v: "middle" }, "global", effects);
    return;
  }
  // Hierarchical labels and sheet pins: a small shape at the point, the name beyond it.
  const inward = kind === "sheet_pin" ? -1 : 1;
  const size = effects.size;
  const shapeLength = size;
  out.line(labelShape(shape, shapeLength, size / 2).map(([x, y]) => to(inward * x, y)), "hier", LINE, { closed: true });
  const t = to(inward * (shapeLength + size * 0.4), 0);
  const reading = inward > 0 ? forward : !forward;
  out.text(name, size, { x: round(t[0]), y: round(t[1]), angle: vertical ? 90 : 0, h: reading ? "start" : "end", v: "middle" }, kind === "sheet_pin" ? "sheetName" : "hier", effects);
}

/** A sheet a schematic places: the file it names, the name it gives it, the box's uuid, and the box's index in the drawing's `sheets`. */
export type SheetChild = { file: string; name: string; uuid: string; box: number };

const sheetProperty = (node: SList, ...keys: string[]) => {
  for (const property of directChildren(node, "property")) if (keys.includes(atom(property.items[1]) ?? "")) return atom(property.items[2]) ?? "";
  return "";
};

/**
 * What a sheet file places and how it is keyed, without drawing it (view.ts walks the hierarchy with this first): its
 * own uuid (a root's starts every KiCad 7+ placement path), the sheets it places, and a KiCad 6 root's
 * `symbol_instances` (each placement's reference by `/sheet-uuid…/symbol-uuid`).
 */
export function sheetOutline(text: string): { uuid: string; children: SheetChild[]; legacy: Map<string, string> } {
  const root = rootExpression(parseSExpression(text, { maxTokens: MAX_TOKENS }));
  if (!root || head(root) !== "kicad_sch") throw new Error("not_a_schematic");
  const children: SheetChild[] = [];
  directChildren(root, "sheet").forEach((node, box) => {
    const file = sheetProperty(node, "Sheetfile", "Sheet file");
    if (file) children.push({ file, name: sheetProperty(node, "Sheetname", "Sheet name") || file, uuid: childValue(node, "uuid") ?? "", box });
  });
  const legacy = new Map<string, string>();
  for (const block of directChildren(root, "symbol_instances")) {
    for (const path of directChildren(block, "path")) {
      const key = atom(path.items[1]);
      const reference = childValue(path, "reference");
      if (key && reference) legacy.set(key, reference);
    }
  }
  return { uuid: childValue(root, "uuid") ?? "", children, legacy };
}

/**
 * Draws one sheet. `netOfWire` maps a wire's KiCad uuid to its net (from the
 * IR), so the viewer can highlight a net without the IR itself. `placement`:
 * which placement of the sheet is drawn, for its references (a sheet placed
 * twice has its own on each).
 */
export function drawSchematic(
  text: string,
  file: string,
  name: string,
  netOfWire: Map<string, string>,
  /** The design's net for a pin, by `Reference|pin number`, where the caller knows it: names a group its wires alone do not. */
  netOfPin?: ReadonlyMap<string, string>,
  placement?: SheetInstance,
): { drawing: SheetDrawing; children: SheetChild[] } {
  const root = rootExpression(parseSExpression(text, { maxTokens: MAX_TOKENS }));
  if (!root || head(root) !== "kicad_sch") throw new Error("not_a_schematic");
  const out = new Sheet();
  const library = librarySymbols(root);
  const children: SheetChild[] = [];
  // Each wire's path, to be given the net its group turns out to be.
  const wirePath = new Map<SList, Path>();

  for (const node of directChildren(root)) {
    const kind = head(node) ?? "";
    switch (kind) {
      case "symbol":
        drawSymbol(out, node, library, placement);
        break;
      case "wire":
      case "bus": {
        const stroke = strokeOf(node, kind === "bus" ? BUS : LINE);
        const before = out.paths.length;
        out.line(points(node), kind === "bus" ? "bus" : "wire", stroke.w, stroke.dash ? { dash: stroke.dash } : {});
        if (kind === "wire" && out.paths.length > before) wirePath.set(node, out.paths[before]!);
        break;
      }
      case "bus_entry": {
        const p = at(firstChild(node, "at"));
        const size = xy(firstChild(node, "size"));
        out.line([[p.x, p.y], [p.x + size[0], p.y + size[1]]], "wire", LINE);
        break;
      }
      case "junction": {
        const p = at(firstChild(node, "at"));
        const diameter = num(childValue(node, "diameter"), 0) || JUNCTION;
        out.circles.push({ x: round(p.x), y: round(p.y), r: round(diameter / 2), ink: "junction", w: 0, fill: "ink" });
        break;
      }
      case "no_connect": {
        const p = at(firstChild(node, "at"));
        const s = NO_CONNECT;
        out.line([[p.x - s, p.y - s], [p.x + s, p.y + s]], "noConnect", LINE);
        out.line([[p.x - s, p.y + s], [p.x + s, p.y - s]], "noConnect", LINE);
        break;
      }
      case "label":
      case "global_label":
      case "hierarchical_label":
        drawLabel(out, labelOf(node, childValue(node, "shape")), kind);
        break;
      case "text": {
        const effects = effectsOf(node);
        const p = at(firstChild(node, "at"));
        if (!effects.hidden) out.text(atom(node.items[1]) ?? "", effects.size, freeText(p.x, p.y, p.angle, effects), "note", effects);
        break;
      }
      case "text_box": {
        const p = at(firstChild(node, "at"));
        const size = xy(firstChild(node, "size"));
        const effects = effectsOf(node);
        const stroke = strokeOf(node, 0);
        if (stroke.w > 0) out.line([[p.x, p.y], [p.x + size[0], p.y], [p.x + size[0], p.y + size[1]], [p.x, p.y + size[1]]], "note", stroke.w, { closed: true, ...(stroke.dash ? { dash: stroke.dash } : {}) });
        out.text(atom(node.items[1]) ?? "", effects.size, { x: round(p.x + effects.size * 0.4), y: round(p.y + effects.size * 0.4), angle: 0, h: "start", v: "top" }, "note", effects);
        break;
      }
      case "polyline":
      case "rectangle":
      case "circle":
      case "arc":
      case "bezier": {
        const shape = shapePoints(node, kind, false);
        if (!shape) {
          out.skip(kind);
          break;
        }
        const stroke = strokeOf(node, LINE);
        const fill = fillOf(node);
        out.line(shape.pts, "note", stroke.w, { ...(shape.closed ? { closed: true as const } : {}), ...(stroke.dash ? { dash: stroke.dash } : {}), ...(fill ? { fill } : {}) });
        break;
      }
      case "sheet": {
        const p = at(firstChild(node, "at"));
        const size = xy(firstChild(node, "size"));
        out.line([[p.x, p.y], [p.x + size[0], p.y], [p.x + size[0], p.y + size[1]], [p.x, p.y + size[1]]], "sheet", strokeOf(node, LINE).w, { closed: true });
        let sheetName = "";
        let sheetFile = "";
        for (const property of directChildren(node, "property")) {
          const key = atom(property.items[1]) ?? "";
          const value = atom(property.items[2]) ?? "";
          if (key === "Sheetname" || key === "Sheet name") sheetName = value;
          if (key === "Sheetfile" || key === "Sheet file") sheetFile = value;
          const effects = effectsOf(property);
          if (effects.hidden) continue;
          const q = at(firstChild(property, "at"));
          out.text(value, effects.size, freeText(q.x, q.y, q.angle, effects), key === "Sheetname" || key === "Sheet name" ? "sheetName" : key === "Sheetfile" || key === "Sheet file" ? "sheetFile" : "fieldOther", effects);
        }
        // A sheet pin is written `(pin "NAME" input (at …) …)`: its shape is the third item.
        for (const pin of directChildren(node, "pin")) drawLabel(out, labelOf(pin, atom(pin.items[2])), "sheet_pin");
        if (sheetFile) children.push({ file: sheetFile, name: sheetName || sheetFile, uuid: childValue(node, "uuid") ?? "", box: out.sheets.length });
        out.sheets.push({ name: sheetName, file: sheetFile, box: [round(p.x), round(p.y), round(p.x + size[0]), round(p.y + size[1])] });
        break;
      }
      case "image":
      case "table":
      case "netclass_flag":
      case "directive_label":
      case "rule_area":
        out.skip(kind);
        break;
      default:
        break;
    }
  }

  // The nets, from how the sheet connects (sheetConnectivity): each wire carries its group's name, and every named group is listed.
  const nets = new Set<string>();
  const netPins: NonNullable<SheetDrawing["netPins"]> = {};
  for (const group of sheetConnectivity(root, { netOfWire, ...(netOfPin ? { netOfPin } : {}) })) {
    if (!group.name) continue;
    netPins[group.name] = group.pins.map(({reference,number,value})=>({reference,number,value}));
    if (group.wires.length > 0 || group.pins.length > 1) nets.add(group.name);
    for (const wire of group.wires) {
      const path = wirePath.get(wire);
      if (path) path.net = group.name;
    }
  }

  const paper = firstChild(root, "paper");
  const paperName = atom(paper?.items[1]) ?? "A4";
  let [width, height] = paperName === "User" ? [num(atom(paper?.items[2]), 297), num(atom(paper?.items[3]), 210)] : (PAPER[paperName] ?? PAPER.A4!);
  if (flag(paper, "portrait")) [width, height] = [height, width];
  const block = firstChild(root, "title_block");
  const field = (key: string) => (block ? (childValue(block, key) ?? "") : "");
  const titleBlock: TitleBlock = {
    title: field("title"),
    date: field("date"),
    rev: field("rev"),
    company: field("company"),
    comments: block ? directChildren(block, "comment").map((comment) => atom(comment.items[2]) ?? "").filter(Boolean) : [],
  };

  return {
    drawing: {
      file,
      name,
      paper: { size: paperName, width, height },
      titleBlock,
      paths: out.paths,
      circles: out.circles,
      texts: out.texts,
      symbols: out.symbols,
      sheets: out.sheets,
      nets: [...nets].sort(),
      netPins,
      skipped: out.skipped,
    },
    children,
  };
}

/**
 * How a KiCad sheet connects, read from its geometry as Eeschema reads it:
 * a wire joins whatever touches it — its ends, and anything lying on it
 * (another wire's end, a pin's connection point, a label, a junction);
 * pins at one point are joined; labels join by name (local labels within
 * the sheet, global labels and power symbols everywhere), and so does a
 * part's hidden power input, by its pin name (KiCad's implicit power pins,
 * common in KiCad 5 symbols); and `links` join
 * points the caller knows to be one (a sheet pin and the hierarchical label
 * it stands for, on a sheet drawn flat). Buses are not followed.
 *
 * Each group is one net. Its name is the first of: the caller's name for one
 * of its wires (`netOfWire`), the one most of its pins have (`netOfPin`, by
 * `Reference|pin number`), a power symbol's Value, a hidden power input's
 * pin name, a global label, a local
 * or hierarchical label; else, for a group with a pin, KiCad's own
 * `Net-(<ref>-Pad<n>)`. `mergeByName: false` keeps same-named local labels
 * apart (a flat drawing of several sheets, whose labels are only local to
 * their own sheet).
 */
export type SheetPinEnd = {
  reference: string;
  number: string;
  x: number;
  y: number;
  power: boolean;
  value: string;
  /** A hidden power input's name (a logic part's VCC or GND not drawn): KiCad joins it to the global net of that name. */
  global?: string;
};
export type SheetLabel = { kind: "label" | "global_label" | "hierarchical_label"; name: string; x: number; y: number };
export type SheetNetGroup = { name: string | null; wires: SList[]; pins: SheetPinEnd[]; labels: SheetLabel[]; points: XY[] };
export type SheetLink = { key: string; x: number; y: number };

export function sheetConnectivity(
  root: SList,
  options: { netOfWire?: ReadonlyMap<string, string>; netOfPin?: ReadonlyMap<string, string>; links?: readonly SheetLink[]; mergeByName?: boolean } = {},
): SheetNetGroup[] {
  const library = librarySymbols(root);
  const key = ([x, y]: XY) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r && parent.has(r)) r = parent.get(r)!;
    let c = k;
    while (parent.get(c) !== r && parent.has(c)) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const add = (k: string) => {
    if (!parent.has(k)) parent.set(k, k);
  };
  const union = (a: string, b: string) => {
    add(a);
    add(b);
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent.set(ra, rb);
  };

  const wires: { node: SList; pts: XY[] }[] = [];
  const pins: SheetPinEnd[] = [];
  const labels: SheetLabel[] = [];
  const anchors: XY[] = [];
  for (const node of directChildren(root)) {
    const kind = head(node) ?? "";
    if (kind === "wire") {
      const pts = points(node);
      if (pts.length < 2) continue;
      wires.push({ node, pts });
      for (let i = 1; i < pts.length; i += 1) union(key(pts[i - 1]!), key(pts[i]!));
      anchors.push(...pts);
    } else if (kind === "junction") {
      const p = at(firstChild(node, "at"));
      add(key([p.x, p.y]));
      anchors.push([p.x, p.y]);
    } else if (kind === "label" || kind === "global_label" || kind === "hierarchical_label") {
      const p = at(firstChild(node, "at"));
      const name = atom(node.items[1]) ?? "";
      labels.push({ kind, name, x: p.x, y: p.y });
      add(key([p.x, p.y]));
      anchors.push([p.x, p.y]);
    } else if (kind === "symbol") {
      for (const pin of pinEnds(node, library)) {
        pins.push(pin);
        add(key([pin.x, pin.y]));
        anchors.push([pin.x, pin.y]);
      }
    }
  }
  for (const link of options.links ?? []) {
    add(key([link.x, link.y]));
    anchors.push([link.x, link.y]);
    union(key([link.x, link.y]), `link:${link.key}`);
  }

  // Anything lying on a wire is joined to it. Axis-aligned segments look up the points on their line; others check every point.
  const onRow = new Map<number, XY[]>();
  const onColumn = new Map<number, XY[]>();
  for (const p of anchors) {
    const [rx, ry] = [Math.round(p[0] * 100), Math.round(p[1] * 100)];
    (onRow.get(ry) ?? onRow.set(ry, []).get(ry)!).push(p);
    (onColumn.get(rx) ?? onColumn.set(rx, []).get(rx)!).push(p);
  }
  const EPS = 0.005;
  for (const { pts } of wires) {
    for (let i = 1; i < pts.length; i += 1) {
      const [a, b] = [pts[i - 1]!, pts[i]!];
      const horizontal = Math.abs(a[1] - b[1]) < EPS;
      const vertical = Math.abs(a[0] - b[0]) < EPS;
      const candidates = horizontal ? (onRow.get(Math.round(a[1] * 100)) ?? []) : vertical ? (onColumn.get(Math.round(a[0] * 100)) ?? []) : anchors;
      const [x0, x1, y0, y1] = [Math.min(a[0], b[0]) - EPS, Math.max(a[0], b[0]) + EPS, Math.min(a[1], b[1]) - EPS, Math.max(a[1], b[1]) + EPS];
      for (const p of candidates) {
        if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
        if (!horizontal && !vertical) {
          const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
          if (Math.abs(cross) / Math.hypot(b[0] - a[0], b[1] - a[1]) > EPS) continue;
        }
        union(key(a), key(p));
      }
    }
  }
  // Names join too: power symbols and global labels everywhere, local and hierarchical labels within the sheet.
  for (const pin of pins) {
    if (pin.power && pin.value) union(key([pin.x, pin.y]), `global:${pin.value}`);
    else if (pin.global) union(key([pin.x, pin.y]), `global:${pin.global}`);
  }
  for (const label of labels) {
    if (label.kind === "global_label") union(key([label.x, label.y]), `global:${label.name}`);
    else if (options.mergeByName !== false) union(key([label.x, label.y]), `local:${label.name}`);
  }

  // Groups, keyed by their root.
  const groups = new Map<string, SheetNetGroup>();
  const groupOf = (k: string) => {
    const r = find(k);
    let group = groups.get(r);
    if (!group) groups.set(r, (group = { name: null, wires: [], pins: [], labels: [], points: [] }));
    return group;
  };
  // Linked points first: where a sheet's pin was is where a label joining it belongs.
  for (const link of options.links ?? []) groupOf(key([link.x, link.y])).points.push([link.x, link.y]);
  for (const wire of wires) {
    const group = groupOf(key(wire.pts[0]!));
    group.wires.push(wire.node);
    group.points.push(...wire.pts);
  }
  for (const pin of pins) groupOf(key([pin.x, pin.y])).pins.push(pin);
  for (const label of labels) groupOf(key([label.x, label.y])).labels.push(label);

  for (const group of groups.values()) {
    const byWire = group.wires.map((wire) => options.netOfWire?.get(childValue(wire, "uuid") ?? "")).find(Boolean);
    const byPin = mostCommon(group.pins.map((pin) => options.netOfPin?.get(`${pin.reference}|${pin.number}`)));
    const power = group.pins.find((pin) => pin.power && pin.value)?.value ?? group.pins.find((pin) => pin.global)?.global;
    const global = group.labels.find((label) => label.kind === "global_label")?.name;
    const local = group.labels.find((label) => label.kind !== "global_label")?.name;
    const pin = group.pins.find((entry) => !entry.power && entry.reference && !entry.reference.startsWith("#"));
    group.name = byWire ?? byPin ?? power ?? global ?? local ?? (pin ? `Net-(${pin.reference}-Pad${pin.number})` : null);
  }
  return [...groups.values()];
}

/**
 * The name most of these give (ties to the first seen); none when none does. A group whose pins the design
 * puts on different nets — a sheet and a board that disagree — is named for most of them.
 */
export function mostCommon(names: readonly (string | undefined)[]): string | undefined {
  const counts = new Map<string, number>();
  for (const name of names) if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  let best: string | undefined;
  for (const [name, count] of counts) if (best === undefined || count > counts.get(best)!) best = name;
  return best;
}

/** Where each pin of a placed symbol connects (its `at`, turned and mirrored with the symbol) — hidden pins too: they connect. */
function pinEnds(instance: SList, library: Map<string, SList>): SheetPinEnd[] {
  const name = childValue(instance, "lib_id") ?? "";
  const symbol = library.get(childValue(instance, "lib_name") ?? name) ?? library.get(name);
  if (!symbol) return [];
  const position = at(firstChild(instance, "at"));
  const mirror = childValue(instance, "mirror");
  let m: M = turn(position.angle);
  if (mirror === "x") m = times(MIRROR_X, m);
  if (mirror === "y") m = times(MIRROR_Y, m);
  const properties = new Map(directChildren(instance, "property").map((property) => [atom(property.items[1]) ?? "", atom(property.items[2]) ?? ""]));
  const reference = properties.get("Reference") ?? "";
  const value = properties.get("Value") ?? "";
  const power = !!firstChild(symbol, "power");
  const unit = num(childValue(instance, "unit"), 1);
  const bodyStyle = num(childValue(instance, "body_style") ?? childValue(instance, "convert"), 1);
  const out: SheetPinEnd[] = [];
  for (const part of unitsOf(symbol, unit, bodyStyle)) {
    for (const node of directChildren(part, "pin")) {
      const p = at(firstChild(node, "at"));
      const [x, y] = apply(m, [p.x, -p.y]);
      const pinName = atom(firstChild(node, "name")?.items[1]) ?? "";
      const hiddenPower = !power && atom(node.items[1]) === "power_in" && flag(node, "hide") && pinName !== "" && pinName !== "~";
      out.push({ reference, number: atom(firstChild(node, "number")?.items[1]) ?? "", x: position.x + x, y: position.y + y, power, value, ...(hiddenPower ? { global: pinName } : {}) });
    }
  }
  return out;
}

