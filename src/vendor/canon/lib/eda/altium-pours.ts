// Local addition to the vendored REFIR core (see ../NOTICE.md): an Altium PcbDoc's copper pours.
import type { PcbIr } from "./types";

type Props = Record<string, string>;
type Stream = (name: string) => Uint8Array;
type XY = [number, number];
type Zone = PcbIr["zones"][number];

/**
 * An Altium board's polygon pours, as zones with their shapes: each polygon
 * (Polygons6 — its net, layer and outline) and the copper it was last poured
 * with (Regions6 — the pieces Altium stores per polygon, each with its holes,
 * the clearances cut round other nets). Free copper regions on a net (solid
 * regions not part of a footprint) are kept as filled zones too.
 *
 * Coordinates are mm in the reader's frame (y up negated, as pads and tracks).
 * Format reference: KiCad's Altium importer (APolygon6, ARegion6).
 */
export function readAltiumPours(
  stream: Stream,
  board: Props,
  polygons: Props[],
  nets: readonly { id: string }[],
  id: string,
  ref: Zone["sourceRef"],
): Zone[] {
  const copper = copperNames(board);
  const named = (name = "") => copper.get(layerNumber(name)) ?? null;
  const netOf = (index: number) => (index >= 0 && index < 65535 ? nets[index] : undefined);
  const zones: Zone[] = [];
  const fills = new Map<number, { layer: string; points: XY[] }[]>();
  const free: { layer: string; net: number; points: XY[] }[] = [];
  for (const region of regions(stream("Regions6/Data"))) {
    const layer = copper.get(region.layer);
    // Copper only: a polygon cutout, a board cutout, a cavity or a footprint's own shape (a custom pad) is not a pour.
    if (!layer || region.kind !== 0 || region.cutout) continue;
    const points = bridged(region.outline, region.holes);
    if (points.length < 3) continue;
    if (region.polygon < 65535) fills.set(region.polygon, [...(fills.get(region.polygon) ?? []), { layer, points }]);
    else if (region.component >= 65535 && netOf(region.net)) free.push({ layer, net: region.net, points });
  }
  polygons.forEach((polygon, index) => {
    const layer = named(polygon.LAYER);
    if (!layer) return;
    const net = netOf(polygon.NET === undefined ? -1 : Number(polygon.NET));
    const keepout = polygon.KEEPOUT === "TRUE" || /cutout/i.test(polygon.POLYGONTYPE ?? "");
    // A split plane's copper is its outline (a plane layer is poured everywhere but its antipads); a polygon's is what Altium poured.
    const split = /split/i.test(polygon.POLYGONTYPE ?? "");
    const outline = outlineOf(polygon);
    const poured = fills.get(index) ?? [];
    zones.push({
      id: `${id}:zone${index}`,
      netId: net?.id,
      sourceNativeNetId: polygon.NET,
      layers: [layer],
      sourceRef: { ...ref, nativeId: `Polygons6:${index}` },
      shape: { keepout, outline, fills: split && poured.length === 0 && outline.length >= 3 ? [{ layer, points: outline }] : poured },
    });
  });
  free.forEach((region, index) =>
    zones.push({
      id: `${id}:region${index}`,
      netId: netOf(region.net)?.id,
      sourceNativeNetId: String(region.net),
      layers: [region.layer],
      sourceRef: { ...ref, nativeId: `Regions6:${index}` },
      shape: { keepout: false, outline: region.points, fills: [{ layer: region.layer, points: region.points }] },
    }),
  );
  return zones;
}

/** Altium's copper layers by number (1 top, 2–31 mid layers, 32 bottom, 39–54 internal planes) as KiCad names them, inner ones in stack order. */
export function copperNames(board: Props): Map<number, string> {
  const names = new Map<number, string>([
    [1, "F.Cu"],
    [32, "B.Cu"],
  ]);
  const isCopper = (n: number) => (n > 1 && n < 32) || (n >= 39 && n <= 54);
  // The stack, top to bottom: each layer's LAYERnNEXT.
  const stack: number[] = [];
  for (let n = Number(board.LAYER1NEXT ?? 0), guard = 0; n > 0 && n !== 32 && guard < 64; n = Number(board[`LAYER${n}NEXT`] ?? 0), guard += 1) if (isCopper(n)) stack.push(n);
  // A file without the links: mid layers, then planes, by number.
  const order = stack.length > 0 ? stack : [...Array.from({ length: 30 }, (_, i) => i + 2), ...Array.from({ length: 16 }, (_, i) => i + 39)];
  order.forEach((n, i) => names.set(n, `In${i + 1}.Cu`));
  return names;
}

