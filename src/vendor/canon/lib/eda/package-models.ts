/**
 * A standard 3D model for a package that names none (local addition,
 * ../../NOTICE.md): EAGLE embeds no 3D model, so a part whose package is a
 * standard one — a 0603 chip, a SOT-23, a SOIC-8, a 1×12 pin header — is given
 * the model KiCad's official library has for that package (kicad-packages3D,
 * CC-BY-SA 4.0 with an exception for designs that use it), read through our
 * server like a KiCad board's library models.
 *
 * Deterministic, and only ever a match by package: a rule names a candidate
 * model from the package's name and its pads (count, pitch, rows), and the
 * candidate is accepted only when KiCad's own footprint for that model, turned
 * a quarter turn at a time and moved, lies on the package's pads within a
 * tolerance. The match says which rule, from what (the name, or the pads
 * alone), how many pads, the pitch and the fit, and whether pin 1 agrees. It
 * never says the model is the part (G12): the page calls it a standard model
 * matched by package.
 *
 * Coordinates: the package's own frame, millimetres, y up (EAGLE's). KiCad's
 * footprints are written y up here too (their pads' y negated), with the
 * footprint's origin at (0, 0) — where KiCad puts the model.
 */

/** Bumped when a rule or a layout changes, so a match records the rules that made it. */
export const PACKAGE_MODEL_RULES = "pkg3d 1";

/** Where KiCad's library models are named from (eelib-bff/src/upstream/kicadModels.ts reads this tag). */
export const MODEL_DIR = "${KICAD10_3DMODEL_DIR}";

/** A copper pad of a package: its centre, its extent along x and y (after its own turn), through-hole or not. */
export type PackagePad = { name: string; x: number; y: number; w: number; h: number; tht: boolean };
export type PackageShape = {
  /** The package's name in its library (`R0603`, `SO016`, `1X12`). */
  name: string;
  /** The letters of a placed part's reference (`R`, `LED`, `U`), when known. */
  prefix: string;
  pads: PackagePad[];
  /** The largest circle drawn on the silkscreen or documentation layer, as a diameter (a radial capacitor, an LED). */
  circle: number | null;
};

export type StandardModel = {
  /** `${KICAD10_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603_1608Metric.step` */
  path: string;
  /** KiCad's footprint for that model (`Resistor_SMD:R_0603_1608Metric`). */
  footprint: string;
  /** The rule that chose it (`chip`, `sot`, `so`, `qfn`, `header` …). */
  rule: string;
  /** What chose it: the package's name, or its pads alone. */
  from: "name" | "pads";
  pads: number;
  /** The pads' pitch (mm), when they have one. */
  pitch: number | null;
  /** How far, root-mean-square, KiCad's pads lie from the package's (mm). */
  fit: number;
  /** Pin 1 of the model is the package's pin 1 (false: matched by position only). */
  pin1: boolean;
  /** Where the model's origin goes in the package's frame, and how far it is turned (degrees, counter-clockwise). */
  at: [number, number];
  rotation: number;
  rules: string;
};

export type PackageMatch = { model: StandardModel } | { model: null; why: "no_rule" | "no_fit" };

type LayoutPad = { n: string; x: number; y: number; ep?: boolean };
type Candidate = {
  lib: string;
  name: string;
  /** KiCad's footprint, when its name is not the model's. */
  footprint?: string;
  rule: string;
  from: "name" | "pads";
  layout: LayoutPad[];
  /** `cathode`: KiCad's pad 1 is the cathode (diodes, LEDs); `anode`: pad 1 is + (polarised capacitors). */
  polarity?: "cathode" | "anode";
  /** Pad names are not compared (a switch's paired pads). */
  unnamed?: boolean;
  tolerance?: number;
};

const round = (value: number, digits = 3) => Number(value.toFixed(digits));

// ── layouts of KiCad's footprints (y up, origin where KiCad's is) ─────────

const two = (half: number): LayoutPad[] => [
  { n: "1", x: -half, y: 0 },
  { n: "2", x: half, y: 0 },
];
/** Two columns, pin 1 top left, down the left and up the right (SOIC, SOT-23-5/6, DFN). */
function dual(count: number, pitch: number, half: number): LayoutPad[] {
  const side = count / 2;
  const top = ((side - 1) * pitch) / 2;
  return Array.from({ length: count }, (_, i) =>
    i < side ? { n: String(i + 1), x: -half, y: round(top - i * pitch, 4) } : { n: String(i + 1), x: half, y: round(-top + (i - side) * pitch, 4) },
  );
}
/** Four sides, pin 1 top of the left side, counter-clockwise (QFN, QFP). */
function quad(count: number, pitch: number, half: number): LayoutPad[] {
  const side = count / 4;
  const top = ((side - 1) * pitch) / 2;
  return Array.from({ length: count }, (_, i) => {
    const k = i % side;
    const along = round(top - k * pitch, 4);
    const n = String(i + 1);
    switch (Math.floor(i / side)) {
      case 0:
        return { n, x: -half, y: along };
      case 1:
        return { n, x: -along, y: -half };
      case 2:
        return { n, x: half, y: -along };
      default:
        return { n, x: along, y: half };
    }
  });
}
/** A pin header: pin 1 at the origin, down the column (and across, for two rows: a header's to the right, a socket's to the left). */
function header(rows: number, count: number, pitch: number, socket = false): LayoutPad[] {
  return Array.from({ length: count }, (_, i) => (rows === 1 ? { n: String(i + 1), x: 0, y: round(-i * pitch, 4) } : { n: String(i + 1), x: (i % 2) * (socket ? -pitch : pitch), y: round(-Math.floor(i / 2) * pitch, 4) }));
}
/** A row from pin 1 at the origin to the right (JST PH/XH, radial parts). */
const row = (count: number, pitch: number): LayoutPad[] => Array.from({ length: count }, (_, i) => ({ n: String(i + 1), x: round(i * pitch, 4), y: 0 }));
const pads = (list: [string, number, number][]): LayoutPad[] => list.map(([n, x, y]) => ({ n, x, y }));
/** JST SH (Qwiic): the pins at 1 mm in a row, two mounting pads behind. */
function jstSh(signals: number): LayoutPad[] {
  const half = (signals - 1) / 2;
  return [
    ...Array.from({ length: signals }, (_, i) => ({ n: String(i + 1), x: round(-half + i, 4), y: 2 })),
    { n: "MP", x: round(-half - 1.3, 4), y: -1.875 },
    { n: "MP", x: round(half + 1.3, 4), y: -1.875 },
  ];
}

