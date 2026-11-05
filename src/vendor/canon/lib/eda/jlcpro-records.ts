// Local addition to the vendored REFIR core (see ../NOTICE.md): EasyEDA Pro (JLCEDA) record helpers
// shared by the board reader (jlcpro-pcb.ts) and the schematic drawer (src/lib/maker/jlcpro-schematic.ts).
//
// An EasyEDA Pro document (.esch, .epcb, .esym, .efoo) is one JSON array per line, its type first.
// Schematic and symbol coordinates are in 10 mil with y up; board and footprint coordinates are in
// mil with y up. Nothing here guesses: a value that is absent stays absent.

export type ProRecord = unknown[];
export type XY = [number, number];

export const num = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
export const text = (value: unknown): string => (value === null || value === undefined ? "" : String(value));
export const truthy = (value: unknown): boolean | undefined =>
  value === null || value === undefined || value === "" ? undefined : value === true || value === 1 || value === "1" || value === "true";

const decoder = new TextDecoder();

/** The records of a document: each non-empty line that is a JSON array starting with a string. */
export function readRecords(source: string | Uint8Array): ProRecord[] {
  const body = typeof source === "string" ? source : decoder.decode(source);
  const out: ProRecord[] = [];
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("[")) continue;
    try {
      const value = JSON.parse(trimmed);
      if (Array.isArray(value) && typeof value[0] === "string") out.push(value);
    } catch {
      // A malformed line is skipped; the IR reader reports them.
    }
  }
  return out;
}

/** FONTSTYLE: id, colour, fill, family, size, italic, bold, underline, strike, vertical (0 top · 1 middle · 2 bottom), horizontal (0 start · 1 middle · 2 end). */
export type FontStyle = { color?: string; size?: number; bold?: boolean; v?: number; h?: number };
/** LINESTYLE: id, colour, dash (0 solid, 1 dash, 2 dot, 3 dash-dot), fill colour, width. */
export type LineStyle = { color?: string; dash?: number; fill?: string; width?: number };

export function readStyles(records: ProRecord[]): { fonts: Map<string, FontStyle>; lines: Map<string, LineStyle> } {
  const fonts = new Map<string, FontStyle>();
  const lines = new Map<string, LineStyle>();
  for (const r of records) {
    if (r[0] === "FONTSTYLE")
      fonts.set(text(r[1]), {
        color: text(r[3]) || text(r[2]) || undefined,
        size: num(r[5]),
        bold: truthy(r[7]) || undefined,
        v: num(r[10]),
        h: num(r[11]),
      });
    else if (r[0] === "LINESTYLE")
      lines.set(text(r[1]), { color: text(r[2]) || undefined, dash: num(r[3]), fill: text(r[4]) || undefined, width: num(r[5]) });
  }
  return { fonts, lines };
}

/**
 * A symbol (.esym): its parts (a multi-unit symbol holds one PART section per unit, named like
 * `NAME.1`), each the records that follow its PART line; the symbol's type (HEAD symbolType:
 * 2 a part, 18 a net flag or port, 20 a drawing frame) and its styles.
 */
export type ProSymbol = {
  type: number;
  parts: Map<string, ProRecord[]>;
  /** Records before any PART line (single-unit symbols put everything there or under one PART). */
  common: ProRecord[];
  fonts: Map<string, FontStyle>;
  lines: Map<string, LineStyle>;
};

export function readSymbol(source: string | Uint8Array): ProSymbol {
  const records = readRecords(source);
  const { fonts, lines } = readStyles(records);
  const head = records.find((r) => r[0] === "HEAD")?.[1] as Record<string, unknown> | undefined;
  const parts = new Map<string, ProRecord[]>();
  const common: ProRecord[] = [];
  let current: ProRecord[] = common;
  for (const r of records) {
    if (r[0] === "PART") {
      current = [];
      parts.set(text(r[1]), current);
    } else current.push(r);
  }
  return { type: num(head?.symbolType) ?? 2, parts, common, fonts, lines };
}

/** The records drawn for one unit of a symbol: the common records and the named part's (the first part when the name is unknown). */
export function symbolUnit(symbol: ProSymbol, partName: string): ProRecord[] {
  const part = symbol.parts.get(partName) ?? symbol.parts.values().next().value ?? [];
  return [...symbol.common, ...part];
}

/* ---------------------------------------------------------------------------------------------- geometry */

