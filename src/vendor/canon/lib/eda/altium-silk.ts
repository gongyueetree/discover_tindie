// Local addition to the vendored REFIR core (see ../NOTICE.md): an Altium PcbDoc's silkscreen.
import { bridged, regions } from "./altium-pours";
import { altiumBlocks, altiumProperties } from "./altium-records";
import type { IrPoint, PcbIr, PcbPolygon, PcbText } from "./types";

type Props = Record<string, string>;
type Stream = (name: string) => Uint8Array;
type Silkscreen = NonNullable<PcbIr["silkscreen"]>;
type Graphic = Silkscreen["graphics"][number];

/** Altium's overlay layers (its silkscreen), by number, as KiCad names them — the names the 3D view prints. */
const OVERLAY: Record<number, "F.SilkS" | "B.SilkS"> = { 33: "F.SilkS", 34: "B.SilkS" };
/** Altium's internal unit, 0.0001 mil, in mm. */
const UNIT = 0.00000254;

/** To 10 nm: finer than any silkscreen, and coarse enough that whole millimetres in Altium's unit read as whole. */
const mm = (value: number) => String(Number(value.toFixed(5)));
/** A point in the reader's frame: mm, Altium's y (up) negated, as the reader places pads and tracks. */
const at = (x: number, y: number): IrPoint => ({ x: mm(x), y: mm(-y), unit: "mm" });

/**
 * An Altium board's silkscreen (user report 2026-10-22: the 3D view printed
 * none for an Altium project): the tracks, arcs, fills, solid regions and
 * texts on the top and bottom overlay, as the board's own silkscreen in board
 * coordinates — Altium stores a component's primitives on the board, where
 * they are, not in the component's frame. A component's designator is printed
 * when the component shows it (Components6 NAMEON), its comment when it shows
 * that (COMMENTON).
 *
 * Format reference: KiCad's Altium importer (ATRACK6, AARC6, AFILL6, ATEXT6,
 * ARegion6, the WideStrings6 table).
 */
