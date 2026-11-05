/**
 * Autodesk EAGLE 6+ projects (also Fusion 360 Electronics' EAGLE export), read
 * into the Canonical IR (local addition, ../../NOTICE.md).
 *
 * EAGLE writes XML: a schematic `.sch` and a board `.brd` that carry their own
 * copies of the libraries they use. Both state their connectivity: the
 * schematic's nets name the pins they join (`pinref`), the board's signals the
 * pads (`contactref`). Nothing here is inferred from geometry.
 *
 * Coordinates: EAGLE is in millimetres with y up; the IR is KiCad's frame, y
 * down — every y is negated. A part placed `R<θ>` is turned θ counter-clockwise;
 * `MR<θ>` is turned θ and then mirrored left to right (as KiCad's own EAGLE
 * importer reads it), which on a board also puts it on the bottom: its layers
 * swap sides. A footprint's drawings are kept in its own frame (KiCad's), so it
 * is placed as KiCad footprints are.
 *
 * Layers are given KiCad's names (Top → F.Cu, inner layers → In<n>.Cu in stack
 * order, Bottom → B.Cu, Dimension and Milling → Edge.Cuts, tPlace/tNames →
 * F.SilkS, tDocu/tValues → F.Fab …), so the viewer and the 3D board treat an
 * EAGLE board as they treat a KiCad one.
 *
 * Not read, and said so: EAGLE's own poured copper (EAGLE computes a polygon's
 * fill and does not store it — the outline is kept), hierarchical modules,
 * buses' members, 3D packages (Fusion's `package3d` names a model by URN and
 * embeds none). A part whose package is a standard one is given KiCad's
 * standard model for it, matched by the package's name and pads and marked
 * `standard` (package-models.ts) — never presented as the part's own model.
 * Binary EAGLE files (before 6.0) are recognised and refused.
 */
import { child, children, list, parseXml, EagleXmlError, type XmlElement } from "./eagle-xml";
import { calculatePhysicalDimensions, type KicadParseOutput } from "./kicad";
import { matchPackage, PACKAGE_MODEL_RULES, type PackagePad, type PackageShape, type StandardModel } from "./package-models";
import type { InputAsset, IrPoint, NetIr, ParseDiagnostic, PartIr, PcbIr, PcbPolygon, PcbText, SchematicIr, SourceAsset, SourceRef } from "./types";
import { decodeUtf8, diagnostic, extensionOf, point, sourceRef, stableId, withoutExtension } from "./util";

export const EAGLE_EXTENSIONS = new Set([".sch", ".brd", ".lbr"]);

