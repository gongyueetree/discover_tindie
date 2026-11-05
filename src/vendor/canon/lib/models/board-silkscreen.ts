import { eagleSilkscreen } from "./eagle-silkscreen";
import { legacyBoardToKicadPcb } from "../eda/kicad-legacy-board";
import {
  atom,
  childValue,
  directChildren,
  firstChild,
  head,
  parseSExpression,
  rootExpression,
  type SList,
} from "../eda/sexpr";
import { arcPoints } from "../eda/view-geometry";
import type { InputAsset, PcbIr } from "../eda/types";
type Point = { x: number; y: number };
export type SilkMark = {
  side: "front" | "back";
  points?: Point[];
  width: number;
  closed?: boolean;
  filled?: boolean;
  text?: string;
  position?: Point;
  angle?: number;
  size?: number;
  mirror?: boolean;
  align?: CanvasTextAlign;
};
export function boardSilkscreen(pcb: PcbIr, assets: InputAsset[]): SilkMark[] {
  const paths = pcb.sourceRefs.map((r) => r.path);
  const boards = assets.filter((a) => /\.(kicad_pcb|brd)$/i.test(a.path));
  const source =
    boards.find((a) => paths.includes(a.path)) ||
    boards.find((a) =>
      paths.some((p) => p.split("/").pop() === a.path.split("/").pop()),
    ) ||
    (boards.length === 1 ? boards[0] : undefined);
  if (!source) return [];
  const sourceText = new TextDecoder().decode(source.bytes);
  // A KiCad legacy .brd, as the .kicad_pcb KiCad makes of it (local change: ../../NOTICE.md).
  const legacy = /\.brd$/i.test(source.path) ? legacyBoardToKicadPcb(sourceText) : undefined;
  if (/\.brd$/i.test(source.path) && !legacy) return eagleSilkscreen(sourceText);
  const root = rootExpression(parseSExpression(legacy ?? sourceText));
  if (!root || head(root) !== "kicad_pcb") return [];
  const marks: SilkMark[] = [];
  const point = (n: SList | undefined): Point => ({
    x: Number(atom(n?.items[1])) || 0,
    y: Number(atom(n?.items[2])) || 0,
  });
  function read(
    parent: SList,
    origin: Point = { x: 0, y: 0 },
    angle = 0,
    ref = "",
    value = "",
  ) {
    const a = (-angle * Math.PI) / 180;
    const transform = (p: Point) => ({
      x: origin.x + p.x * Math.cos(a) - p.y * Math.sin(a),
      y: origin.y + p.x * Math.sin(a) + p.y * Math.cos(a),
    });
    for (const n of directChildren(parent)) {
      const layer = childValue(n, "layer");
      if (layer !== "F.SilkS" && layer !== "B.SilkS") continue;
      const side = layer === "F.SilkS" ? "front" : "back";
      const type = head(n) || "";
      const width =
        Number(childValue(firstChild(n, "stroke") || n, "width")) || 0.15;
      if (/^(gr|fp)_(line|rect|poly|circle|arc)$/.test(type)) {
        const kind = type.split("_")[1];
        const start = point(firstChild(n, "start")),
          end = point(firstChild(n, "end"));
        let points: Point[] = [];
        if (kind === "line") points = [start, end];
        if (kind === "rect")
          points = [
            start,
            { x: end.x, y: start.y },
            end,
            { x: start.x, y: end.y },
            start,
          ];
        if (kind === "poly")
          points = directChildren(firstChild(n, "pts") || n, "xy").map(point);
        if (kind === "circle") {
          const c = point(firstChild(n, "center"));
          const radius = Math.hypot(end.x - c.x, end.y - c.y);
          points = Array.from({ length: 97 }, (_, i) => ({
            x: c.x + radius * Math.cos((i * Math.PI) / 48),
            y: c.y + radius * Math.sin((i * Math.PI) / 48),
          }));
        }
        if (kind === "arc") {
          const mid = firstChild(n, "mid");
          if (mid) points = arcPoints(start, point(mid), end);
          else {
            const sweep = (Number(childValue(n, "angle")) * Math.PI) / 180;
            const radius = Math.hypot(end.x - start.x, end.y - start.y),
              base = Math.atan2(end.y - start.y, end.x - start.x);
            points = Array.from({ length: 49 }, (_, i) => ({
              x: start.x + radius * Math.cos(base + (sweep * i) / 48),
              y: start.y + radius * Math.sin(base + (sweep * i) / 48),
            }));
          }
        }
        marks.push({
          side,
          width,
          points: points.map(transform),
          closed: kind === "poly" || kind === "rect" || kind === "circle",
          filled: childValue(n, "fill") === "solid",
        });
      } else if (
        type === "fp_text" ||
        type === "gr_text" ||
        type === "property"
      ) {
        const effects = firstChild(n, "effects"),
          font = effects && firstChild(effects, "font");
        if (
          n.items.some((i) => atom(i) === "hide") ||
          effects?.items.some((i) => atom(i) === "hide") ||
          childValue(n, "hide") === "yes"
        )
          continue;
        let text = atom(n.items[type === "gr_text" ? 1 : 2]) || "";
        text = text
          .replace(/\$\{REFERENCE\}|%R/g, ref)
          .replace(/\$\{VALUE\}|%V/g, value);
        const at = firstChild(n, "at"),
          just = effects && firstChild(effects, "justify");
        const tokens = just?.items.map(atom) || [];
        marks.push({
          side,
          width,
          text,
          position: transform(point(at)),
          angle: Number(atom(at?.items[3])) || 0,
          size: Number(atom(firstChild(font || n, "size")?.items[2])) || 1,
          mirror: tokens.includes("mirror"),
          align: tokens.includes("left")
            ? "left"
            : tokens.includes("right")
              ? "right"
              : "center",
        });
      }
    }
  }
  read(root);
  for (const fp of [
    ...directChildren(root, "footprint"),
    ...directChildren(root, "module"),
  ]) {
    const at = firstChild(fp, "at");
    const fields = directChildren(fp, "fp_text"),
      properties = directChildren(fp, "property");
    const ref =
      atom(fields.find((n) => atom(n.items[1]) === "reference")?.items[2]) ||
      atom(
        properties.find((n) => atom(n.items[1]) === "Reference")?.items[2],
      ) ||
      "";
    const value =
      atom(fields.find((n) => atom(n.items[1]) === "value")?.items[2]) || "";
    read(fp, point(at), Number(atom(at?.items[3])) || 0, ref, value);
  }
  return marks;
}
export function paintSilkscreen(
  ctx: CanvasRenderingContext2D,
  marks: SilkMark[],
  side: "front" | "back",
  bounds: { minX: number; minY: number; width: number; height: number },
) {
  const sx = ctx.canvas.width / bounds.width,
    sy = ctx.canvas.height / bounds.height;
  ctx.scale(sx, sy);
  ctx.translate(-bounds.minX, -bounds.minY);
  ctx.fillStyle = ctx.strokeStyle = "#f4f1dd";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const mark of marks.filter((m) => m.side === side)) {
    ctx.lineWidth = mark.width;
    if (mark.points?.length) {
      ctx.beginPath();
      mark.points.forEach((p, i) =>
        i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
      );
      if (mark.closed) ctx.closePath();
      if (mark.filled) ctx.fill();
      ctx.stroke();
    }
    if (mark.text && mark.position) {
      ctx.save();
      ctx.translate(mark.position.x, mark.position.y);
      ctx.rotate((-(mark.angle || 0) * Math.PI) / 180);
      if (mark.mirror) ctx.scale(-1, 1);
      ctx.font = `${mark.size}px Arial`;
      ctx.textAlign = mark.align || "center";
      ctx.textBaseline = "middle";
      mark.text
        .split("\n")
        .forEach((line, i) =>
          ctx.fillText(line, 0, i * (mark.size || 1) * 1.3),
        );
      ctx.restore();
    }
  }
}