// ── the catalogue ───────────────────────────────────────────────────────────

const corners = (hx: number, hy: number) => pads([["1", -hx, -hy], ["2", hx, -hy], ["3", hx, hy], ["4", -hx, hy]]);
const paired = (hx: number, hy: number) => pads([["1", -hx, hy], ["1", hx, hy], ["2", -hx, -hy], ["2", hx, -hy]]);
/** KiCad footprints with a fixed pad layout, by model name. */
const FIXED: Record<string, { lib: string; layout: LayoutPad[] }> = {
  "Crystal_HC49-U_Vertical": { lib: "Crystal", layout: row(2, 4.88) },
  "Crystal_SMD_HC49-SD": { lib: "Crystal", layout: two(4.25) },
  "Crystal_SMD_5032-2Pin_5.0x3.2mm": { lib: "Crystal", layout: two(1.85) },
  "Crystal_SMD_3225-4Pin_3.2x2.5mm": { lib: "Crystal", layout: corners(1.1, 0.85) },
  "Crystal_SMD_2520-4Pin_2.5x2.0mm": { lib: "Crystal", layout: corners(0.875, 0.7) },
  "Crystal_SMD_2016-4Pin_2.0x1.6mm": { lib: "Crystal", layout: corners(0.7, 0.55) },
  "LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm": { lib: "LED_SMD", layout: pads([["1", -2.45, 1.65], ["2", -2.45, -1.65], ["3", 2.45, -1.65], ["4", 2.45, 1.65]]) },
  SW_PUSH_6mm: { lib: "Button_Switch_THT", layout: pads([["1", 0, 0], ["1", 6.5, 0], ["2", 0, -4.5], ["2", 6.5, -4.5]]) },
  SW_SPST_TL3342: { lib: "Button_Switch_SMD", layout: paired(3.15, 1.9) },
  SW_SPST_PTS645Sx43SMTR92: { lib: "Button_Switch_SMD", layout: paired(3.98, 2.25) },
  "LED_D3.0mm": { lib: "LED_THT", layout: row(2, 2.54) },
  "LED_D5.0mm": { lib: "LED_THT", layout: row(2, 2.54) },
  "USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal": {
    lib: "Connector_USB",
    layout: [
      ...[-3.2, -2.4, -1.75, -1.25, -0.75, -0.25, 0.25, 0.75, 1.25, 1.75, 2.4, 3.2].map((x): LayoutPad => ({ n: "", x, y: 3.68 })),
      ...pads([["SH", -4.32, 3.105], ["SH", 4.32, 3.105], ["SH", -4.32, -1.075], ["SH", 4.32, -1.075]]),
    ],
  },
  "USB_Micro-B_Molex_47346-0001": {
    lib: "Connector_USB",
    layout: pads([["1", -1.3, 1.46], ["2", -0.65, 1.46], ["3", 0, 1.46], ["4", 0.65, 1.46], ["5", 1.3, 1.46], ["SH", -3.375, -1.2], ["SH", -2.4875, 1.375], ["SH", -1.15, -1.2], ["SH", 1.55, -1.2], ["SH", 2.4875, 1.375], ["SH", 3.375, -1.2]]),
  },
};
const CANS: Record<string, [string, number]> = { B: ["CP_Elec_4x5.4", 1.8], C: ["CP_Elec_5x5.4", 2.2], D: ["CP_Elec_6.3x5.4", 2.8], F: ["CP_Elec_6.3x7.7", 2.7], G: ["CP_Elec_8x10", 3.25], H: ["CP_Elec_10x10", 4] };
const RADIAL: Record<string, number[]> = { "4.0": [1.5, 2], "5.0": [2, 2.5], "6.3": [2.5], "8.0": [2.5, 3.5, 3.8, 5], "10.0": [2.5, 3.5, 3.8, 5, 7.5] };
/** A candidate for one of the fixed layouts. */
const fixed = (name: string, rule: string, rest: Partial<Candidate> = {}): Candidate => ({ lib: FIXED[name]!.lib, name, rule, from: "name", layout: FIXED[name]!.layout, ...rest });

