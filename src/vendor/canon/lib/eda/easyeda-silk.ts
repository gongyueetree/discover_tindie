// Local addition to the vendored REFIR core (see ../NOTICE.md): EasyEDA's silkscreen, Standard and Pro.
import type { IrPoint, PcbIr, PcbPolygon, PcbText } from "./types";

type Silkscreen = NonNullable<PcbIr["silkscreen"]>;
type Graphic = Silkscreen["graphics"][number];
type XY = [number, number];

/** EasyEDA's silkscreen layers (Standard and Pro number them alike), as KiCad names them — the names the 3D view prints. */
const SILK: Record<string, "F.SilkS" | "B.SilkS"> = { "3": "F.SilkS", "4": "B.SilkS" };

export const emptySilkscreen = (): Silkscreen => ({ graphics: [], polygons: [], texts: [] });

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const str = (value: number) => String(Number(value.toFixed(6)));
const at = ([x, y]: XY): IrPoint => ({ x: str(x), y: str(y), unit: "mm" });
/** The numbers of a path or point list, in order: SVG paths may separate them with commas or spaces. */
const numbers = (path: string) => (path.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
const pairs = (values: number[]): XY[] => Array.from({ length: Math.floor(values.length / 2) }, (_, i) => [values[2 * i]!, values[2 * i + 1]!]);

/**
 * One EasyEDA Standard shape on a silkscreen layer, added to `into` (user
 * report 2026-10-22: the 3D view printed no silkscreen for EasyEDA projects).
 * The shapes are TRACK, ARC, CIRCLE, SOLIDREGION and TEXT as EasyEDA's PCB
 * file format describes them (`~`-separated fields); a footprint's own shapes
 * (inside its LIB) are on the board where they are drawn, so all of them are
 * the board's silkscreen, in the reader's coordinates (EasyEDA's units, y down,
 * as its pads and tracks). Other layers and shapes are left alone.
 */
export function easyEdaStandardSilk(fields: string[], id: string, into: Silkscreen): void {
  const [prefix] = fields;
  const layerField = prefix === "TRACK" || prefix === "ARC" ? fields[2] : prefix === "CIRCLE" ? fields[5] : prefix === "SOLIDREGION" ? fields[1] : prefix === "TEXT" ? fields[7] : undefined;
  const layer = SILK[layerField ?? ""];
  if (!layer) return;
  if (prefix === "TRACK") {
    const width = num(fields[1]);
    const points = pairs(numbers(fields[4] ?? ""));
    points.slice(1).forEach((end, i) => into.graphics.push(graphic(`${id}:${i}`, layer, "line", { start: at(points[i]!), end: at(end) }, width)));
  } else if (prefix === "ARC") {
    const arc = svgArc(fields[4] ?? "");
    if (arc) into.graphics.push(graphic(id, layer, "arc", { start: at(arc.start), mid: at(arc.mid), end: at(arc.end) }, num(fields[1])));
  } else if (prefix === "CIRCLE") {
    const [cx, cy, r] = [num(fields[1]), num(fields[2]), num(fields[3])];
    if (cx !== undefined && cy !== undefined && r) into.graphics.push(graphic(id, layer, "circle", { center: at([cx, cy]), end: at([cx + r, cy]) }, num(fields[4])));
  } else if (prefix === "SOLIDREGION") {
    // A solid region is printed; a cutout or a drilled slot is not.
    const points = pairs(numbers((fields[3] ?? "").replace(/A[^LMZ]*/gi, "")));
    if ((fields[4] ?? "solid") === "solid" && points.length >= 3) into.polygons.push(polygon(id, layer, points));
  } else if (prefix === "TEXT") {
    if ((fields[12] ?? "") === "none") return;
    const text = (fields[10] ?? "").replace(/\\(.)/g, "$1");
    const [x, y, height] = [num(fields[2]), num(fields[3]), num(fields[9])];
    if (!text.trim() || x === undefined || y === undefined || !height) return;
    const mirrored = fields[6] === "1";
    const glyphs = pairs(numbers(fields[11] ?? ""));
    const rotation = num(fields[5]) ?? 0;
    into.texts.push({
      id,
      layer,
      kind: fields[1] === "P" ? "reference" : fields[1] === "N" ? "value" : "user",
      text,
      // The strokes EasyEDA drew for it say where it is and which way it reads; without them, its anchor is its lower left.
      ...(glyphs.length >= 2
        ? { position: at(centre(glyphs)), justify: { horizontal: "center", vertical: "center" } as const, angle: str(readingAngle(glyphs, rotation, mirrored, height)) }
        : { position: at([x, y]), justify: { horizontal: "left", vertical: "bottom" } as const, angle: str(rotation) }),
      size: { height: str(height), width: str(height) },
      ...(num(fields[4]) ? { thickness: str(num(fields[4])!) } : {}),
      mirrored,
    });
  }
}

/**
 * EasyEDA Pro's silkscreen in a PCB document's records (JSON arrays, one a
 * line): POLY strokes and FILL shapes on a silkscreen layer, STRING texts
 * there, and each component's attribute texts (its Designator among them)
 * that are shown there. Field order as the reader already reads them — a
 * record's id, then its lock, then (for POLY, FILL) its net, then its layer.
 * Coordinates are the reader's, as its pads and tracks.
 */
export function easyEdaProSilk(record: unknown[], into: Silkscreen): void {
  const kind = record[0];
  const id = String(record[1] ?? "");
  if (kind === "POLY" || kind === "FILL") {
    const layer = SILK[String(record[4] ?? "")];
    if (!layer) return;
    const width = num(record[5]);
    if (kind === "POLY") {
      for (const [i, loop] of proPath(record[6]).entries()) {
        if (loop.circle) into.graphics.push(graphic(`${id}:${i}`, layer, "circle", { center: at(loop.circle.c), end: at([loop.circle.c[0] + loop.circle.r, loop.circle.c[1]]) }, width));
        else loop.points.slice(1).forEach((end, k) => into.graphics.push(graphic(`${id}:${i}:${k}`, layer, "line", { start: at(loop.points[k]!), end: at(end) }, width)));
      }
    } else {
      const paths = Array.isArray(record[7]) && Array.isArray(record[7][0]) ? (record[7] as unknown[]) : [record[7]];
      paths.forEach((path, i) =>
        proPath(path).forEach((loop, k) => {
          const points = loop.circle ? circleLoop(loop.circle.c, loop.circle.r) : loop.points;
          if (points.length >= 3) into.polygons.push(polygon(`${id}:${i}:${k}`, layer, points));
        }),
      );
    }
    return;
  }
  // STRING: id, lock, layer, x, y, text, font, height, stroke, bold, italic, anchor, angle, inverse, expansion, mirror.
  // ATTR: id, lock, owner, layer, x, y, key, value, key shown, value shown, then as STRING from the font on.
  const attr = kind === "ATTR";
  if (kind !== "STRING" && !attr) return;
  const shift = attr ? 1 : 0;
  const layer = SILK[String(record[3 + shift] ?? "")];
  const [x, y] = [num(record[4 + shift]), num(record[5 + shift])];
  if (!layer || x === undefined || y === undefined) return;
  const key = attr ? String(record[7] ?? "") : "";
  if (attr && !(record[10] === 1 || record[10] === true)) return;
  const text = String((attr ? record[8] : record[6]) ?? "");
  const height = num(record[8 + shift * 4]);
  if (!text.trim() || !height) return;
  const stroke = num(record[9 + shift * 4]);
  into.texts.push({
    id,
    layer,
    kind: key === "Designator" ? "reference" : key === "Value" ? "value" : attr ? "field" : "user",
    text,
    position: at([x, y]),
    angle: str(num(record[13 + shift * 4]) ?? 0),
    size: { height: str(height), width: str(height) },
    ...(stroke ? { thickness: str(stroke) } : {}),
    justify: proAnchor(num(record[12 + shift * 4])),
    mirrored: record[16 + shift * 4] === 1 || record[16 + shift * 4] === true,
  });
}

/**
 * EasyEDA Pro's text anchor, 1–9: left top, left middle, left bottom, then centre and right the same
 * way (its align modes; jlcpro-pcb.ts, checked against EasyEDA's own layout images). Left bottom
 * when absent.
 */
function proAnchor(value: number | undefined): PcbText["justify"] {
  const n = value !== undefined && value >= 1 && value <= 9 ? Math.round(value) - 1 : 2;
  return { horizontal: (["left", "center", "right"] as const)[Math.floor(n / 3)]!, vertical: (["top", "center", "bottom"] as const)[n % 3]! };
}

function graphic(id: string, layer: string, kind: Graphic["kind"], geometry: Record<string, unknown>, width: number | undefined): Graphic {
  return { id, layer, kind, geometry, ...(width ? { width: str(width) } : {}) };
}

function polygon(id: string, layer: string, points: XY[]): PcbPolygon {
  return { id, layer, points: points.map(at), filled: true };
}

const circleLoop = (c: XY, r: number): XY[] => Array.from({ length: 32 }, (_, i) => [c[0] + r * Math.cos((i * Math.PI) / 16), c[1] + r * Math.sin((i * Math.PI) / 16)]);

/**
 * An EasyEDA Pro path: numbers in pairs joined by `L` (straight), `ARC` /
 * `CARC` (an arc through a stated angle to the next point — kept as its
 * chord's ends), or a whole `CIRCLE cx cy r`. Other forms are not read.
 */
function proPath(path: unknown): { points: XY[]; circle?: { c: XY; r: number } }[] {
  if (!Array.isArray(path)) return [];
  if (path[0] === "CIRCLE") {
    const [cx, cy, r] = [num(path[1]), num(path[2]), num(path[3])];
    return cx !== undefined && cy !== undefined && r ? [{ points: [], circle: { c: [cx, cy], r } }] : [];
  }
  const points: XY[] = [];
  for (let i = 0; i < path.length; ) {
    const value = path[i];
    if (value === "ARC" || value === "CARC") i += 2;
    else if (typeof value === "string") i += 1;
    else {
      const [x, y] = [num(path[i]), num(path[i + 1])];
      if (x !== undefined && y !== undefined) points.push([x, y]);
      i += 2;
    }
  }
  return points.length >= 2 ? [{ points }] : [];
}

/** An SVG arc `M sx sy A r r rotation large sweep ex ey` as its start, the point halfway along it, and its end. */
export function svgArc(path: string): { start: XY; mid: XY; end: XY } | null {
  const match = /M\s*([-\d.e]+)[\s,]+([-\d.e]+)\s*A\s*([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)[\s,]+([01])[\s,]*([01])[\s,]+([-\d.e]+)[\s,]+([-\d.e]+)/i.exec(path);
  if (!match) return null;
  const [x1, y1, r0, , , large, sweep, x2, y2] = match.slice(1).map(Number) as [number, number, number, number, number, number, number, number, number];
  const [hx, hy] = [(x1 - x2) / 2, (y1 - y2) / 2];
  const half = hx * hx + hy * hy;
  if (half === 0 || !Number.isFinite(r0)) return null;
  const r = Math.max(Math.abs(r0), Math.sqrt(half));
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, (r * r - half) / half));
  const [cx, cy] = [coef * hy + (x1 + x2) / 2, -coef * hx + (y1 + y2) / 2];
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  let delta = Math.atan2(y2 - cy, x2 - cx) - a1;
  if (sweep === 1 && delta < 0) delta += 2 * Math.PI;
  if (sweep === 0 && delta > 0) delta -= 2 * Math.PI;
  const m = a1 + delta / 2;
  return { start: [x1, y1], mid: [cx + r * Math.cos(m), cy + r * Math.sin(m)], end: [x2, y2] };
}

const centre = (points: XY[]): XY => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};

/**
 * The text's angle on the board (counter-clockwise as seen from above), its
 * stated rotation taken whichever way its own strokes read: the first
 * letters' strokes come first. A single letter does not say, and the stated
 * rotation is kept.
 */
function readingAngle(glyphs: XY[], rotation: number, mirrored: boolean, height: number): number {
  const quarter = Math.max(1, Math.floor(glyphs.length / 4));
  const [first, last] = [centroid(glyphs.slice(0, quarter)), centroid(glyphs.slice(-quarter))];
  const [dx, dy] = [last[0] - first[0], last[1] - first[1]];
  if (Math.hypot(dx, dy) < height) return rotation;
  // y is down: up the board is −y.
  const reads = (Math.atan2(-dy, dx) * 180) / Math.PI;
  const off = (angle: number) => Math.abs(((((reads - angle - (mirrored ? 180 : 0)) % 360) + 540) % 360) - 180);
  const other = (360 - rotation) % 360;
  return off(other) < off(rotation) ? other : rotation;
}

const centroid = (points: XY[]): XY => [points.reduce((sum, [x]) => sum + x, 0) / points.length, points.reduce((sum, [, y]) => sum + y, 0) / points.length];