export function readAltiumSilkscreen(stream: Stream, components: Props[], footprints: PcbIr["footprints"], id: string): Silkscreen {
  const graphics: Graphic[] = [];
  const polygons: PcbPolygon[] = [];
  const texts: PcbText[] = [];

  records(stream("Tracks6/Data"), 4, 1).forEach(([b], i) => {
    const r = reader(b!);
    const layer = OVERLAY[b![0]!];
    if (!layer || b!.length < 33 || b![2] === 2) return;
    graphics.push({ id: `${id}:silk-track${i}`, layer, kind: "line", geometry: { start: r.p(13), end: r.p(21) }, width: mm(r.len(29)) });
  });

  records(stream("Arcs6/Data"), 1, 1).forEach(([b], i) => {
    const r = reader(b!);
    const layer = OVERLAY[b![0]!];
    if (!layer || b!.length < 45 || b![2] === 2) return;
    const [cx, cy, radius] = [r.x(13), r.y(13), r.len(21)];
    const [start, end, width] = [r.d(25), r.d(33), mm(r.len(41))];
    const sweep = (((end - start) % 360) + 360) % 360;
    const on = (angle: number) => at(cx + radius * Math.cos((angle * Math.PI) / 180), cy + radius * Math.sin((angle * Math.PI) / 180));
    if (sweep === 0) graphics.push({ id: `${id}:silk-arc${i}`, layer, kind: "circle", geometry: { center: at(cx, cy), end: on(0) }, width });
    else graphics.push({ id: `${id}:silk-arc${i}`, layer, kind: "arc", geometry: { start: on(start), mid: on(start + sweep / 2), end: on(start + sweep) }, width });
  });

  records(stream("Fills6/Data"), 6, 1).forEach(([b], i) => {
    const r = reader(b!);
    const layer = OVERLAY[b![0]!];
    if (!layer || b!.length < 37 || b![2] === 2) return;
    const [x1, y1, x2, y2] = [r.x(13), r.y(13), r.x(21), r.y(21)];
    const turn = (r.d(29) * Math.PI) / 180;
    const [cx, cy] = [(x1 + x2) / 2, (y1 + y2) / 2];
    const corner = (x: number, y: number) => at(cx + (x - cx) * Math.cos(turn) - (y - cy) * Math.sin(turn), cy + (x - cx) * Math.sin(turn) + (y - cy) * Math.cos(turn));
    polygons.push({ id: `${id}:silk-fill${i}`, layer, points: [corner(x1, y1), corner(x2, y1), corner(x2, y2), corner(x1, y2)], filled: true });
  });

  // Solid regions on an overlay: logos and marks, the region less its holes.
  regions(stream("Regions6/Data")).forEach((region, i) => {
    const layer = OVERLAY[region.layer];
    if (!layer || region.kind !== 0 || region.cutout) return;
    const ring = bridged(region.outline, region.holes);
    if (ring.length >= 3) polygons.push({ id: `${id}:silk-region${i}`, layer, points: ring.map(([x, y]) => ({ x: mm(x), y: mm(y), unit: "mm" })), filled: true });
  });

  const wide = wideStrings(stream("WideStrings6/Data"));
  records(stream("Texts6/Data"), 5, 2).forEach(([b, s], i) => {
    const r = reader(b!);
    const layer = OVERLAY[b![0]!];
    if (!layer || b!.length < 40) return;
    const component = r.u16(7);
    const owner = component < 0xffff ? components[component] : undefined;
    const footprint = component < 0xffff ? footprints[component] : undefined;
    const designator = b!.length > 41 && b![41] !== 0;
    const comment = b!.length > 40 && b![40] !== 0;
    // A component shows its designator unless it says not, and its comment only when it says so.
    if (owner && designator && owner.NAMEON === "FALSE") return;
    if (owner && comment && owner.COMMENTON !== "TRUE") return;
    const index = b!.length >= 119 ? r.u32(115) : 0;
    const written = (wide.get(index) ?? pascal(s!)).replace(/\r\n/g, "\n");
    const special = written.trim().toLowerCase();
    // Special strings name the component's own designator and comment; a designator's own record may leave it empty.
    const text = special === ".designator" || (designator && special === "") ? (footprint?.reference ?? "") : special === ".comment" ? (footprint?.value ?? "") : written;
    if (!text.trim() || /^[?#]/.test(text.trim())) return;
    const height = mm(r.len(21));
    texts.push({
      id: `${id}:silk-text${i}`,
      layer,
      kind: designator ? "reference" : comment ? "value" : "user",
      text,
      position: at(r.x(13), r.y(13)),
      angle: mm(r.d(27)),
      size: { height, width: height },
      thickness: mm(r.len(36)),
      // Altium anchors a text at its lower left, in its own (mirrored, turned) frame.
      justify: { horizontal: "left", vertical: "bottom" },
      mirrored: b![35] !== 0,
    });
  });

  return { graphics, polygons, texts };
}

/**
 * Each component's designator as its designator text says it, by component
 * index (local change: ../../NOTICE.md): a board not updated from a schematic
 * leaves Components6 SOURCEDESIGNATOR empty, and its designator lives only here.
 */
export function altiumDesignators(stream: Stream): Map<number, string> {
  const out = new Map<number, string>();
  const wide = wideStrings(stream("WideStrings6/Data"));
  for (const [b, s] of records(stream("Texts6/Data"), 5, 2)) {
    if (!b || b.length < 42 || b[41] === 0) continue;
    const r = reader(b);
    const component = r.u16(7);
    if (component === 0xffff || out.has(component)) continue;
    const text = (wide.get(b.length >= 119 ? r.u32(115) : 0) ?? pascal(s ?? new Uint8Array())).trim();
    if (text && !text.startsWith(".") && !/^[?#]/.test(text) && text.length <= 64) out.set(component, text);
  }
  return out;
}

function reader(b: Uint8Array) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const x = (offset: number) => view.getInt32(offset, true) * UNIT;
  const y = (offset: number) => view.getInt32(offset + 4, true) * UNIT;
  return {
    u16: (offset: number) => view.getUint16(offset, true),
    u32: (offset: number) => view.getUint32(offset, true),
    d: (offset: number) => view.getFloat64(offset, true),
    len: (offset: number) => view.getUint32(offset, true) * UNIT,
    x,
    y,
    p: (offset: number) => at(x(offset), y(offset)),
  };
}

/** A binary stream's records of one type: each a type byte, then this many length-prefixed subrecords. */
function records(bytes: Uint8Array, type: number, subrecords: number): Uint8Array[][] {
  const out: Uint8Array[][] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.length; ) {
    if (bytes[offset] !== type || out.length >= 100000) throw new Error(`Unsupported silkscreen record ${bytes[offset]}`);
    offset += 1;
    const blocks: Uint8Array[] = [];
    for (let k = 0; k < subrecords; k += 1) {
      if (offset + 4 > bytes.length) throw new Error("Truncated silkscreen record");
      const length = view.getUint32(offset, true) & 0xffffff;
      offset += 4;
      if (offset + length > bytes.length) throw new Error("Truncated silkscreen record");
      blocks.push(bytes.subarray(offset, offset + length));
      offset += length;
    }
    out.push(blocks);
  }
  return out;
}

/** A text's 8-bit copy: a length byte, then the characters. */
function pascal(b: Uint8Array): string {
  if (b.length === 0) return "";
  return new TextDecoder("windows-1252").decode(b.subarray(1, 1 + Math.min(b[0]!, b.length - 1)));
}

/**
 * WideStrings6: each text's Unicode copy, by the index its record names.
 * Older files write it as properties (`ENCODEDTEXT<n>=` the character codes,
 * comma-separated), newer ones as a table (index, byte length, UTF-16).
 */
function wideStrings(bytes: Uint8Array): Map<number, string> {
  const table = new Map<number, string>();
  if (bytes.length < 8) return table;
  try {
    const props = altiumBlocks(bytes).map(altiumProperties);
    for (const record of props)
      for (const [key, value] of Object.entries(record)) {
        const n = /^ENCODEDTEXT(\d+)$/.exec(key);
        if (n) table.set(Number(n[1]), String.fromCodePoint(...value.split(",").filter(Boolean).map(Number).filter((code) => Number.isInteger(code) && code > 0 && code <= 0x10ffff)));
      }
    if (table.size > 0) return table;
  } catch {
    // Not properties: the table form.
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const utf16 = new TextDecoder("utf-16le");
  for (let offset = 0; offset + 8 <= bytes.length && table.size < 100000; ) {
    const index = view.getUint32(offset, true);
    const length = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > bytes.length) break;
    table.set(index, utf16.decode(bytes.subarray(offset, offset + length)).replace(/\0+$/, ""));
    offset += length;
  }
  return table;
}
