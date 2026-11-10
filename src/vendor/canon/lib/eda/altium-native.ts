// @ts-nocheck — vendored from canon-eda-ir-agent (REFIR); see ../NOTICE.md. Typed access goes through ../core-api.ts.
import * as CFB from "cfb";
import { altiumBlocks, altiumProperties, altiumRecordList } from "./altium-records";
import { attachAltiumModels } from "./altium-models";
import { copperNames, readAltiumPours } from "./altium-pours";
import { placedModel } from "./eagle";
import { matchPackage, type PackagePad, type StandardModel } from "./package-models";
import { altiumDesignators, readAltiumSilkscreen } from "./altium-silk";
import { buildConnectivity, type KicadParseOutput } from "./kicad";
import type { IrPoint, PartIr, PcbIr, SchematicIr, SourceAsset } from "./types";
import { diagnostic, sourceRef, stableId, withoutExtension } from "./util";

// AD stores length-prefixed records inside an OLE compound document. No external
// libraries, scripts, database links or absolute paths in the project are opened.
type Props = Record<string, string>;
const num = (p: Props, k: string) => Number(p[k] ?? 0);
const pt = (x: number, y: number): IrPoint => ({ x: String(Number(x.toFixed(7))), y: String(Number(y.toFixed(7))), unit: "mm" });
const coord = (p: Props, k: string) => (num(p, k) + num(p, `${k}_FRAC`) / 100000) * .254;
const pos = (p: Props, x = "LOCATION.X", y = "LOCATION.Y") => pt(coord(p, x), -coord(p, y));
const decoder = new TextDecoder("windows-1252");
const altiumPinTypes = ["input", "bidirectional", "output", "open_collector", "passive", "tri_state", "open_emitter", "power_in"];
/** Altium writes an overbar as a backslash after each letter (`R\E\S\E\T\`): the name is the letters (local change: ../../NOTICE.md). */
export const altiumText = (text: string) => text.replace(/\\/g, "");
/**
 * A component's parameters by name (designator, comment, …), a value written
 * `=Name` read from the parameter it names, as Altium shows it (local change:
 * ../../NOTICE.md).
 */
export function altiumFields(parameters: Props[]): Record<string, string> {
  const raw = Object.fromEntries(parameters.map((p) => [p.NAME.toUpperCase(), p.TEXT ?? ""]));
  const resolve = (value: string, depth = 0): string => (value.startsWith("=") && depth < 4 && raw[value.slice(1).trim().toUpperCase()] !== undefined ? resolve(raw[value.slice(1).trim().toUpperCase()], depth + 1) : value);
  return Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, resolve(value)]));
}
export { altiumBlocks, altiumProperties } from "./altium-records";

/**
 * A SchDoc's FileHeader records after the header, each in its place (owner
 * indices count every record): an empty or binary record stands as `{}` /
 * `RECORD=binary`, and a stream cut short keeps what came before it (local
 * change: ../../NOTICE.md — one odd record no longer loses the whole sheet).
 */
export function altiumSchematicRecords(data: Uint8Array): { records: Props[]; truncated: boolean; binary: number } {
  const { records, truncated } = altiumRecordList(data);
  let binary = 0;
  const props = records.slice(1).map((record) => {
    if (record.binary) {
      binary += 1;
      return { RECORD: "binary" } as Props;
    }
    return record.bytes.length ? altiumProperties(record.bytes) : ({} as Props);
  });
  return { records: props, truncated, binary };
}

function schematic(data: Uint8Array, asset: SourceAsset, out: KicadParseOutput) {
  if (!data.length) throw new Error("Missing FileHeader stream");
  const { records, truncated, binary } = altiumSchematicRecords(data);
  if (!records.length) throw new Error("No AD schematic records");
  schematicRecords(records, asset, out);
  const ref = sourceRef(asset.id, asset.relativePath);
  if (truncated) out.diagnostics.push(diagnostic("ALTIUM_SCHEMATIC_TRUNCATED", `${asset.relativePath} 的记录流在第 ${records.length + 1} 条处截断；已读取之前的 ${records.length} 条。`, "warning", "syntax", ref, "preserved"));
  if (binary) out.diagnostics.push(diagnostic("ALTIUM_SCHEMATIC_BINARY_RECORDS", `${asset.relativePath} 含 ${binary} 条二进制记录（未解释，按位置保留）。`, "information", "unsupported", ref, "preserved"));
}

/**
 * A SchDoc saved as "Schematic ASCII" (local change: ../../NOTICE.md): not a
 * compound file but one `|KEY=VALUE|…` record per line, the first the header —
 * the same records the binary FileHeader stream holds, read the same way.
 */
export function isAltiumAsciiSchematic(bytes: Uint8Array): boolean {
  const head = decoder.decode(bytes.subarray(0, 256)).replace(/^\uFEFF/, "").trimStart();
  return /^\|HEADER=[^|\n]*Schematic Capture Ascii/i.test(head);
}
export function parseAltiumAsciiSchematic(bytes: Uint8Array, asset: SourceAsset, out: KicadParseOutput) {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("AD schematic exceeds 64 MiB limit");
  const lines: Uint8Array[] = [];
  for (let start = 0, at = 0; at <= bytes.length; at += 1) {
    if (at < bytes.length && bytes[at] !== 0x0a) continue;
    const line = bytes.subarray(start, at > start && bytes[at - 1] === 0x0d ? at - 1 : at);
    if (line.some((byte) => byte !== 0x0d && byte !== 0x20 && byte !== 0x09)) lines.push(line);
    start = at + 1;
    if (lines.length > 100000) throw new Error("Invalid or excessive AD records");
  }
  schematicRecords(lines.slice(1).map(altiumProperties), asset, out);
}

