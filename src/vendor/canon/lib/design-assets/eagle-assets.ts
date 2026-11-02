/**
 * An EAGLE design's own library entries as KiCad library files (local
 * addition, ../../NOTICE.md; user report 2026-10-27: the Library tab showed no
 * symbol and no footprint for an EAGLE project). EAGLE writes a copy of every
 * library a design uses into the `.sch` and the `.brd`; each part's deviceset
 * (its gates' symbols, and the pads its device connects) and package are
 * written here as a `.kicad_sym` and a `.kicad_mod`, which the Library tab
 * draws and adopting saves, as it does a KiCad project's.
 *
 * Read from the files, not invented: symbols keep EAGLE's own coordinates
 * (both are y up, millimetres), each gate a unit, each pin its name, number
 * (several pads on one pin: stacked pins, the extra ones hidden) and
 * direction; packages keep their pads (shape, size, drill, layers, turn,
 * roundness, an offset pad's drill), drawings and texts, with y negated into
 * KiCad's footprint frame, and a courtyard round them. The footprint names the
 * standard model its package matches (package-models.ts) — a standard model,
 * said so in the file's description, never the part's own. Provenance (the
 * EAGLE library and entry, and the licence the library declares, if it
 * declares one) is kept in the files and with the candidate.
 */
import type { InputAsset, PartIr, PcbIr } from "../eda/types";
import {
  arcThrough,
  clean,
  deviceName,
  DIRECTION,
  libraryFor,
  librariesOf,
  NAMED,
  normalize,
  num,
  packagePads,
  PIN_LENGTH,
  placedModel,
  prefixOf,
  rotOf,
  rulesOf,
  shownPinName,
  standardModelOf,
  stripHtml,
  type EaglePad,
} from "../eda/eagle";
import { child, children, list, parseXml, type XmlElement } from "../eda/eagle-xml";
import { decodeUtf8 } from "../eda/util";
import type { AssetProvenance } from "./types";

export const eagleAssetWarning = "由 EAGLE 设计内嵌的库（器件集、符号、封装）转换为 KiCad 库文件；引脚、焊盘与图形来自源文件，特殊图元（文字字体、阻焊扩展、禁布区）须与原文件核对。";
export const standardModelWarning = (rule: string, rules: string) => `标准模型：按封装匹配的 KiCad 官方 3D 模型（${rules}，规则 ${rule}），不是该器件本身的模型。`;

const q = JSON.stringify;
const n = (value: number) => clean(value);
type XY = [number, number];

// ── reading the design's files once ─────────────────────────────────────────

const roots = new WeakMap<Uint8Array, XmlElement | null>();
function rootOf(input: InputAsset | undefined): XmlElement | null {
  if (!input) return null;
  if (!roots.has(input.bytes)) {
    let root: XmlElement | null = null;
    try {
      root = parseXml(decodeUtf8(input.bytes));
    } catch {
      root = null;
    }
    roots.set(input.bytes, root?.name === "eagle" ? root : null);
  }
  return roots.get(input.bytes) ?? null;
}
const drawingOf = (root: XmlElement | null, kind: "schematic" | "board") => child(child(root ?? undefined, "drawing"), kind);

/** The licence a library's description declares: a licence's name as written there, or null. */
export function declaredLicence(description: string): string | null {
  const text = stripHtml(description);
  const named = /(CC[- ]?BY(?:-(?:SA|NC|ND))*(?:[- ]\d\.\d)?|CC0(?:[- ]1\.0)?|Creative Commons [A-Za-z -]*?(?:\d\.\d)(?: International)?|MIT License|Apache(?: License,?)?(?: Version)? ?2\.0|(?:L?GPL)-?v?\d(?:\.\d)?|CERN[- ]OHL[- A-Z0-9.]*|Public Domain)/i.exec(text);
  return named ? named[1]!.trim().replace(/\s+/g, " ") : null;
}

const provenanceOf = (library: { name: string; description: string } | undefined, entry: string): AssetProvenance => ({ format: "eagle", library: library?.name ?? "", entry, licence: library ? declaredLicence(library.description) : null });

