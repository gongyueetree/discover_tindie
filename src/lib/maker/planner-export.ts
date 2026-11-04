import type {
  CircuitCanvasDocument,
  PlacedComponent,
} from "@/vendor/protopcb/design-core/document/types";
import { buildKicadPcb } from "@/vendor/protopcb/modules/board-editor/pcbExport";
import {
  parseSExpression,
  rootExpression,
  head,
  atom,
  type SExpr,
  type SList,
} from "@/vendor/canon/lib/eda/sexpr";
const serial = (n: SExpr): string =>
  n.kind === "atom"
    ? n.quoted
      ? JSON.stringify(n.value)
      : n.value
    : `(${n.items.map(serial).join(" ")})`;
/** Preserve source drill, custom pad and model definitions; edit only placement/identity. */
function native(c: PlacedComponent, source: string) {
  const root = rootExpression(parseSExpression(source));
  if (!root || !["footprint", "module"].includes(head(root) || ""))
    throw Error("Invalid source footprint");
  const rot = (360 - c.placement.rotation) % 360;
  const bottom = c.placement.side === "BOTTOM";
  const visit = (n: SExpr): string => {
    if (n.kind === "atom") return n.quoted ? JSON.stringify(n.value) : n.value;
    const tag = head(n);
    if (tag === "uuid" || tag === "tstamp") return "";
    if (tag === "layer" || tag === "layers")
      return `(${tag} ${n.items
        .slice(1)
        .map((i) => {
          let t = atom(i) || "";
          if (bottom)
            t = t.startsWith("F.")
              ? "B." + t.slice(2)
              : t.startsWith("B.")
                ? "F." + t.slice(2)
                : t;
          return JSON.stringify(t);
        })
        .join(" ")})`;
    if (
      bottom &&
      ["at", "start", "end", "mid", "center", "xy"].includes(tag || "")
    ) {
      const v = n.items.map(serial);
      if (v[2] && Number.isFinite(+v[2])) v[2] = String(-Number(v[2]));
      return `(${v.join(" ")})`;
    }
    return `(${n.items.map(visit).join(" ")})`;
  };
  const nodes = root.items
    .slice(2)
    .filter(
      (n) =>
        n.kind !== "list" ||
        (![
          "at",
          "layer",
          "uuid",
          "tstamp",
          "path",
          "version",
          "generator",
          "generator_version",
        ].includes(head(n) || "") &&
          !(
            ["fp_text", "property"].includes(head(n) || "") &&
            ["reference", "value"].includes(
              (atom(n.items[1]) || "").toLowerCase(),
            )
          )),
    )
    .map((n) => {
      if (n.kind === "list" && head(n) === "pad") {
        const text = visit(n);
        const p = rootExpression(parseSExpression(text))!;
        const at = p.items.find(
          (x): x is SList => x.kind === "list" && head(x) === "at",
        );
        if (at) {
          const x = atom(at.items[1]) || "0",
            y = atom(at.items[2]) || "0",
            a = Number(atom(at.items[3]) || 0);
          return serial(p).replace(serial(at), `(at ${x} ${y} ${a + rot})`);
        }
        return text;
      }
      return visit(n);
    });
  return `(footprint ${JSON.stringify(c.footprint.name)} (layer "${bottom ? "B" : "F"}.Cu") (at ${c.placement.xMm} ${c.placement.yMm} ${rot}) (property "Reference" ${JSON.stringify(c.reference)} (at 0 -3) (layer "${bottom ? "B" : "F"}.SilkS") (effects (font (size 1 1) (thickness 0.15)))) (property "Value" ${JSON.stringify(c.mpn)} (at 0 3) (layer "${bottom ? "B" : "F"}.Fab") (effects (font (size 1 1) (thickness 0.15)))) ${nodes.join("\n")})`;
}
/** A4 landscape drawing sheet (KiCad's default page for a new board), in mm. */
const SHEET = { w: 297, h: 210 };
/** Where the board's (0,0) goes so the board sits centred on the sheet, on a whole-mm grid. */
export function pageOffset(widthMm: number, heightMm: number) {
  const at = (sheet: number, size: number) => Math.max(10, Math.round((sheet - size) / 2));
  return { x: at(SHEET.w, widthMm), y: at(SHEET.h, heightMm) };
}
const POINT_TAGS = new Set(["start", "end", "mid", "center", "xy"]);
const TOP_SHAPES = new Set(["gr_line", "gr_arc", "gr_circle", "gr_rect", "gr_poly", "gr_curve", "gr_text", "segment", "arc", "via", "zone", "dimension"]);
/**
 * Moves every top-level board item by (dx, dy): board outline, tracks, vias, zones and footprint
 * positions. Footprint contents are relative to the footprint and are left alone.
 */
export function shiftBoard(source: string, dx: number, dy: number) {
  const root = rootExpression(parseSExpression(source));
  if (!root || (!dx && !dy)) return source;
  const edits: { start: number; end: number; text: string }[] = [];
  const move = (n: SList) => {
    const x = Number(atom(n.items[1])),
      y = Number(atom(n.items[2]));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const r = (v: number) => String(Math.round(v * 1e4) / 1e4);
    const rest = n.items.slice(3).map(serial);
    edits.push({ start: n.span.start, end: n.span.end, text: `(${[head(n), r(x + dx), r(y + dy), ...rest].join(" ")})` });
  };
  const walk = (n: SList) => {
    for (const c of n.items) {
      if (c.kind !== "list") continue;
      const tag = head(c) || "";
      if (POINT_TAGS.has(tag) || (tag === "at" && n !== root)) move(c);
      else if (tag !== "footprint") walk(c);
    }
  };
  for (const item of root.items) {
    if (item.kind !== "list") continue;
    const tag = head(item) || "";
    if (tag === "footprint") {
      const at = item.items.find((x): x is SList => x.kind === "list" && head(x) === "at");
      if (at) move(at);
    } else if (TOP_SHAPES.has(tag)) walk(item);
  }
  let out = source;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

export function plannerPcb(d: CircuitCanvasDocument) {
  const base = buildKicadPcb(d);
  const root = rootExpression(parseSExpression(base))!;
  const fps = root.items.filter(
    (n): n is SList => n.kind === "list" && head(n) === "footprint",
  );
  let out = base;
  for (let i = d.components.length - 1; i >= 0; i--) {
    const src = d.components[i].display?.attributes?.kicadSource;
    if (!src) continue;
    const fp = fps[fps.length - d.components.length + i];
    out =
      out.slice(0, fp.span.start) +
      native(d.components[i], src) +
      out.slice(fp.span.end);
  }
  // Coordinates start at the board corner (0,0); KiCad would draw the board over the sheet's
  // top-left corner, so place it in the middle of the A4 sheet instead.
  const o = pageOffset(d.board.widthMm, d.board.heightMm);
  return shiftBoard(out, o.x, o.y);
}