/** A schematic's records, after the header: components (1) and what they own, wires, labels, ports and the rest. */
function schematicRecords(records: Props[], asset: SourceAsset, out: KicadParseOutput) {
  const id = stableId("sch", asset.id), ref = sourceRef(asset.id, asset.relativePath);
  const sch: SchematicIr = { id, documentId: stableId("document", asset.sha256, asset.relativePath), name: withoutExtension(asset.fileName), rootSheetId: `${id}:sheet`, sheets: [{ id: `${id}:sheet`, name: asset.fileName, instancePath: "/" }], texts: [], graphics: [], symbolInstanceIds: [], pins: [], wires: [], junctions: [], labels: [], noConnects: [], connectivityGraphId: stableId("graph", id), sourceRefs: [ref] };
  const components = new Map<number, PartIr>();
  // Each record's children, by owner index, once (local change: ../../NOTICE.md) — not a scan of every record per component.
  const owned = new Map<string, number[]>();
  records.forEach((r, index) => {
    if (r.OWNERINDEX === undefined) return;
    if (!owned.has(r.OWNERINDEX)) owned.set(r.OWNERINDEX, []);
    owned.get(r.OWNERINDEX)!.push(index);
  });
  const childrenOf = (index: number | string) => (owned.get(String(index)) ?? []).map(i => records[i]);
  // A multi-part component (local change: ../../NOTICE.md): each placed part is its own component record with the
  // same designator; they are one part with one symbol unit per placed part, as KiCad keeps a multi-unit symbol.
  const multiPart = new Map<string, PartIr>();
  const unitOf = new Map<number, string>();
  records.forEach((r, index) => {
    if (r.RECORD !== "1") return;
    const children = childrenOf(index);
    const fields = altiumFields(children.filter(p => ["34", "41"].includes(p.RECORD) && p.NAME));
    if(r.LIBREFERENCE)fields.lib_id=r.LIBREFERENCE;
    const designator = fields.DESIGNATOR || r.DESIGNATOR || "?";
    const sibling = num(r, "PARTCOUNT") > 2 && designator !== "?" ? multiPart.get(`${designator}\u0000${r.LIBREFERENCE ?? ""}`) : undefined;
    if (sibling) {
      const unit = { id: `${sibling.id}:unit${num(r, "CURRENTPARTID") || 1}:${index}`, unit: num(r, "CURRENTPARTID") || 1, position: pos(r), rotation: String(num(r, "ORIENTATION") * 90) };
      sibling.symbolUnits.push(unit);
      sibling.sourceRefs.push({ ...sourceRef(asset.id, asset.relativePath), nativeId: String(index) });
      components.set(index, sibling); unitOf.set(index, unit.id); sch.symbolInstanceIds.push(unit.id);
      return;
    }
    const partId = stableId("part", id, String(index));
    const part: PartIr = { id: partId, logicalPartKey: r.UNIQUEID || partId, reference: fields.DESIGNATOR || r.DESIGNATOR || "?", value: fields.COMMENT || r.COMMENT || r.LIBREFERENCE || "", fields, manufacturerRaw: fields.MANUFACTURER, mpnRaw: fields["MANUFACTURER PART NUMBER"] || fields.MPN, variantStatus: "unknown", pinPadMap: [], symbolUnits: [{ id: `${partId}:unit`, unit: num(r, "CURRENTPARTID") || 1, position: pos(r), rotation: "0" }], sourceRefs: [{ ...sourceRef(asset.id, asset.relativePath), nativeId: String(index) }] };
    part.manufacturerRaw ||= fields["MANUFACTURER 1"];
    part.mpnRaw ||= fields["MANUFACTURER PART NUMBER 1"];
    // Its footprint, as the symbol names it (local change: ../../NOTICE.md): the current PCB model of its
    // implementation list (44 → 45), so a part reads with one before, or without, a board.
    const lists = [String(index), ...(owned.get(String(index)) ?? []).filter(i => records[i].RECORD === "44").map(String)];
    const models = lists.flatMap(childrenOf).filter(p => p.RECORD === "45" && (p.MODELTYPE || "").toUpperCase() === "PCBLIB" && p.MODELNAME);
    const model = models.find(p => p.ISCURRENT === "T") ?? (models.length === 1 ? models[0] : undefined);
    if (model) part.footprint = model.MODELNAME;
    components.set(index, part); unitOf.set(index, part.symbolUnits[0].id); out.parts.push(part); sch.symbolInstanceIds.push(part.symbolUnits[0].id);
    if (num(r, "PARTCOUNT") > 2 && designator !== "?") multiPart.set(`${designator}\u0000${r.LIBREFERENCE ?? ""}`, part);
  });
  // Ports, sheet symbols and their entries (local change: ../../NOTICE.md): a port is a hierarchical label (the
  // project's net scope may make it global, altium.ts), a sheet symbol a sheet box with its entries as pins.
  const wireTouches = (x: number, y: number) => records.some(w => w.RECORD === "27" && Array.from({ length: Math.min(num(w, "LOCATIONCOUNT"), 10000) }, (_, i) => [coord(w, `X${i + 1}`), coord(w, `Y${i + 1}`)]).some(([ax, ay], i, all) => {
    const next = all[i + 1];
    if (Math.abs(ax - x) < 1e-6 && Math.abs(ay - y) < 1e-6) return true;
    if (!next) return false;
    const [bx, by] = next;
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    return Math.abs(cross) < 1e-6 && (x - ax) * (x - bx) + (y - ay) * (y - by) <= 1e-9;
  }));
  sch.sheetBoxes = [];
  records.forEach((r, index) => {
    const sr = { ...sourceRef(asset.id, asset.relativePath), nativeId: String(index) };
    if (r.RECORD === "18") {
      const [x, y] = [coord(r, "LOCATION.X"), coord(r, "LOCATION.Y")];
      const width = coord(r, "WIDTH") || 0;
      const vertical = num(r, "STYLE") >= 4;
      const ends: [number, number][] = vertical ? [[x, y], [x, y + width]] : [[x, y], [x + width, y]];
      const [ex, ey] = ends.find(([a, b]) => wireTouches(a, b)) ?? ends[0];
      sch.labels.push({ id: stableId("ad", id, String(index)), name: altiumText(r.NAME ?? ""), kind: "hierarchical", shape: ["input", "output", "bidirectional"][num(r, "IOTYPE") - 1] ?? "passive", position: pt(ex, -ey), rotation: vertical ? "90" : "0", size: "1.5", sourceRef: sr });
    } else if (r.RECORD === "15") {
      const children = childrenOf(index);
      const [x, y] = [coord(r, "LOCATION.X"), coord(r, "LOCATION.Y")];
      const [w, h] = [coord(r, "XSIZE"), coord(r, "YSIZE")];
      const name = children.find(c => c.RECORD === "32")?.TEXT ?? "";
      const file = children.find(c => c.RECORD === "33")?.TEXT ?? "";
      const pins = children.filter(c => c.RECORD === "16").map(entry => {
        const along = (num(entry, "DISTANCEFROMTOP") + num(entry, "DISTANCEFROMTOP_FRAC1") / 1000000) * 2.54;
        const side = num(entry, "SIDE");
        const [px, py] = side === 0 ? [x, y - along] : side === 1 ? [x + w, y - along] : side === 2 ? [x + along, y] : [x + along, y - h];
        return { name: altiumText(entry.NAME ?? ""), position: pt(px, -py) };
      });
      sch.sheetBoxes!.push({ id: stableId("ad", id, String(index)), name: altiumText(name), file: file.replace(/\\/g, "/"), position: pt(x, -y), size: { x: String(Number(w.toFixed(7))), y: String(Number(h.toFixed(7))) }, pins });
    } else if (r.RECORD === "22") sch.noConnects.push(pos(r));
  });
  const unsupported = new Map<string, number>();
  records.forEach((r, index) => {
    const type = r.RECORD || "binary", owner = components.get(num(r, "OWNERINDEX"));
    const component = records[num(r, "OWNERINDEX")];
    if (owner && num(r, "OWNERPARTID") > 0 && (num(r, "OWNERPARTID") !== (num(component, "CURRENTPARTID") || 1) || num(r, "OWNERPARTDISPLAYMODE") !== num(component, "DISPLAYMODE"))) return;
    const rid = stableId("ad", id, String(index)), unit = (owner && unitOf.get(num(r, "OWNERINDEX"))) || rid;
    const sr = { ...sourceRef(asset.id, asset.relativePath), nativeId: String(index) }, p = pos(r);
    const graphic = (points: IrPoint[], closed = false) => { sch.graphics!.push({ id: rid, symbolUnitId: unit, points: closed ? [...points, points[0]] : points, closed }); };
    const points = () => Array.from({ length: Math.min(num(r, "LOCATIONCOUNT"), 10000) }, (_, i) => pos(r, `X${i + 1}`, `Y${i + 1}`));
    if (type === "2" && owner) {
      const angle = (num(r, "PINCONGLOMERATE") & 3) * Math.PI / 2, length = coord(r, "PINLENGTH");
      const end = pt(Number(p.x) + length * Math.cos(angle), Number(p.y) - length * Math.sin(angle));
      if (!(num(r, "PINCONGLOMERATE") & 4)) graphic([p, end]);
      const electrical = r.ELECTRICAL === undefined ? undefined : altiumPinTypes[Number(r.ELECTRICAL)] || "unspecified";
      sch.pins.push({ id: rid, partId: owner.id, symbolUnitId: unit, reference: owner.reference, number: r.DESIGNATOR || "", name: altiumText(r.NAME || ""), electricalType: electrical, position: end, bodyPosition:p, hidden:!!(num(r,"PINCONGLOMERATE")&4), sourceRef: sr });
    } else if (["6", "7"].includes(type)) graphic(points(), type === "7");
    else if (type === "13") graphic([p, pos(r, "CORNER.X", "CORNER.Y")]);
    else if (type === "14") { const q = pos(r, "CORNER.X", "CORNER.Y"); graphic([p, pt(Number(q.x), Number(p.y)), q, pt(Number(p.x), Number(q.y))], true); }
    else if (["8", "12"].includes(type)) {
      const start = num(r, "STARTANGLE"), end = r.ENDANGLE ? num(r, "ENDANGLE") : 360;
      const sweep = ((end - start) % 360 + 360) % 360 || 360;
      const radius = coord(r, "RADIUS"), ry = r.SECONDARYRADIUS ? coord(r, "SECONDARYRADIUS") : radius;
      graphic(Array.from({ length: 49 }, (_, i) => { const a = (start + sweep * i / 48) * Math.PI / 180; return pt(Number(p.x) + radius * Math.cos(a), Number(p.y) - ry * Math.sin(a)); }));
    } else if (type === "27") sch.wires.push({ id: rid, points: points(), sourceRef: sr });
    else if (type === "29") sch.junctions.push({ id: rid, position: p, sourceRef: sr });
    else if (type === "25" || type === "17") {
      const style=num(r,'STYLE');const ground=type==='17'&&([4,5,6,8,9].includes(style)||(!r.STYLE&&/^(?:[A-Z_]*GND|VSS\d*|EARTH)$/i.test(r.TEXT||'')));
      sch.labels.push({ id: rid, name: altiumText(r.TEXT || ""), kind: type === "17" ? "power" : "local", shape:type==='17'?(ground?'ground':style===1||style===7?'arrow':style===0?'circle':'bar'):undefined, position: p, rotation: String(num(r, "ORIENTATION") * 90), size: "1.5", sourceRef: sr });
    } else if (["4", "34", "41"].includes(type)) {
      if (r.ISHIDDEN === "T" || (type === "41" && r.NAME?.toUpperCase() !== "COMMENT")) return;
      const text = r.TEXT || (type === "34" ? owner?.reference : type === "41" ? owner?.value : "");
      if (text) sch.texts!.push({ id: rid, symbolUnitId: owner?.symbolUnits[0].id, text, kind: type === "34" ? "reference" : "value", position: p, rotation: String(num(r, "ORIENTATION") * 90), size: "1.5", align: "start" });
    } else if (!["1", "15", "16", "18", "22", "31", "32", "33", "41", "44", "45", "46", "47", "48"].includes(type)) unsupported.set(type, (unsupported.get(type) || 0) + 1);
  });
  // AD field coordinates often share the body or pin wiring. Place fields
  // beside small two-terminal symbols and above connectors with pins on both
  // sides, where a right-side field would sit directly on the outgoing wires.
  for (const part of new Set(components.values())) {
    const unit = part.symbolUnits[0], pins=sch.pins.filter(p=>p.symbolUnitId===unit.id);
    const graphics = sch.graphics!.filter(g => g.symbolUnitId === unit.id && !pins.some(pin=>
      g.points.length===2 && [pin.bodyPosition,pin.position].every((point,i)=>point?.x===g.points[i]?.x&&point?.y===g.points[i]?.y)));
    const bodyPoints=graphics.flatMap(g=>g.points);
    if(!bodyPoints.length)bodyPoints.push(...pins.map(pin=>pin.bodyPosition??pin.position));
    if(!bodyPoints.length&&unit.position)bodyPoints.push(unit.position);
    const bodyLeft=Math.min(...bodyPoints.map(p=>Number(p.x)));
    const bodyRight = Math.max(...bodyPoints.map(p => Number(p.x)));
    const ys=bodyPoints.map(p=>Number(p.y));
    const top=Math.min(...ys),centerY=(top+Math.max(...ys))/2;
    const leftPins=pins.some(pin=>pin.bodyPosition&&Number(pin.bodyPosition.x)<=bodyLeft+.7&&Number(pin.position.x)<Number(pin.bodyPosition.x)-.2);
    const rightPins=pins.some(pin=>pin.bodyPosition&&Number(pin.bodyPosition.x)>=bodyRight-.7&&Number(pin.position.x)>Number(pin.bodyPosition.x)+.2);
    const connector=leftPins&&rightPins;
    for (const [kind, value, dy] of [["reference", part.reference, -1.25], ["value", part.value, 1.25]] as const) {
      if (!value || value === "?") continue;
      const existing = sch.texts!.find(t => t.symbolUnitId === unit.id && t.kind === kind);
      const fieldPosition=connector?pt((bodyLeft+bodyRight)/2,top+(kind==='reference'?-4.25:-1.9)):pt(bodyRight+.65,centerY+dy);
      if (existing) {
        existing.position = fieldPosition;existing.rotation = "0";existing.align=connector?'middle':'start';
      } else sch.texts!.push({ id: `${unit.id}:${kind}`, symbolUnitId: unit.id, text: value, kind, position: fieldPosition, rotation: "0", size: "1.5", align: connector?'middle':'start' });
    }
  }
  out.schematics.push(sch);
  out.nets.push(...buildConnectivity(sch, sch.pins.map(p => ({ ...p, pin: p.number, x: p.position.x, y: p.position.y })), out.diagnostics));
  out.recognized += records.length; out.normalized += records.length - [...unsupported.values()].reduce((a, b) => a + b, 0);
  out.diagnostics.push(diagnostic("ALTIUM_SCHEMATIC_PARTIAL", `AD 原理图已解析 ${new Set(components.values()).size} 个器件、${sch.pins.length} 个引脚、${sch.wires.length} 条导线。未完整绘制的记录（类型:数量）：${[...unsupported].map(([k,v]) => `${k}:${v}`).join(", ") || "无"}。隐藏引脚、跨页连接与电源样式需人工复核。`, "warning", "unsupported", ref, "preserved"));
}