type Library = NonNullable<ReturnType<typeof libraryFor>>;
const libraryInfo = (drawing: XmlElement | undefined, library: Library | undefined) => {
  if (!library) return undefined;
  const element = list(drawing, "libraries").find((entry) => (entry.attrs.name ?? "") === library.name);
  return { name: library.name, description: child(element, "description")?.text ?? "" };
};

// ── symbols ─────────────────────────────────────────────────────────────────

const font = (size = 1.27) => `(effects (font (size ${n(size)} ${n(size)})))`;
const hidden = (size = 1.27) => `(effects (font (size ${n(size)} ${n(size)})) hide)`;
const stroke = (width: number) => `(stroke (width ${n(Math.max(width, 0))}) (type default))`;

/** A symbol's drawing (layer 94 and the others EAGLE draws a symbol on) as KiCad's graphic items, y up as both are. */
function symbolGraphics(symbol: XmlElement): string[] {
  const out: string[] = [];
  for (const item of symbol.children) {
    if (item.name === "wire") {
      const a: XY = [num(item.attrs.x1), num(item.attrs.y1)];
      const b: XY = [num(item.attrs.x2), num(item.attrs.y2)];
      const arc = arcThrough(a, b, num(item.attrs.curve, 0));
      out.push(arc ? `(arc (start ${n(a[0])} ${n(a[1])}) (mid ${n(arc.mid[0])} ${n(arc.mid[1])}) (end ${n(b[0])} ${n(b[1])}) ${stroke(num(item.attrs.width, 0.254))} (fill (type none)))` : `(polyline (pts (xy ${n(a[0])} ${n(a[1])}) (xy ${n(b[0])} ${n(b[1])})) ${stroke(num(item.attrs.width, 0.254))} (fill (type none)))`);
    } else if (item.name === "circle") {
      const width = num(item.attrs.width, 0.254);
      out.push(`(circle (center ${n(num(item.attrs.x))} ${n(num(item.attrs.y))}) (radius ${n(num(item.attrs.radius))}) ${stroke(width)} (fill (type ${width === 0 ? "outline" : "none"})))`);
    } else if (item.name === "rectangle") {
      out.push(`(rectangle (start ${n(num(item.attrs.x1))} ${n(num(item.attrs.y1))}) (end ${n(num(item.attrs.x2))} ${n(num(item.attrs.y2))}) ${stroke(0)} (fill (type outline)))`);
    } else if (item.name === "polygon") {
      const points = children(item, "vertex").map((vertex) => `(xy ${n(num(vertex.attrs.x))} ${n(num(vertex.attrs.y))})`);
      if (points.length >= 3) out.push(`(polyline (pts ${points.join(" ")} ${points[0]}) ${stroke(num(item.attrs.width, 0.254))} (fill (type outline)))`);
    } else if (item.name === "text") {
      const text = item.text.trim();
      if (!text || text.startsWith(">")) continue;
      const rot = rotOf(item.attrs.rot);
      out.push(`(text ${q(text)} (at ${n(num(item.attrs.x))} ${n(num(item.attrs.y))} ${n(normalize(rot.degrees) * 10)}) ${font(num(item.attrs.size, 1.778))})`);
    }
  }
  return out;
}

/** EAGLE's pin function as KiCad's pin shape. */
const PIN_SHAPE: Record<string, string> = { dot: "inverted", clk: "clock", dotclk: "inverted_clock" };

/**
 * A schematic part's deviceset as a KiCad symbol: each gate a unit with its
 * symbol's drawing and pins, numbered by the device's connects. Null when the
 * part is not an EAGLE part, or its deviceset is not in the file.
 */