/** Chip sizes (imperial code → KiCad's metric name, and the pads' half-span of KiCad's resistor). */
const CHIP: Record<string, { metric: string; half: number }> = {
  "0201": { metric: "0603", half: 0.32 },
  "0402": { metric: "1005", half: 0.51 },
  "0603": { metric: "1608", half: 0.825 },
  "0805": { metric: "2012", half: 0.9125 },
  "1206": { metric: "3216", half: 1.4625 },
  "1210": { metric: "3225", half: 1.4625 },
  "1812": { metric: "4532", half: 2.1375 },
  "2010": { metric: "5025", half: 2.3125 },
  "2512": { metric: "6332", half: 2.9625 },
};
const METRIC_CHIP = Object.fromEntries(Object.entries(CHIP).map(([code, size]) => [size.metric, code]));
/** The kinds of chip KiCad models in each size. */
const CHIP_MODELS: Record<"R" | "C" | "L" | "LED" | "D", { lib: string; prefix: string; sizes: string[] }> = {
  R: { lib: "Resistor_SMD", prefix: "R", sizes: Object.keys(CHIP) },
  C: { lib: "Capacitor_SMD", prefix: "C", sizes: ["0201", "0402", "0603", "0805", "1206", "1210", "1812"] },
  L: { lib: "Inductor_SMD", prefix: "L", sizes: ["0402", "0603"] },
  LED: { lib: "LED_SMD", prefix: "LED", sizes: ["0201", "0402", "0603", "0805", "1206", "1210", "1812"] },
  D: { lib: "Diode_SMD", prefix: "D", sizes: ["0603", "0805", "1206"] },
};
const TANTALUM: Record<string, { name: string; half: number }> = {
  "3216": { name: "CP_EIA-3216-18_Kemet-A", half: 1.3525 },
  "3528": { name: "CP_EIA-3528-21_Kemet-B", half: 1.54 },
  "6032": { name: "CP_EIA-6032-28_Kemet-C", half: 2.47 },
  "7343": { name: "CP_EIA-7343-31_Kemet-D", half: 3.12 },
};
const DIODES: { pattern: RegExp; name: string; half: number }[] = [
  { pattern: /SOD-?123/, name: "D_SOD-123", half: 1.65 },
  { pattern: /SOD-?323/, name: "D_SOD-323", half: 1.05 },
  { pattern: /SOD-?523/, name: "D_SOD-523", half: 0.7 },
  { pattern: /(?:^|[^A-Z])SMA(?![A-Z])|DO-?214AC/, name: "D_SMA", half: 2 },
  { pattern: /(?:^|[^A-Z])SMB(?![A-Z])|DO-?214AA/, name: "D_SMB", half: 2.15 },
  { pattern: /(?:^|[^A-Z])SMC(?![A-Z])|DO-?214AB/, name: "D_SMC", half: 3.4 },
];
/** SOT packages, by name, with KiCad's pads. */
const SOT: { pattern: RegExp; name: string; footprint?: string; layout: LayoutPad[] }[] = [
  { pattern: /SOT-?23-?6|SOT-?26(?!\d)|SC-?74(?!A)|SOT-?457/, name: "SOT-23-6", layout: dual(6, 0.95, 1.1375) },
  { pattern: /SOT-?23-?5|SOT-?25(?!\d)|SC-?74A|SOT-?753/, name: "SOT-23-5", layout: dual(6, 0.95, 1.1375).filter((pad) => pad.n !== "5").map((pad) => (pad.n === "6" ? { ...pad, n: "5" } : pad)) },
  { pattern: /SOT-?363|SC-?70-?6|SC-?88(?!A)/, name: "SOT-363_SC-70-6", layout: dual(6, 0.65, 0.8375) },
  { pattern: /SOT-?353|SC-?70-?5|SC-?88A/, name: "SOT-353_SC-70-5", layout: dual(6, 0.65, 0.8375).filter((pad) => pad.n !== "5").map((pad) => (pad.n === "6" ? { ...pad, n: "5" } : pad)) },
  { pattern: /SOT-?323|SC-?70(?!-?\d)/, name: "SOT-323_SC-70", layout: pads([["1", -0.8875, 0.65], ["2", -0.8875, -0.65], ["3", 0.8875, 0]]) },
  { pattern: /SOT-?223/, name: "SOT-223", footprint: "SOT-223-3_TabPin2", layout: pads([["1", -3.15, 2.3], ["2", -3.15, 0], ["3", -3.15, -2.3], ["4", 3.15, 0]]) },
  { pattern: /SOT-?23(?!\d)|SOT-?346|TO-?236/, name: "SOT-23", layout: pads([["1", -0.9375, 0.95], ["2", -0.9375, -0.95], ["3", 0.9375, 0]]) },
];
/** Dual-row families: their name, the pads' half-span across the rows, and KiCad's models (pins, body, pitch). */
const SO_FAMILIES: { family: string; pattern: RegExp; half: number; models: string[] }[] = [
  { family: "SOIC", pattern: /SOIC|(?:^|[^A-Z])SO-?\d|^SO\d|(?:^|[^A-Z])SOP-?\d/, half: 2.475, models: ["SOIC-8_3.9x4.9mm_P1.27mm", "SOIC-14_3.9x8.7mm_P1.27mm", "SOIC-16_3.9x9.9mm_P1.27mm"] },
  { family: "SOIC-W", pattern: /SOIC|(?:^|[^A-Z])SO-?\d|^SO\d|(?:^|[^A-Z])SOP-?\d/, half: 4.65, models: ["SOIC-16W_7.5x10.3mm_P1.27mm", "SOIC-18W_7.5x11.6mm_P1.27mm", "SOIC-20W_7.5x12.8mm_P1.27mm", "SOIC-24W_7.5x15.4mm_P1.27mm", "SOIC-28W_7.5x17.9mm_P1.27mm"] },
  { family: "TSSOP", pattern: /TSSOP|HTSSOP/, half: 2.8625, models: ["TSSOP-8_4.4x3mm_P0.65mm", "TSSOP-14_4.4x5mm_P0.65mm", "TSSOP-16_4.4x5mm_P0.65mm", "TSSOP-20_4.4x6.5mm_P0.65mm", "TSSOP-24_4.4x7.8mm_P0.65mm", "TSSOP-28_4.4x9.7mm_P0.65mm"] },
  { family: "MSOP", pattern: /MSOP|VSSOP|UMAX|MICRO-?8/, half: 2.1, models: ["MSOP-8_3x3mm_P0.65mm", "MSOP-10_3x3mm_P0.5mm"] },
  { family: "SSOP", pattern: /SSOP|QSOP/, half: 2.625, models: ["SSOP-16_3.9x4.9mm_P0.635mm", "SSOP-20_3.9x8.7mm_P0.635mm", "SSOP-24_3.9x8.7mm_P0.635mm", "SSOP-28_3.9x9.9mm_P0.635mm"] },
  { family: "SSOP-5.3", pattern: /SSOP/, half: 3.5, models: ["SSOP-14_5.3x6.2mm_P0.65mm", "SSOP-16_5.3x6.2mm_P0.65mm", "SSOP-20_5.3x7.2mm_P0.65mm", "SSOP-24_5.3x8.2mm_P0.65mm", "SSOP-28_5.3x10.2mm_P0.65mm"] },
];
/** KiCad's square QFNs, QFPs and DFNs (pins, body, pitch, exposed pad parsed from the names). */
const QFN_MODELS = [
  "QFN-16-1EP_3x3mm_P0.5mm_EP1.7x1.7mm",
  "QFN-16-1EP_4x4mm_P0.65mm_EP2.1x2.1mm",
  "QFN-20-1EP_4x4mm_P0.5mm_EP2.5x2.5mm",
  "QFN-24-1EP_4x4mm_P0.5mm_EP2.6x2.6mm",
  "QFN-28-1EP_5x5mm_P0.5mm_EP3.35x3.35mm",
  "QFN-28-1EP_4x4mm_P0.4mm_EP2.4x2.4mm",
  "QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm",
  "QFN-32-1EP_4x4mm_P0.4mm_EP2.65x2.65mm",
  "QFN-40-1EP_6x6mm_P0.5mm_EP4.6x4.6mm",
  "QFN-44-1EP_7x7mm_P0.5mm_EP5.15x5.15mm",
  "QFN-48-1EP_7x7mm_P0.5mm_EP5.15x5.15mm",
  "QFN-56-1EP_7x7mm_P0.4mm_EP5.6x5.6mm",
  "QFN-64-1EP_9x9mm_P0.5mm_EP6x6mm",
];
const QFP_MODELS = [
  "LQFP-32_7x7mm_P0.8mm",
  "TQFP-32_7x7mm_P0.8mm",
  "LQFP-44_10x10mm_P0.8mm",
  "TQFP-44_10x10mm_P0.8mm",
  "LQFP-48_7x7mm_P0.5mm",
  "TQFP-48_7x7mm_P0.5mm",
  "LQFP-64_10x10mm_P0.5mm",
  "TQFP-64_10x10mm_P0.5mm",
  "LQFP-64_14x14mm_P0.8mm",
  "LQFP-100_14x14mm_P0.5mm",
  "TQFP-100_14x14mm_P0.5mm",
  "LQFP-144_20x20mm_P0.5mm",
];
const DFN_MODELS = ["DFN-8-1EP_2x2mm_P0.5mm_EP0.6x1.2mm", "DFN-10-1EP_3x3mm_P0.5mm_EP1.55x2.48mm", "DFN-12-1EP_4x4mm_P0.5mm_EP2.66x3.38mm"];