/** An EAGLE XML document: an XML declaration and/or DOCTYPE, then `<eagle`. */
export function isEagleXml(bytes: Uint8Array): boolean {
  const head = decodeUtf8(bytes.subarray(0, Math.min(bytes.length, 4096))).replace(/^﻿/, "");
  return /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE\s+eagle\b[^>[]*(?:\[[\s\S]*?\])?[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<eagle[\s>]/.test(head);
}

/**
 * A binary EAGLE file (EAGLE 5 and earlier): an EAGLE extension, binary
 * content, and the first record's type byte 0x10 that such files open with.
 * Not an OLE (Altium/OrCAD) or ZIP container, and not an Allegro board.
 */
export function isEagleBinary(path: string, bytes: Uint8Array): boolean {
  if (!EAGLE_EXTENSIONS.has(extensionOf(path)) || bytes.length < 24 || bytes[0] !== 0x10) return false;
  const head = bytes.subarray(0, 64);
  return head.includes(0) || head.some((byte) => byte < 0x09);
}

/**
 * A Fusion Electronics `<spline degree knots>` with `<vertex>` control points, sampled along
 * its length (Cox–de Boor). A rational spline, or one whose knots do not fit, is drawn through
 * its control points (local addition: ../../NOTICE.md).
 */
export function splinePoints(item: XmlElement): XY[] {
  const control = children(item, "vertex").map((v): XY => [num(v.attrs.x), num(v.attrs.y)]);
  const degree = num(item.attrs.degree, 3);
  const knots = (item.attrs.knots ?? "").trim().split(/\s+/).filter(Boolean).map(Number);
  if (control.length < 2 || item.attrs.rational === "yes" || knots.length !== control.length + degree + 1 || knots.some((k) => !Number.isFinite(k))) return control;
  const basis = (i: number, p: number, u: number): number => {
    if (p === 0) return (knots[i] <= u && u < knots[i + 1]) || (u === knots[knots.length - degree - 1] && knots[i] < u && u <= knots[i + 1]) ? 1 : 0;
    const left = knots[i + p] - knots[i], right = knots[i + p + 1] - knots[i + 1];
    return (left ? ((u - knots[i]) / left) * basis(i, p - 1, u) : 0) + (right ? ((knots[i + p + 1] - u) / right) * basis(i + 1, p - 1, u) : 0);
  };
  const start = knots[degree], end = knots[control.length];
  if (!(end > start)) return control;
  const steps = Math.min(200, 16 * (control.length - degree));
  const out: XY[] = [];
  for (let s = 0; s <= steps; s++) {
    const u = start + ((end - start) * s) / steps;
    let x = 0, y = 0;
    control.forEach(([cx, cy], i) => {
      const b = basis(i, degree, u);
      x += b * cx;
      y += b * cy;
    });
    out.push([x, y]);
  }
  return out;
}

// ── numbers, rotations, transforms ─────────────────────────────────────────

export const num = (value: string | undefined, fallback = 0): number => {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
};
export const clean = (value: number): string => {
  const rounded = Number(value.toFixed(6));
  return Object.is(rounded, -0) || Math.abs(rounded) < 1e-9 ? "0" : String(rounded);
};
export const normalize = (degrees: number) => ((Math.round(degrees * 1e6) / 1e6) % 360 + 360) % 360;

export type Rot = { degrees: number; mirror: boolean; spin: boolean };
/** `R90`, `MR180`, `SR0`, `SMR270` → its angle, mirror and spin. */
export function rotOf(value: string | undefined): Rot {
  const text = (value ?? "").toUpperCase();
  const degrees = Number(/R(-?\d+(?:\.\d+)?)/.exec(text)?.[1] ?? 0);
  return { degrees: Number.isFinite(degrees) ? degrees : 0, mirror: text.includes("M"), spin: text.includes("S") };
}

type XY = [number, number];
/** A point in an item's own frame placed in its parent's (EAGLE's frame, y up): turned, then mirrored left to right. */
export function place(origin: XY, rot: Rot, [x, y]: XY): XY {
  const r = (rot.degrees * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const tx = x * c - y * s;
  const ty = x * s + y * c;
  return [origin[0] + (rot.mirror ? -tx : tx), origin[1] + ty];
}

/** EAGLE writes design-rule distances with units: `10mil`, `0.35mm`, `0.1inch`, `500mic`. */
export function distance(value: string | undefined, fallback: number): number {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*(mm|mil|inch|in|mic)?\s*$/i.exec(value ?? "");
  if (!match) return fallback;
  const amount = Number(match[1]);
  switch ((match[2] ?? "mm").toLowerCase()) {
    case "mil":
      return amount * 0.0254;
    case "inch":
    case "in":
      return amount * 25.4;
    case "mic":
      return amount / 1000;
    default:
      return amount;
  }
}

/** Points along an EAGLE wire's arc: `curve` degrees, counter-clockwise from the first end to the second. */
export function arcThrough(a: XY, b: XY, curve: number): { mid: XY; center: XY; radius: number } | null {
  const sweep = (curve * Math.PI) / 180;
  if (!Number.isFinite(sweep) || Math.abs(sweep) < 1e-6) return null;
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (chord < 1e-9) return null;
  const m: XY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const dir: XY = [(b[0] - a[0]) / chord, (b[1] - a[1]) / chord];
  const left: XY = [-dir[1], dir[0]];
  const offset = chord / 2 / Math.tan(sweep / 2);
  const center: XY = [m[0] + left[0] * offset, m[1] + left[1] * offset];
  const half = sweep / 2;
  const [dx, dy] = [a[0] - center[0], a[1] - center[1]];
  const mid: XY = [center[0] + dx * Math.cos(half) - dy * Math.sin(half), center[1] + dx * Math.sin(half) + dy * Math.cos(half)];
  return { mid, center, radius: Math.hypot(dx, dy) };
}

/** An arc as `steps` chords (both ends included), for polygons and drawings. */
export function arcPolyline(a: XY, b: XY, curve: number, steps = 8): XY[] {
  const arc = arcThrough(a, b, curve);
  if (!arc) return [a, b];
  const sweep = (curve * Math.PI) / 180;
  const [dx, dy] = [a[0] - arc.center[0], a[1] - arc.center[1]];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = (sweep * i) / steps;
    return [arc.center[0] + dx * Math.cos(t) - dy * Math.sin(t), arc.center[1] + dx * Math.sin(t) + dy * Math.cos(t)] as XY;
  });
}

/** EAGLE's frame (y up) to the IR's (y down). */
const ir = ([x, y]: XY): IrPoint => point(clean(x), clean(-y))!;

// ── libraries ──────────────────────────────────────────────────────────────

/** A design's own libraries, by name and (EAGLE 9) URN: two libraries may share a name. */
type Library = { name: string; packages: Map<string, XmlElement>; symbols: Map<string, XmlElement>; devicesets: Map<string, XmlElement> };
export function librariesOf(drawingPart: XmlElement | undefined): Map<string, Library> {
  const out = new Map<string, Library>();
  for (const library of list(drawingPart, "libraries")) {
    const name = library.attrs.name ?? "";
    const byName = (container: string) => new Map(list(library, container).map((entry) => [entry.attrs.name ?? "", entry] as const));
    const entry: Library = { name, packages: byName("packages"), symbols: byName("symbols"), devicesets: byName("devicesets") };
    out.set(`${name}\u0000${library.attrs.urn ?? ""}`, entry);
    if (!out.has(`${name}\u0000`)) out.set(`${name}\u0000`, entry);
  }
  return out;
}
export const libraryFor = (libraries: Map<string, Library>, element: XmlElement) =>
  libraries.get(`${element.attrs.library ?? ""}\u0000${element.attrs.library_urn ?? ""}`) ?? libraries.get(`${element.attrs.library ?? ""}\u0000`);

/** A deviceset's device as EAGLE names it: `*` is the technology, `?` the device (appended when there is no `?`). */
export function deviceName(deviceset: string, device: string, technology: string): string {
  const withTechnology = deviceset.replace(/\*/g, technology);
  return withTechnology.includes("?") ? withTechnology.replace(/\?/g, device) : `${withTechnology}${device}`;
}

/** Attributes: name → value, from `<attribute name value>` children. */
const attributesOf = (element: XmlElement | undefined): Record<string, string> =>
  Object.fromEntries(children(element, "attribute").filter((entry) => entry.attrs.name && entry.attrs.value !== undefined).map((entry) => [entry.attrs.name!, entry.attrs.value!]));

/** A maker's part number only from an attribute that names one (G12): MPN and its spellings, and SnapEDA's MP beside MF. */
const MPN_ATTRIBUTE = /^(?:mpn|manufacturer[\s_-]*part[\s_-]*(?:number|no|#)|mfr[\s_-]*(?:pn|part[\s_-]*number)|mfg[\s_-]*(?:pn|part[\s_-]*number)|mf[\s_-]*pn)$/i;
const MAKER_ATTRIBUTE = /^(?:manufacturer|manufacturer[\s_-]*name|mfr|mfg|mf)$/i;
export function identityOf(fields: Record<string, string>): { mpn?: string; manufacturer?: string } {
  const entries = Object.entries(fields).map(([key, value]) => [key.trim(), value.trim()] as const).filter(([, value]) => value !== "");
  let mpn = entries.find(([key]) => MPN_ATTRIBUTE.test(key))?.[1];
  const manufacturer = entries.find(([key]) => MAKER_ATTRIBUTE.test(key))?.[1];
  if (!mpn && entries.some(([key]) => /^mf$/i.test(key))) mpn = entries.find(([key]) => /^mp$/i.test(key))?.[1];
  return { ...(mpn ? { mpn } : {}), ...(manufacturer ? { manufacturer } : {}) };
}

export const stripHtml = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// ── layers ─────────────────────────────────────────────────────────────────

const PAIRS: [number, number][] = [[1, 16], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32], [33, 34], [35, 36], [37, 38], [39, 40], [41, 42], [51, 52]];
const FLIP = new Map<number, number>(PAIRS.flatMap(([a, b]) => [[a, b], [b, a]] as [number, number][]));
/** The layer an item of a mirrored part lands on. */
export const flipLayer = (layer: number, mirrored: boolean) => (mirrored ? (FLIP.get(layer) ?? layer) : layer);

export const NAMED: Record<number, string> = {
  20: "Edge.Cuts", 46: "Edge.Cuts",
  21: "F.SilkS", 22: "B.SilkS", 25: "F.SilkS", 26: "B.SilkS",
  27: "F.Fab", 28: "B.Fab", 51: "F.Fab", 52: "B.Fab",
  29: "F.Mask", 30: "B.Mask", 31: "F.Paste", 32: "B.Paste",
  35: "F.Adhes", 36: "B.Adhes", 39: "F.CrtYd", 40: "B.CrtYd",
  47: "Cmts.User", 48: "Dwgs.User", 49: "Cmts.User",
};
/** Layers EAGLE uses for itself, never drawn: pads, vias, unrouted, origins, drills, holes, restrict areas. */
const INTERNAL = new Set([17, 18, 19, 23, 24, 41, 42, 43, 44, 45, 50]);

type LayerMap = { name: (layer: number) => string | null; copper: (layer: number) => boolean; copperNames: string[] };
function layerMap(copperLayers: number[]): LayerMap {
  const inner = copperLayers.filter((layer) => layer > 1 && layer < 16).sort((a, b) => a - b);
  const copperName = (layer: number) => (layer === 1 ? "F.Cu" : layer === 16 ? "B.Cu" : `In${inner.indexOf(layer) + 1}.Cu`);
  return {
    copper: (layer) => layer >= 1 && layer <= 16 && (layer === 1 || layer === 16 || inner.includes(layer)),
    name: (layer) => {
      if (layer >= 1 && layer <= 16) return layer === 1 || layer === 16 || inner.includes(layer) ? copperName(layer) : null;
      if (INTERNAL.has(layer)) return null;
      return NAMED[layer] ?? null;
    },
    copperNames: ["F.Cu", ...inner.map(copperName), "B.Cu"],
  };
}

function layerRole(name: string): { role: string; side: PcbIr["layers"][number]["side"] } {
  if (name === "Edge.Cuts") return { role: "edge", side: "both" };
  const side = name.startsWith("F.") ? "front" : name.startsWith("B.") ? "back" : /^In\d+\.Cu$/.test(name) ? "inner" : "unknown";
  if (/\.Cu$/.test(name)) return { role: "copper", side };
  if (name.includes("Mask")) return { role: "solder_mask", side };
  if (name.includes("Paste")) return { role: "paste", side };
  if (name.includes("SilkS")) return { role: "silkscreen", side };
  if (name.includes("CrtYd")) return { role: "courtyard", side };
  if (name.includes("Fab")) return { role: "fabrication", side };
  return { role: "user", side };
}

/** The design rules' parameters (`<designrules><param name value>`). */
export const rulesOf = (board: XmlElement | undefined): Map<string, string> => new Map(children(child(board, "designrules"), "param").map((param) => [param.attrs.name ?? "", param.attrs.value ?? ""] as const));

/** EAGLE's restring: a share of the drill, between a minimum and a maximum (mm), as the design rules say. */
function restring(rules: Map<string, string>, prefix: "Pad" | "Via", drill: number): number {
  const which = prefix === "Pad" ? "PadTop" : "ViaOuter";
  const share = num(rules.get(`rv${which}`), 0.25);
  const min = distance(rules.get(`rlMin${which}`), prefix === "Pad" ? 0.254 : 0.2032);
  const max = distance(rules.get(`rlMax${which}`), 0.508);
  return Math.min(max, Math.max(min, drill * share));
}

// ── packages ───────────────────────────────────────────────────────────────

/**
 * A package's pads in its own frame (EAGLE's, mm, y up), sized as the board
 * draws them: an SMD by its dx/dy and roundness, a through-hole pad by its
 * diameter (at least the drill and the design rules' restring) and shape — an
 * oval `long`/`offset` pad elongated as the rules say, an `offset` pad's
 * copper shifted to one side of its drill. `x`/`y` is the drill (the pin);
 * `offset` the copper's centre from it, along the pad's own axis.
 */
export type EaglePad = {
  name: string;
  kind: "smd" | "pad" | "hole";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees counter-clockwise, the pad's own turn. */
  rotation: number;
  shape: "rect" | "roundrect" | "circle" | "oval" | "octagon";
  /** An SMD's corner rounding, 0–100 (% of the shorter side's half). */
  roundness: number;
  drill: number | null;
  offset: number;
  /** An SMD on the bottom copper. */
  bottom: boolean;
  cream: boolean;
  stop: boolean;
};
export function packagePads(pkg: XmlElement, rules: Map<string, string>): EaglePad[] {
  return pkg.children.flatMap((item): EaglePad[] => {
    const x = num(item.attrs.x);
    const y = num(item.attrs.y);
    const rotation = normalize(rotOf(item.attrs.rot).degrees);
    if (item.name === "smd") {
      const w = num(item.attrs.dx);
      const h = num(item.attrs.dy);
      const roundness = num(item.attrs.roundness, 0);
      const shape = roundness >= 100 ? (w === h ? "circle" : "oval") : roundness > 0 ? "roundrect" : "rect";
      return [{ name: item.attrs.name ?? "", kind: "smd", x, y, w, h, rotation, shape, roundness, drill: null, offset: 0, bottom: num(item.attrs.layer, 1) === 16, cream: item.attrs.cream !== "no", stop: item.attrs.stop !== "no" }];
    }
    if (item.name === "hole") {
      const d = num(item.attrs.drill);
      return [{ name: "", kind: "hole", x, y, w: d, h: d, rotation: 0, shape: "circle", roundness: 0, drill: d, offset: 0, bottom: false, cream: false, stop: true }];
    }
    if (item.name !== "pad") return [];
    const d = num(item.attrs.drill);
    const diameter = Math.max(num(item.attrs.diameter, 0), d + 2 * restring(rules, "Pad", d));
    const kind = (item.attrs.shape ?? "round").toLowerCase();
    const elongation = num(rules.get(kind === "offset" ? "psElongationOffset" : "psElongationLong"), 100) / 100;
    const long = kind === "long" || kind === "offset";
    const w = long ? diameter * (1 + elongation) : diameter;
    return [{
      name: item.attrs.name ?? "",
      kind: "pad",
      x,
      y,
      w,
      h: diameter,
      rotation,
      shape: kind === "square" ? "rect" : kind === "octagon" ? "octagon" : long ? "oval" : "circle",
      roundness: 0,
      drill: d,
      offset: kind === "offset" ? (w - diameter) / 2 : 0,
      bottom: false,
      cream: false,
      stop: item.attrs.stop !== "no",
    }];
  });
}

/** The letters a reference starts with (`LED3` → `LED`), what a chip's kind is read from. */
export const prefixOf = (reference: string) => /^[A-Za-z]+/.exec(reference.trim())?.[0]?.toUpperCase() ?? "";

/** A package as the model rules read it: its copper pads (each pad's extent turned with it) and its largest drawn circle. */
export function packageShape(pkg: XmlElement, rules: Map<string, string>, prefix: string): PackageShape {
  const pads = packagePads(pkg, rules)
    .filter((pad) => pad.kind !== "hole")
    .map((pad): PackagePad => {
      const across = Math.abs(pad.rotation % 180) === 90;
      return { name: pad.name, x: pad.x, y: pad.y, w: across ? pad.h : pad.w, h: across ? pad.w : pad.h, tht: pad.kind === "pad" };
    });
  // tPlace, bPlace, tDocu, bDocu.
  const circles = children(pkg, "circle").filter((circle) => [21, 22, 51, 52].includes(num(circle.attrs.layer, 0))).map((circle) => 2 * num(circle.attrs.radius));
  return { name: pkg.attrs.name ?? "", prefix, pads, circle: circles.length ? Math.max(...circles) : null };
}

/** The standard model a package matches (package-models.ts), if any. */
export function standardModelOf(pkg: XmlElement, rules: Map<string, string>, prefix: string): StandardModel | null {
  return matchPackage(packageShape(pkg, rules, prefix)).model;
}

/**
 * The model as a footprint names it, KiCad's way (offset in mm, y up; turn
 * negated). On the bottom, EAGLE mirrors left to right where KiCad turns the
 * part over about its x axis: the same as KiCad's flip turned half a turn, so
 * the model's offset is negated and its turn advanced by 180°.
 */
export function placedModel(model: StandardModel, mirrored: boolean): NonNullable<PcbIr["footprints"][number]["models"]>[number] {
  const [x, y] = model.at;
  const turn = normalize(-(model.rotation + (mirrored ? 180 : 0)));
  return {
    path: model.path,
    offset: [Number(clean(mirrored ? -x : x)), Number(clean(mirrored ? -y : y)), 0],
    scale: [1, 1, 1],
    rotation: [0, 0, turn],
    hidden: false,
    standard: { rules: model.rules, rule: model.rule, from: model.from, footprint: model.footprint, pads: model.pads, pitch: model.pitch, fit: model.fit, pin1: model.pin1 },
  };
}

// ── texts ──────────────────────────────────────────────────────────────────

/** EAGLE's `align` (default bottom-left) as KiCad's justification. */
function justifyOf(align: string | undefined): PcbText["justify"] {
  const value = (align ?? "bottom-left").toLowerCase();
  const [vertical, horizontal] = value === "center" ? ["center", "center"] : value.split("-");
  return {
    horizontal: horizontal === "center" ? "center" : horizontal === "right" ? "right" : "left",
    vertical: vertical === "top" ? "top" : vertical === "center" ? "center" : "bottom",
  };
}

// ── the reader ─────────────────────────────────────────────────────────────

type Ctx = { diagnostics: ParseDiagnostic[]; sourceMap: SourceRef[] };
export const PIN_LENGTH: Record<string, number> = { point: 0, short: 2.54, middle: 5.08, long: 7.62 };
export const DIRECTION: Record<string, string> = { in: "input", out: "output", io: "bidirectional", oc: "open_collector", hiz: "tri_state", pas: "passive", pwr: "power_in", sup: "power_out", nc: "no_connect" };

/** A pin's name as EAGLE shows it: `GND@2` is the second pin named GND. */
export const shownPinName = (name: string) => name.replace(/@[^@]*$/, "");

type BoardRead = { pcb: PcbIr; nets: NetIr[]; elements: { name: string; value: string; footprintId: string; libraryIdentifier: string; fields: Record<string, string>; pads: number; ref: SourceRef; populate: boolean }[]; recognized: number };

function readBoard(root: XmlElement, input: InputAsset, asset: SourceAsset, ctx: Ctx): BoardRead | null {
  const board = child(child(root, "drawing"), "board");
  if (!board) return null;
  const documentId = stableId("document", asset.sha256, asset.relativePath);
  const pcbId = stableId("pcb", documentId);
  const fileRef = sourceRef(asset.id, asset.relativePath);
  ctx.sourceMap.push(fileRef);
  const rules = rulesOf(board);
  const libraries = librariesOf(board);
  const signals = list(board, "signals");
  const plain = list(board, "plain");

  // The copper layers: the layer setup's, and any an item is on.
  const used = new Set<number>([1, 16]);
  for (const match of (rules.get("layerSetup") ?? "").matchAll(/\d+/g)) {
    const layer = Number(match[0]);
    if (layer >= 1 && layer <= 16) used.add(layer);
  }
  for (const item of [...plain, ...signals.flatMap((signal) => signal.children)]) {
    const layer = num(item.attrs.layer, 0);
    if (layer >= 1 && layer <= 16) used.add(layer);
  }
  const layers = layerMap([...used]);

  const pads: PcbIr["pads"] = [];
  const footprints: PcbIr["footprints"] = [];
  const tracks: PcbIr["tracks"] = [];
  const vias: PcbIr["vias"] = [];
  const zones: PcbIr["zones"] = [];
  const outline: PcbIr["boardOutline"] = [];
  const silkscreen: NonNullable<PcbIr["silkscreen"]> = { graphics: [], polygons: [], texts: [] };
  const elements: BoardRead["elements"] = [];
  let skippedAirwires = 0;
  let unreadPackages = 0;
  // A package's standard model, matched once per package (and reference letters: an R and a C share a 0603 package).
  const standardModels = new Map<string, StandardModel | null>();
  let matched = 0;

  // Each signal's name, by the element pad it reaches.
  const netOfPad = new Map<string, string>();
  for (const signal of signals) for (const contact of children(signal, "contactref")) netOfPad.set(`${contact.attrs.element}\u0000${contact.attrs.pad}`, signal.attrs.name ?? "");
  const netId = (name: string | undefined) => (name ? stableId("pcb-net", pcbId, name) : undefined);

  const outlineItem = (id: string, a: XY, b: XY, curve: number) => {
    const arc = curve ? arcThrough(a, b, curve) : null;
    outline.push(arc ? { id, kind: "arc", geometry: { start: ir(a), mid: ir(arc.mid), end: ir(b) } } : { id, kind: "line", geometry: { start: ir(a), end: ir(b) } });
  };
  const silkLayer = (name: string | null) => name === "F.SilkS" || name === "B.SilkS";

  for (const [elementIndex, element] of list(board, "elements").entries()) {
    const name = element.attrs.name ?? `?${elementIndex + 1}`;
    const library = libraryFor(libraries, element);
    const pkg = library?.packages.get(element.attrs.package ?? "");
    const rot = rotOf(element.attrs.rot);
    const origin: XY = [num(element.attrs.x), num(element.attrs.y)];
    const id = stableId("footprint", pcbId, name);
    const ref = sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `element:${name}`, line: element.line });
    ctx.sourceMap.push(ref);
    const libraryIdentifier = `${element.attrs.library ?? ""}:${element.attrs.package ?? ""}`;
    const value = element.attrs.value ?? "";
    const attributes = attributesOf(element);
    const fields: Record<string, string> = { ...attributes, Reference: name, Value: value, Footprint: libraryIdentifier };
    if (!pkg) unreadPackages += 1;
    // In the footprint's own frame (KiCad's): x mirrored for a part on the bottom, y down.
    const local = ([x, y]: XY): IrPoint => point(clean(rot.mirror ? -x : x), clean(-y))!;
    const world = (p: XY): XY => place(origin, rot, p);
    const angleOf = (own: number) => normalize(rot.mirror ? -(rot.degrees + own) : rot.degrees + own);
    const padIds: string[] = [];
    const graphics: NonNullable<PcbIr["footprints"][number]["graphics"]> = [];
    const polygons: PcbPolygon[] = [];
    const texts: PcbText[] = [];
    const layerOf = (item: XmlElement) => layers.name(flipLayer(num(item.attrs.layer, 0), rot.mirror));

    for (const [index, item] of (pkg?.children ?? []).entries()) {
      const at: XY = [num(item.attrs.x), num(item.attrs.y)];
      if (item.name === "pad" || item.name === "smd" || item.name === "hole") {
        const padName = item.name === "hole" ? "" : (item.attrs.name ?? "");
        const own = rotOf(item.attrs.rot);
        const net = netOfPad.get(`${name}\u0000${padName}`);
        const padId = stableId("pad", id, item.name, padName, index);
        const padRef = sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `element:${name}:${item.name}:${padName || index}`, line: item.line });
        ctx.sourceMap.push(padRef);
        let size: XY;
        let shape: string;
        let padType: string;
        let padLayers: string[];
        let drill: { x: string; y: string } | undefined;
        let center = at;
        if (item.name === "smd") {
          size = [num(item.attrs.dx), num(item.attrs.dy)];
          const roundness = num(item.attrs.roundness, 0);
          shape = roundness >= 100 ? (size[0] === size[1] ? "circle" : "oval") : roundness > 0 ? "roundrect" : "rect";
          padType = "smd";
          const copper = layers.name(flipLayer(num(item.attrs.layer, 1), rot.mirror)) ?? "F.Cu";
          const face = copper.startsWith("B.") ? "B" : "F";
          padLayers = [copper, ...(item.attrs.cream === "no" ? [] : [`${face}.Paste`]), ...(item.attrs.stop === "no" ? [] : [`${face}.Mask`])];
        } else if (item.name === "hole") {
          const d = num(item.attrs.drill);
          size = [d, d];
          shape = "circle";
          padType = "np_thru_hole";
          padLayers = ["*.Cu", "*.Mask"];
          drill = { x: clean(d), y: clean(d) };
        } else {
          const d = num(item.attrs.drill);
          const diameter = Math.max(num(item.attrs.diameter, 0), d + 2 * restring(rules, "Pad", d));
          const kind = (item.attrs.shape ?? "round").toLowerCase();
          const elongation = num(rules.get(kind === "offset" ? "psElongationOffset" : "psElongationLong"), 100) / 100;
          size = kind === "long" || kind === "offset" ? [diameter * (1 + elongation), diameter] : [diameter, diameter];
          shape = kind === "square" ? "rect" : kind === "octagon" ? "octagon" : kind === "long" || kind === "offset" ? "oval" : "circle";
          // An offset pad's drill sits at one end of its oval.
          if (kind === "offset") {
            const shift = place([0, 0], own, [(size[0] - diameter) / 2, 0]);
            center = [at[0] + shift[0], at[1] + shift[1]];
          }
          padType = "thru_hole";
          padLayers = ["*.Cu", "*.Mask"];
          drill = { x: clean(d), y: clean(d) };
        }
        padIds.push(padId);
        pads.push({
          id: padId,
          footprintId: id,
          number: padName,
          padType,
          shape,
          rotation: clean(angleOf(own.degrees)),
          ...(drill ? { drill } : {}),
          position: ir(world(center)),
          size: { x: clean(size[0]), y: clean(size[1]), unit: "mm" },
          layers: padLayers,
          ...(net ? { netId: netId(net), sourceNativeNetId: net, netName: net } : {}),
          sourceRef: padRef,
        });
        continue;
      }
      const layerNumber = num(item.attrs.layer, 0);
      const layer = layerOf(item);
      if (item.name === "wire") {
        const a: XY = [num(item.attrs.x1), num(item.attrs.y1)];
        const b: XY = [num(item.attrs.x2), num(item.attrs.y2)];
        const curve = num(item.attrs.curve, 0);
        if (layerNumber === 20 || layerNumber === 46) outlineItem(stableId("outline", id, index), world(a), world(b), rot.mirror ? -curve : curve);
        if (!layer || layer === "Edge.Cuts") continue;
        const arc = curve ? arcThrough(a, b, curve) : null;
        graphics.push({ id: stableId("fp-graphic", id, index), layer, kind: arc ? "arc" : "line", geometry: arc ? { start: local(a), mid: local(arc.mid), end: local(b) } : { start: local(a), end: local(b) }, width: clean(num(item.attrs.width)) });
      } else if (item.name === "circle") {
        if (!layer) continue;
        const r = num(item.attrs.radius);
        graphics.push({ id: stableId("fp-graphic", id, index), layer, kind: "circle", geometry: { center: local(at), end: local([at[0] + r, at[1]]) }, width: clean(num(item.attrs.width)) });
      } else if (item.name === "rectangle") {
        if (!layer) continue;
        const own = rotOf(item.attrs.rot);
        const [x1, y1, x2, y2] = [num(item.attrs.x1), num(item.attrs.y1), num(item.attrs.x2), num(item.attrs.y2)];
        const c: XY = [(x1 + x2) / 2, (y1 + y2) / 2];
        const corners = ([[x1, y1], [x2, y1], [x2, y2], [x1, y2]] as XY[]).map(([x, y]) => place(c, own, [x - c[0], y - c[1]]));
        const square = Math.abs(own.degrees % 90) < 1e-6;
        if (square) graphics.push({ id: stableId("fp-graphic", id, index), layer, kind: "rectangle", geometry: { start: local(corners[0]!), end: local(corners[2]!) } });
        if (silkLayer(layer) || !square) polygons.push({ id: stableId("fp-poly", id, index), layer, points: corners.map(local), filled: true });
      } else if (item.name === "polygon") {
        if (!layer || layers.copper(layerNumber)) continue;
        polygons.push({ id: stableId("fp-poly", id, index), layer, points: polygonPoints(item).map(local), width: clean(num(item.attrs.width)), filled: true });
      } else if (item.name === "text" && !(element.attrs.smashed === "yes" && /^>(NAME|VALUE)$/i.test(item.text.trim()))) {
        const text = packageText(item.text, name, value, attributes);
        if (!layer || !silkLayer(layer) || !text) continue;
        const own = rotOf(item.attrs.rot);
        texts.push(pcbText(stableId("fp-text", id, index), layer, item, text, local(at), angleOf(own.degrees), rot.mirror !== own.mirror));
      }
    }
    // A smashed part's name and value are its own attributes, placed on the board.
    if (element.attrs.smashed === "yes") {
      for (const [index, attribute] of children(element, "attribute").entries()) {
        if (attribute.attrs.x === undefined || attribute.attrs.display === "off") continue;
        const which = (attribute.attrs.name ?? "").toUpperCase();
        const text = which === "NAME" ? name : which === "VALUE" ? value : (attribute.attrs.value ?? "");
        const layer = layers.name(num(attribute.attrs.layer, 0));
        if (!text || !layer || !silkLayer(layer)) continue;
        const own = rotOf(attribute.attrs.rot);
        // Back into the footprint's frame, from where the board places it.
        const [wx, wy] = [num(attribute.attrs.x) - origin[0], num(attribute.attrs.y) - origin[1]];
        const r = (-rot.degrees * Math.PI) / 180;
        const unturned: XY = rot.mirror ? [-wx, wy] : [wx, wy];
        const p: XY = [unturned[0] * Math.cos(r) - unturned[1] * Math.sin(r), unturned[0] * Math.sin(r) + unturned[1] * Math.cos(r)];
        texts.push(pcbText(stableId("fp-attr", id, index), layer, attribute, text, local(p), normalize(own.mirror ? -own.degrees : own.degrees), own.mirror));
      }
    }
    footprints.push({
      id,
      reference: name,
      value,
      libraryIdentifier,
      fields,
      // EAGLE embeds no 3D model (Fusion's package3d names one by URN only): a standard model matched by the
      // package (package-models.ts), said so, or none.
      models: (() => {
        if (!pkg) return [];
        const key = `${libraryIdentifier}\u0000${prefixOf(name)}`;
        if (!standardModels.has(key)) standardModels.set(key, standardModelOf(pkg, rules, prefixOf(name)));
        const standard = standardModels.get(key);
        if (standard) matched += 1;
        return standard ? [placedModel(standard, rot.mirror)] : [];
      })(),
      graphics,
      texts,
      polygons,
      position: ir(origin),
      rotation: clean(normalize(rot.mirror ? -rot.degrees : rot.degrees)),
      side: rot.mirror ? "back" : "front",
      locked: element.attrs.locked === "yes",
      padIds,
      sourceRef: ref,
    });
    elements.push({ name, value, footprintId: id, libraryIdentifier, fields, pads: padIds.length, ref, populate: element.attrs.populate !== "no" });
  }

  // The board's own drawing.
  for (const [index, item] of plain.entries()) {
    const layerNumber = num(item.attrs.layer, 0);
    const layer = layers.name(layerNumber);
    if (item.name === "wire") {
      const a: XY = [num(item.attrs.x1), num(item.attrs.y1)];
      const b: XY = [num(item.attrs.x2), num(item.attrs.y2)];
      const curve = num(item.attrs.curve, 0);
      if (layer === "Edge.Cuts") outlineItem(stableId("outline", pcbId, "plain", index), a, b, curve);
      else if (layer && layers.copper(layerNumber)) tracks.push(track(stableId("track", pcbId, "plain", index), item, layer, undefined, sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `plain:${index}`, line: item.line })));
      else if (silkLayer(layer)) {
        const arc = curve ? arcThrough(a, b, curve) : null;
        silkscreen.graphics.push({ id: stableId("silk", pcbId, index), layer: layer!, kind: arc ? "arc" : "line", geometry: arc ? { start: ir(a), mid: ir(arc.mid), end: ir(b) } : { start: ir(a), end: ir(b) }, width: clean(num(item.attrs.width)) });
      }
    } else if (item.name === "spline") {
      // Fusion Electronics writes curves as B-splines (EAGLE never did): drawn as the polyline through it (local change: ../../NOTICE.md).
      const path = splinePoints(item);
      for (let i = 0; i + 1 < path.length; i++) {
        if (layer === "Edge.Cuts") outlineItem(stableId("outline", pcbId, "plain", index, i), path[i], path[i + 1], 0);
        else if (silkLayer(layer)) silkscreen.graphics.push({ id: stableId("silk", pcbId, index, i), layer: layer!, kind: "line", geometry: { start: ir(path[i]), end: ir(path[i + 1]) }, width: clean(num(item.attrs.width)) });
      }
    } else if (item.name === "circle") {
      const c: XY = [num(item.attrs.x), num(item.attrs.y)];
      const r = num(item.attrs.radius);
      if (layer === "Edge.Cuts") outline.push({ id: stableId("outline", pcbId, "plain", index), kind: "circle", geometry: { center: ir(c), end: ir([c[0] + r, c[1]]) } });
      else if (silkLayer(layer)) silkscreen.graphics.push({ id: stableId("silk", pcbId, index), layer: layer!, kind: "circle", geometry: { center: ir(c), end: ir([c[0] + r, c[1]]) }, width: clean(num(item.attrs.width)) });
    } else if (item.name === "rectangle") {
      const [x1, y1, x2, y2] = [num(item.attrs.x1), num(item.attrs.y1), num(item.attrs.x2), num(item.attrs.y2)];
      const own = rotOf(item.attrs.rot);
      const c: XY = [(x1 + x2) / 2, (y1 + y2) / 2];
      const corners = ([[x1, y1], [x2, y1], [x2, y2], [x1, y2]] as XY[]).map(([x, y]) => place(c, own, [x - c[0], y - c[1]]));
      if (layer === "Edge.Cuts") corners.forEach((corner, i) => outlineItem(stableId("outline", pcbId, "plain", index, i), corner, corners[(i + 1) % 4]!, 0));
      else if (silkLayer(layer)) silkscreen.polygons.push({ id: stableId("silk-poly", pcbId, index), layer: layer!, points: corners.map(ir), filled: true });
    } else if (item.name === "polygon") {
      const loop = polygonPoints(item);
      if (layer === "Edge.Cuts") loop.forEach((corner, i) => outlineItem(stableId("outline", pcbId, "plain", index, i), corner, loop[(i + 1) % loop.length]!, 0));
      else if (layer && layers.copper(layerNumber)) zones.push(zone(stableId("zone", pcbId, "plain", index), item, layer, undefined, sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `plain:${index}`, line: item.line })));
      else if (silkLayer(layer)) silkscreen.polygons.push({ id: stableId("silk-poly", pcbId, index), layer: layer!, points: loop.map(ir), width: clean(num(item.attrs.width)), filled: true });
    } else if (item.name === "text") {
      if (!silkLayer(layer) || !item.text.trim()) continue;
      const own = rotOf(item.attrs.rot);
      silkscreen.texts.push(pcbText(stableId("silk-text", pcbId, index), layer!, item, item.text.trim(), ir([num(item.attrs.x), num(item.attrs.y)]), normalize(own.mirror ? -own.degrees : own.degrees), own.mirror));
    } else if (item.name === "hole") {
      const d = num(item.attrs.drill);
      const holeRef = sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `plain:hole:${index}`, line: item.line });
      pads.push({ id: stableId("pad", pcbId, "hole", index), number: "", padType: "np_thru_hole", shape: "circle", rotation: "0", drill: { x: clean(d), y: clean(d) }, position: ir([num(item.attrs.x), num(item.attrs.y)]), size: { x: clean(d), y: clean(d), unit: "mm" }, layers: ["*.Cu", "*.Mask"], sourceRef: holeRef });
    }
  }

  // Signals: their tracks, vias and polygons.
  for (const [signalIndex, signal] of signals.entries()) {
    const name = signal.attrs.name ?? "";
    for (const [index, item] of signal.children.entries()) {
      const layerNumber = num(item.attrs.layer, 0);
      const layer = layers.name(layerNumber);
      const ref = sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `signal:${name}:${index}`, line: item.line });
      if (item.name === "wire") {
        if (layerNumber === 19) {
          skippedAirwires += 1;
          continue;
        }
        if (!layer || !layers.copper(layerNumber)) continue;
        ctx.sourceMap.push(ref);
        tracks.push(track(stableId("track", pcbId, signalIndex, index), item, layer, name, ref, netId(name)));
      } else if (item.name === "via") {
        ctx.sourceMap.push(ref);
        const d = num(item.attrs.drill);
        const [from, to] = (item.attrs.extent ?? "1-16").split("-").map((value) => num(value, 0));
        const diameter = Math.max(num(item.attrs.diameter, 0), d + 2 * restring(rules, "Via", d));
        vias.push({
          id: stableId("via", pcbId, signalIndex, index),
          position: ir([num(item.attrs.x), num(item.attrs.y)]),
          size: clean(diameter),
          drill: clean(d),
          layers: [layers.name(from ?? 1) ?? "F.Cu", layers.name(to ?? 16) ?? "B.Cu"],
          netId: netId(name),
          sourceNativeNetId: name,
          sourceRef: ref,
        });
      } else if (item.name === "polygon") {
        if (!layer || !layers.copper(layerNumber)) continue;
        ctx.sourceMap.push(ref);
        zones.push(zone(stableId("zone", pcbId, signalIndex, index), item, layer, name, ref, netId(name)));
      }
    }
  }

  if (!outline.length) ctx.diagnostics.push(diagnostic("BOARD_OUTLINE_OPEN", `${asset.relativePath} 未在 Dimension（20）或 Milling（46）层找到板框。`, "warning", "geometry", fileRef));
  if (zones.length) ctx.diagnostics.push(diagnostic("EAGLE_POLYGON_FILL_NOT_STORED", `${asset.relativePath} 有 ${zones.length} 个铺铜多边形：EAGLE 不在文件中保存铺铜结果（由 Ratsnest 计算），只保留轮廓与网络，未推算填充。`, "information", "geometry", fileRef, "preserved"));
  if (skippedAirwires) ctx.diagnostics.push(diagnostic("EAGLE_AIRWIRES_SKIPPED", `${asset.relativePath} 的 ${skippedAirwires} 条未布线飞线（Unrouted 19 层）未作为走线；连接仍由 contactref 显式给出。`, "information", "connectivity", fileRef));
  if (footprints.length) ctx.diagnostics.push(diagnostic("EAGLE_STANDARD_MODELS", `${asset.relativePath} 不含 3D 模型：${matched}/${footprints.length} 个元件按封装匹配到 KiCad 标准模型（${PACKAGE_MODEL_RULES}，非该器件本身的模型），其余以估算外形显示。`, "information", "library", fileRef));
  if (unreadPackages) ctx.diagnostics.push(diagnostic("EAGLE_PACKAGE_MISSING", `${asset.relativePath} 有 ${unreadPackages} 个元件在板内嵌库中找不到封装定义，只保留位置与名称。`, "warning", "library", fileRef));
  if (list(board, "elements").some((element) => libraryFor(libraries, element)?.packages.get(element.attrs.package ?? "")?.attrs.package3d_urn) || children(child(board, "libraries"), "library").some((library) => child(library, "packages3d")))
    ctx.diagnostics.push(diagnostic("EAGLE_3D_PACKAGE_NOT_EMBEDDED", `${asset.relativePath} 的 3D 封装只以 URN 引用（Fusion 360），文件未内嵌模型；3D 视图不附模型。`, "information", "library", fileRef));

  const copper = [1, 16, ...used].filter((layer, index, all) => all.indexOf(layer) === index && layers.copper(layer));
  const thickness = (() => {
    // A two-layer board's thickness is its two coppers and the core between them (mtCopper, mtIsolate); a multilayer stack is not summed.
    const coppers = (rules.get("mtCopper") ?? "").trim().split(/\s+/).filter(Boolean);
    const isolate = (rules.get("mtIsolate") ?? "").trim().split(/\s+/).filter(Boolean);
    if (copper.length !== 2 || !coppers.length || !isolate.length) return undefined;
    return clean(distance(coppers[0], 0.035) + distance(isolate[0], 1.5) + distance(coppers[15] ?? coppers[coppers.length - 1], 0.035));
  })();
  const layerNames = [...layers.copperNames, "F.SilkS", "B.SilkS", "F.Mask", "B.Mask", "F.Paste", "B.Paste", "F.Fab", "B.Fab", "Edge.Cuts"];
  const pcbLayers = layerNames.map((name, index) => ({ id: stableId("layer", pcbId, name), sourceId: String(index), name, ...layerRole(name), copper: /\.Cu$/.test(name) }));

  const pcbNets: NetIr[] = signals
    .map((signal) => signal.attrs.name ?? "")
    .filter((name, index, all) => name && all.indexOf(name) === index)
    .map((name) => {
      const id = netId(name)!;
      const netPads = pads.filter((pad) => pad.netId === id);
      const netTracks = tracks.filter((item) => item.netId === id);
      const netVias = vias.filter((item) => item.netId === id);
      const netZones = zones.filter((item) => item.netId === id);
      return {
        id,
        domain: "pcb_physical" as const,
        canonicalName: name,
        displayNames: [name],
        endpoints: [
          ...netPads.map((pad) => ({ id: stableId("endpoint", id, pad.id), type: "footprint_pad" as const, targetId: pad.id, identifier: { pad: pad.number, footprintId: pad.footprintId ?? "" }, ...(pad.position ? { position: pad.position } : {}) })),
          ...netTracks.map((item) => ({ id: stableId("endpoint", id, item.id), type: "track" as const, targetId: item.id, identifier: { kind: item.kind } })),
          ...netVias.map((item) => ({ id: stableId("endpoint", id, item.id), type: "via" as const, targetId: item.id, identifier: {}, ...(item.position ? { position: item.position } : {}) })),
          ...netZones.map((item) => ({ id: stableId("endpoint", id, item.id), type: "zone" as const, targetId: item.id, identifier: {} })),
        ],
        segmentIds: netTracks.map((item) => item.id),
        resolution: { method: "explicit" as const, confidence: 1 },
        sourceRefs: [fileRef],
      };
    });

  const pcb: PcbIr = {
    id: pcbId,
    documentId,
    name: withoutExtension(asset.fileName),
    units: "mm",
    coordinateSystem: { sourceUnits: "mm", canonicalUnits: "mm", rotationConvention: "degrees_ccw", precision: "source_token_preserved" },
    layers: pcbLayers,
    stackup: [],
    boardOutline: outline,
    physicalDimensions: calculatePhysicalDimensions(outline, thickness),
    footprints,
    pads,
    tracks,
    vias,
    zones,
    silkscreen,
    sourceRefs: [fileRef],
  };
  if (pcb.physicalDimensions && !pcb.physicalDimensions.outlineClosed) ctx.diagnostics.push(diagnostic("BOARD_OUTLINE_OPEN", `${asset.relativePath} 的板框未闭合；尺寸按外接边界计算。`, "warning", "geometry", fileRef, "preserved"));
  const recognized = footprints.length + pads.length + tracks.length + vias.length + zones.length + outline.length;
  return { pcb, nets: pcbNets, elements, recognized };
}