export function eagleSymbol(part: PartIr, inputs: readonly InputAsset[], name: string): { file: InputAsset; name: string; provenance: AssetProvenance } | null {
  const ref = part.sourceRefs.find((source) => /\.sch$/i.test(source.path) && source.nativeId?.startsWith("part:"));
  if (!ref) return null;
  const schematic = drawingOf(rootOf(inputs.find((input) => input.path === ref.path)), "schematic");
  const element = list(schematic, "parts").find((entry) => entry.attrs.name === ref.nativeId!.slice("part:".length));
  if (!schematic || !element) return null;
  const library = libraryFor(librariesOf(schematic), element);
  const deviceset = library?.devicesets.get(element.attrs.deviceset ?? "");
  const device = children(child(deviceset, "devices"), "device").find((entry) => (entry.attrs.name ?? "") === (element.attrs.device ?? ""));
  if (!library || !deviceset || !device) return null;
  const gates = children(child(deviceset, "gates"), "gate");
  const connects = new Map<string, string[]>();
  for (const connect of children(child(device, "connects"), "connect")) connects.set(`${connect.attrs.gate}\u0000${connect.attrs.pin}`, (connect.attrs.pad ?? "").split(/\s+/).filter(Boolean));
  const symbolName = deviceName(deviceset.attrs.name ?? "", element.attrs.device ?? "", element.attrs.technology ?? "");
  const display = symbolName || name;

  const units: string[] = [];
  let namesShown = false;
  let numbersShown = false;
  let anchors: { name: XY | null; value: XY | null } = { name: null, value: null };
  gates.forEach((gate, index) => {
    const symbol = library.symbols.get(gate.attrs.symbol ?? "");
    if (!symbol) return;
    const pins = children(symbol, "pin").flatMap((pin) => {
      const pinName = pin.attrs.name ?? "";
      const pads = connects.get(`${gate.attrs.name}\u0000${pinName}`) ?? [];
      const rot = rotOf(pin.attrs.rot);
      const length = PIN_LENGTH[pin.attrs.length ?? "long"] ?? 7.62;
      const visible = (pin.attrs.visible ?? "both").toLowerCase();
      if (visible === "both" || visible === "pin") namesShown = true;
      if (visible === "both" || visible === "pad") numbersShown = true;
      const type = DIRECTION[pin.attrs.direction ?? "io"] ?? "unspecified";
      const shape = PIN_SHAPE[pin.attrs.function ?? ""] ?? "line";
      const shown = shownPinName(pinName);
      // A pin no pad connects (a supply symbol's) keeps its name as its number; several pads: stacked, the rest hidden.
      return (pads.length ? pads : [pinName]).map(
        (pad, stacked) =>
          `(pin ${type} ${shape} (at ${n(num(pin.attrs.x))} ${n(num(pin.attrs.y))} ${n(normalize(rot.degrees))}) (length ${n(length)})${stacked ? " hide" : ""} (name ${q(shown || "~")} ${font()}) (number ${q(pad)} ${font()}))`,
      );
    });
    if (index === 0 || anchors.name === null) {
      for (const text of children(symbol, "text")) {
        const at: XY = [num(text.attrs.x), num(text.attrs.y)];
        if (/^>NAME$/i.test(text.text.trim())) anchors = { ...anchors, name: at };
        if (/^>VALUE$/i.test(text.text.trim())) anchors = { ...anchors, value: at };
      }
    }
    units.push(`(symbol ${q(`${display}_${index + 1}_1`)} ${[...symbolGraphics(symbol), ...pins].join(" ")})`);
  });
  if (units.length === 0) return null;

  const info = libraryInfo(schematic, library);
  const provenance = provenanceOf(info, deviceset.attrs.name ?? "");
  const description = stripHtml(child(deviceset, "description")?.text ?? "").slice(0, 300);
  const reference = (deviceset.attrs.prefix ?? prefixOf(part.reference)) || "U";
  const pkg = device.attrs.package;
  const source = `EAGLE library ${library.name}, deviceset ${deviceset.attrs.name ?? ""}${provenance.licence ? `; licence as declared: ${provenance.licence}` : ""}`;
  const properties = [
    `(property "Reference" ${q(reference)} (id 0) (at ${n(anchors.name?.[0] ?? 0)} ${n(anchors.name?.[1] ?? 2.54)} 0) ${font()})`,
    `(property "Value" ${q(display)} (id 1) (at ${n(anchors.value?.[0] ?? 0)} ${n(anchors.value?.[1] ?? -2.54)} 0) ${font()})`,
    `(property "Footprint" ${q(pkg ?? "")} (id 2) (at 0 0 0) ${hidden()})`,
    `(property "Datasheet" "" (id 3) (at 0 0 0) ${hidden()})`,
    `(property "ki_description" ${q(description)} (id 4) (at 0 0 0) ${hidden()})`,
    `(property "Source" ${q(source)} (id 5) (at 0 0 0) ${hidden()})`,
  ];
  const header = `(pin_names (offset 0.508)${namesShown ? "" : " hide"})${numbersShown ? "" : " (pin_numbers hide)"} (in_bom yes) (on_board ${pkg ? "yes" : "no"})`;
  const text = `(kicad_symbol_lib (version 20211014) (generator eelib) (symbol ${q(display)} ${header} ${properties.join(" ")} ${units.join(" ")}))`;
  return { file: { path: `${name}.kicad_sym`, bytes: new TextEncoder().encode(text) }, name: `${library.name}:${display}`, provenance };
}