const parseIc = (name: string) => {
  const match = /^[A-Z]+-(\d+)(?:-1EP)?W?_([\d.]+)x([\d.]+)mm_P([\d.]+)mm/.exec(name);
  return match ? { count: Number(match[1]), body: Number(match[2]), length: Number(match[3]), pitch: Number(match[4]) } : null;
};

// ── reading a package ───────────────────────────────────────────────────────

/** A pad's name as KiCad numbers it: `P$1` and `01` are `1`. */
export function padNumber(name: string): string {
  const text = name.trim().toUpperCase().replace(/^P\$/, "");
  return /^0*\d+$/.test(text) ? String(Number(text)) : text;
}
/** A polarised part's pads in KiCad's numbers: a diode's or LED's cathode is 1; a capacitor's + is 1. */
function polarised(name: string, polarity: "cathode" | "anode" | undefined): string {
  const number = padNumber(name);
  if (!polarity) return number;
  const cathode = /^(?:C|K|KATHODE|CATHODE|-|NEG|MINUS)$/.test(number);
  const anode = /^(?:A|ANODE|\+|POS|PLUS)$/.test(number);
  if (polarity === "cathode") return cathode ? "1" : anode ? "2" : number;
  return anode ? "1" : cathode ? "2" : number;
}

type Point = [number, number];
const centreOf = (points: readonly Point[]): Point => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
};
/** The smallest distance between two pads' centres: the pitch, for a row of pins. */
export function pitchOf(points: readonly Point[]): number | null {
  let best = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    for (let j = i + 1; j < points.length; j += 1) {
      const d = Math.hypot(points[i]![0] - points[j]![0], points[i]![1] - points[j]![1]);
      if (d > 0.05 && d < best) best = d;
    }
  }
  return Number.isFinite(best) ? round(best, 3) : null;
}
/** One copy of each position: KiCad stacks two pads on one spot (USB-C's A and B rows), EAGLE may too. */
function distinct<T extends { x: number; y: number }>(list: readonly T[]): T[] {
  const out: T[] = [];
  for (const item of list) if (!out.some((other) => Math.abs(other.x - item.x) < 0.02 && Math.abs(other.y - item.y) < 0.02)) out.push(item);
  return out;
}
/** A pad in the middle, much larger than the rest: an exposed pad (QFN, DFN). */
function exposed(list: readonly PackagePad[]): PackagePad[] {
  if (list.length < 5) return [];
  const areas = list.map((pad) => pad.w * pad.h).sort((a, b) => a - b);
  const median = areas[Math.floor(areas.length / 2)]!;
  const [cx, cy] = centreOf(list.map((pad) => [pad.x, pad.y]));
  const span = Math.min(...["x", "y"].map((axis) => Math.max(...list.map((pad) => pad[axis as "x"])) - Math.min(...list.map((pad) => pad[axis as "x"]))));
  return list.filter((pad) => pad.w * pad.h > 3 * median && Math.abs(pad.x - cx) < span * 0.25 && Math.abs(pad.y - cy) < span * 0.25);
}

/** Rows of pads: their positions grouped along one axis (within a tolerance). */
function linesOf(values: readonly number[], tolerance = 0.2): number[] {
  const lines: number[] = [];
  for (const value of [...values].sort((a, b) => a - b)) if (!lines.some((line) => Math.abs(line - value) < tolerance)) lines.push(value);
  return lines;
}

// ── fitting a footprint onto the pads ───────────────────────────────────────

type Fit = { fit: number; at: Point; rotation: number; pin1: boolean };
const turn = (x: number, y: number, degrees: number): Point => {
  const r = (degrees * Math.PI) / 180;
  return [round(x * Math.cos(r) - y * Math.sin(r), 6), round(x * Math.sin(r) + y * Math.cos(r), 6)];
};

