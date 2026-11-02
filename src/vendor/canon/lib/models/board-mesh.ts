import * as THREE from "three";
import type { PcbIr, IrPoint } from "../eda/types";
import { arcPoints, type XY } from "../eda/view-geometry";
import { cleanBoardContours } from "./board-contours";
export type BoardMeshData = { position: Float32Array; normal: Float32Array };
export function boardDrills(pcb: PcbIr) {
  const drills = [
    ...pcb.pads
      .filter((p) => p.drill)
      .map((p) => ({
        position: p.position,
        x: Number(p.drill!.x),
        y: Number(p.drill!.y),
        rotation: Number(p.rotation ?? 0),
      })),
    ...pcb.vias.map((v) => ({
      position: v.position,
      x: Number(v.drill ?? 0),
      y: Number(v.drill ?? 0),
      rotation: 0,
    })),
  ].filter((d) => d.position && d.x > 0 && d.y > 0);
  // A nested circular hole removes no additional material. Passing both rings to
  // Earcut violates its non-overlapping hole assumption (e.g. dual keyboard mounts).
  return drills.filter(
    (d, i) =>
      !drills.some((other, j) => {
        if (i === j || d.x !== d.y || other.x !== other.y || other.x < d.x)
          return false;
        const distance = Math.hypot(
          Number(d.position!.x) - Number(other.position!.x),
          Number(d.position!.y) - Number(other.position!.y),
        );
        return (
          distance + d.x / 2 <= other.x / 2 + 1e-7 && (other.x > d.x || j < i)
        );
      }),
  );
}
export function buildBoardMeshes(pcb: PcbIr): BoardMeshData[] {
  const rounded = (w: number, h: number, r: number) => {
    const path = new THREE.Shape();
    const x = w / 2,
      y = h / 2;
    r = Math.min(r, x, y);
    path.moveTo(-x + r, -y);
    path.lineTo(x - r, -y);
    path.absarc(x - r, -y + r, r, -Math.PI / 2, 0, false);
    path.lineTo(x, y - r);
    path.absarc(x - r, y - r, r, 0, Math.PI / 2, false);
    path.lineTo(-x + r, y);
    path.absarc(-x + r, y - r, r, Math.PI / 2, Math.PI, false);
    path.lineTo(-x, -y + r);
    path.absarc(-x + r, -y + r, r, Math.PI, Math.PI * 1.5, false);
    path.closePath();
    return path;
  };
  const point = (p: unknown): XY | undefined => {
    const v = p as IrPoint | undefined;
    return v && Number.isFinite(Number(v.x)) && Number.isFinite(Number(v.y))
      ? { x: Number(v.x), y: -Number(v.y) }
      : undefined;
  };
  const segments: XY[][] = [];
  for (const edge of pcb.boardOutline) {
    const a = point(edge.geometry.start),
      b = point(edge.geometry.end),
      m = point(edge.geometry.mid),
      c = point(edge.geometry.center);
    if (edge.kind === "line" && a && b) segments.push([a, b]);
    if (edge.kind === "arc") {
      if (!a || !b || !m)
        throw new Error(
          "A board-outline arc is missing its midpoint. Reimport the source PCB with the current parser.",
        );
      segments.push(arcPoints(a, m, b));
    }
    if (edge.kind === "rectangle" && a && b)
      segments.push([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }, a]);
    if (edge.kind === "circle" && (c || a) && b) {
      const center = (c || a)!;
      const r = Math.hypot(b.x - center.x, b.y - center.y);
      segments.push(
        Array.from({ length: 97 }, (_, i) => ({
          x: center.x + r * Math.cos((i * Math.PI) / 48),
          y: center.y + r * Math.sin((i * Math.PI) / 48),
        })),
      );
    }
  }
  const near = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y) <= 0.01 + 1e-7;
  const loops: XY[][] = [];
  while (segments.length) {
    const chain = segments.shift()!;
    while (!near(chain[0], chain[chain.length - 1])) {
      const end = chain[chain.length - 1];
      const i = segments.findIndex(
        (s) => near(s[0], end) || near(s[s.length - 1], end),
      );
      if (i < 0)
        throw new Error(
          "The board outline is incomplete or contains an unsupported arc. Reimport the complete PCB source file.",
        );
      let next = segments.splice(i, 1)[0];
      if (!near(next[0], end)) next = next.reverse();
      chain.push(...next.slice(1));
    }
    loops.push(chain);
  }
  const contours = cleanBoardContours(loops);
  if (!contours.length)
    throw new Error("No valid closed board outline was found.");
  const area = (p: XY[]) =>
    p.reduce((sum, v, i) => {
      const n = p[(i + 1) % p.length];
      return sum + v.x * n.y - n.x * v.y;
    }, 0) / 2;
  contours.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
  const inside = (p: XY, polygon: XY[]) => {
    let yes = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i],
        b = polygon[j];
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      )
        yes = !yes;
    }
    return yes;
  };
  const shapes: Array<{ loop: XY[]; shape: InstanceType<typeof THREE.Shape> }> =
    [];
  for (const loop of contours) {
    const parent = shapes.find((s) => inside(loop[0], s.loop));
    const points = loop.map((p) => new THREE.Vector2(p.x, p.y));
    if (parent) parent.shape.holes.push(new THREE.Path(points));
    else shapes.push({ loop, shape: new THREE.Shape(points) });
  }
  for (const drill of boardDrills(pcb)) {
    const p = point(drill.position);
    if (!p || drill.x <= 0 || drill.y <= 0) continue;
    const target = shapes.find((s) => inside(p, s.loop));
    if (!target) continue;
    const r = (drill.rotation * Math.PI) / 180;
    const pts = rounded(drill.x, drill.y, Math.min(drill.x, drill.y) / 2)
      .getPoints(4)
      .map(
        (v) =>
          new THREE.Vector2(
            p.x + v.x * Math.cos(r) - v.y * Math.sin(r),
            p.y + v.x * Math.sin(r) + v.y * Math.cos(r),
          ),
      );
    if (
      !target.shape.holes.some((h) =>
        pts.every((v) => inside(v, h.getPoints())),
      )
    )
      target.shape.holes.push(new THREE.Path(pts));
  }

  const thickness = Number(pcb.physicalDimensions?.thickness ?? 1.6);
  if (!Number.isFinite(thickness) || thickness <= 0)
    throw Error("Invalid PCB thickness.");
  return shapes.map(({ shape }) => {
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: thickness,
      bevelEnabled: false,
      curveSegments: 8,
    });
    const result = {
      position: geometry.getAttribute("position").array as Float32Array,
      normal: geometry.getAttribute("normal").array as Float32Array,
    };
    geometry.dispose();
    return result;
  });
}
