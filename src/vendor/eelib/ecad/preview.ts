import { symbolDefinition } from "./kicad-symbol";
import { atom, childValue, directChildren, firstChild, head, parseSExpression, rootExpression, type SList } from "./sexpr";
import { arcPoints } from "./view-geometry";

/**
 * A KiCad symbol or footprint, as shapes to draw (any file KiCad writes, not
 * only the ones our generator emits). Coordinates are SVG's: y grows down —
 * a symbol library's y-up axis is flipped here, a footprint's is already so.
 *
 * Read-only and bounded: the parser caps tokens, and a file that is not a
 * symbol library or a footprint is refused rather than half-drawn.
 */
type XY = [number, number];
export type Shape = { points: XY[]; closed: boolean; filled: boolean; width?: number; layer?: string };
/** `type`: KiCad's electrical type (power_in, input, passive, …). */
export type SymbolPin = { x: number; y: number; angle: number; length: number; name: string; number: string; type: string; showName: boolean; showNumber: boolean };
/** One unit of a symbol (a dual op amp: A, B and the supply unit), with what every unit shares. */
export type SymbolUnit = { unit: number; name: string | null; shapes: Shape[]; pins: SymbolPin[] };
/**
 * `units`: how many units the symbol has; `parts`: each of them, drawable on
 * its own. `shapes` and `pins` are unit 1's, as before units were sent.
 */
export type SymbolPreview = { kind: "symbol"; name: string; shapes: Shape[]; pins: SymbolPin[]; units: number; parts: SymbolUnit[]; namesHiddenInFile?: true };
export type Pad = { number: string; shape: string; x: number; y: number; w: number; h: number; angle: number; through: boolean; drill?: number };
export type FootprintPreview = { kind: "footprint"; name: string; pads: Pad[]; shapes: Shape[] };
export type EcadPreview = SymbolPreview | FootprintPreview;

/** Layers a footprint preview shows: silkscreen, fabrication outline, courtyard. */
export const FOOTPRINT_LAYERS = ["F.SilkS", "F.Fab", "F.CrtYd"] as const;
const MAX_TOKENS = 2_000_000;

