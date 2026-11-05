// Local addition to the vendored REFIR core (see ../NOTICE.md): a JLCEDA / EasyEDA Pro board (.epcb)
// as the IR's PcbIr, drawn the way EasyEDA lays it out — each COMPONENT's footprint (.efoo) placed,
// turned and (on the bottom) mirrored with its pads, the board's tracks (LINE, ARC, POLY on copper),
// vias, copper fills (FILL) and poured copper (POUR + POURED), keep-out regions (REGION), the board
// outline (its OUTLINE layer) and the silkscreen (strokes, fills, texts and shown designators).
//
// EasyEDA Pro boards are in mil with y up; the IR is in millimetres with y down (as KiCad), so every
// coordinate is scaled by 0.0254 and its y negated. Angles stay counter-clockwise as seen from the top.
import type { NetIr, PcbIr, PcbPolygon, PcbText, SourceAsset, SourceRef } from "./types";
import { stableId, sourceRef } from "./util";
import { easyEdaProSilk, emptySilkscreen } from "./easyeda-silk";
import { num, pathPieces, pathPoints, shapePaths, text, truthy, type PathPiece, type ProRecord, type XY } from "./jlcpro-records";

const MIL = 0.0254;
const str = (v: number) => String(Math.round(v * 1e6) / 1e6);
const mm = (v: number) => str(v * MIL);
/** A board point (mil, y up) as an IR point (mm, y down). */
const P = ([x, y]: XY) => ({ x: mm(x), y: mm(-y), unit: "mm" as const });

/** EasyEDA Pro layer ids that swap when a footprint is placed on the bottom. */
const FLIP: Record<number, number> = { 1: 2, 2: 1, 3: 4, 4: 3, 5: 6, 6: 5, 7: 8, 8: 7, 9: 10, 10: 9, 58: 59, 59: 58 };
const SILK: Record<number, "F.SilkS" | "B.SilkS"> = { 3: "F.SilkS", 4: "B.SilkS" };
const isCopper = (layer: number) => layer === 1 || layer === 2 || (layer >= 15 && layer <= 46);
const OUTLINE = 11;
const MULTI = 12;
const COMPONENT_SHAPE = 48;

export type JlcProBoardContext = {
  /** A footprint's records by its uuid (the .efoo file name), when the project holds it. */
  footprint: (uuid: string) => ProRecord[] | undefined;
  /** The project's devices' attributes, by device uuid. */
  devices: Map<string, Record<string, string>>;
  /** The project's footprint titles, by footprint uuid. */
  footprintTitles: Map<string, string>;
};

export type JlcProBoard = { pcb: PcbIr; nets: NetIr[]; normalized: number; panel: boolean };

type Place = { x: number; y: number; rotation: number; bottom: boolean };
/** A footprint point (mil, y up) on the board (mil, y up): mirrored on the bottom, then turned, then moved. */
function placeAt(place: Place, [u, v]: XY): XY {
  const t = (place.rotation * Math.PI) / 180;
  const x = place.bottom ? -u : u;
  return [place.x + x * Math.cos(t) - v * Math.sin(t), place.y + x * Math.sin(t) + v * Math.cos(t)];
}
const pieceAt = (piece: PathPiece, f: (p: XY) => XY): PathPiece =>
  piece.kind === "line" ? { kind: "line", start: f(piece.start), end: f(piece.end) } : piece.kind === "arc" ? { kind: "arc", start: f(piece.start), mid: f(piece.mid), end: f(piece.end) } : { kind: "circle", center: f(piece.center), r: piece.r };
const pieceGeometry = (piece: PathPiece) =>
  piece.kind === "line"
    ? { kind: "line" as const, geometry: { start: P(piece.start), end: P(piece.end) } }
    : piece.kind === "arc"
      ? { kind: "arc" as const, geometry: { start: P(piece.start), mid: P(piece.mid), end: P(piece.end) } }
      : { kind: "circle" as const, geometry: { center: P(piece.center), end: P([piece.center[0] + piece.r, piece.center[1]]) } };

/** A field's value with its `={Other}` references resolved. */
function resolve(value: string, lookup: (key: string) => string | undefined, depth = 0): string {
  if (!value.startsWith("=") || depth > 4) return value;
  return value.slice(1).replace(/\{([^}]+)\}/g, (_, key: string) => resolve(lookup(key) ?? "", lookup, depth + 1));
}