const layerNumber = (name: string) => {
  const upper = name.toUpperCase();
  if (upper === "TOP") return 1;
  if (upper === "BOTTOM") return 32;
  const mid = /^MID(\d+)$/.exec(upper);
  if (mid) return 1 + Number(mid[1]);
  const plane = /^PLANE(\d+)$/.exec(upper);
  return plane ? 38 + Number(plane[1]) : 0;
};

const mil = (value = "0") => Number.parseFloat(value) * (/mm$/i.test(value) ? 1 : 0.0254);

/** A polygon's outline: its vertices, an arc segment sampled. */
function outlineOf(polygon: Props): XY[] {
  const out: XY[] = [];
  for (let n = 0; polygon[`VX${n}`] !== undefined && n < 10000; n += 1) {
    out.push([mil(polygon[`VX${n}`]), -mil(polygon[`VY${n}`])]);
    if (polygon[`KIND${n}`] === "1") {
      const [cx, cy, r] = [mil(polygon[`CX${n}`]), mil(polygon[`CY${n}`]), mil(polygon[`R${n}`])];
      const start = Number(polygon[`SA${n}`] ?? 0);
      const sweep = (((Number(polygon[`EA${n}`] ?? 0) - start) % 360) + 360) % 360;
      for (let k = 1; k < 24; k += 1) {
        const t = ((start + (sweep * k) / 24) * Math.PI) / 180;
        out.push([cx + r * Math.cos(t), -(cy + r * Math.sin(t))]);
      }
    }
  }
  return out;
}

type Region = { layer: number; net: number; polygon: number; component: number; kind: number; cutout: boolean; outline: XY[]; holes: XY[][] };

/** Regions6: one record per region — layer, net, polygon and component indices, properties, then its outline and holes (doubles, 0.0001 mil). */
export function regions(bytes: Uint8Array): Region[] {
  const out: Region[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const unit = 0.00000254;
  for (let offset = 0; offset < bytes.length; ) {
    if (bytes[offset] !== 11 || offset + 5 > bytes.length || out.length >= 100000) throw new Error("Unsupported Regions6 record");
    const length = view.getUint32(offset + 1, true) & 0xffffff;
    const start = offset + 5;
    const end = start + length;
    if (end > bytes.length || length < 26) throw new Error("Truncated Regions6");
    offset = end;
    const holeCount = view.getUint16(start + 14, true);
    const propsLength = view.getUint32(start + 18, true);
    let at = start + 22 + propsLength;
    if (at + 4 > end) continue;
    const text = new TextDecoder("windows-1252").decode(bytes.subarray(start + 22, start + 22 + propsLength));
    const prop = (key: string) => new RegExp(`\\|${key}=([^|\\0]*)`).exec(`|${text}`)?.[1];
    const ring = (): XY[] | null => {
      if (at + 4 > end) return null;
      const count = view.getUint32(at, true);
      at += 4;
      if (at + count * 16 > end) return null;
      const points: XY[] = [];
      for (let i = 0; i < count; i += 1, at += 16) points.push([view.getFloat64(at, true) * unit, -view.getFloat64(at + 8, true) * unit]);
      return points;
    };
    const outline = ring();
    if (!outline) continue;
    const holes: XY[][] = [];
    for (let h = 0; h < holeCount; h += 1) {
      const hole = ring();
      if (!hole) break;
      if (hole.length >= 3) holes.push(hole);
    }
    out.push({
      layer: bytes[start]!,
      net: view.getUint16(start + 3, true),
      polygon: view.getUint16(start + 5, true),
      component: view.getUint16(start + 7, true),
      kind: Number(prop("KIND") ?? 0),
      cutout: prop("ISBOARDCUTOUT") === "TRUE",
      outline,
      holes,
    });
  }
  return out;
}

/**
 * One ring for an outline and its holes, as KiCad keeps a filled polygon: each
 * hole joined to the ring at its nearest point by a cut there and back. Drawn
 * even–odd and tested even–odd, it is the outline less its holes.
 */
export function bridged(outline: readonly XY[], holes: readonly (readonly XY[])[]): XY[] {
  let ring: XY[] = [...outline];
  for (const hole of holes) {
    let best = Infinity;
    let at = 0;
    let from = 0;
    // On very large rings, every few hole points are tried: any join is right, a short one is tidier.
    const step = Math.max(1, Math.floor((ring.length * hole.length) / 200_000));
    for (let j = 0; j < hole.length; j += step) {
      const [hx, hy] = hole[j]!;
      for (let i = 0; i < ring.length; i += 1) {
        const d = (ring[i]![0] - hx) ** 2 + (ring[i]![1] - hy) ** 2;
        if (d < best) [best, at, from] = [d, i, j];
      }
    }
    const around = [...hole.slice(from), ...hole.slice(0, from), hole[from]!];
    ring = [...ring.slice(0, at + 1), ...around, ring[at]!, ...ring.slice(at + 1)];
  }
  return ring;
}