export function parseAltiumNative(bytes: Uint8Array, asset: SourceAsset, out: KicadParseOutput) {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("AD container exceeds 64 MiB limit");
  const container = CFB.read(bytes, { type: "array" });
  const stream = (name: string): Uint8Array => {
    const i = container.FullPaths.findIndex(p => p.toLowerCase().endsWith(`/${name.toLowerCase()}`));
    return i < 0 ? new Uint8Array() : new Uint8Array(container.FileIndex[i].content as Uint8Array);
  };
  if (asset.extension === ".schdoc") schematic(stream("FileHeader"), asset, out);
  else if (asset.extension === ".pcbdoc") pcb(stream, asset, out);
  else throw new Error("Unsupported AD library container");
}

function pcb(stream: (name: string) => Uint8Array, asset: SourceAsset, out: KicadParseOutput) {
  const ref = sourceRef(asset.id, asset.relativePath), id = stableId("pcb", asset.id);
  const props = (name: string) => altiumBlocks(stream(`${name}/Data`)).map(altiumProperties);
  const mil = (s = "0") => Number.parseFloat(s) * (s.toLowerCase().endsWith("mm") ? 1 : .0254);
  const board = props("Board6")[0];
  if (!board) throw new Error("Missing Board6 records");
  const result: PcbIr = { id, documentId: stableId("document", asset.sha256, asset.relativePath), name: withoutExtension(asset.fileName), units: "mm", coordinateSystem: { sourceUnits: "0.0001mil", canonicalUnits: "mm", rotationConvention: "degrees_ccw", precision: "source_token_preserved" }, layers: [], stackup: [], boardOutline: [], footprints: [], pads: [], tracks: [], vias: [], zones: [], sourceRefs: [ref] };
  // Copper by its place in the stack (In1.Cu …, local change: ../../NOTICE.md); other layers by number.
  const copper = copperNames(board);
  const layer = (n: number) => n === 74 ? "*.Cu" : copper.get(n) ?? `AD.Layer${n}`;
  for (let n = 1; n <= 32; n++) result.layers.push({ id: layer(n), sourceId: String(n), name: layer(n), role: "copper", side: n === 1 ? "front" : n === 32 ? "back" : "inner", copper: true });
  const vertices: IrPoint[] = [];
  for (let n = 0; board[`VX${n}`] !== undefined && n < 10000; n++) {
    vertices.push(pt(mil(board[`VX${n}`]), -mil(board[`VY${n}`])));
    if (board[`KIND${n}`] === "1") {
      const a = num(board, `SA${n}`), sweep = ((num(board, `EA${n}`) - a) % 360 + 360) % 360;
      for (let k = 1; k < 24; k++) { const t = (a + sweep * k / 24) * Math.PI / 180; vertices.push(pt(mil(board[`CX${n}`]) + mil(board[`R${n}`]) * Math.cos(t), -mil(board[`CY${n}`]) - mil(board[`R${n}`]) * Math.sin(t))); }
    }
  }
  vertices.forEach((p, i) => result.boardOutline.push({ id: `${id}:edge${i}`, kind: "line", geometry: { start: p, end: vertices[(i + 1) % vertices.length] } }));
  // A board not (yet) updated from a schematic names its parts only in each one's designator text (Texts6); read there when Components6 does not say (local change: ../../NOTICE.md).
  let designators = new Map<number, string>();
  try {
    designators = altiumDesignators(stream);
  } catch {
    // No readable designator texts: the parts keep "?".
  }
  props("Components6").forEach((p, i) => result.footprints.push({ id: `${id}:fp${i}`, reference: p.SOURCEDESIGNATOR || designators.get(i) || "?", value: p.SOURCELIBREFERENCE || "", libraryIdentifier: p.PATTERN || "", position: pt(mil(p.X), -mil(p.Y)), rotation: String(num(p, "ROTATION")), side: p.LAYER === "BOTTOM" ? "back" : "front", locked: p.LOCKED === "TRUE", padIds: [], sourceRef: { ...sourceRef(asset.id, asset.relativePath), nativeId: `Components6:${i}` } }));
  const nets = props("Nets6").map((p, i) => ({ id: `${id}:net${i}`, domain: "pcb_physical" as const, canonicalName: p.NAME || `Net${i}`, displayNames: [p.NAME || `Net${i}`], endpoints: [] as import("./types").NetEndpoint[], segmentIds: [] as string[], resolution: { method: "explicit" as const, confidence: 1 }, sourceRefs: [ref] }));
  // A stream whose records this reader cannot follow (another format version) stops that stream only, said so;
  // the parts, nets and other streams read before and after it stay (local change: ../../NOTICE.md).
  const binary = (name: string, type: number, handler: (blocks: Uint8Array[], i: number) => void) => {
    const bytes = stream(`${name}/Data`), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 0, i = 0;
    try {
    while (offset < bytes.length) {
      if (bytes[offset++] !== type || i >= 100000) throw new Error(`Unsupported ${name} record`);
      const blocks: Uint8Array[] = [];
      for (let k = 0; k < (type === 2 ? 6 : 1); k++) {
        if (offset + 4 > bytes.length) throw new Error(`Truncated ${name}`);
        const len = view.getUint32(offset, true) & 0xffffff; offset += 4;
        if (offset + len > bytes.length) throw new Error(`Truncated ${name}`);
        blocks.push(bytes.subarray(offset, offset + len)); offset += len;
      }
      handler(blocks, i++);
    }
    } catch (error) {
      out.diagnostics.push(diagnostic("ALTIUM_PCB_RECORDS_PARTIAL", `${name} 自第 ${i + 1} 条记录起无法解析：${error instanceof Error ? error.message : String(error)}。已读取的 ${i} 条及封装、网络和其余记录保留。`, "warning", "unsupported", ref, "preserved"));
    }
  };
  const read = (b: Uint8Array) => { const v = new DataView(b.buffer, b.byteOffset, b.byteLength); return { u: (i: number) => v.getUint16(i, true), d: (i: number) => v.getFloat64(i, true), mm: (i: number) => v.getInt32(i, true) * .00000254, p: (i: number) => pt(v.getInt32(i, true) * .00000254, -v.getInt32(i + 4, true) * .00000254) }; };
  binary("Pads6", 2, (blocks, i) => {
    const b = blocks[4], v = read(b), fp = result.footprints[v.u(7)], net = nets[v.u(3)], pid = `${id}:pad${i}`;
    const hole = v.mm(45), size = { x: String(v.mm(21)), y: String(v.mm(25)), unit: "mm" as const };
    const number = decoder.decode(blocks[0].subarray(1, 1 + blocks[0][0]));
    result.pads.push({ id: pid, footprintId: fp?.id, number, padType: hole > 0 ? b[60] ? "thru_hole" : "np_thru_hole" : "smd", shape: b[49] === 1 ? (size.x === size.y ? "circle" : "oval") : b[49] === 2 ? "rect" : "roundrect", rotation: String(v.d(52)), position: v.p(13), size, drill: hole > 0 ? { x: String(hole), y: String(hole) } : undefined, layers: [layer(b[0])], netId: net?.id, netName: net?.canonicalName, sourceNativeNetId: String(v.u(3)), sourceRef: ref });
    fp?.padIds.push(pid); net?.endpoints.push({ id: `${pid}:ep`, type: "footprint_pad", targetId: pid, identifier: { reference: fp?.reference || "", pad: number }, position: v.p(13) });
  });
  binary("Tracks6", 4, ([b], i) => { const v = read(b), net = nets[v.u(3)], tid = `${id}:track${i}`; result.tracks.push({ id: tid, kind: "segment", start: v.p(13), end: v.p(21), width: String(v.mm(29)), layer: layer(b[0]), netId: net?.id, sourceNativeNetId: String(v.u(3)), sourceRef: ref }); net?.segmentIds.push(tid); });
  binary("Vias6", 3, ([b], i) => { const v = read(b), net = nets[v.u(3)], vid = `${id}:via${i}`; result.vias.push({ id: vid, position: v.p(13), size: String(v.mm(21)), drill: String(v.mm(25)), layers: ["F.Cu", "B.Cu"], netId: net?.id, sourceRef: ref }); net?.endpoints.push({ id: `${vid}:ep`, type: "via", targetId: vid, identifier: {}, position: v.p(13) }); });
  try {
    result.zones = readAltiumPours(stream, board, props("Polygons6"), nets, id, ref);
  } catch (error) {
    out.diagnostics.push(diagnostic("ALTIUM_POURS_PARTIAL", `覆铜记录解析失败：${error instanceof Error ? error.message : String(error)}。PCB 其余几何仍保留。`, "warning", "geometry", ref, "preserved"));
  }
  // Its silkscreen, for the 3D view (local change: ../../NOTICE.md).
  try {
    result.silkscreen = readAltiumSilkscreen(stream, props("Components6"), result.footprints, id);
  } catch (error) {
    out.diagnostics.push(diagnostic("ALTIUM_SILKSCREEN_PARTIAL", `丝印记录解析失败：${error instanceof Error ? error.message : String(error)}。PCB 其余几何仍保留。`, "warning", "geometry", ref, "preserved"));
  }
  const usedLayers = new Set([...result.pads.flatMap(p => p.layers), ...result.tracks.map(t => t.layer)]);
  result.layers = result.layers.filter(l => usedLayers.has(l.name));
  try {
    const models = attachAltiumModels(stream, result);
    out.diagnostics.push(diagnostic("ALTIUM_3D_MODELS", `已关联 ${models.attached} 个 AD 内嵌模型引用；${models.extruded} 个拉伸、圆柱或球体 Body 按其轮廓与高度绘制；${models.skipped} 条 Body 未关联（外部模型、非封装 Body 或缺少模型）。实际加载状态见 3D 查看器。`, models.skipped ? "warning" : "information", "geometry", ref, "normalized"));
  } catch (error) {
    out.diagnostics.push(diagnostic("ALTIUM_3D_PARTIAL", `3D 模型记录解析失败：${error instanceof Error ? error.message : String(error)}。PCB 几何仍保留。`, "warning", "geometry", ref, "preserved"));
  }
  out.pcbs.push(result); out.nets.push(...nets);
  const normalized = result.pads.length + result.tracks.length + result.footprints.length;
  out.normalized += normalized; out.recognized += normalized;
  out.diagnostics.push(diagnostic("ALTIUM_PCB_PARTIAL", `AD PCB 已解析 ${result.footprints.length} 个封装、${result.pads.length} 个焊盘、${result.tracks.length} 条直线走线、${result.vias.length} 个过孔和 ${result.zones.length} 块覆铜。圆弧板框采用采样近似；圆弧走线、特殊焊盘、叠层、盲埋孔范围和规则尚未完整解析。内嵌 STEP 模型按 Body 记录关联，加载结果请查看 3D 页面。`, "warning", "unsupported", ref, "preserved"));
}