export function readJlcProBoard(asset: SourceAsset, records: ProRecord[], ref: SourceRef, name: string, context: JlcProBoardContext): JlcProBoard {
  const pcbId = stableId("pcb", asset.sha256, asset.relativePath);
  const recordRef = (record: ProRecord): SourceRef => sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: text(record[1]) || undefined });
  const byType = new Map<string, ProRecord[]>();
  for (const record of records) (byType.get(text(record[0])) ?? byType.set(text(record[0]), []).get(text(record[0]))!).push(record);
  const all = (type: string) => byType.get(type) ?? [];
  let normalized = 0;

  // Layers: the board's copper, then each other layer something is drawn on.
  const layerRecords = new Map(all("LAYER").map((r) => [num(r[1]) ?? -1, r]));
  const layerName = (id: number) => text(layerRecords.get(id)?.[3]) || (id === 1 ? "Top Layer" : id === 2 ? "Bottom Layer" : id === MULTI ? "Multi-Layer" : `Layer ${id}`);
  const used = new Set<number>([1, 2, OUTLINE]);
  const markUsed = (id: number | undefined) => id !== undefined && used.add(id);
  for (const r of records) {
    if (["LINE", "ARC", "POLY", "FILL", "PAD", "POUR", "VIA"].includes(text(r[0]))) markUsed(num(r[4]));
    if (r[0] === "STRING") markUsed(num(r[3]));
  }
  for (const r of all("LAYER")) if (text(r[2]) === "SIGNAL" && (num(r[4]) ?? 0) !== 0) used.add(num(r[1])!);
  const layers: PcbIr["layers"] = [...used]
    .filter((id) => layerRecords.has(id) || id <= 2)
    .sort((a, b) => a - b)
    .map((id) => {
      const kind = text(layerRecords.get(id)?.[2]);
      const side = id === 1 || /^TOP/.test(kind) ? "front" : id === 2 || /^BOT/.test(kind) ? "back" : isCopper(id) ? "inner" : id === MULTI ? "both" : "unknown";
      return {
        id: stableId("layer", pcbId, String(id)),
        sourceId: String(id),
        name: layerName(id),
        role: isCopper(id) ? "copper" : id === OUTLINE ? "edge" : /SILK/.test(kind) ? "silkscreen" : /SOLDER/.test(kind) ? "mask" : /PASTE/.test(kind) ? "paste" : "user",
        side,
        copper: isCopper(id),
      };
    });
  normalized += layers.length;

  const footprints: PcbIr["footprints"] = [];
  const pads: PcbIr["pads"] = [];
  const tracks: PcbIr["tracks"] = [];
  const vias: PcbIr["vias"] = [];
  const zones: PcbIr["zones"] = [];
  const boardOutline: PcbIr["boardOutline"] = [];
  const outlinePieces: PathPiece[] = [];
  const silkscreen = emptySilkscreen();
  const netNames = new Set(all("NET").map((r) => text(r[1])).filter(Boolean));
  const netId = (net: string) => (net ? stableId("pcb-net", pcbId, net) : undefined);
  const netFields = (net: string) => (net ? { netId: netId(net), sourceNativeNetId: net } : {});
  const useNet = (net: string) => {
    if (net) netNames.add(net);
  };

  /** A stroke, arc or circle piece on a board layer: copper track, outline edge or silkscreen. */
  const addPiece = (piece: PathPiece, layer: number, width: number | undefined, net: string, id: string, record: ProRecord) => {
    const { kind, geometry } = pieceGeometry(piece);
    if (isCopper(layer) && kind !== "circle") {
      useNet(net);
      tracks.push({ id, kind: kind === "arc" ? "arc" : "segment", ...(geometry as object), ...(width ? { width: mm(width) } : {}), layer: layerName(layer), ...netFields(net), sourceRef: recordRef(record) } as PcbIr["tracks"][number]);
    } else if (layer === OUTLINE) outlinePieces.push(piece);
    else if (SILK[layer]) silkscreen.graphics.push({ id, layer: SILK[layer]!, kind, geometry, ...(width ? { width: mm(width) } : {}) });
    else return false;
    return true;
  };
  const polygon = (id: string, layer: string, points: XY[], filled = true): PcbPolygon => ({ id, layer, points: points.map(P), filled });

  // Footprints, with their pads and silkscreen, from the project's .efoo files.
  const attrsOf = new Map<string, Map<string, ProRecord>>();
  for (const r of all("ATTR")) {
    const parent = text(r[3]);
    (attrsOf.get(parent) ?? attrsOf.set(parent, new Map()).get(parent)!).set(text(r[7]), r);
  }
  const padNets = new Map<string, string>();
  for (const r of all("PAD_NET")) {
    padNets.set(`${text(r[1])}|${text(r[4])}`, text(r[3]));
    padNets.set(`${text(r[1])}#${text(r[2])}`, text(r[3]));
  }
  const padOf = (r: ProRecord, place: Place | null, footprintId: string | undefined, net: string, id: string): PcbIr["pads"][number] | null => {
    // PAD: id, lock, net, layer, number, x, y, rotation, hole [shape w h], pad [shape w h radius]
    const [x, y] = [num(r[6]), num(r[7])];
    if (x === undefined || y === undefined) return null;
    const rawLayer = num(r[4]) ?? 1;
    const layer = place?.bottom ? FLIP[rawLayer] ?? rawLayer : rawLayer;
    const at = place ? placeAt(place, [x, y]) : ([x, y] as XY);
    const own = num(r[8]) ?? 0;
    const rotation = place ? (place.bottom ? place.rotation - own : place.rotation + own) : own;
    const shape = Array.isArray(r[10]) ? (r[10] as unknown[]) : [];
    const hole = Array.isArray(r[9]) ? (r[9] as unknown[]) : null;
    let [w, h] = [num(shape[1]) ?? 0, num(shape[2]) ?? 0];
    const kind = text(shape[0]).toUpperCase();
    if (kind === "POLY" || kind === "POLYGON") {
      const pts = shapePaths(shape[1]).flatMap((p) => pathPoints(p));
      if (pts.length) {
        const xs = pts.map((p) => p[0]),
          ys = pts.map((p) => p[1]);
        [w, h] = [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
      }
    }
    const [hw, hh] = hole ? [num(hole[1]) ?? 0, num(hole[2]) ?? num(hole[1]) ?? 0] : [0, 0];
    const irShape = kind === "RECT" ? ((num(shape[3]) ?? 0) > 0 ? "roundrect" : "rect") : kind === "ELLIPSE" ? (Math.abs(w - h) < 1e-6 ? "circle" : "oval") : kind === "OVAL" ? "oval" : kind === "POLY" || kind === "POLYGON" ? "custom" : "rect";
    const copperLayers = layer === MULTI ? ["Multi-Layer"] : [layerName(layer)];
    useNet(net);
    normalized += 1;
    return {
      id,
      ...(footprintId ? { footprintId } : {}),
      number: text(r[5]),
      padType: hole && hw > 0 ? (w <= hw + 1e-6 && h <= hh + 1e-6 ? "np_thru_hole" : "thru_hole") : "smd",
      shape: irShape,
      rotation: str(rotation),
      ...(hole && hw > 0 ? { drill: { x: mm(hw), y: mm(hh) } } : {}),
      position: P(at),
      size: { x: mm(w || hw), y: mm(h || hh), unit: "mm" },
      layers: copperLayers,
      ...netFields(net),
      ...(net ? { netName: net } : {}),
      sourceRef: recordRef(r),
    };
  };

  for (const component of all("COMPONENT")) {
    // COMPONENT: id, lock, layer (1 top, 2 bottom), x, y, rotation, {attributes}
    const nativeId = text(component[1]);
    const attrs = attrsOf.get(nativeId) ?? new Map<string, ProRecord>();
    const value = (key: string) => text(attrs.get(key)?.[8]);
    const device = context.devices.get(value("Device")) ?? {};
    const own = (component[7] && typeof component[7] === "object" ? component[7] : {}) as Record<string, unknown>;
    const lookup = (key: string): string | undefined => value(key) || text(own[key]) || device[key] || undefined;
    const field = (key: string) => resolve(lookup(key) ?? "", lookup);
    const footprintUuid = value("Footprint") || device.Footprint || "";
    const place: Place = { x: num(component[4]) ?? 0, y: num(component[5]) ?? 0, rotation: num(component[6]) ?? 0, bottom: text(component[3]) === "2" };
    const reference = field("Designator") || `FP${footprints.length + 1}`;
    const id = stableId("footprint", pcbId, nativeId);
    const fields: Record<string, string> = {};
    for (const key of new Set([...Object.keys(device), ...attrs.keys()])) {
      const v = field(key);
      if (v && !/^(Symbol|Device|Footprint|3D Model|Unique ID|Channel ID|Group ID|Reuse Block)$/.test(key)) fields[key] = v;
    }
    const footprint: PcbIr["footprints"][number] = {
      id,
      reference,
      value: field("Value") || field("Name") || "",
      libraryIdentifier: context.footprintTitles.get(footprintUuid) ?? footprintUuid,
      fields,
      graphics: [],
      position: P([place.x, place.y]),
      rotation: str(place.rotation),
      side: place.bottom ? "back" : "front",
      locked: truthy(component[2]) === true,
      padIds: [],
      sourceRef: recordRef(component),
    };
    footprints.push(footprint);
    normalized += 1;
    const lib = footprintUuid ? context.footprint(footprintUuid) : undefined;
    if (!lib) continue;
    const at = (p: XY) => placeAt(place, p);
    for (const r of lib) {
      const kind = r[0];
      const rawLayer = num(r[4]) ?? -1;
      const layer = place.bottom ? FLIP[rawLayer] ?? rawLayer : rawLayer;
      if (kind === "PAD") {
        const padNative = text(r[1]);
        const net = padNets.get(`${nativeId}|${padNative}`) ?? padNets.get(`${nativeId}#${text(r[5])}`) ?? "";
        const pad = padOf(r, place, id, net, stableId("pad", pcbId, id, text(r[5]), padNative));
        if (pad) {
          pads.push(pad);
          footprint.padIds.push(pad.id);
        }
      } else if (kind === "POLY" || kind === "LINE" || kind === "ARC") {
        const pieces = kind === "POLY" ? pathPieces(r[6]) : linePieces(r);
        const width = num(kind === "POLY" ? r[5] : kind === "LINE" ? r[9] : r[10]);
        if (rawLayer === COMPONENT_SHAPE) {
          // The body's outline, in the footprint's own frame (mm, y down; mirrored on the bottom) — for the 3D view's body envelopes.
          for (const [k, piece] of pieces.entries()) {
            const local = pieceAt(piece, ([u, v]) => [place.bottom ? -u : u, v]);
            const g = pieceGeometry(local);
            footprint.graphics!.push({ id: `${id}:${text(r[1])}:${k}`, layer: "Component Shape Layer", ...g });
          }
        } else pieces.forEach((piece, k) => SILK[layer] && addPiece(pieceAt(piece, at), layer, width, "", `${id}:${text(r[1])}:${k}`, r));
      } else if (kind === "FILL" && SILK[layer]) {
        shapePaths(r[7]).forEach((path, k) => {
          const pts = pathPoints(path).map(at);
          if (pts.length >= 3) silkscreen.polygons.push(polygon(`${id}:${text(r[1])}:${k}`, SILK[layer]!, pts));
        });
      }
    }
  }

  // Pads placed on the board itself.
  for (const r of all("PAD")) {
    const footprintId = stableId("footprint", pcbId, "board-pads");
    let footprint = footprints.find((candidate) => candidate.id === footprintId);
    if (!footprint) {
      footprint = { id: footprintId, reference: "BOARD_PAD", value: "", libraryIdentifier: "board_pad", rotation: "0", side: "front", locked: false, padIds: [], sourceRef: ref };
      footprints.push(footprint);
    }
    const pad = padOf(r, null, footprintId, text(r[3]), stableId("pad", pcbId, text(r[1])));
    if (pad) {
      pads.push(pad);
      footprint.padIds.push(pad.id);
    }
  }

  // Tracks, outline and silkscreen strokes.
  for (const r of [...all("LINE"), ...all("ARC"), ...all("POLY")]) {
    const layer = num(r[4]) ?? -1;
    const net = text(r[3]);
    const pieces = r[0] === "POLY" ? pathPieces(r[6]) : linePieces(r);
    const width = num(r[0] === "POLY" ? r[5] : r[0] === "LINE" ? r[9] : r[10]);
    pieces.forEach((piece, k) => {
      if (addPiece(piece, layer, width, net, pieces.length > 1 ? stableId("track", pcbId, text(r[1]), k) : stableId("track", pcbId, text(r[1])), r)) normalized += 1;
    });
  }
  for (const r of all("VIA")) {
    // VIA: id, lock, net, ?, x, y, drill, diameter
    const [x, y] = [num(r[5]), num(r[6])];
    if (x === undefined || y === undefined) continue;
    const net = text(r[3]);
    useNet(net);
    vias.push({ id: stableId("via", pcbId, text(r[1])), position: P([x, y]), drill: mm(num(r[7]) ?? 0), size: mm(num(r[8]) ?? 0), layers: ["Top Layer", "Bottom Layer"], ...netFields(net), sourceRef: recordRef(r) });
    normalized += 1;
  }

  // Copper: fills, pours (their outline) and what EasyEDA poured inside them.
  for (const r of all("FILL")) {
    // FILL: id, lock, net, layer, width, fill style, [paths]
    const layer = num(r[4]) ?? -1;
    const loops = shapePaths(r[7]).map(pathPoints).filter((pts) => pts.length >= 3);
    if (!loops.length) continue;
    if (isCopper(layer) || layer === MULTI) {
      const net = text(r[3]);
      useNet(net);
      const name = layer === MULTI ? "Multi-Layer" : layerName(layer);
      zones.push({ id: stableId("zone", pcbId, text(r[1])), layers: [name], ...netFields(net), sourceRef: recordRef(r), shape: { keepout: false, outline: loops[0]!.map(([x, y]) => [x * MIL, -y * MIL] as [number, number]), fills: loops.map((pts) => ({ layer: name, points: pts.map(([x, y]) => [x * MIL, -y * MIL] as [number, number]) })) } });
    } else if (SILK[layer]) loops.forEach((pts, k) => silkscreen.polygons.push(polygon(`${text(r[1])}:${k}`, SILK[layer]!, pts)));
    else continue;
    normalized += 1;
  }
  const poured = new Map<string, XY[][]>();
  for (const r of all("POURED")) {
    // POURED: id, pour id, ?, is fill, [paths]
    const loops = shapePaths(r[5]).map(pathPoints).filter((pts) => pts.length >= 3);
    const list = poured.get(text(r[2])) ?? [];
    list.push(...loops);
    poured.set(text(r[2]), list);
  }
  for (const r of all("POUR")) {
    // POUR: id, lock, net, layer, width, name, priority, [paths]
    const layer = num(r[4]) ?? -1;
    const net = text(r[3]);
    useNet(net);
    const outline = shapePaths(r[8]).map(pathPoints).find((pts) => pts.length >= 3) ?? [];
    let fills = poured.get(text(r[1])) ?? [];
    // EasyEDA (editor 2.2) stores poured copper in tenths of the board's unit: scaled when that is what lands it in its pour.
    if (outline.length && fills.length) {
      const box = boxOf(outline);
      const poured = boxOf(fills.flat());
      const inside = (k: number) => poured[0] * k >= box[0] - 50 && poured[2] * k <= box[2] + 50 && poured[1] * k >= box[1] - 50 && poured[3] * k <= box[3] + 50;
      const off = (k: number) => Math.hypot(((poured[0] + poured[2]) * k - box[0] - box[2]) / 2, ((poured[1] + poured[3]) * k - box[1] - box[3]) / 2);
      if (inside(10) && (!inside(1) || off(10) < off(1))) fills = fills.map((pts) => pts.map(([x, y]) => [x * 10, y * 10] as XY));
    }
    const name = layerName(layer);
    zones.push({
      id: stableId("zone", pcbId, text(r[1])),
      layers: [name],
      ...netFields(net),
      sourceRef: recordRef(r),
      shape: { keepout: false, outline: outline.map(([x, y]) => [x * MIL, -y * MIL] as [number, number]), fills: fills.map((pts) => ({ layer: name, points: pts.map(([x, y]) => [x * MIL, -y * MIL] as [number, number]) })) },
    });
    normalized += 1;
  }
  for (const r of all("REGION")) {
    // REGION: id, lock, layer, width, [rule kinds], [paths] — a keep-out or constraint area.
    const layer = num(r[3]) ?? -1;
    const outline = shapePaths(r[6]).map(pathPoints).find((pts) => pts.length >= 3);
    if (!outline) continue;
    zones.push({ id: stableId("zone", pcbId, text(r[1])), layers: [layerName(layer)], sourceRef: recordRef(r), shape: { keepout: true, outline: outline.map(([x, y]) => [x * MIL, -y * MIL] as [number, number]), fills: [] } });
    normalized += 1;
  }

  // Silkscreen texts and shown designators (easyeda-silk.ts reads them in the board's own units).
  const texts = emptySilkscreen();
  const textRecords = new Map<string, ProRecord>();
  for (const r of [...all("STRING"), ...all("ATTR")]) {
    easyEdaProSilk(r, texts);
    textRecords.set(text(r[1]), r);
  }
  silkscreen.texts.push(
    ...texts.texts.map(
      (t): PcbText => {
        // STRING: … font (7), height (8), …, inverse (14), its box's margin (15); an ATTR has four more fields first.
        const r = textRecords.get(t.id) ?? [];
        const shift = r[0] === "ATTR" ? 4 : 0;
        const height = Number(t.size.height);
        // EasyEDA's own fonts are narrow ("License plate" most of all); the extent is estimated from the height.
        const length = height * t.text.length * (/license/i.test(text(r[7 + shift])) ? 0.5 : 0.62);
        const inverse = truthy(r[14 + shift]) === true;
        return {
        ...t,
        length: mm(length),
        ...(inverse ? { inverse: { margin: mm(num(r[15 + shift]) || height * 0.15) } } : {}),
        position: P([Number(t.position.x), Number(t.position.y)]),
        size: { height: mm(Number(t.size.height)), width: mm(Number(t.size.width)) },
        ...(t.thickness ? { thickness: mm(Number(t.thickness)) } : {}),
        // EasyEDA mirrors bottom silkscreen text itself (read from the back); its own flag mirrors it once more.
        mirrored: t.layer === "B.SilkS" ? !t.mirrored : t.mirrored,
        };
      },
    ),
  );
  normalized += silkscreen.texts.length;

  cleanOutline(outlinePieces).forEach((piece, k) => boardOutline.push({ id: stableId("outline", pcbId, k), ...pieceGeometry(piece) }));

  // Board size: the outline's extent, and the stack-up's thickness.
  const outlinePoints = boardOutline.flatMap((item) => ["start", "mid", "end", "center"].flatMap((key) => {
    const p = item.geometry[key] as { x: string; y: string } | undefined;
    return p ? [[Number(p.x), Number(p.y)] as XY] : [];
  }));
  const circleExtent = boardOutline.filter((item) => item.kind === "circle").flatMap((item) => {
    const c = item.geometry.center as { x: string; y: string };
    const e = item.geometry.end as { x: string; y: string };
    const r = Math.hypot(Number(e.x) - Number(c.x), Number(e.y) - Number(c.y));
    return [[Number(c.x) - r, Number(c.y) - r], [Number(c.x) + r, Number(c.y) + r]] as XY[];
  });
  const stackMil = all("LAYER_PHYS").reduce((sum, r) => sum + (num(r[3]) ?? 0), 0);
  // To the micrometre: the stack-up sums layer thicknesses rounded to a thousandth of a mil.
  const thickness = stackMil > 10 ? String(Math.round(stackMil * MIL * 1000) / 1000) : "1.6";
  let physicalDimensions: PcbIr["physicalDimensions"];
  if (outlinePoints.length >= 2) {
    const box = boxOf([...outlinePoints, ...circleExtent]);
    physicalDimensions = {
      width: str(box[2] - box[0]),
      height: str(box[3] - box[1]),
      thickness,
      unit: "mm",
      boundingBox: { minX: str(box[0]), minY: str(box[1]), maxX: str(box[2]), maxY: str(box[3]) },
      outlineClosed: true,
    };
  }

  const nets: NetIr[] = [...netNames].map((netName) => {
    const id = netId(netName)!;
    return {
      id,
      domain: "pcb_physical",
      canonicalName: netName,
      displayNames: [netName],
      endpoints: [
        ...pads.filter((pad) => pad.netId === id).map((pad) => ({ id: stableId("endpoint", id, pad.id), type: "footprint_pad" as const, targetId: pad.id, identifier: { pad: pad.number, footprintId: pad.footprintId ?? "" } })),
        ...tracks.filter((track) => track.netId === id).map((track) => ({ id: stableId("endpoint", id, track.id), type: "track" as const, targetId: track.id, identifier: { kind: track.kind } })),
        ...vias.filter((via) => via.netId === id).map((via) => ({ id: stableId("endpoint", id, via.id), type: "via" as const, targetId: via.id, identifier: {}, position: via.position })),
        ...zones.filter((zone) => zone.netId === id).map((zone) => ({ id: stableId("endpoint", id, zone.id), type: "zone" as const, targetId: zone.id, identifier: {} })),
      ],
      segmentIds: tracks.filter((track) => track.netId === id).map((track) => track.id),
      resolution: { method: "explicit", confidence: 1 },
      sourceRefs: [ref],
    } as NetIr;
  });

  // A panel: named so, panelizing, or the same designators placed over and over.
  const references = footprints.filter((f) => f.reference !== "BOARD_PAD").map((f) => f.reference);
  const repeated = references.length - new Set(references).size;
  const panel = /\bpanel/i.test(name) || all("PANELIZE").some((r) => truthy(r[1]) === true) || (references.length >= 4 && repeated / references.length > 0.3);

  const pcb: PcbIr = {
    id: pcbId,
    documentId: stableId("document", asset.sha256, asset.relativePath),
    name,
    units: "mm",
    coordinateSystem: { sourceUnits: "mil (JLCEDA Pro, y up)", canonicalUnits: "mm", rotationConvention: "degrees_ccw", precision: "source_token_preserved" },
    layers,
    stackup: all("LAYER_PHYS").map((r) => ({ nativeId: text(r[1]), name: text(r[2]), thickness: num(r[3]) !== undefined ? mm(num(r[3])!) : null })),
    boardOutline,
    ...(physicalDimensions ? { physicalDimensions } : {}),
    footprints,
    pads,
    tracks,
    vias,
    zones,
    silkscreen,
    sourceRefs: [ref],
  };
  return { pcb, nets, normalized, panel };
}