const num = (value: string | undefined, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const xyOf = (node: SList | undefined): XY => [num(atom(node?.items[1])), num(atom(node?.items[2]))];
const ptsOf = (node: SList): XY[] => directChildren(firstChild(node, "pts") ?? node, "xy").map((entry) => xyOf(entry));
const circle = (center: XY, r: number): XY[] => Array.from({ length: 49 }, (_, i) => [center[0] + r * Math.cos((i * Math.PI) / 24), center[1] + r * Math.sin((i * Math.PI) / 24)]);
const arc = (a: XY, m: XY, b: XY): XY[] => arcPoints({ x: a[0], y: a[1] }, { x: m[0], y: m[1] }, { x: b[0], y: b[1] }).map((p: { x: number; y: number }) => [p.x, p.y] as XY);
const hasFlag = (node: SList | undefined, flag: string) =>
  !!node && node.items.some((item) => (item.kind === "atom" && item.value === flag) || (item.kind === "list" && head(item) === flag && atom(item.items[1]) !== "no"));

/** The graphic primitives KiCad uses in both symbols and footprints. */
function shapeOf(node: SList, kind: string): Shape | null {
  const fill = firstChild(node, "fill");
  const filled = (childValue(fill ?? node, "type") ?? atom(fill?.items[1]) ?? "none") !== "none";
  const width = num(childValue(firstChild(node, "stroke") ?? node, "width"), 0) || undefined;
  const at = (key: string) => xyOf(firstChild(node, key));
  switch (kind) {
    case "rectangle":
    case "fp_rect": {
      const [a, b] = [at("start"), at("end")];
      return { points: [a, [b[0], a[1]], b, [a[0], b[1]], a], closed: true, filled, ...(width ? { width } : {}) };
    }
    case "polyline":
    case "fp_poly":
      return { points: ptsOf(node), closed: kind === "fp_poly", filled, ...(width ? { width } : {}) };
    case "fp_line":
      return { points: [at("start"), at("end")], closed: false, filled: false, ...(width ? { width } : {}) };
    case "circle":
      return { points: circle(at("center"), num(childValue(node, "radius"))), closed: true, filled, ...(width ? { width } : {}) };
    case "fp_circle": {
      const [c, e] = [at("center"), at("end")];
      return { points: circle(c, Math.hypot(e[0] - c[0], e[1] - c[1])), closed: true, filled, ...(width ? { width } : {}) };
    }
    case "arc":
    case "fp_arc":
      // KiCad 6+ arcs: start, mid, end. Older center-and-angle arcs are skipped rather than guessed.
      return firstChild(node, "mid") ? { points: arc(at("start"), at("mid"), at("end")), closed: false, filled: false, ...(width ? { width } : {}) } : null;
    default:
      return null;
  }
}

/** From this many named pins a symbol is a part whose pin names must be seen to be checked. */
const LARGE_SYMBOL_PINS = 10;

/** Every pin of a symbol, in its own body and its units. */
function allPins(symbol: SList): SList[] {
  return directChildren(symbol).flatMap((node) => (head(node) === "pin" ? [node] : head(node) === "symbol" ? directChildren(node, "pin") : []));
}

/** The first symbol of a symbol library: each of its units (with the shared unit 0), body style 1. */
export function previewSymbol(text: string): SymbolPreview {
  const root = rootExpression(parseSExpression(text, { maxTokens: MAX_TOKENS }));
  if (!root || head(root) !== "kicad_symbol_lib") throw new Error("not_a_symbol_library");
  const first = directChildren(root, "symbol")[0];
  const name = atom(first?.items[1]);
  if (!first || !name) throw new Error("no_symbol");
  const symbol = symbolDefinition(root, name) ?? first;
  // A large part whose file hides every pin name (an MCU from ezPLM did, 2026-10-12) is still previewed with
  // them: a box of unnamed pins cannot be checked. Small symbols that hide their names on purpose — an op-amp's
  // + and − drawn by its triangle, a transistor — keep the file's choice. The page says when names were shown
  // against the file (namesHiddenInFile).
  const hiddenInFile = hasFlag(firstChild(symbol, "pin_names"), "hide");
  const namedPins = new Set(
    allPins(symbol)
      .map((node) => atom(firstChild(node, "name")?.items[1]) ?? "~")
      .filter((pinName) => pinName !== "~" && !/^\d+$/.test(pinName)),
  ).size;
  const namesHiddenInFile = hiddenInFile && namedPins >= LARGE_SYMBOL_PINS;
  const showNames = !hiddenInFile || namesHiddenInFile;
  const showNumbers = !hasFlag(firstChild(symbol, "pin_numbers"), "hide");
  const flip = ([x, y]: XY): XY => [x, -y];

  /** What one block of the symbol draws. */
  const read = (unit: SList) => {
    const shapes: Shape[] = [];
    const pins: SymbolPin[] = [];
    for (const node of directChildren(unit)) {
      const kind = head(node) ?? "";
      if (kind === "pin") {
        // A hidden no-connect pin is not drawn, as KiCad does not draw it: an op-amp's NC pins sit inside its triangle (user report
        // 2026-10-18). A hidden power pin still is — its pad is checked against it — with its name and number left off.
        const hidden = hasFlag(node, "hide");
        if (hidden && atom(node.items[1]) === "no_connect") continue;
        const at = firstChild(node, "at");
        const pinName = atom(firstChild(node, "name")?.items[1]) ?? "";
        pins.push({
          x: num(atom(at?.items[1])),
          y: -num(atom(at?.items[2])),
          // Flipping y mirrors the angle too.
          angle: (360 - num(atom(at?.items[3]))) % 360,
          length: num(childValue(node, "length")),
          name: pinName.replace(/~\{([^}]*)\}/g, "$1"),
          number: atom(firstChild(node, "number")?.items[1]) ?? "",
          type: atom(node.items[1]) ?? "",
          showName: showNames && pinName !== "~" && !hidden,
          showNumber: showNumbers && !hidden,
        });
        continue;
      }
      const shape = shapeOf(node, kind);
      if (shape) shapes.push({ ...shape, points: shape.points.map(flip) });
    }
    return { shapes, pins };
  };

  // Sub-symbols are named <name>_<unit>_<body style>: unit 0 is drawn with every unit; body style 2 (De Morgan) is not drawn.
  const blocks = directChildren(symbol, "symbol").flatMap((block) => {
    const suffix = (atom(block.items[1]) ?? "").match(/_(\d+)_(\d+)$/);
    const unit = suffix ? Number(suffix[1]) : 0;
    return !suffix || Number(suffix[2]) <= 1 ? [{ unit, block, name: atom(firstChild(block, "unit_name")?.items[1]) ?? null }] : [];
  });
  const shared = [read(symbol), ...blocks.filter((entry) => entry.unit === 0).map((entry) => read(entry.block))];
  const numbers = [...new Set(blocks.map((entry) => entry.unit).filter((unit) => unit > 0))].sort((a, b) => a - b);
  const parts: SymbolUnit[] = (numbers.length ? numbers : [1]).map((unit) => {
    const own = blocks.filter((entry) => entry.unit === unit);
    const drawn = [...shared, ...own.map((entry) => read(entry.block))];
    return { unit, name: own.find((entry) => entry.name)?.name ?? null, shapes: drawn.flatMap((entry) => entry.shapes), pins: drawn.flatMap((entry) => entry.pins) };
  });
  return { kind: "symbol", name: name.split(":").at(-1)!, shapes: parts[0]!.shapes, pins: parts[0]!.pins, units: parts.length, parts, ...(namesHiddenInFile ? { namesHiddenInFile: true } : {}) };
}