/* ----------------------------------------------------------------------------
 * A PcbDoc saved as "PCB ASCII" (local change: ../../NOTICE.md): not a compound
 * file but one `|RECORD=Kind|KEY=VALUE|…` record per line, the same fields the
 * binary streams hold as text (coordinates as `1234.5mil` / `1.2mm`, layers by
 * name). Read into the same PCB IR as a binary board: outline, footprints,
 * nets, pads, tracks, arcs, vias, copper regions and the silkscreen lines.
 * -------------------------------------------------------------------------- */

/** Layer names as an ASCII board writes them → Altium's layer numbers (as in the binary streams). */
function asciiLayerNumber(name = ""): number {
  const u = name.toUpperCase();
  const fixed: Record<string, number> = {
    TOP: 1, BOTTOM: 32, TOPOVERLAY: 33, BOTTOMOVERLAY: 34, TOPPASTE: 35, BOTTOMPASTE: 36, TOPSOLDER: 37, BOTTOMSOLDER: 38,
    DRILLGUIDE: 55, KEEPOUT: 56, DRILLDRAWING: 73, MULTILAYER: 74,
  };
  if (fixed[u]) return fixed[u];
  let m = /^MID(?:LAYER)?(\d+)$/.exec(u);
  if (m) return 1 + Number(m[1]);
  m = /^(?:INTERNAL)?PLANE(\d+)$/.exec(u);
  if (m) return 38 + Number(m[1]);
  m = /^MECHANICAL(\d+)$/.exec(u);
  if (m) return 56 + Number(m[1]);
  return 0;
}