/** A polygon's corners (EAGLE's frame), each `curve` between a vertex and the next drawn as chords. */
function polygonPoints(item: XmlElement): XY[] {
  const vertices = children(item, "vertex").map((vertex) => ({ at: [num(vertex.attrs.x), num(vertex.attrs.y)] as XY, curve: num(vertex.attrs.curve, 0) }));
  const out: XY[] = [];
  vertices.forEach((vertex, index) => {
    const next = vertices[(index + 1) % vertices.length]!;
    if (vertex.curve) out.push(...arcPolyline(vertex.at, next.at, vertex.curve).slice(0, -1));
    else out.push(vertex.at);
  });
  return out;
}

function track(id: string, item: XmlElement, layer: string, net: string | undefined, ref: SourceRef, netId?: string): PcbIr["tracks"][number] {
  const a: XY = [num(item.attrs.x1), num(item.attrs.y1)];
  const b: XY = [num(item.attrs.x2), num(item.attrs.y2)];
  const arc = arcThrough(a, b, num(item.attrs.curve, 0));
  return {
    id,
    kind: arc ? "arc" : "segment",
    start: ir(a),
    end: ir(b),
    ...(arc ? { mid: ir(arc.mid) } : {}),
    width: clean(num(item.attrs.width)),
    layer,
    ...(netId ? { netId, sourceNativeNetId: net } : {}),
    sourceRef: ref,
  };
}