// ── footprints ──────────────────────────────────────────────────────────────

/** A package layer as KiCad's, on the top (a library footprint is drawn on the top); null when KiCad has no such layer. */
const layerName = (layer: number): string | null => (layer === 1 ? "F.Cu" : layer === 16 ? "B.Cu" : (NAMED[layer] ?? null));
const at = ([x, y]: XY) => `${n(x)} ${n(-y)}`;
const line = (width: number) => `(stroke (width ${n(Math.max(width, 0.05))}) (type solid))`;

function padNode(pad: EaglePad): string {
  const atNode = `(at ${at([pad.x, pad.y])}${pad.rotation ? ` ${n(pad.rotation)}` : ""})`;
  const size = `(size ${n(pad.w)} ${n(pad.h)})`;
  if (pad.kind === "hole") return `(pad "" np_thru_hole circle ${atNode} ${size} (drill ${n(pad.drill ?? pad.w)}) (layers "*.Cu" "*.Mask"))`;
  if (pad.kind === "pad") {
    const shape = pad.shape === "octagon" ? "roundrect" : pad.shape === "rect" ? "rect" : pad.shape === "oval" ? "oval" : "circle";
    const octagon = pad.shape === "octagon" ? " (roundrect_rratio 0) (chamfer_ratio 0.2929) (chamfer top_left top_right bottom_left bottom_right)" : "";
    const drill = `(drill ${n(pad.drill ?? 0)}${pad.offset ? ` (offset ${n(pad.offset)} 0)` : ""})`;
    return `(pad ${q(pad.name)} thru_hole ${shape} ${atNode} ${size} ${drill} (layers "*.Cu"${pad.stop ? ' "*.Mask"' : ""})${octagon})`;
  }
  const face = pad.bottom ? "B" : "F";
  const layers = [`"${face}.Cu"`, ...(pad.cream ? [`"${face}.Paste"`] : []), ...(pad.stop ? [`"${face}.Mask"`] : [])].join(" ");
  const shape = pad.shape === "roundrect" ? `roundrect ${atNode} ${size} (layers ${layers}) (roundrect_rratio ${n(Math.min(0.5, pad.roundness / 200))})` : `${pad.shape} ${atNode} ${size} (layers ${layers})`;
  return `(pad ${q(pad.name)} smd ${shape})`;
}