export function isAltiumAsciiPcb(bytes: Uint8Array): boolean {
  const head = decoder.decode(bytes.subarray(0, 256)).replace(/^﻿/, "").trimStart();
  return /^\|RECORD=Board\|/i.test(head);
}

export function parseAltiumAsciiPcb(bytes: Uint8Array, asset: SourceAsset, out: KicadParseOutput) {
  if (bytes.length > 64 * 1024 * 1024) throw new Error("AD PCB exceeds 64 MiB limit");
  const records: Props[] = [];
  for (let start = 0, at = 0; at <= bytes.length; at += 1) {
    if (at < bytes.length && bytes[at] !== 0x0a && bytes[at] !== 0x0d) continue;
    if (at > start) records.push(altiumProperties(bytes.subarray(start, at)));
    start = at + 1;
    if (records.length > 400000) throw new Error("Invalid or excessive AD records");
  }
  const of = (kind: string) => records.filter((r) => (r.RECORD || "").toLowerCase() === kind);
  const boards = of("board");
  if (!boards.length) throw new Error("Missing Board records");
  // The board's settings are spread over several Board lines; the first holds the outline.
  const board: Props = Object.assign(Object.create(null), ...boards.slice(1), boards[0]);

  const ref = sourceRef(asset.id, asset.relativePath), id = stableId("pcb", asset.id);
  const mil = (s = "0") => Number.parseFloat(s) * (s.toLowerCase().endsWith("mm") ? 1 : .0254);
  const at = (p: Props, x = "X", y = "Y") => pt(mil(p[x]), -mil(p[y]));
  const result: PcbIr = { id, documentId: stableId("document", asset.sha256, asset.relativePath), name: withoutExtension(asset.fileName), units: "mm", coordinateSystem: { sourceUnits: "mil", canonicalUnits: "mm", rotationConvention: "degrees_ccw", precision: "source_token_preserved" }, layers: [], stackup: [], boardOutline: [], footprints: [], pads: [], tracks: [], vias: [], zones: [], silkscreen: { graphics: [], polygons: [], texts: [] }, sourceRefs: [ref] };
  const copper = copperNames(board);
  const layer = (name = "") => { const n = asciiLayerNumber(name); return n === 74 ? "*.Cu" : copper.get(n) ?? (n ? `AD.Layer${n}` : `AD.${name || "Unknown"}`); };
  const silk = (name = "") => ({ 33: "F.SilkS", 34: "B.SilkS" } as Record<number, string>)[asciiLayerNumber(name)];
  for (let n = 1; n <= 32; n++) { const name = n === 1 ? "F.Cu" : n === 32 ? "B.Cu" : copper.get(n) ?? `AD.Layer${n}`; result.layers.push({ id: name, sourceId: String(n), name, role: "copper", side: n === 1 ? "front" : n === 32 ? "back" : "inner", copper: true }); }

  // Outline: the board's vertices, an arc segment sampled (as the binary reader).
  const outline: IrPoint[] = [];
  for (let n = 0; board[`VX${n}`] !== undefined && n < 10000; n++) {
    outline.push(pt(mil(board[`VX${n}`]), -mil(board[`VY${n}`])));
    if (board[`KIND${n}`] === "1") {
      const a = num(board, `SA${n}`), sweep = ((num(board, `EA${n}`) - a) % 360 + 360) % 360;
      for (let k = 1; k < 24; k++) { const t = (a + sweep * k / 24) * Math.PI / 180; outline.push(pt(mil(board[`CX${n}`]) + mil(board[`R${n}`]) * Math.cos(t), -mil(board[`CY${n}`]) - mil(board[`R${n}`]) * Math.sin(t))); }
    }
  }
  // The last vertex repeats the first: one closing edge is enough.
  if (outline.length > 1 && outline[0].x === outline[outline.length - 1].x && outline[0].y === outline[outline.length - 1].y) outline.pop();
  outline.forEach((p, i) => result.boardOutline.push({ id: `${id}:edge${i}`, kind: "line", geometry: { start: p, end: outline[(i + 1) % outline.length] } }));

  // Footprints, by their ID (pads and texts name it in COMPONENT=).
  const footprints = new Map<string, PcbIr["footprints"][number]>();
  const designators = new Map<string, string>();
  for (const t of of("text")) if (t.COMPONENT !== undefined && t.DESIGNATOR === "TRUE" && t.TEXT) designators.set(t.COMPONENT, t.TEXT);
  of("component").forEach((p, i) => {
    const key = p.ID ?? String(i);
    const fp: PcbIr["footprints"][number] = { id: `${id}:fp${i}`, reference: p.SOURCEDESIGNATOR || designators.get(key) || "?", value: p.SOURCELIBREFERENCE || p.COMMENT || "", libraryIdentifier: p.PATTERN || "", position: at(p), rotation: String(num(p, "ROTATION")), side: (p.LAYER || "").toUpperCase() === "BOTTOM" ? "back" : "front", locked: p.LOCKED === "TRUE", padIds: [], sourceRef: { ...ref, nativeId: `Component:${key}` } };
    footprints.set(key, fp);
    result.footprints.push(fp);
  });
  const nets = new Map<string, import("./types").NetIr>();
  of("net").forEach((p, i) => {
    const key = p.ID ?? String(i), name = p.NAME || `Net${key}`;
    nets.set(key, { id: `${id}:net${key}`, domain: "pcb_physical", canonicalName: name, displayNames: [name], endpoints: [], segmentIds: [], resolution: { method: "explicit", confidence: 1 }, sourceRefs: [ref] });
  });
  const netOf = (p: Props) => (p.NET === undefined ? undefined : nets.get(p.NET));

  of("pad").forEach((p, i) => {
    const fp = p.COMPONENT === undefined ? undefined : footprints.get(p.COMPONENT), net = netOf(p), pid = `${id}:pad${i}`;
    const hole = mil(p.HOLESIZE), shape = (p.SHAPE || "").toUpperCase();
    const size = { x: String(mil(p.XSIZE ?? p.TOPXSIZE)), y: String(mil(p.YSIZE ?? p.TOPYSIZE)), unit: "mm" as const };
    const position = at(p);
    result.pads.push({ id: pid, footprintId: fp?.id, number: p.NAME || "", padType: hole > 0 ? (p.PLATED === "FALSE" ? "np_thru_hole" : "thru_hole") : "smd", shape: shape === "ROUND" ? (size.x === size.y ? "circle" : "oval") : shape === "RECTANGLE" ? "rect" : shape === "OCTAGONAL" ? "octagon" : "roundrect", rotation: String(num(p, "ROTATION")), position, size, drill: hole > 0 ? { x: String(hole), y: String(hole) } : undefined, layers: [layer(p.LAYER)], netId: net?.id, netName: net?.canonicalName, sourceNativeNetId: p.NET, sourceRef: ref });
    fp?.padIds.push(pid);
    net?.endpoints.push({ id: `${pid}:ep`, type: "footprint_pad", targetId: pid, identifier: { reference: fp?.reference || "", pad: p.NAME || "" }, position });
  });
  of("track").forEach((p, i) => {
    const start = at(p, "X1", "Y1"), end = at(p, "X2", "Y2"), width = String(mil(p.WIDTH)), s = silk(p.LAYER);
    if (s) { result.silkscreen!.graphics.push({ id: `${id}:silk-track${i}`, layer: s, kind: "line", geometry: { start, end }, width }); return; }
    const net = netOf(p), tid = `${id}:track${i}`;
    result.tracks.push({ id: tid, kind: "segment", start, end, width, layer: layer(p.LAYER), netId: net?.id, sourceNativeNetId: p.NET, sourceRef: ref });
    net?.segmentIds.push(tid);
  });
  of("arc").forEach((p, i) => {
    const cx = mil(p["LOCATION.X"]), cy = mil(p["LOCATION.Y"]), r = mil(p.RADIUS), a = num(p, "STARTANGLE"), sweep = ((num(p, "ENDANGLE") - a) % 360 + 360) % 360;
    const on = (deg: number) => pt(cx + r * Math.cos(deg * Math.PI / 180), -(cy + r * Math.sin(deg * Math.PI / 180)));
    const width = String(mil(p.WIDTH)), s = silk(p.LAYER);
    if (s) { result.silkscreen!.graphics.push(sweep === 0 ? { id: `${id}:silk-arc${i}`, layer: s, kind: "circle", geometry: { center: pt(cx, -cy), end: on(0) }, width } : { id: `${id}:silk-arc${i}`, layer: s, kind: "arc", geometry: { start: on(a), mid: on(a + sweep / 2), end: on(a + sweep) }, width }); return; }
    const net = netOf(p), tid = `${id}:arc${i}`;
    // A full circle: two halves (an arc needs distinct ends).
    const parts = sweep === 0 ? [[a, 180], [a + 180, 180]] : [[a, sweep]];
    parts.forEach(([from, span], k) => result.tracks.push({ id: k ? `${tid}b` : tid, kind: "arc", start: on(from), mid: on(from + span / 2), end: on(from + span), width, layer: layer(p.LAYER), netId: net?.id, sourceNativeNetId: p.NET, sourceRef: ref }));
    net?.segmentIds.push(tid);
  });
  of("via").forEach((p, i) => {
    const net = netOf(p), vid = `${id}:via${i}`, position = at(p);
    result.vias.push({ id: vid, position, size: String(mil(p.DIAMETER)), drill: String(mil(p.HOLESIZE?.match(/[a-z]$/i) ? p.HOLESIZE : `${p.HOLESIZE ?? 0}mil`)), layers: [layer(p.STARTLAYER || "TOP"), layer(p.ENDLAYER || "BOTTOM")], netId: net?.id, sourceRef: ref });
    net?.endpoints.push({ id: `${vid}:ep`, type: "via", targetId: vid, identifier: {}, position });
  });
  // Copper regions outside footprints (pours, copper shapes): drawn as filled zones. A footprint's own region is its pad shape.
  of("region").forEach((p, i) => {
    const l = copper.get(asciiLayerNumber(p.LAYER));
    if (!l || p.KEEPOUT === "TRUE" || (p.KIND ?? "0") !== "0") return;
    const pts: [number, number][] = [];
    for (let n = 0; p[`VX${n}`] !== undefined && n < 10000; n++) pts.push([mil(p[`VX${n}`]), -mil(p[`VY${n}`])]);
    if (pts.length < 3 || (p.COMPONENT !== undefined && p.COMPONENT !== "65535" && footprints.has(p.COMPONENT))) return;
    const net = netOf(p);
    result.zones.push({ id: `${id}:region${i}`, netId: net?.id, sourceNativeNetId: p.NET, layers: [l], sourceRef: { ...ref, nativeId: `Region:${i}` }, shape: { keepout: false, outline: pts, fills: [{ layer: l, points: pts }] } });
  });

  // EasyEDA's Altium export draws the real board shape on the Keep-Out layer and leaves the board region a
  // rectangle around it: a closed Keep-Out loop inside the region is the board's outline.
  const loop = keepoutLoop(records, mil);
  if (loop) result.boardOutline = loop.map((g, i) => ({ id: `${id}:edge${i}`, kind: g.mid ? "arc" : "line", geometry: g }));

  // An ASCII board embeds no 3D model: a standard KiCad model matched by each footprint's pads
  // (package-models.ts, as for EAGLE), said so — never presented as the part's own model (G12).
  const matched = asciiStandardModels(of("component"), of("pad"), footprints, mil);
  const usedLayers = new Set([...result.pads.flatMap((p) => p.layers), ...result.tracks.map((t) => t.layer)]);
  result.layers = result.layers.filter((l) => usedLayers.has(l.name));
  out.pcbs.push(result);
  out.nets.push(...nets.values());
  const normalized = result.pads.length + result.tracks.length + result.footprints.length;
  out.normalized += normalized; out.recognized += normalized;
  out.diagnostics.push(diagnostic("ALTIUM_ASCII_PCB", `AD PCB（ASCII 格式）已解析 ${result.footprints.length} 个封装、${result.pads.length} 个焊盘、${result.tracks.length} 条走线（含圆弧）、${result.vias.length} 个过孔和 ${result.zones.length} 块铜皮。ASCII 文件不含内嵌 3D 模型：${matched} 个封装按焊盘匹配了 KiCad 标准 3D 模型（不是器件本身的模型），其余在 3D 中只显示焊盘。元件丝印文字与自定义焊盘形状尚未绘制。`, "warning", "unsupported", ref, "preserved"));
}