/** Points along a circular arc from `a` to `b` turning through `sweep` degrees (positive: counter-clockwise, y up); `a` excluded, `b` included. */
export function arcBySweep(a: XY, b: XY, sweep: number): XY[] {
  const theta = (sweep * Math.PI) / 180;
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const chord = Math.hypot(dx, dy);
  if (!chord || !Number.isFinite(theta) || Math.abs(theta) < 1e-9) return [b];
  const half = Math.tan(theta / 2);
  if (Math.abs(half) < 1e-12) return [b];
  // The centre lies on the chord's left (counter-clockwise turn) at chord / (2 tan(θ/2)) from its middle.
  const d = chord / (2 * half);
  const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [nx, ny] = [-dy / chord, dx / chord];
  const [cx, cy] = [mx + nx * d, my + ny * d];
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  const start = Math.atan2(a[1] - cy, a[0] - cx);
  const steps = Math.max(2, Math.min(64, Math.ceil(Math.abs(theta) / (Math.PI / 18))));
  const out: XY[] = [];
  for (let k = 1; k < steps; k++) {
    const t = start + (theta * k) / steps;
    out.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  out.push(b);
  return out;
}

/** Points along the circle through `a`, `m`, `b` from `a` to `b` (both included); a straight line when they are collinear. */
export function arcThrough(a: XY, m: XY, b: XY): XY[] {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-12) return [a, b];
  const sq = (p: XY) => p[0] * p[0] + p[1] * p[1];
  const cx = (sq(a) * (m[1] - b[1]) + sq(m) * (b[1] - a[1]) + sq(b) * (a[1] - m[1])) / d;
  const cy = (sq(a) * (b[0] - m[0]) + sq(m) * (a[0] - b[0]) + sq(b) * (m[0] - a[0])) / d;
  const r = Math.hypot(a[0] - cx, a[1] - cy);
  const angle = (p: XY) => Math.atan2(p[1] - cy, p[0] - cx);
  const [t0, tm, t1] = [angle(a), angle(m), angle(b)];
  const ccw = (from: number, to: number) => (((to - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  // Counter-clockwise from a reaches m before b, or the arc runs clockwise.
  let sweep = ccw(t0, t1);
  if (ccw(t0, tm) > sweep) sweep -= 2 * Math.PI;
  const steps = Math.max(4, Math.min(64, Math.ceil(Math.abs(sweep) / (Math.PI / 18))));
  const out: XY[] = [a];
  for (let k = 1; k < steps; k++) out.push([cx + r * Math.cos(t0 + (sweep * k) / steps), cy + r * Math.sin(t0 + (sweep * k) / steps)]);
  out.push(b);
  return out;
}

export const circlePoints = (c: XY, r: number, steps = 48): XY[] =>
  Array.from({ length: steps + 1 }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / steps), c[1] + r * Math.sin((2 * Math.PI * i) / steps)] as XY);

/** A rectangle `R x y w h rotation radius`: (x, y) its top-left corner (y up, so it extends to y − h), turned about that corner. */
export function rectPoints(x: number, y: number, w: number, h: number, rotation = 0, radius = 0): XY[] {
  const r = Math.max(0, Math.min(radius, Math.abs(w) / 2, Math.abs(h) / 2));
  let local: XY[];
  if (r > 0) {
    local = [];
    // Clockwise (y up) from the top edge: each corner's centre and the angle its quarter starts at.
    const corners: Array<[XY, number]> = [
      [[w - r, -r], 90],
      [[w - r, -h + r], 0],
      [[r, -h + r], -90],
      [[r, -r], 180],
    ];
    for (const [[cx, cy], from] of corners)
      for (let k = 0; k <= 6; k++) {
        const t = ((from - (90 * k) / 6) * Math.PI) / 180;
        local.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
      }
    local.push(local[0]!);
  } else
    local = [
      [0, 0],
      [w, 0],
      [w, -h],
      [0, -h],
      [0, 0],
    ];
  const t = (rotation * Math.PI) / 180;
  const [c, s] = [Math.cos(t), Math.sin(t)];
  return local.map(([u, v]) => [x + u * c - v * s, y + u * s + v * c]);
}

/**
 * A board path (POLY, FILL, POUR, POURED, REGION): numbers in pairs, joined by `L` (straight),
 * `ARC` / `CARC` sweep (an arc turning through `sweep` degrees to the next point) or `C` (a cubic
 * Bézier: two control points, then its end); or a whole `R` rectangle or `CIRCLE cx cy r`. One loop
 * of points per path; arcs and curves are sampled.
 */
export function pathPoints(path: unknown): XY[] {
  if (!Array.isArray(path)) return [];
  if (path[0] === "CIRCLE") {
    const [cx, cy, r] = [num(path[1]), num(path[2]), num(path[3])];
    return cx !== undefined && cy !== undefined && r ? circlePoints([cx, cy], r) : [];
  }
  if (path[0] === "R") {
    const [x, y, w, h] = [num(path[1]), num(path[2]), num(path[3]), num(path[4])];
    return x !== undefined && y !== undefined && w && h ? rectPoints(x, y, w, h, num(path[5]) ?? 0, num(path[6]) ?? 0) : [];
  }
  const out: XY[] = [];
  let mode = "L";
  let sweep = 0;
  for (let i = 0; i < path.length; ) {
    const value = path[i];
    if (typeof value === "string") {
      mode = value.toUpperCase();
      i += 1;
      if (mode === "ARC" || mode === "CARC") {
        sweep = num(path[i]) ?? 0;
        i += 1;
      }
      continue;
    }
    if (mode === "C" && out.length) {
      const v = [0, 1, 2, 3, 4, 5].map((k) => num(path[i + k]));
      if (v.some((n) => n === undefined)) break;
      const [x1, y1, x2, y2, x3, y3] = v as number[];
      const [x0, y0] = out[out.length - 1]!;
      for (let k = 1; k <= 12; k++) {
        const t = k / 12;
        const [a, b, c, d] = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3];
        out.push([a * x0 + b * x1! + c * x2! + d * x3!, a * y0 + b * y1! + c * y2! + d * y3!]);
      }
      i += 6;
      continue;
    }
    const [x, y] = [num(path[i]), num(path[i + 1])];
    i += 2;
    if (x === undefined || y === undefined) continue;
    if ((mode === "ARC" || mode === "CARC") && out.length) {
      out.push(...arcBySweep(out[out.length - 1]!, [x, y], sweep));
      mode = "L";
    } else out.push([x, y]);
  }
  return out;
}