/** A package's drawings and texts on KiCad's layers; `>NAME` and `>VALUE` as the Reference and Value positions. */
function packageGraphics(pkg: XmlElement): { items: string[]; reference: { at: XY; size: number } | null; value: { at: XY; size: number } | null; extent: XY[] } {
  const items: string[] = [];
  const extent: XY[] = [];
  let reference: { at: XY; size: number } | null = null;
  let value: { at: XY; size: number } | null = null;
  for (const item of pkg.children) {
    const layer = layerName(num(item.attrs.layer, 0));
    const width = num(item.attrs.width, 0.127);
    if (item.name === "text") {
      const content = item.text.trim();
      const where = { at: [num(item.attrs.x), num(item.attrs.y)] as XY, size: num(item.attrs.size, 1.27) };
      if (/^>NAME$/i.test(content)) reference = where;
      else if (/^>VALUE$/i.test(content)) value = where;
      else if (content && layer && !content.startsWith(">")) {
        const size = where.size;
        items.push(`(fp_text user ${q(content)} (at ${at(where.at)} ${n(normalize(rotOf(item.attrs.rot).degrees))}) (layer ${q(layer)}) (effects (font (size ${n(size)} ${n(size)}) (thickness ${n((size * num(item.attrs.ratio, 8)) / 100)}))))`);
      }
      continue;
    }
    if (!layer || /Cu$/.test(layer)) continue;
    if (item.name === "wire") {
      const a: XY = [num(item.attrs.x1), num(item.attrs.y1)];
      const b: XY = [num(item.attrs.x2), num(item.attrs.y2)];
      const arc = arcThrough(a, b, num(item.attrs.curve, 0));
      items.push(arc ? `(fp_arc (start ${at(a)}) (mid ${at(arc.mid)}) (end ${at(b)}) ${line(width)} (layer ${q(layer)}))` : `(fp_line (start ${at(a)}) (end ${at(b)}) ${line(width)} (layer ${q(layer)}))`);
      if (/Fab|SilkS/.test(layer)) extent.push(a, b);
    } else if (item.name === "circle") {
      const c: XY = [num(item.attrs.x), num(item.attrs.y)];
      const r = num(item.attrs.radius);
      items.push(`(fp_circle (center ${at(c)}) (end ${at([c[0] + r, c[1]])}) ${line(width)}${width === 0 ? " (fill solid)" : ""} (layer ${q(layer)}))`);
      if (/Fab|SilkS/.test(layer)) extent.push([c[0] - r, c[1] - r], [c[0] + r, c[1] + r]);
    } else if (item.name === "rectangle") {
      const a: XY = [num(item.attrs.x1), num(item.attrs.y1)];
      const b: XY = [num(item.attrs.x2), num(item.attrs.y2)];
      const turned = Math.abs(rotOf(item.attrs.rot).degrees % 180) === 90;
      const [c, h]: [XY, XY] = [[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2]];
      const [hx, hy] = turned ? [h[1], h[0]] : h;
      items.push(`(fp_rect (start ${at([c[0] - hx, c[1] - hy])}) (end ${at([c[0] + hx, c[1] + hy])}) ${line(0)} (fill solid) (layer ${q(layer)}))`);
    } else if (item.name === "polygon") {
      const points = children(item, "vertex").map((vertex) => `(xy ${at([num(vertex.attrs.x), num(vertex.attrs.y)])})`);
      if (points.length >= 3) items.push(`(fp_poly (pts ${points.join(" ")}) ${line(width)} (fill solid) (layer ${q(layer)}))`);
    }
  }
  return { items, reference, value, extent };
}

/**
 * An EAGLE package as a KiCad footprint (KiCad's frame: y down, on the top),
 * with a courtyard round its pads and outline and the standard model its
 * package matches, if any.
 */
