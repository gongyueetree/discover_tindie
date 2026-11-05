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
  // Ends 0.01 mm apart meet (local change: ../../NOTICE.md). Outlines drawn by hand in older
  // tools (KiCad 2012 boards, EAGLE / Fusion outlines from DXF) can also overshoot — a line runs a
  // little past the arc it meets, so an end lies on the next stroke rather than at its end — or
  // repeat a stroke, or carry a stray one; their own tools accept that. Only when the outline does
  // not close this way: a repeated stroke counts once, an overshoot is cut where the strokes
  // cross, and strokes that close nothing are left out — provided what closes spans the drawing.
  // A gap is never bridged.
  const GAP = 0.01;
  const distance = (a: XY, b: XY) => Math.hypot(a.x - b.x, a.y - b.y);
  const near = (a: XY, b: XY) => distance(a, b) <= GAP + 1e-7;
  /** The point of a polyline nearest p: after vertex `index`. */
  const nearestOn = (p: XY, line: XY[]) => {
    let best = { d: Infinity, index: -1, at: p };
    for (let k = 0; k + 1 < line.length; k++) {
      const a = line[k], b = line[k + 1], dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
      const at = { x: a.x + t * dx, y: a.y + t * dy }, d = distance(p, at);
      if (d < best.d) best = { d, index: k, at };
    }
    return best;
  };
  const lengthOf = (line: XY[]) => line.reduce((sum, p, i) => (i ? sum + distance(line[i - 1], p) : 0), 0);
  const chainLoops = (pieces: XY[][], loose: boolean) => {
    const loops: XY[][] = [];
    let open = 0;
    while (pieces.length) {
      const chain = pieces.shift()!;
      let last = 0; // where the most recently added stroke starts in the chain
      let closed = true;
      while (!near(chain[0], chain[chain.length - 1])) {
        const end = chain[chain.length - 1];
        let i = -1, best = Infinity;
        pieces.forEach((s, k) => {
          const d = Math.min(distance(s[0], end), distance(s[s.length - 1], end));
          if (d < best && d <= GAP + 1e-7) { best = d; i = k; }
        });
        if (i >= 0) {
          let next = pieces.splice(i, 1)[0];
          if (distance(next[0], end) > distance(next[next.length - 1], end)) next = next.reverse();
          last = chain.length - 1;
          chain.push(...next.slice(1));
          continue;
        }
        if (!loose) { closed = false; break; }
        // The chain ran past its start: cut it where it crosses back.
        const first = nearestOn(end, chain.slice(0, Math.max(2, Math.min(last + 1, chain.length - 1))));
        if (first.d <= GAP && first.index >= 0 && last > 0) {
          chain.splice(0, first.index + 1, first.at);
          break;
        }
        // Another stroke starts on the last one (the last overshoots it): cut the last there.
        let joined = false;
        for (const [k, s] of pieces.entries()) {
          for (const from of [s, [...s].reverse()]) {
            const on = nearestOn(from[0], chain.slice(last));
            if (on.d > GAP || on.index < 0) continue;
            chain.splice(last + on.index + 1, chain.length, on.at, ...from.slice(1));
            pieces.splice(k, 1);
            last = last + on.index + 1;
            joined = true;
            break;
          }
          if (joined) break;
        }
        if (joined) continue;
        // The last stroke ends on another one (it overshoots the end of that one the other way).
        for (const [k, s] of pieces.entries()) {
          const on = nearestOn(end, s);
          if (on.d > GAP || on.index < 0) continue;
          const before = [...s.slice(0, on.index + 1), on.at].reverse(), after = [on.at, ...s.slice(on.index + 1)];
          last = chain.length - 1;
          chain.push(...(lengthOf(after) >= lengthOf(before) ? after : before).slice(1));
          pieces.splice(k, 1);
          joined = true;
          break;
        }
        if (!joined) { closed = false; break; }
      }
      if (closed) loops.push(chain);
      else open += 1;
    }
    return { loops, open };
  };
  let chained = chainLoops(segments.map((s) => [...s]), false);
  if (chained.open) {
    // The same stroke drawn twice (an outline pasted again, or kept on two layers) is one edge.
    const key = (s: XY[]) => [s[0], s[Math.floor(s.length / 2)], s[s.length - 1]].map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`);
    const seen = new Set<string>();
    const unique = segments.filter((s) => {
      const k = key(s), forward = k.join(" "), backward = [...k].reverse().join(" ");
      if (seen.has(forward) || seen.has(backward)) return false;
      seen.add(forward);
      return true;
    });
    chained = chainLoops(unique.map((s) => [...s]), true);
  }
  const span = (points: XY[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    return (maxX - minX) * (maxY - minY);
  };
  const whole = span(segments.flat());
  if (!chained.loops.length || (chained.open && Math.max(...chained.loops.map(span)) < 0.9 * whole))
    throw new Error(
      "The board outline is incomplete or contains an unsupported arc. Reimport the complete PCB source file.",
    );
  // …and, when strokes were left out, specks a few hundredths of a millimetre across (marker arcs at stroke ends).
  const loops = chained.open ? chained.loops.filter((l) => span(l) >= 1e-4 * whole) : chained.loops;
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