/**
 * KiCad's pads onto the package's: for each quarter turn, the layout moved so
 * the two sets' centres meet, each package pad paired with the nearest free
 * layout pad, then moved to the pairs' mean. The turn whose pads lie closest
 * wins; one whose pad names disagree (pin 1 elsewhere) counts as a millimetre
 * worse, so a symmetric package takes the turn that puts pin 1 on pin 1.
 */
export function fitLayout(package_: readonly { n: string; x: number; y: number }[], layout: readonly LayoutPad[], compareNames: boolean): Fit | null {
  if (package_.length !== layout.length || package_.length === 0) return null;
  const own = package_.map((pad) => [pad.x, pad.y] as Point);
  const ownCentre = centreOf(own);
  const named = new Set(layout.map((pad) => pad.n));
  let best: (Fit & { score: number }) | null = null;
  for (const rotation of [0, 90, 180, 270]) {
    const turned = layout.map((pad) => turn(pad.x, pad.y, rotation));
    const [cx, cy] = centreOf(turned);
    const shift: Point = [ownCentre[0] - cx, ownCentre[1] - cy];
    // Pairs, nearest first.
    const pairs: { i: number; j: number; d: number }[] = [];
    own.forEach(([x, y], i) => turned.forEach(([lx, ly], j) => pairs.push({ i, j, d: Math.hypot(x - lx - shift[0], y - ly - shift[1]) })));
    pairs.sort((a, b) => a.d - b.d);
    const of = new Map<number, number>();
    const taken = new Set<number>();
    for (const pair of pairs) {
      if (of.has(pair.i) || taken.has(pair.j)) continue;
      of.set(pair.i, pair.j);
      taken.add(pair.j);
    }
    let sx = 0;
    let sy = 0;
    for (const [i, j] of of) {
      sx += own[i]![0] - turned[j]![0];
      sy += own[i]![1] - turned[j]![1];
    }
    const at: Point = [sx / own.length, sy / own.length];
    let squares = 0;
    let compared = 0;
    let agree = 0;
    for (const [i, j] of of) {
      squares += (own[i]![0] - turned[j]![0] - at[0]) ** 2 + (own[i]![1] - turned[j]![1] - at[1]) ** 2;
      if (compareNames && named.has(package_[i]!.n)) {
        compared += 1;
        if (package_[i]!.n === layout[j]!.n) agree += 1;
      }
    }
    const fit = Math.sqrt(squares / own.length);
    const pin1 = compared > 0 && agree === compared;
    const score = fit + (compared > 0 && !pin1 ? 1 : 0);
    if (!best || score < best.score - 1e-6) best = { fit: round(fit, 3), at: [round(at[0], 4), round(at[1], 4)], rotation, pin1, score };
  }
  return best ? { fit: best.fit, at: best.at, rotation: best.rotation, pin1: best.pin1 } : null;
}

// ── the rules ───────────────────────────────────────────────────────────────

const PIN_HEADER_PITCHES = [2.54, 2.0, 1.27];
/** Not parts: solder jumpers, test pads, fiducials, stand-offs, logos — copper on the board, no body to model. */
export const BOARD_FEATURE = /JUMPER|SOLDER-?J|(?:^|[^A-Z])SJ(?:[^A-Z]|$)|FIDUCIAL|STAND-?OFF|TEST-?P(?:OINT|AD)|(?:^|[^A-Z])TP(?:[^A-Z]|$)|^PAD[._-]|LOGO|MOUNT(?:ING)?-?HOLE|^HOLE/i;
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