export function packageFootprint(
  pkg: XmlElement,
  rules: Map<string, string>,
  library: { name: string; description: string } | undefined,
  prefix: string,
): { file: InputAsset; models: NonNullable<PcbIr["footprints"][number]["models"]>; provenance: AssetProvenance } {
  const name = pkg.attrs.name ?? "EAGLE";
  const pads = packagePads(pkg, rules);
  const { items, reference, value, extent } = packageGraphics(pkg);
  // The courtyard: round the pads and the drawn outline, a quarter millimetre out, on a 0.01 mm grid.
  const corners: XY[] = [...extent, ...pads.flatMap((pad): XY[] => {
    const half = Math.max(pad.w, pad.h) / 2 + Math.abs(pad.offset);
    return [[pad.x - half, pad.y - half], [pad.x + half, pad.y + half]];
  })];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const box = corners.length ? [Math.min(...xs) - 0.25, Math.min(...ys) - 0.25, Math.max(...xs) + 0.25, Math.max(...ys) + 0.25].map((v) => Math.round(v * 100) / 100) : null;
  const standard = standardModelOf(pkg, rules, prefix);
  const models = standard ? [placedModel(standard, false)] : [];
  const provenance = { ...provenanceOf(library, name), ...(standard ? { rule: `${standard.rules}/${standard.rule}` } : {}) };
  const tht = pads.some((pad) => pad.kind === "pad");
  const smd = pads.some((pad) => pad.kind === "smd");
  const describe = [
    `Converted from EAGLE library ${library?.name ?? "?"}, package ${name}`,
    provenance.licence ? `licence as declared by the library: ${provenance.licence}` : "",
    standard ? `3D: standard KiCad model matched by package (${standard.rules}, rule ${standard.rule}), not the part's own model` : "",
  ].filter(Boolean).join("; ");
  const textAt = (where: { at: XY; size: number } | null, fallback: XY) => `(at ${at(where?.at ?? fallback)})`;
  const textFont = (where: { at: XY; size: number } | null) => `(effects (font (size ${n(where?.size ?? 1)} ${n(where?.size ?? 1)}) (thickness ${n((where?.size ?? 1) * 0.15)})))`;
  const top = box ? box[3]! : 1;
  const bottom = box ? box[1]! : -1;
  const body = [
    `(footprint ${q(name)} (version 20240108) (generator "eelib") (layer "F.Cu")`,
    `(descr ${q(describe)}) (tags ${q(`eagle ${library?.name ?? ""}`.trim())})`,
    `(property "Reference" "REF**" ${textAt(reference, [0, top + 1])} (layer "F.SilkS") ${textFont(reference)})`,
    `(property "Value" ${q(name)} ${textAt(value, [0, bottom - 1])} (layer "F.Fab") ${textFont(value)})`,
    `(attr ${tht ? "through_hole" : smd ? "smd" : "board_only"})`,
    ...items,
    ...(box ? [`(fp_rect (start ${at([box[0]!, box[1]!])}) (end ${at([box[2]!, box[3]!])}) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))`] : []),
    ...pads.map(padNode),
    ...models.map((model) => `(model ${q(model.path)} (offset (xyz ${model.offset.map(n).join(" ")})) (scale (xyz 1 1 1)) (rotate (xyz ${model.rotation.map(n).join(" ")})))`),
    ")",
  ];
  return { file: { path: `${name.replace(/[^\p{L}\p{N}_.+-]/gu, "_")}.kicad_mod`, bytes: new TextEncoder().encode(body.join(" ")) }, models, provenance };
}

/** A placed board footprint's package, from the board's own copy of its library. */
export function eagleFootprint(fp: PcbIr["footprints"][number], inputs: readonly InputAsset[]): ReturnType<typeof packageFootprint> | null {
  if (!/\.brd$/i.test(fp.sourceRef.path) || !fp.sourceRef.nativeId?.startsWith("element:")) return null;
  const board = drawingOf(rootOf(inputs.find((input) => input.path === fp.sourceRef.path)), "board");
  const element = list(board, "elements").find((entry) => entry.attrs.name === fp.sourceRef.nativeId!.slice("element:".length));
  if (!board || !element) return null;
  const library = libraryFor(librariesOf(board), element);
  const pkg = library?.packages.get(element.attrs.package ?? "");
  if (!pkg) return null;
  return packageFootprint(pkg, rulesOf(board), libraryInfo(board, library), prefixOf(fp.reference));
}

/** A schematic part's package when there is no board: the schematic's own copy of the library has it too. */
export function eagleSchematicFootprint(part: PartIr, inputs: readonly InputAsset[]): (ReturnType<typeof packageFootprint> & { name: string }) | null {
  const ref = part.sourceRefs.find((source) => /\.sch$/i.test(source.path) && source.nativeId?.startsWith("part:"));
  if (!ref) return null;
  const schematic = drawingOf(rootOf(inputs.find((input) => input.path === ref.path)), "schematic");
  const element = list(schematic, "parts").find((entry) => entry.attrs.name === ref.nativeId!.slice("part:".length));
  if (!schematic || !element) return null;
  const library = libraryFor(librariesOf(schematic), element);
  const device = children(child(library?.devicesets.get(element.attrs.deviceset ?? ""), "devices"), "device").find((entry) => (entry.attrs.name ?? "") === (element.attrs.device ?? ""));
  const pkg = library?.packages.get(device?.attrs.package ?? "");
  if (!library || !pkg) return null;
  return { ...packageFootprint(pkg, new Map(), libraryInfo(schematic, library), prefixOf(part.reference)), name: `${library.name}:${pkg.attrs.name ?? ""}` };
}