function zone(id: string, item: XmlElement, layer: string, net: string | undefined, ref: SourceRef, netId?: string): PcbIr["zones"][number] {
  const loop = polygonPoints(item);
  return {
    id,
    ...(netId ? { netId, sourceNativeNetId: net } : {}),
    layers: [layer],
    sourceRef: ref,
    // The outline only: EAGLE stores no poured copper (it is computed on Ratsnest), and none is invented.
    shape: { keepout: false, outline: loop.map(([x, y]) => [Number(clean(x)), Number(clean(-y))] as [number, number]), fills: [] },
  };
}

/** A package text's content: `>NAME`, `>VALUE` and other `>ATTRIBUTE` placeholders filled in; null when it names nothing. */
function packageText(raw: string, name: string, value: string, attributes: Record<string, string>): string | null {
  const text = raw.trim();
  if (!text.startsWith(">")) return text || null;
  const key = text.slice(1).toUpperCase();
  if (key === "NAME") return name;
  if (key === "VALUE") return value || null;
  const found = Object.entries(attributes).find(([attribute]) => attribute.toUpperCase() === key);
  return found?.[1] || null;
}

function pcbText(id: string, layer: string, item: XmlElement, text: string, at: IrPoint, angle: number, mirrored: boolean): PcbText {
  const size = num(item.attrs.size, 1.27);
  return {
    id,
    layer,
    kind: /^>?NAME$/i.test(item.text.trim()) || (item.attrs.name ?? "").toUpperCase() === "NAME" ? "reference" : /^>?VALUE$/i.test(item.text.trim()) || (item.attrs.name ?? "").toUpperCase() === "VALUE" ? "value" : item.name === "attribute" ? "field" : "user",
    text,
    position: at,
    angle: clean(angle),
    size: { height: clean(size), width: clean(size) },
    thickness: clean((size * num(item.attrs.ratio, 8)) / 100),
    justify: justifyOf(item.attrs.align),
    mirrored,
  };
}