/**
 * Standard models for an ASCII board's footprints (local change: ../../NOTICE.md). Each footprint's pads are
 * taken into its own frame (Altium: y up; a bottom part is mirrored left to right, then turned), as the
 * package matcher expects, and the model placed the way EAGLE's are (eagle.ts placedModel).
 */
function asciiStandardModels(components: Props[], pads: Props[], footprints: Map<string, PcbIr["footprints"][number]>, mil: (s?: string) => number) {
  const byComponent = new Map<string, Props[]>();
  for (const p of pads) if (p.COMPONENT !== undefined) byComponent.set(p.COMPONENT, [...(byComponent.get(p.COMPONENT) ?? []), p]);
  const cache = new Map<string, StandardModel | null>();
  let matched = 0;
  components.forEach((c, i) => {
    const key = c.ID ?? String(i), fp = footprints.get(key), own = byComponent.get(key) ?? [];
    if (!fp || !own.length) return;
    const bottom = (c.LAYER || "").toUpperCase() === "BOTTOM", rot = num(c, "ROTATION"), t = -rot * Math.PI / 180;
    const cx = mil(c.X), cy = mil(c.Y);
    const local: PackagePad[] = own.map((p) => {
      const dx = mil(p.X) - cx, dy = mil(p.Y) - cy;
      let x = dx * Math.cos(t) - dy * Math.sin(t);
      const y = dx * Math.sin(t) + dy * Math.cos(t);
      if (bottom) x = -x;
      const relative = (((num(p, "ROTATION") - rot) % 180) + 180) % 180;
      const across = Math.abs(relative - 90) < 1;
      const w = mil(p.XSIZE ?? p.TOPXSIZE), h = mil(p.YSIZE ?? p.TOPYSIZE);
      return { name: p.NAME || "", x: Number(x.toFixed(4)), y: Number(y.toFixed(4)), w: across ? h : w, h: across ? w : h, tht: mil(p.HOLESIZE) > 0 };
    });
    const prefix = (fp.reference.match(/^[A-Za-z]+/) ?? [""])[0].toUpperCase();
    const signature = `${c.PATTERN ?? ""}\u0000${prefix}\u0000${local.map((p) => `${p.name}:${p.x},${p.y},${p.w},${p.h},${p.tht ? 1 : 0}`).sort().join(";")}`;
    if (!cache.has(signature)) cache.set(signature, matchPackage({ name: c.PATTERN || "", prefix, pads: local, circle: null }).model);
    const model = cache.get(signature);
    if (!model) return;
    fp.models = [placedModel(model, bottom)];
    matched += 1;
  });
  return matched;
}

