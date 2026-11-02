import { SaxesParser } from "saxes";
import type { SilkMark } from "./board-silkscreen";
type Node = {
  tag: string;
  a: Record<string, string>;
  children: Node[];
  text: string;
};
export function eagleSilkscreen(source: string): SilkMark[] {
  if (/<!ENTITY/i.test(source)) throw Error("XML entities are not supported");
  const root: Node = { tag: "root", a: {}, children: [], text: "" },
    stack = [root];
  const parser = new SaxesParser();
  parser.on("opentag", (t) => {
    const n: Node = {
      tag: t.name,
      a: t.attributes as Record<string, string>,
      children: [],
      text: "",
    };
    stack[stack.length - 1].children.push(n);
    stack.push(n);
  });
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.on("text", (t) => {
    stack[stack.length - 1].text += t;
  });
  parser.write(source).close();
  const descendants = (n: Node, tag: string): Node[] =>
    n.children.flatMap((c) => [
      ...(c.tag === tag ? [c] : []),
      ...descendants(c, tag),
    ]);
  const board = descendants(root, "board")[0];
  if (!board) return [];
  const marks: SilkMark[] = [];
  function draw(
    nodes: Node[],
    ox = 0,
    oy = 0,
    rotation = "",
    ref = "",
    value = "",
  ) {
    const mirrored = rotation.includes("M"),
      angle = Number(rotation.replace(/[^\d.-]/g, "")) || 0,
      r = (angle * Math.PI) / 180;
    const transform = (x: number, y: number) => {
      if (mirrored) x = -x;
      return {
        x: ox + x * Math.cos(r) - y * Math.sin(r),
        y: -(oy + x * Math.sin(r) + y * Math.cos(r)),
      };
    };
    for (const n of nodes) {
      const layer = Number(n.a.layer);
      if (![21, 22, 25, 26, 27, 28].includes(layer)) continue;
      const back = (layer % 2 === 0) !== mirrored,
        side = back ? "back" : "front";
      const v = (key: string) => Number(n.a[key]) || 0;
      if (n.tag === "text" || n.tag === "attribute") {
        const text =
          n.tag === "attribute"
            ? n.a.name === "NAME"
              ? ref
              : n.a.name === "VALUE"
                ? value
                : n.a.value || ""
            : n.text.replace(/>NAME/g, ref).replace(/>VALUE/g, value);
        if (n.a.display === "off") continue;
        const textAngle = Number((n.a.rot || "").replace(/[^\d.-]/g, "")) || 0;
        marks.push({
          side,
          text,
          position: transform(v("x"), v("y")),
          angle: angle + (mirrored ? -textAngle : textAngle),
          mirror: mirrored !== !!n.a.rot?.includes("M"),
          size: v("size") || 1,
          width: 0.15,
          align: n.a.align?.includes("center")
            ? "center"
            : n.a.align?.includes("right")
              ? "right"
              : "left",
        });
      } else {
        let points: { x: number; y: number }[] = [];
        if (n.tag === "wire") {
          const x = v("x1"),
            y = v("y1"),
            ex = v("x2"),
            ey = v("y2"),
            sweep = (v("curve") * Math.PI) / 180;
          if (Math.abs(sweep) < 1e-8)
            points = [
              { x, y },
              { x: ex, y: ey },
            ];
          else {
            const t = 1 / (2 * Math.tan(sweep / 2)),
              cx = (x + ex) / 2 - (ey - y) * t,
              cy = (y + ey) / 2 + (ex - x) * t,
              rad = Math.hypot(x - cx, y - cy),
              start = Math.atan2(y - cy, x - cx);
            points = Array.from({ length: 65 }, (_, i) => ({
              x: cx + rad * Math.cos(start + (sweep * i) / 64),
              y: cy + rad * Math.sin(start + (sweep * i) / 64),
            }));
          }
        }
        if (n.tag === "circle")
          points = Array.from({ length: 97 }, (_, i) => ({
            x: v("x") + v("radius") * Math.cos((i * Math.PI) / 48),
            y: v("y") + v("radius") * Math.sin((i * Math.PI) / 48),
          }));
        if (n.tag === "rectangle")
          points = [
            { x: v("x1"), y: v("y1") },
            { x: v("x2"), y: v("y1") },
            { x: v("x2"), y: v("y2") },
            { x: v("x1"), y: v("y2") },
          ];
        if (n.tag === "polygon")
          points = n.children
            .filter((c) => c.tag === "vertex")
            .map((c) => ({ x: Number(c.a.x), y: Number(c.a.y) }));
        if (points.length)
          marks.push({
            side,
            points: points.map((p) => transform(p.x, p.y)),
            width: v("width") || 0.15,
            closed: n.tag !== "wire",
            filled: n.tag === "rectangle" || n.tag === "polygon",
          });
      }
    }
  }
  draw(board.children.find((n) => n.tag === "plain")?.children || []);
  const libraries = descendants(board, "library");
  for (const element of descendants(board, "element")) {
    const lib = libraries.find((l) => l.a.name === element.a.library),
      pkg =
        lib &&
        descendants(lib, "package").find((p) => p.a.name === element.a.package);
    if (!pkg) continue;
    const smashed = element.a.smashed === "yes";
    draw(
      pkg.children.filter(
        (n) => !(smashed && n.tag === "text" && />NAME|>VALUE/.test(n.text)),
      ),
      Number(element.a.x) || 0,
      Number(element.a.y) || 0,
      element.a.rot,
      element.a.name,
      element.a.value,
    );
    if (smashed)
      draw(element.children, 0, 0, "", element.a.name, element.a.value);
  }
  return marks;
}