type SchematicRead = { schematics: SchematicIr[]; parts: PartIr[]; nets: NetIr[]; recognized: number };

function readSchematic(root: XmlElement, input: InputAsset, asset: SourceAsset, ctx: Ctx): SchematicRead | null {
  const schematic = child(child(root, "drawing"), "schematic");
  if (!schematic) return null;
  const documentId = stableId("document", asset.sha256, asset.relativePath);
  const fileRef = sourceRef(asset.id, asset.relativePath);
  ctx.sourceMap.push(fileRef);
  const libraries = librariesOf(schematic);
  const stem = withoutExtension(asset.fileName);
  const currentVariant = children(child(schematic, "variantdefs"), "variantdef").find((variant) => variant.attrs.current === "yes")?.attrs.name;

  type PartInfo = { part: PartIr; deviceset?: XmlElement; gates: XmlElement[]; connects: Map<string, string[]>; library?: Library };
  const parts = new Map<string, PartInfo>();
  let unresolved = 0;
  for (const element of list(schematic, "parts")) {
    const name = element.attrs.name ?? "";
    if (!name) continue;
    const library = libraryFor(libraries, element);
    const deviceset = library?.devicesets.get(element.attrs.deviceset ?? "");
    const device = children(child(deviceset, "devices"), "device").find((entry) => (entry.attrs.name ?? "") === (element.attrs.device ?? ""));
    if (!deviceset || !device) unresolved += 1;
    const technology = element.attrs.technology ?? "";
    const technologyAttributes = attributesOf(children(child(device, "technologies"), "technology").find((entry) => (entry.attrs.name ?? "") === technology));
    const own = attributesOf(element);
    const pkg = device?.attrs.package;
    const libraryIdentifier = pkg ? `${element.attrs.library ?? ""}:${pkg}` : undefined;
    const value = element.attrs.value ?? (deviceset ? deviceName(deviceset.attrs.name ?? "", element.attrs.device ?? "", technology) : "");
    const description = stripHtml(child(deviceset, "description")?.text ?? "").slice(0, 300);
    const fields: Record<string, string> = {
      ...technologyAttributes,
      ...own,
      ...(description ? { Description: description } : {}),
      Reference: name,
      Value: value,
      ...(libraryIdentifier ? { Footprint: libraryIdentifier } : {}),
    };
    const identity = identityOf({ ...technologyAttributes, ...own });
    const variant = children(element, "variant").find((entry) => entry.attrs.name === currentVariant);
    const connects = new Map<string, string[]>();
    for (const connect of children(child(device, "connects"), "connect")) connects.set(`${connect.attrs.gate}\u0000${connect.attrs.pin}`, (connect.attrs.pad ?? "").split(/\s+/).filter(Boolean));
    const ref = sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `part:${name}`, line: element.line });
    ctx.sourceMap.push(ref);
    parts.set(name, {
      part: {
        id: stableId("part", documentId, name),
        logicalPartKey: name,
        // A part with no package (a supply symbol, a frame) is not on the board: marked as KiCad marks power symbols.
        reference: pkg ? name : `#${name}`,
        value,
        symbolUnits: [],
        ...(libraryIdentifier ? { footprint: libraryIdentifier } : {}),
        fields,
        ...(identity.manufacturer ? { manufacturerRaw: identity.manufacturer } : {}),
        ...(identity.mpn ? { mpnRaw: identity.mpn } : {}),
        variantStatus: variant?.attrs.populate === "no" ? "dnp" : "fitted",
        pinPadMap: [],
        sourceRefs: [ref],
      },
      ...(deviceset ? { deviceset } : {}),
      gates: children(child(deviceset, "gates"), "gate"),
      connects,
      ...(library ? { library } : {}),
    });
  }
  if (unresolved) ctx.diagnostics.push(diagnostic("EAGLE_DEVICE_MISSING", `${asset.relativePath} 有 ${unresolved} 个器件在内嵌库中找不到 deviceset/device。`, "warning", "library", fileRef));

  const sheets = list(schematic, "sheets");
  const out: SchematicIr[] = [];
  // Nets are global by name across a schematic's sheets.
  const netEndpoints = new Map<string, { endpoints: NetIr["endpoints"]; segments: string[]; refs: SourceRef[] }>();
  const pinsByUnit = new Map<string, { id: string; name: string; number: string; reference: string; partId: string }[]>();
  let recognized = 0;
  let busses = 0;

  for (const [sheetIndex, sheet] of sheets.entries()) {
    const schematicId = stableId("schematic", documentId, sheetIndex);
    const sheetId = stableId("sheet", schematicId);
    const name = sheets.length > 1 ? `${stem} (${sheetIndex + 1}/${sheets.length})` : stem;
    const sheetIr: SchematicIr = {
      id: schematicId,
      documentId,
      name,
      rootSheetId: sheetId,
      sheets: [{ id: sheetId, name, instancePath: `/${sheetIndex + 1}/` }],
      symbolInstanceIds: [],
      pins: [],
      wires: [],
      junctions: [],
      labels: [],
      noConnects: [],
      connectivityGraphId: stableId("connectivity", schematicId),
      sourceRefs: [sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `sheet:${sheetIndex + 1}`, line: sheet.line })],
    };
    for (const instance of list(sheet, "instances")) {
      const info = parts.get(instance.attrs.part ?? "");
      if (!info) continue;
      const gateName = instance.attrs.gate ?? "";
      const gateIndex = info.gates.findIndex((gate) => gate.attrs.name === gateName);
      const gate = info.gates[gateIndex];
      const symbol = info.library?.symbols.get(gate?.attrs.symbol ?? "");
      const unitId = stableId("unit", info.part.id, gateName);
      const rot = rotOf(instance.attrs.rot);
      const origin: XY = [num(instance.attrs.x), num(instance.attrs.y)];
      info.part.symbolUnits.push({ id: unitId, unit: gateIndex + 1 || 1, position: point(clean(origin[0]), clean(-origin[1]))!, rotation: clean(normalize(rot.degrees)) });
      sheetIr.symbolInstanceIds.push(unitId);
      const unitPins: { id: string; name: string; number: string; reference: string; partId: string }[] = [];
      for (const pin of children(symbol, "pin")) {
        const pinName = pin.attrs.name ?? "";
        const at = place(origin, rot, [num(pin.attrs.x), num(pin.attrs.y)]);
        const pinRot = rotOf(pin.attrs.rot);
        const body = place(origin, rot, place([num(pin.attrs.x), num(pin.attrs.y)], pinRot, [PIN_LENGTH[pin.attrs.length ?? "long"] ?? 7.62, 0]));
        const pads = info.connects.get(`${gateName}\u0000${pinName}`) ?? [];
        const ref = sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `instance:${info.part.logicalPartKey}:${gateName}:${pinName}`, line: instance.line });
        for (const pad of pads.length ? pads : [pinName]) {
          const id = stableId("pin", unitId, pinName, pad);
          sheetIr.pins.push({
            id,
            partId: info.part.id,
            symbolUnitId: unitId,
            reference: info.part.reference,
            number: pad,
            name: shownPinName(pinName),
            electricalType: DIRECTION[pin.attrs.direction ?? "io"] ?? "unspecified",
            bodyPosition: point(clean(body[0]), clean(-body[1]))!,
            ...(pin.attrs.visible === "off" ? { hidden: true } : {}),
            position: point(clean(at[0]), clean(-at[1]))!,
            sourceRef: ref,
          });
          unitPins.push({ id, name: pinName, number: pad, reference: info.part.reference, partId: info.part.id });
        }
      }
      pinsByUnit.set(`${info.part.logicalPartKey}\u0000${gateName}`, unitPins);
    }
    busses += list(sheet, "busses").length;
    for (const net of list(sheet, "nets")) {
      const netName = net.attrs.name ?? "";
      const entry = netEndpoints.get(netName) ?? { endpoints: [], segments: [], refs: [] };
      netEndpoints.set(netName, entry);
      for (const [segmentIndex, segment] of children(net, "segment").entries()) {
        for (const [index, item] of segment.children.entries()) {
          const ref = sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `net:${netName}:${sheetIndex + 1}:${segmentIndex}:${index}`, line: item.line });
          if (item.name === "wire") {
            const id = stableId("wire", schematicId, netName, segmentIndex, index);
            sheetIr.wires.push({ id, points: [point(clean(num(item.attrs.x1)), clean(-num(item.attrs.y1)))!, point(clean(num(item.attrs.x2)), clean(-num(item.attrs.y2)))!], sourceRef: ref });
            entry.segments.push(id);
            ctx.sourceMap.push(ref);
          } else if (item.name === "junction") {
            sheetIr.junctions.push({ id: stableId("junction", schematicId, netName, segmentIndex, index), position: point(clean(num(item.attrs.x)), clean(-num(item.attrs.y)))!, sourceRef: ref });
          } else if (item.name === "label") {
            const id = stableId("label", schematicId, netName, segmentIndex, index);
            sheetIr.labels.push({ id, name: netName, kind: item.attrs.xref === "yes" ? "global" : "local", rotation: clean(rotOf(item.attrs.rot).degrees), size: clean(num(item.attrs.size, 1.778)), position: point(clean(num(item.attrs.x)), clean(-num(item.attrs.y)))!, sourceRef: ref });
            entry.endpoints.push({ id: stableId("endpoint", netName, id), type: "label", targetId: id, identifier: { name: netName } });
          } else if (item.name === "pinref") {
            for (const pin of (pinsByUnit.get(`${item.attrs.part}\u0000${item.attrs.gate}`) ?? []).filter((entry) => entry.name === item.attrs.pin)) {
              entry.endpoints.push({ id: stableId("endpoint", netName, pin.id), type: "symbol_pin", targetId: pin.id, identifier: { partId: pin.partId, reference: pin.reference, pin: pin.number, pinName: shownPinName(pin.name) } });
            }
          }
        }
      }
      entry.refs.push(sourceRef(asset.id, asset.relativePath, "explicit", { nativeId: `net:${netName}`, line: net.line }));
    }
    recognized += sheetIr.wires.length + sheetIr.labels.length + sheetIr.junctions.length + sheetIr.pins.length;
    out.push(sheetIr);
  }
  if (busses) ctx.diagnostics.push(diagnostic("EAGLE_BUS_MEMBERS_UNREAD", `${asset.relativePath} 有 ${busses} 条总线：总线只作图形，成员网络按各自的 net 显式读取。`, "information", "connectivity", fileRef));
  if (list(schematic, "modules").length) ctx.diagnostics.push(diagnostic("EAGLE_MODULES_UNSUPPORTED", `${asset.relativePath} 使用 EAGLE 层次模块（modules）；模块内的图纸未读取，只读取顶层图纸。`, "warning", "unsupported", fileRef));

  const nets: NetIr[] = [...netEndpoints].map(([netName, entry]) => {
    const id = stableId("schematic-net", documentId, netName);
    const unique = new Map(entry.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    return {
      id,
      domain: "schematic_logical",
      canonicalName: netName,
      displayNames: [netName],
      endpoints: [...unique.values()],
      segmentIds: entry.segments,
      resolution: { method: "explicit", confidence: 1 },
      sourceRefs: entry.refs,
    };
  });
  return { schematics: out, parts: [...parts.values()].map((info) => info.part), nets, recognized: recognized + parts.size };
}