export function previewFootprint(text: string): FootprintPreview {
  const root = rootExpression(parseSExpression(text, { maxTokens: MAX_TOKENS }));
  if (!root || !["footprint", "module"].includes(head(root) ?? "")) throw new Error("not_a_footprint");
  const pads: Pad[] = directChildren(root, "pad").map((pad) => {
    const at = firstChild(pad, "at");
    const size = firstChild(pad, "size");
    const drill = firstChild(pad, "drill");
    return {
      number: atom(pad.items[1]) ?? "",
      shape: atom(pad.items[3]) ?? "rect",
      x: num(atom(at?.items[1])),
      y: num(atom(at?.items[2])),
      w: num(atom(size?.items[1])),
      h: num(atom(size?.items[2])),
      angle: num(atom(at?.items[3])),
      through: (atom(pad.items[2]) ?? "").includes("thru_hole"),
      ...(drill ? { drill: num(atom(drill.items[1])) } : {}),
    };
  });
  const shapes: Shape[] = [];
  for (const node of directChildren(root)) {
    const kind = head(node) ?? "";
    if (!kind.startsWith("fp_")) continue;
    const layer = childValue(node, "layer");
    if (!layer || !(FOOTPRINT_LAYERS as readonly string[]).includes(layer)) continue;
    const shape = shapeOf(node, kind);
    if (shape) shapes.push({ ...shape, layer });
  }
  return { kind: "footprint", name: (atom(root.items[1]) ?? "").split(":").at(-1)!, pads, shapes };
}

/** By file name, then by content: a symbol library or a footprint. */
export function previewEcad(text: string, name = ""): EcadPreview {
  if (/\.kicad_sym$/i.test(name) || /^\s*\(kicad_symbol_lib/.test(text)) return previewSymbol(text);
  // KiCad 5 `.lib` libraries are not supported in this vendored copy (official KiCad 10 libraries are S-expression).
  if (text.startsWith("EESchema-LIBRARY")) throw new Error("legacy_symbol_library");
  return previewFootprint(text);
}