/** The candidates a package's name and pads point to, most specific first. */
function candidatesFor(shape: PackageShape): Candidate[] {
  const name = shape.name.toUpperCase();
  const prefix = shape.prefix.toUpperCase();
  const copper = shape.pads;
  const smd = copper.every((pad) => !pad.tht);
  const tht = copper.every((pad) => pad.tht);
  const count = copper.length;
  const points = copper.map((pad) => [pad.x, pad.y] as Point);
  const pitch = pitchOf(points);
  const out: Candidate[] = [];

  // Two-pad SMD parts: a named diode package, a tantalum case, an electrolytic can, else a chip by its size.
  if (count === 2 && smd) {
    const span = Math.hypot(copper[0]!.x - copper[1]!.x, copper[0]!.y - copper[1]!.y);
    for (const diode of DIODES) if (diode.pattern.test(name)) out.push({ lib: "Diode_SMD", name: diode.name, rule: "diode", from: "name", layout: two(diode.half), polarity: "cathode" });
    const tantalum = /EIA-?(3216|3528|6032|7343)|(?:^|[^0-9])(3216|3528|6032|7343)-\d\d/.exec(name);
    if (tantalum && /EIA|TANT|CASE|CP|POL/.test(name)) {
      const model = TANTALUM[tantalum[1] ?? tantalum[2]!]!;
      out.push({ lib: "Capacitor_Tantalum_SMD", name: model.name, rule: "tantalum", from: "name", layout: two(model.half), polarity: "anode" });
    }
    const can = /PANASONIC_([B-H])(?![A-Z])/.exec(name);
    if (can && CANS[can[1]!]) {
      const [model, half] = CANS[can[1]!]!;
      out.push({ lib: "Capacitor_SMD", name: model, rule: "electrolytic", from: "name", layout: two(half), polarity: "anode", tolerance: 0.5 });
    }
    const sizes = Object.keys(CHIP);
    const imperial = /(?:^|[^0-9])(0201|0402|0603|0805|1206|1210|1812|2010|2512)(?![0-9])/.exec(name)?.[1];
    const metric = /(?:^|[^0-9])(0603|1005|1608|2012|3216|3225|4532|5025|6332)(?:METRIC|M)(?![0-9])|(?:^|[^0-9])(1005|1608|2012)(?![0-9])/.exec(name)?.slice(1).find(Boolean);
    const fromName = imperial ?? (metric ? METRIC_CHIP[metric] : undefined);
    const similar = Math.max(copper[0]!.w * copper[0]!.h, copper[1]!.w * copper[1]!.h) <= 2 * Math.min(copper[0]!.w * copper[0]!.h, copper[1]!.w * copper[1]!.h);
    const size = fromName ?? (similar && span < 7 && /^(?:R|C|L|D|LED|FB|F|RN|CN)$/.test(prefix) ? sizes.reduce((a, b) => (Math.abs(CHIP[b]!.half * 2 - span) < Math.abs(CHIP[a]!.half * 2 - span) ? b : a)) : undefined);
    if (size && !tantalum && !can && !out.some((candidate) => candidate.rule === "diode")) {
      const led = /LED/.test(name) || prefix === "LED";
      const kind = led ? "LED" : prefix === "D" ? "D" : prefix === "C" ? "C" : prefix === "L" || prefix === "FB" ? "L" : "R";
      const models = CHIP_MODELS[kind];
      const family = models.sizes.includes(size) ? models : kind === "D" && CHIP_MODELS.LED.sizes.includes(size) ? CHIP_MODELS.LED : CHIP_MODELS.R;
      out.push({
        lib: family.lib,
        name: `${family.prefix}_${size}_${CHIP[size]!.metric}Metric`,
        rule: "chip",
        from: fromName ? "name" : "pads",
        layout: two(CHIP[size]!.half),
        ...(kind === "LED" || kind === "D" ? { polarity: "cathode" as const } : {}),
        tolerance: Math.max(0.12, CHIP[size]!.half * 0.3),
      });
    }
  }

  // SOT packages, by name or by their pads.
  for (const sot of SOT) {
    if (sot.layout.length !== count || !smd) continue;
    if (sot.pattern.test(name)) out.push({ lib: "Package_TO_SOT_SMD", name: sot.name, ...(sot.footprint ? { footprint: sot.footprint } : {}), rule: "sot", from: "name", layout: sot.layout, tolerance: 0.25 });
  }
  if (smd && count === 3 && !out.length) out.push({ lib: "Package_TO_SOT_SMD", name: "SOT-23", rule: "sot", from: "pads", layout: SOT.find((sot) => sot.name === "SOT-23")!.layout, tolerance: 0.15 });

  // Crystals.
  const crystal = /XTAL|CRYSTAL|HC-?49|RESONATOR|(?:^|[^A-Z])(?:ABM|TSX|FA-|NX)\d|(?:^|[^0-9])(?:3225|2520|2016|5032)(?![0-9])/.test(name) || /^(?:Y|X|Q|XTAL)$/.test(prefix);
  if (crystal && count === 2 && tht) out.push(fixed("Crystal_HC49-U_Vertical", "crystal", { unnamed: true }));
  if (crystal && count === 2 && smd) {
    out.push(fixed("Crystal_SMD_HC49-SD", "crystal", { unnamed: true, tolerance: 0.5 }));
    out.push(fixed("Crystal_SMD_5032-2Pin_5.0x3.2mm", "crystal", { unnamed: true }));
  }
  if (crystal && count === 4 && smd) {
    for (const model of ["Crystal_SMD_3225-4Pin_3.2x2.5mm", "Crystal_SMD_2520-4Pin_2.5x2.0mm", "Crystal_SMD_2016-4Pin_2.0x1.6mm"]) out.push(fixed(model, "crystal", { tolerance: 0.2 }));
  }

  // Addressable LEDs in a 5050 PLCC.
  if (count === 4 && smd && /WS2812|SK6812|APA102|5050|PLCC-?4/.test(name)) {
    out.push(fixed("LED_WS2812B_PLCC4_5.0x5.0mm_P3.2mm", "led-5050", { tolerance: 0.35 }));
  }

  // Tactile switches.
  if (count === 4 && /TACT|PUSH|BUTTON|SWITCH|(?:^|[^A-Z])SW|KMR|PTS|TL33|EVQ/.test(name)) {
    if (tht) out.push(fixed("SW_PUSH_6mm", "switch", { unnamed: true, tolerance: 0.4 }));
    if (smd) for (const model of ["SW_SPST_TL3342", "SW_SPST_PTS645Sx43SMTR92"]) out.push(fixed(model, "switch", { unnamed: true, tolerance: 0.35 }));
  }

  // Through-hole two-pin parts: an LED, a radial electrolytic.
  if (count === 2 && tht && pitch) {
    const diameter = shape.circle;
    if ((/LED/.test(name) || prefix === "LED") && near(pitch, 2.54, 0.15)) {
      out.push(fixed(diameter !== null && diameter > 4 ? "LED_D5.0mm" : "LED_D3.0mm", "led-tht", { polarity: "cathode", tolerance: 0.2 }));
    }
    if ((/CPOL|ELEC|PANASONIC|CAP.*POL|POL.*CAP|RADIAL|(?:^|[^A-Z])E\d/.test(name) || prefix === "C") && diameter !== null) {
      const d = Object.keys(RADIAL).reduce((a, b) => (Math.abs(Number(b) - diameter) < Math.abs(Number(a) - diameter) ? b : a));
      const spacing = RADIAL[d]!.find((value) => near(value, pitch, 0.15));
      if (spacing !== undefined && Math.abs(Number(d) - diameter) <= 1) {
        out.push({ lib: "Capacitor_THT", name: `CP_Radial_D${d}mm_P${spacing.toFixed(2)}mm`, rule: "electrolytic", from: "name", layout: row(2, spacing), polarity: "anode", tolerance: 0.2 });
      }
    }
  }

  // Connectors named as such: JST PH/XH/SH (Qwiic), USB.
  const jst = /JST|(?:^|[^A-Z])(?:PH|XH|SH)(?![A-Z])|QWIIC|(?:^|[^A-Z])[BS]\d+B-|SM\d+B|1MM_RA/.test(name);
  if (jst && tht && pitch && count >= 2 && count <= 16 && linesOf(points.map(([, y]) => y)).length * linesOf(points.map(([x]) => x)).length === count) {
    const nn = String(count).padStart(2, "0");
    if (near(pitch, 2, 0.1)) out.push({ lib: "Connector_JST", name: `JST_PH_B${count}B-PH-K_1x${nn}_P2.00mm_Vertical`, rule: "jst", from: "name", layout: row(count, 2), tolerance: 0.25 });
    if (near(pitch, 2.5, 0.1)) out.push({ lib: "Connector_JST", name: `JST_XH_B${count}B-XH-A_1x${nn}_P2.50mm_Vertical`, rule: "jst", from: "name", layout: row(count, 2.5), tolerance: 0.25 });
  }
  if (jst && smd && count >= 4 && count <= 11) {
    const signals = count - 2;
    const nn = String(signals).padStart(2, "0");
    out.push({ lib: "Connector_JST", name: `JST_SH_SM${nn}B-SRSS-TB_1x${nn}-1MP_P1.00mm_Horizontal`, rule: "jst", from: "name", layout: jstSh(signals), tolerance: 0.3 });
  }
  if (/USB/.test(name) && /(?:^|[^A-Z])C(?![A-Z])|TYPE-?C|USBC|USB-C/.test(name.replace(/USB/g, " USB "))) {
    out.push(fixed("USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal", "usb", { unnamed: true }));
  }
  if (/USB/.test(name) && /MICRO/.test(name)) {
    out.push(fixed("USB_Micro-B_Molex_47346-0001", "usb", { unnamed: true }));
  }

  // Pin headers and sockets: through-hole pins on a 2.54, 2.00 or 1.27 mm grid, one or two rows.
  if (tht && (count >= 2 || /HEADER|PINHD|1X0?1(?![0-9])/.test(name)) && count <= 80 && !jst && !out.length) {
    const xs = linesOf(points.map(([x]) => x), 0.3);
    const ys = linesOf(points.map(([, y]) => y), 0.3);
    const [rows, along] = xs.length <= 2 && ys.length === Math.ceil(count / xs.length) ? [xs.length, ys.length] : ys.length <= 2 && xs.length === Math.ceil(count / ys.length) ? [ys.length, xs.length] : [0, 0];
    const grid = pitch ?? 2.54;
    const step = PIN_HEADER_PITCHES.find((value) => near(grid, value, 0.15));
    if (rows && step && rows * along === count && along <= 40) {
      const socket = /FEMALE|SOCKET|RECEPT|(?:^|_)F(?:\d|_|$)|FEM/.test(name);
      const kind = socket ? "PinSocket" : "PinHeader";
      const p = step.toFixed(2);
      const named = /(?:^|[^A-Z0-9])[12]X\d|HEADER|PINHD|CONN|(?:^|[^A-Z])M\d+|PIN/.test(name);
      out.push({ lib: `Connector_${kind}_${p}mm`, name: `${kind}_${rows}x${String(along).padStart(2, "0")}_P${p}mm_Vertical`, rule: "header", from: named ? "name" : "pads", layout: header(rows, count, step, socket), tolerance: 0.3 });
    }
  }

  // Integrated circuits: two rows (SO families, DFN) or four sides (QFN, QFP), with an exposed pad set aside.
  if (smd && count >= 6) {
    const ep = exposed(copper);
    const perimeter = copper.filter((pad) => !ep.includes(pad));
    const at = perimeter.map((pad) => [pad.x, pad.y] as Point);
    const perimeterPitch = pitchOf(at);
    const xs = linesOf(at.map(([x]) => x));
    const ys = linesOf(at.map(([, y]) => y));
    const n = perimeter.length;
    const named = (pattern: RegExp) => pattern.test(name);
    // Two rows: across them, the half-span.
    if (perimeterPitch && (xs.length === 2 || ys.length === 2) && n % 2 === 0) {
      const across = xs.length === 2 ? Math.abs(xs[1]! - xs[0]!) / 2 : Math.abs(ys[1]! - ys[0]!) / 2;
      if (ep.length && n <= 16) {
        for (const model of DFN_MODELS) {
          const ic = parseIc(model)!;
          if (ic.count !== n || !near(ic.pitch, perimeterPitch, 0.03)) continue;
          const half = ic.body / 2 - 0.05;
          if (near(half, across, 0.35)) out.push({ lib: "Package_DFN_QFN", name: model, rule: "dfn", from: named(/DFN|SON|WSON|USON|VSON/) ? "name" : "pads", layout: [...dual(n, ic.pitch, half), { n: "EP", x: 0, y: 0, ep: true }], tolerance: 0.2 });
        }
      }
      for (const family of SO_FAMILIES) {
        for (const model of family.models) {
          const ic = parseIc(model)!;
          if (ic.count !== n || !near(ic.pitch, perimeterPitch, 0.03) || !near(family.half, across, 0.45)) continue;
          out.push({ lib: "Package_SO", name: model, rule: "so", from: family.pattern.test(name) ? "name" : "pads", layout: dual(n, ic.pitch, family.half), tolerance: 0.4 });
        }
      }
    }
    // Four sides.
    if (perimeterPitch && n % 4 === 0 && xs.length > 2 && ys.length > 2) {
      const extent = Math.max(...at.map(([x]) => Math.abs(x - centreOf(at)[0])));
      const qfp = named(/QFP/);
      const qfn = named(/QFN|MLF|MLP|LFCSP|DFN/) || ep.length > 0;
      for (const model of QFN_MODELS) {
        const ic = parseIc(model)!;
        if (qfp || ic.count !== n || !near(ic.pitch, perimeterPitch, 0.03)) continue;
        const half = ic.body / 2 - 0.05;
        if (near(half, extent, 0.4)) out.push({ lib: "Package_DFN_QFN", name: model, rule: "qfn", from: named(/QFN|MLF|MLP|LFCSP/) ? "name" : "pads", layout: [...quad(n, ic.pitch, half), { n: "EP", x: 0, y: 0, ep: true }], tolerance: 0.25 });
      }
      for (const model of QFP_MODELS) {
        const ic = parseIc(model)!;
        if ((qfn && !qfp) || ic.count !== n || !near(ic.pitch, perimeterPitch, 0.03)) continue;
        if (model.startsWith("TQFP") !== /TQFP/.test(name) && /[LT]QFP/.test(name)) continue;
        const half = ic.body / 2 + 0.6625;
        if (near(half, extent, 0.5)) out.push({ lib: "Package_QFP", name: model, rule: "qfp", from: qfp ? "name" : "pads", layout: quad(n, ic.pitch, half), tolerance: 0.3 });
      }
    }
  }
  return out;
}