/** Reads every EAGLE schematic and board in the package. */
export function parseEagle(inputs: InputAsset[], inventory: SourceAsset[]): KicadParseOutput {
  const ctx: Ctx = { diagnostics: [], sourceMap: [] };
  const output: KicadParseOutput = { settings: {}, schematics: [], pcbs: [], parts: [], nets: [], constraints: [], libraries: [], sourceMap: [], diagnostics: ctx.diagnostics, opaqueNodes: [], recognized: 0, normalized: 0, opaque: 0 };
  const byPath = new Map(inputs.map((input) => [input.path, input]));
  const boards: { read: BoardRead; asset: SourceAsset }[] = [];
  let version: string | undefined;
  for (const asset of inventory) {
    if (asset.detectedFormat !== "eagle") continue;
    const input = byPath.get(asset.relativePath);
    if (!input) continue;
    const ref = sourceRef(asset.id, asset.relativePath);
    if (isEagleBinary(asset.relativePath, input.bytes)) {
      ctx.diagnostics.push(diagnostic("EAGLE_BINARY_UNSUPPORTED", `${asset.relativePath} 是 EAGLE 6.0 之前的二进制格式，不读取；请用 EAGLE 6+ 打开并另存为 XML 后再上传。`, "error", "unsupported", ref));
      continue;
    }
    if (asset.extension === ".lbr") {
      output.libraries.push({ name: asset.fileName, format: "eagle-lbr", path: asset.relativePath, provenance: "explicit" });
      continue;
    }
    let root: XmlElement;
    try {
      root = parseXml(decodeUtf8(input.bytes));
    } catch (error) {
      const code = error instanceof EagleXmlError ? error.code : "XML_SYNTAX";
      const security = code === "XML_ENTITY_REFUSED" || code === "XML_DOCTYPE_REFUSED";
      const resource = code === "XML_RESOURCE_LIMIT" || code === "XML_TIMEOUT";
      ctx.diagnostics.push(diagnostic(`EAGLE_${code}`, `${asset.relativePath}: ${error instanceof Error ? error.message : "XML 解析失败"}`, "error", security ? "security" : resource ? "resource" : "syntax", ref));
      continue;
    }
    if (root.name !== "eagle") {
      ctx.diagnostics.push(diagnostic("EAGLE_ROOT_MISSING", `${asset.relativePath} 不是 EAGLE 文档（根元素 <${root.name}>）。`, "error", "format", ref));
      continue;
    }
    version ??= root.attrs.version;
    const schematic = readSchematic(root, input, asset, ctx);
    if (schematic) {
      output.schematics.push(...schematic.schematics);
      output.parts.push(...schematic.parts);
      output.nets.push(...schematic.nets);
      output.recognized += schematic.recognized;
    }
    const board = readBoard(root, input, asset, ctx);
    if (board) {
      output.pcbs.push(board.pcb);
      output.nets.push(...board.nets);
      output.recognized += board.recognized;
      boards.push({ read: board, asset });
    }
    if (!schematic && !board) ctx.diagnostics.push(diagnostic("EAGLE_DRAWING_UNRECOGNIZED", `${asset.relativePath} 既不是原理图也不是 PCB（库或其他 EAGLE 文档）。`, "warning", "structure", ref));
  }
  // A board without its schematic: its elements are the parts list (what the board places, by name and value).
  if (!output.schematics.length) {
    for (const { read } of boards) {
      for (const element of read.elements) {
        if (!element.pads) continue;
        const identity = identityOf(Object.fromEntries(Object.entries(element.fields).filter(([key]) => !["Reference", "Value", "Footprint"].includes(key))));
        output.parts.push({
          id: stableId("part", read.pcb.documentId, element.name),
          logicalPartKey: element.name,
          reference: element.name,
          value: element.value,
          symbolUnits: [],
          footprintInstanceId: element.footprintId,
          footprint: element.libraryIdentifier,
          fields: element.fields,
          ...(identity.manufacturer ? { manufacturerRaw: identity.manufacturer } : {}),
          ...(identity.mpn ? { mpnRaw: identity.mpn } : {}),
          variantStatus: element.populate ? "fitted" : "dnp",
          pinPadMap: [],
          sourceRefs: [element.ref],
        });
      }
    }
  }
  output.sourceMap = ctx.sourceMap;
  output.normalized = output.recognized + output.nets.length;
  output.sourceFormatVersion = version;
  output.sourceToolVersion = version ? `EAGLE ${version}` : undefined;
  const named = inventory.find((asset) => asset.detectedFormat === "eagle" && asset.extension === ".brd") ?? inventory.find((asset) => asset.detectedFormat === "eagle" && asset.extension === ".sch");
  if (named) output.projectName = withoutExtension(named.fileName);
  return output;
}