type Piece = { start: IrPoint; mid?: IrPoint; end: IrPoint };
/** The largest closed loop of Keep-Out tracks and arcs (ends within 0.01 mm), in drawing order; null if none closes. */
function keepoutLoop(records: Props[], mil: (s?: string) => number): Piece[] | null {
  const pieces: Piece[] = [];
  for (const r of records) {
    if ((r.LAYER || "").toUpperCase() !== "KEEPOUT" || r.COMPONENT !== undefined && r.COMPONENT !== "65535") continue;
    const kind = (r.RECORD || "").toLowerCase();
    if (kind === "track") pieces.push({ start: pt(mil(r.X1), -mil(r.Y1)), end: pt(mil(r.X2), -mil(r.Y2)) });
    else if (kind === "arc") {
      const cx = mil(r["LOCATION.X"]), cy = mil(r["LOCATION.Y"]), rad = mil(r.RADIUS), a = num(r, "STARTANGLE"), sweep = ((num(r, "ENDANGLE") - a) % 360 + 360) % 360;
      if (!sweep) continue;
      const on = (deg: number) => pt(cx + rad * Math.cos(deg * Math.PI / 180), -(cy + rad * Math.sin(deg * Math.PI / 180)));
      pieces.push({ start: on(a), mid: on(a + sweep / 2), end: on(a + sweep) });
    }
  }
  if (pieces.length < 2 || pieces.length > 2000) return null;
  const near = (a: IrPoint, b: IrPoint) => Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) < 0.01;
  const used = new Set<number>();
  let best: Piece[] | null = null, bestArea = 0;
  for (let first = 0; first < pieces.length; first++) {
    if (used.has(first)) continue;
    const chain: Piece[] = [pieces[first]];
    used.add(first);
    for (let grown = true; grown && !near(chain[chain.length - 1].end, chain[0].start); ) {
      grown = false;
      const tail = chain[chain.length - 1].end;
      for (let k = 0; k < pieces.length; k++) {
        if (used.has(k)) continue;
        const p = pieces[k];
        if (near(p.start, tail)) chain.push(p);
        else if (near(p.end, tail)) chain.push({ start: p.end, mid: p.mid, end: p.start });
        else continue;
        used.add(k); grown = true; break;
      }
    }
    if (chain.length < 2 || !near(chain[chain.length - 1].end, chain[0].start)) continue;
    const xs = chain.flatMap((c) => [c.start, c.mid, c.end].filter(Boolean).map((q) => Number(q!.x)));
    const ys = chain.flatMap((c) => [c.start, c.mid, c.end].filter(Boolean).map((q) => Number(q!.y)));
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (area > bestArea) { best = chain; bestArea = area; }
  }
  return best;
}