/** The standard model for a package, if a rule names one and its footprint lies on the package's pads. */
export function matchPackage(shape: PackageShape): PackageMatch {
  if (shape.pads.length === 0 || shape.pads.length > 200 || BOARD_FEATURE.test(shape.name)) return { model: null, why: "no_rule" };
  const candidates = candidatesFor(shape);
  if (candidates.length === 0) return { model: null, why: "no_rule" };
  let best: { candidate: Candidate; fit: Fit } | null = null;
  for (const candidate of candidates) {
    const ep = exposed(shape.pads);
    const withEp = candidate.layout.some((pad) => pad.ep);
    // An exposed pad (and its split copies) is set aside on both sides: the perimeter places the part.
    const own = distinct(shape.pads.filter((pad) => !(withEp && ep.includes(pad)))).map((pad) => ({ n: polarised(pad.name, candidate.polarity), x: pad.x, y: pad.y }));
    const layout = distinct(candidate.layout.filter((pad) => !pad.ep));
    const fit = fitLayout(own, layout, !candidate.unnamed);
    if (!fit || fit.fit > (candidate.tolerance ?? 0.3)) continue;
    // Among acceptable candidates: pin 1 agreeing first, then the closest.
    if (!best || (fit.pin1 && !best.fit.pin1) || (fit.pin1 === best.fit.pin1 && fit.fit < best.fit.fit - 1e-6)) best = { candidate, fit };
  }
  if (!best) return { model: null, why: "no_fit" };
  const { candidate, fit } = best;
  return {
    model: {
      path: `${MODEL_DIR}/${candidate.lib}.3dshapes/${candidate.name}.step`,
      footprint: `${candidate.lib}:${candidate.footprint ?? candidate.name}`,
      rule: candidate.rule,
      from: candidate.from,
      pads: shape.pads.length,
      pitch: pitchOf(shape.pads.map((pad) => [pad.x, pad.y])),
      fit: fit.fit,
      pin1: !candidate.unnamed && fit.pin1,
      at: fit.at,
      rotation: fit.rotation,
      rules: PACKAGE_MODEL_RULES,
    },
  };
}