/** The paths of a shape field: a list of paths, or one path. */
export function shapePaths(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return Array.isArray(value[0]) ? value : [value];
}

/** One straight or arc piece of a board path, for outlines and strokes: a line, or an arc as its start, middle and end. */
export type PathPiece = { kind: "line"; start: XY; end: XY } | { kind: "arc"; start: XY; mid: XY; end: XY } | { kind: "circle"; center: XY; r: number };

export function pathPieces(path: unknown): PathPiece[] {
  if (!Array.isArray(path)) return [];
  if (path[0] === "CIRCLE") {
    const [cx, cy, r] = [num(path[1]), num(path[2]), num(path[3])];
    return cx !== undefined && cy !== undefined && r ? [{ kind: "circle", center: [cx, cy], r }] : [];
  }
  if (path[0] === "R") {
    const pts = pathPoints(path);
    return pts.slice(1).map((end, k) => ({ kind: "line" as const, start: pts[k]!, end }));
  }
  const out: PathPiece[] = [];
  let mode = "L";
  let sweep = 0;
  let last: XY | undefined;
  for (let i = 0; i < path.length; ) {
    const value = path[i];
    if (typeof value === "string") {
      mode = value.toUpperCase();
      i += 1;
      if (mode === "ARC" || mode === "CARC") {
        sweep = num(path[i]) ?? 0;
        i += 1;
      }
      continue;
    }
    if (mode === "C" && last) {
      const v = [0, 1, 2, 3, 4, 5].map((k) => num(path[i + k]));
      i += 6;
      if (v.some((n) => n === undefined)) break;
      const pts = pathPoints([last[0], last[1], "C", ...v]);
      pts.slice(1).forEach((end, k) => out.push({ kind: "line", start: pts[k]!, end }));
      last = pts[pts.length - 1];
      continue;
    }
    const [x, y] = [num(path[i]), num(path[i + 1])];
    i += 2;
    if (x === undefined || y === undefined) continue;
    const next: XY = [x, y];
    if (last) {
      if ((mode === "ARC" || mode === "CARC") && Math.abs(sweep) > 1e-9) {
        const pts = arcBySweep(last, next, sweep);
        const mid = pts[Math.floor((pts.length - 1) / 2)]!;
        out.push(pts.length >= 2 ? { kind: "arc", start: last, mid, end: next } : { kind: "line", start: last, end: next });
        mode = "L";
      } else out.push({ kind: "line", start: last, end: next });
    }
    last = next;
  }
  return out;
}