/** LINE (id, lock, net, layer, x1, y1, x2, y2, width) and ARC (… x2, y2, sweep, width) as one piece. */
function linePieces(r: ProRecord): PathPiece[] {
  const v = [5, 6, 7, 8].map((k) => num(r[k]));
  if (v.some((n) => n === undefined)) return [];
  const [a, b]: XY[] = [
    [v[0]!, v[1]!],
    [v[2]!, v[3]!],
  ];
  if (r[0] === "ARC") return pathPieces([a[0], a[1], "ARC", num(r[9]) ?? 0, b[0], b[1]]);
  return [{ kind: "line", start: a, end: b }];
}

/**
 * The board outline as closed loops, the way EasyEDA reads it: EasyEDA tolerates an outline drawn in
 * overlapping pieces (a line drawn twice, a stroke doubling back over another, a hair-thin arc at a
 * joint), the 3D board does not. Collinear overlapping lines are merged, ends within half a mil are
 * joined, lines are split where another piece ends on them, and pieces left dangling are dropped.
 * The pieces as drawn are kept when that leaves nothing.
 */
export function cleanOutline(pieces: PathPiece[]): PathPiece[] {
  const TOL = 0.5;
  type Line = { kind: "line"; start: XY; end: XY };
  let lines = pieces.filter((p): p is Line => p.kind === "line" && Math.hypot(p.end[0] - p.start[0], p.end[1] - p.start[1]) > 1e-9);
  const others = pieces.filter((p) => p.kind !== "line");
  const unionOf = (a: Line, b: Line): Line | null => {
    const [dx, dy] = [a.end[0] - a.start[0], a.end[1] - a.start[1]];
    const len = Math.hypot(dx, dy);
    const [ux, uy] = [dx / len, dy / len];
    const [ex, ey] = [b.end[0] - b.start[0], b.end[1] - b.start[1]];
    const blen = Math.hypot(ex, ey);
    if (Math.abs(ux * ey - uy * ex) / blen > 1e-3) return null;
    const off = (p: XY) => Math.abs((p[0] - a.start[0]) * uy - (p[1] - a.start[1]) * ux);
    if (off(b.start) > TOL || off(b.end) > TOL) return null;
    const t = (p: XY) => (p[0] - a.start[0]) * ux + (p[1] - a.start[1]) * uy;
    const [b0, b1] = [t(b.start), t(b.end)];
    if (Math.max(0, Math.min(b0, b1)) > Math.min(len, Math.max(b0, b1)) + TOL) return null;
    const ends: Array<[number, XY]> = [[0, a.start], [len, a.end], [b0, b.start], [b1, b.end]];
    ends.sort((p, q) => p[0] - q[0]);
    return { kind: "line", start: ends[0]![1], end: ends[3]![1] };
  };
  for (let merged = true; merged; ) {
    merged = false;
    outer: for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++) {
        const union = unionOf(lines[i]!, lines[j]!);
        if (!union) continue;
        lines[i] = union;
        lines.splice(j, 1);
        merged = true;
        break outer;
      }
  }
  // Ends within TOL become one point.
  const nodes: XY[] = [];
  const snap = (p: XY): XY => nodes.find((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) <= TOL) ?? (nodes.push(p), p);
  let all: PathPiece[] = [...lines, ...others].map((p) => (p.kind === "circle" ? p : { ...p, start: snap(p.start), end: snap(p.end) }));
  // Split lines where another piece ends on them.
  const split: PathPiece[] = [];
  for (const p of all) {
    if (p.kind !== "line") {
      split.push(p);
      continue;
    }
    const [dx, dy] = [p.end[0] - p.start[0], p.end[1] - p.start[1]];
    const len = Math.hypot(dx, dy);
    const cuts = nodes
      .map((q) => ({ q, t: ((q[0] - p.start[0]) * dx + (q[1] - p.start[1]) * dy) / len, off: Math.abs((q[0] - p.start[0]) * dy - (q[1] - p.start[1]) * dx) / len }))
      .filter(({ t, off }) => off <= TOL && t > TOL && t < len - TOL)
      .sort((a, b) => a.t - b.t);
    let from = p.start;
    for (const { q } of cuts) {
      split.push({ kind: "line", start: from, end: q });
      from = q;
    }
    split.push({ kind: "line", start: from, end: p.end });
  }
  const key = (p: XY) => `${p[0]},${p[1]}`;
  const seen = new Set<string>();
  all = split.filter((p) => {
    if (p.kind === "circle") return true;
    if (key(p.start) === key(p.end)) return false;
    if (p.kind === "line") {
      const id = [key(p.start), key(p.end)].sort().join("|");
      if (seen.has(id)) return false;
      seen.add(id);
    }
    return true;
  });
  // Drop what dangles.
  for (let pruned = true; pruned; ) {
    const degree = new Map<string, number>();
    for (const p of all) if (p.kind !== "circle") for (const end of [p.start, p.end]) degree.set(key(end), (degree.get(key(end)) ?? 0) + 1);
    const kept = all.filter((p) => p.kind === "circle" || ((degree.get(key(p.start)) ?? 0) > 1 && (degree.get(key(p.end)) ?? 0) > 1));
    pruned = kept.length !== all.length;
    all = kept;
  }
  // What dangled may have been the board's own edge (a panel's rails drawn as open strokes): then keep it as drawn.
  const extent = (list: PathPiece[]) => {
    const box = boxOf(list.flatMap((p) => (p.kind === "circle" ? [[p.center[0] - p.r, p.center[1] - p.r], [p.center[0] + p.r, p.center[1] + p.r]] as XY[] : [p.start, p.end])));
    return (box[2] - box[0]) * (box[3] - box[1]);
  };
  return all.length && extent(all) >= extent(pieces) * 0.98 ? all : pieces;
}

function boxOf(points: XY[]): [number, number, number, number] {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}