/** Every model the rules can name, with KiCad's footprint layout for it — for the check against KiCad's own library. */
export function catalogue(): { model: string; footprint: string; layout: { n: string; x: number; y: number }[] }[] {
  const out: { model: string; footprint: string; layout: { n: string; x: number; y: number }[] }[] = [];
  const add = (lib: string, name: string, layout: LayoutPad[], footprint = name) => out.push({ model: `${lib}.3dshapes/${name}.step`, footprint: `${lib}/${footprint}`, layout });
  for (const family of Object.values(CHIP_MODELS)) for (const size of family.sizes) add(family.lib, `${family.prefix}_${size}_${CHIP[size]!.metric}Metric`, two(CHIP[size]!.half));
  for (const model of Object.values(TANTALUM)) add("Capacitor_Tantalum_SMD", model.name, two(model.half));
  for (const diode of DIODES) add("Diode_SMD", diode.name, two(diode.half));
  for (const sot of SOT) add("Package_TO_SOT_SMD", sot.name, sot.layout, sot.footprint);
  for (const family of SO_FAMILIES) for (const model of family.models) add("Package_SO", model, dual(parseIc(model)!.count, parseIc(model)!.pitch, family.half));
  for (const model of QFN_MODELS) add("Package_DFN_QFN", model, quad(parseIc(model)!.count, parseIc(model)!.pitch, parseIc(model)!.body / 2 - 0.05));
  for (const model of DFN_MODELS) add("Package_DFN_QFN", model, dual(parseIc(model)!.count, parseIc(model)!.pitch, parseIc(model)!.body / 2 - 0.05));
  for (const model of QFP_MODELS) add("Package_QFP", model, quad(parseIc(model)!.count, parseIc(model)!.pitch, parseIc(model)!.body / 2 + 0.6625));
  for (const rows of [1, 2]) for (const count of [1, 2, 4, 10, 20, 40]) for (const p of ["2.54", "2.00", "1.27"]) for (const kind of ["PinHeader", "PinSocket"]) add(`Connector_${kind}_${p}mm`, `${kind}_${rows}x${String(count).padStart(2, "0")}_P${p}mm_Vertical`, header(rows, rows * count, Number(p), kind === "PinSocket"));
  for (const count of [2, 4, 6, 8, 16]) add("Connector_JST", `JST_PH_B${count}B-PH-K_1x${String(count).padStart(2, "0")}_P2.00mm_Vertical`, row(count, 2));
  for (const count of [2, 4, 6, 8, 16]) add("Connector_JST", `JST_XH_B${count}B-XH-A_1x${String(count).padStart(2, "0")}_P2.50mm_Vertical`, row(count, 2.5));
  for (const count of [2, 4, 6, 8]) add("Connector_JST", `JST_SH_SM${String(count).padStart(2, "0")}B-SRSS-TB_1x${String(count).padStart(2, "0")}-1MP_P1.00mm_Horizontal`, jstSh(count));
  for (const [name, entry] of Object.entries(FIXED)) add(entry.lib, name, entry.layout);
  for (const [model, half] of Object.values(CANS)) add("Capacitor_SMD", model, two(half));
  for (const [d, spacings] of Object.entries(RADIAL)) for (const spacing of spacings) add("Capacitor_THT", `CP_Radial_D${d}mm_P${spacing.toFixed(2)}mm`, row(2, spacing));
  return out;
}
