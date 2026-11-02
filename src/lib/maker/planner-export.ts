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
  return out;
}
