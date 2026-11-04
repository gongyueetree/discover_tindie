/**
 * EasyEDA (Standard) schematic JSON as the viewer's drawing primitives (the same SheetDrawing the
 * KiCad / EAGLE / Altium drawers produce), so an EasyEDA project shows its own schematic: symbols
 * with their graphics, pins with names and numbers, wires, junctions, net flags and ports, notes,
 * section boxes and the sheet frame. Tindie addition; eelib has no EasyEDA drawer.
 *
 * Format: a sheet is `{ head: { docType: "1" }, canvas, shape: string[] }`; a project export is
 * `{ docType: "5", schematics: [{ title, dataStr: <sheet> }] }`. Each shape is a "~"-separated
 * record. Inside a component (LIB, sub-shapes joined by "#@$") and a net flag (F, parts joined by
 * "^^") coordinates are already absolute and rotated. Units are 10 mil (0.254 mm), y down.
 * Nothing is guessed: a record this reader does not draw is counted in `skipped`.
 */
import type { Ink, Path, SheetDrawing, Text, SymbolHit } from "@/vendor/eelib/kicad-schematic";

const MM = 0.254;
const MARGIN = 5;
const decoder = new TextDecoder();

type Raw = {
  paths: Path[];
  circles: { x: number; y: number; r: number; ink: Ink; w: number; fill?: "body" | "ink" }[];
  texts: Text[];
  symbols: SymbolHit[];
  nets: Set<string>;
  skipped: Record<string, number>;
};

const num = (v: string | undefined, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const width = (v: string | undefined) => Math.max(0.1, num(v, 1) * MM * 0.6);
const filled = (v: string | undefined) => !!v && !/^(none|transparent)?$/i.test(v.trim());
const skip = (raw: Raw, what: string) => (raw.skipped[what] = (raw.skipped[what] ?? 0) + 1);

/** "x1 y1 x2 y2 …" */
function points(list: string): number[] {
  return list
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

/** SVG path data (M L H V A C Q Z, absolute and relative) as polylines; curves and arcs are sampled. */
export function svgPolylines(d: string): number[][] {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: number[][] = [];
  let cur: number[] = [];
  let x = 0,
    y = 0,
    sx = 0,
    sy = 0,
    cmd = "";
  let i = 0;
  const n = () => Number(tokens[i++]);
  const flush = () => {
    if (cur.length >= 4) out.push(cur);
    cur = [];
  };
  const lineTo = (nx: number, ny: number) => {
    if (!cur.length) cur.push(x, y);
    cur.push(nx, ny);
    x = nx;
    y = ny;
  };
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": {
        flush();
        const nx = n() + (rel ? x : 0),
          ny = n() + (rel ? y : 0);
        x = sx = nx;
        y = sy = ny;
        cur.push(x, y);
        cmd = rel ? "l" : "L";
        break;
      }
      case "L":
        lineTo(n() + (rel ? x : 0), n() + (rel ? y : 0));
        break;
      case "H":
        lineTo(n() + (rel ? x : 0), y);
        break;
      case "V":
        lineTo(x, n() + (rel ? y : 0));
        break;
      case "Z":
        lineTo(sx, sy);
        flush();
        break;
      case "C": {
        const [x1, y1, x2, y2, ex, ey] = [n(), n(), n(), n(), n(), n()].map((v, k) => v + (rel ? (k % 2 ? y : x) : 0));
        const [x0, y0] = [x, y];
        for (let t = 1; t <= 12; t++) {
          const s = t / 12,
            a = (1 - s) ** 3,
            b = 3 * (1 - s) ** 2 * s,
            c = 3 * (1 - s) * s * s,
            e = s ** 3;
          lineTo(a * x0 + b * x1 + c * x2 + e * ex, a * y0 + b * y1 + c * y2 + e * ey);
        }
        break;
      }
      case "Q": {
        const [x1, y1, ex, ey] = [n(), n(), n(), n()].map((v, k) => v + (rel ? (k % 2 ? y : x) : 0));
        const [x0, y0] = [x, y];
        for (let t = 1; t <= 10; t++) {
          const s = t / 10;
          lineTo((1 - s) ** 2 * x0 + 2 * (1 - s) * s * x1 + s * s * ex, (1 - s) ** 2 * y0 + 2 * (1 - s) * s * y1 + s * s * ey);
        }
        break;
      }
      case "A": {
        const rx0 = Math.abs(n()),
          ry0 = Math.abs(n()),
          rot = (n() * Math.PI) / 180,
          large = n(),
          sweep = n();
        const ex = n() + (rel ? x : 0),
          ey = n() + (rel ? y : 0);
        arcTo(x, y, rx0, ry0, rot, !!large, !!sweep, ex, ey).forEach(([px, py]) => lineTo(px, py));
        x = ex;
        y = ey;
        break;
      }
      default:
        i++; // unknown command: skip its argument
    }
  }
  flush();
  return out;
}

/** SVG elliptical arc (endpoint form) sampled into points, end point included. */
function arcTo(x1: number, y1: number, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, x2: number, y2: number): number[][] {
  if (!rx || !ry) return [[x2, y2]];
  const cos = Math.cos(phi),
    sin = Math.sin(phi);
  const dx = (x1 - x2) / 2,
    dy = (y1 - y2) / 2;
  const xp = cos * dx + sin * dy,
    yp = -sin * dx + cos * dy;
  const lambda = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const sign = large === sweep ? -1 : 1;
  const num0 = rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp;
  const coef = sign * Math.sqrt(Math.max(0, num0 / (rx * rx * yp * yp + ry * ry * xp * xp)));
  const cxp = (coef * rx * yp) / ry,
    cyp = (-coef * ry * xp) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2,
    cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = angle(1, 0, (xp - cxp) / rx, (yp - cyp) / ry);
  let dt = angle((xp - cxp) / rx, (yp - cyp) / ry, (-xp - cxp) / rx, (-yp - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const steps = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 12)));
  const pts: number[][] = [];
  for (let k = 1; k <= steps; k++) {
    const t = t1 + (dt * k) / steps;
    pts.push([cos * rx * Math.cos(t) - sin * ry * Math.sin(t) + cx, sin * rx * Math.cos(t) + cos * ry * Math.sin(t) + cy]);
  }
  return pts;
}

/** EasyEDA font sizes are CSS sizes ("7pt", "9pt", "1.2em"); the viewer's size is the glyph height in mm. */
function fontSize(v: string | undefined) {
  const m = (v || "").match(/^([\d.]+)\s*(pt|px)?$/);
  const pt = m ? (m[2] === "px" ? Number(m[1]) * 0.75 : Number(m[1])) : 7;
  return Math.max(0.8, pt * 1.333 * MM * 0.72);
}

/** Text with EasyEDA's rotation (0/90/180/270, SVG sense) mapped to the viewer's readable 0 / 90. */
function pushText(raw: Raw, x: number, y: number, rotation: number, anchor: string, text: string, size: string | undefined, ink: Ink) {
  if (!text.trim()) return;
  const r = ((Math.round(rotation / 90) * 90) % 360 + 360) % 360;
  let h: Text["h"] = anchor === "middle" ? "middle" : anchor === "end" ? "end" : "start";
  const flip = (a: Text["h"]): Text["h"] => (a === "start" ? "end" : a === "end" ? "start" : a);
  if (r === 180 || r === 90) h = flip(h);
  raw.texts.push({ x, y, t: text, size: fontSize(size), angle: r === 90 || r === 270 ? 90 : 0, h, v: "bottom", ink });
}

/** A drawing record (R, E, PL, PG, PT, A, T) shared by components, flags and the sheet itself. */
function drawShape(raw: Raw, rec: string, ink: Ink, textInk: (mark: string) => Ink | null): void {
  const f = rec.split("~");
  switch (f[0]) {
    case "R": {
      const [x, y, w, h] = [num(f[1]), num(f[2]), num(f[5]), num(f[6])];
      if (!w || !h) return;
      raw.paths.push({ d: [x, y, x + w, y, x + w, y + h, x, y + h, x, y], ink, w: width(f[8]), closed: true, ...(filled(f[10]) && ink === "body" ? { fill: "body" as const } : {}) });
      return;
    }
    case "E": {
      const [cx, cy, rx, ry] = [num(f[1]), num(f[2]), num(f[3]), num(f[4])];
      if (!rx) return;
      if (Math.abs(rx - ry) < 1e-6) raw.circles.push({ x: cx, y: cy, r: rx, ink, w: width(f[6]), ...(filled(f[8]) ? { fill: (rx < 3 ? "ink" : "body") as "ink" | "body" } : {}) });
      else {
        const d: number[] = [];
        for (let k = 0; k <= 36; k++) d.push(cx + rx * Math.cos((k * Math.PI) / 18), cy + ry * Math.sin((k * Math.PI) / 18));
        raw.paths.push({ d, ink, w: width(f[6]), closed: true });
      }
      return;
    }
    case "PL":
    case "PG": {
      const d = points(f[1]);
      if (d.length < 4) return;
      if (f[0] === "PG") d.push(d[0], d[1]);
      raw.paths.push({ d, ink, w: width(f[3]), ...(f[0] === "PG" ? { closed: true as const } : {}), ...(f[0] === "PG" && filled(f[5]) ? { fill: "ink" as const } : {}) });
      return;
    }
    case "PT":
      for (const d of svgPolylines(f[1])) raw.paths.push({ d, ink, w: width(f[3]), ...(filled(f[5]) && /z\s*$/i.test(f[1].trim()) ? { fill: "ink" as const } : {}) });
      return;
    case "A":
      for (const d of svgPolylines(f[1])) raw.paths.push({ d, ink, w: width(f[4]) });
      return;
    case "T": {
      // T~mark~x~y~rotation~color~font~size~weight~style~baseline~type~text~visible~anchor~id
      const as = textInk(f[1]);
      if (!as || f[13] === "0") return;
      pushText(raw, num(f[2]), num(f[3]), num(f[4]), f[14], f[12] ?? "", f[7], as);
      return;
    }
    default:
      skip(raw, f[0] || "empty");
  }
}

/** A pin: P~show~…~x~y~rot~id ^^ dot ^^ path~color ^^ name ^^ number ^^ inverted dot ^^ clock. */
function drawPin(raw: Raw, rec: string) {
  const parts = rec.split("^^");
  const head = parts[0].split("~");
  if (head[1] === "none") return;
  const path = (parts[2] ?? "").split("~")[0];
  for (const d of svgPolylines(path)) raw.paths.push({ d, ink: "pin", w: 0.15 });
  for (const [k, ink] of [
    [3, "pinName"],
    [4, "pinNumber"],
  ] as const) {
    const t = (parts[k] ?? "").split("~");
    if (t[0] === "1") pushText(raw, num(t[1]), num(t[2]), num(t[3]), t[5], t[4] ?? "", t[7], ink);
  }
  const dot = (parts[5] ?? "").split("~");
  if (dot[0] === "1") raw.circles.push({ x: num(dot[1]), y: num(dot[2]), r: 3, ink: "pin", w: 0.15 });
  const clock = (parts[6] ?? "").split("~");
  if (clock[0] === "1") for (const d of svgPolylines(clock[1] ?? "")) raw.paths.push({ d, ink: "pin", w: 0.15 });
}

function bounds(raw: Raw, from: number) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of raw.paths.slice(from))
    for (let k = 0; k < p.d.length; k += 2) {
      x0 = Math.min(x0, p.d[k]);
      x1 = Math.max(x1, p.d[k]);
      y0 = Math.min(y0, p.d[k + 1]);
      y1 = Math.max(y1, p.d[k + 1]);
    }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

function drawSheet(shapes: string[], name: string, file: string): SheetDrawing {
  const raw: Raw = { paths: [], circles: [], texts: [], symbols: [], nets: new Set(), skipped: {} };
  for (const shape of shapes) {
    const kind = shape.slice(0, shape.indexOf("~"));
    if (kind === "LIB") {
      const parts = shape.split("#@$");
      const head = parts[0].split("~");
      const frame = /frame/i.test(head[6] ?? "") || /`?package`NONE`/.test(head[3] ?? "") && parts.some((p) => /frame_tick/.test(p));
      const from = raw.paths.length;
      let reference = "",
        value = "";
      for (const sub of parts.slice(1)) {
        const tag = sub.slice(0, sub.indexOf("~"));
        if (tag === "P") drawPin(raw, sub);
        else if (tag === "Pimage" || tag === "I") skip(raw, "image");
        else {
          if (tag === "T") {
            const t = sub.split("~");
            if (t[1] === "P") reference = t[12] ?? "";
            if (t[1] === "N") value = t[12] ?? "";
          }
          drawShape(raw, sub, frame ? "frame" : "body", (mark) => (frame ? "frame" : mark === "P" ? "field" : mark === "N" ? "fieldOther" : "note"));
        }
      }
      if (!frame) {
        const b = bounds(raw, from);
        const para = Object.fromEntries(
          (head[3] ?? "").split("`").reduce<string[][]>((acc, v, k, all) => (k % 2 ? acc : [...acc, [v, all[k + 1] ?? ""]]), []),
        );
        if (b) raw.symbols.push({ reference: reference || para.pre || "", value: value || para["Manufacturer Part"] || para.name || "", box: b as [number, number, number, number] });
      }
    } else if (kind === "W" || kind === "B") {
      const f = shape.split("~");
      const d = points(f[1]);
      if (d.length >= 4) raw.paths.push({ d, ink: kind === "W" ? "wire" : "bus", w: kind === "W" ? 0.15 : 0.3 });
    } else if (kind === "J") {
      const f = shape.split("~");
      raw.circles.push({ x: num(f[1]), y: num(f[2]), r: Math.max(1.5, num(f[3], 2)), ink: "junction", w: 0, fill: "ink" });
    } else if (kind === "O") {
      const f = shape.split("~");
      for (const d of svgPolylines(f[4] ?? "")) raw.paths.push({ d, ink: "noConnect", w: 0.15 });
    } else if (kind === "F") {
      // F~type~x~y~rot~id ^^ mark ^^ name~color~x~y~rot~anchor~visible~font~size ^^ shapes…
      const parts = shape.split("^^");
      const type = parts[0].split("~")[1] ?? "";
      const label = (parts[2] ?? "").split("~");
      const ink: Ink = /netPort/i.test(type) ? "global" : "label";
      for (const sub of parts.slice(3)) drawShape(raw, sub, ink, () => ink);
      if (label[0]) {
        raw.nets.add(label[0]);
        if (label[6] !== "0") pushText(raw, num(label[2]), num(label[3]), num(label[4]), label[5], label[0], label[8], ink);
      }
    } else if (kind === "N") {
      // N~x~y~rotation~color~name~id~anchor~px~py~font~size
      const f = shape.split("~");
      if (f[5]) {
        raw.nets.add(f[5]);
        pushText(raw, num(f[1]), num(f[2]), num(f[3]), f[7], f[5], f[11], "label");
      }
    } else if (["R", "E", "PL", "PG", "PT", "A", "T"].includes(kind)) drawShape(raw, shape, "note", () => "note");
    else skip(raw, kind || "empty");
  }

  // Units → mm, and the drawing moved so it starts at the page margin (the viewer frames 0,0 → paper).
  const all = bounds(raw, 0) ?? [0, 0, 0, 0];
  const ox = all[0],
    oy = all[1];
  const X = (v: number) => Math.round(((v - ox) * MM + MARGIN) * 1000) / 1000;
  const Y = (v: number) => Math.round(((v - oy) * MM + MARGIN) * 1000) / 1000;
  const paths = raw.paths.map((p) => ({ ...p, d: p.d.map((v, k) => (k % 2 ? Y(v) : X(v))) }));
  const circles = raw.circles.map((c) => ({ ...c, x: X(c.x), y: Y(c.y), r: c.r * MM }));
  const texts = raw.texts.map((t) => ({ ...t, x: X(t.x), y: Y(t.y) }));
  const symbols = raw.symbols.map((s) => ({ ...s, box: [X(s.box[0]), Y(s.box[1]), X(s.box[2]), Y(s.box[3])] as [number, number, number, number] }));
  return {
    file,
    name,
    paper: { size: "EasyEDA", width: (all[2] - all[0]) * MM + 2 * MARGIN, height: (all[3] - all[1]) * MM + 2 * MARGIN },
    titleBlock: { title: name, date: "", rev: "", company: "", comments: [] },
    frame: false,
    paths,
    circles,
    texts,
    symbols,
    sheets: [],
    nets: [...raw.nets].sort(),
    skipped: raw.skipped,
  } as SheetDrawing;
}

/** The sheets of an EasyEDA Standard schematic JSON (a sheet or a project export); [] for anything else. */
export function drawEasyEdaSchematic(source: string, file: string): SheetDrawing[] {
  let doc: any;
  try {
    doc = JSON.parse(source.replace(/^﻿/, ""));
  } catch {
    return [];
  }
  if (!doc || typeof doc !== "object") return [];
  const stem = file.split("/").pop()!.replace(/\.json$/i, "");
  if (Array.isArray(doc.schematics))
    return doc.schematics.flatMap((s: any, k: number) => {
      const data = typeof s?.dataStr === "string" ? safeJson(s.dataStr) : s?.dataStr;
      return Array.isArray(data?.shape) ? [drawSheet(data.shape, String(s.title || `${stem} ${k + 1}`), file)] : [];
    });
  const type = String(doc.head?.docType ?? doc.docType ?? "");
  if (type === "1" && Array.isArray(doc.shape)) return [drawSheet(doc.shape, String(doc.title || doc.head?.title || stem), file)];
  return [];
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Every EasyEDA Standard schematic among the project's files, in file order. */
export function easyEdaSheets(inputs: readonly { path: string; bytes: Uint8Array }[]): SheetDrawing[] {
  return inputs
    .filter((a) => /\.json$/i.test(a.path) && a.bytes.length < 30 * 1024 * 1024)
    .flatMap((a) => {
      const head = decoder.decode(a.bytes.subarray(0, 4000));
      if (!/"(schematics|docType)"/.test(head) || /"docType"\s*:\s*"(3|4|14)"/.test(head) && !/"schematics"/.test(head)) return [];
      return drawEasyEdaSchematic(decoder.decode(a.bytes), a.path);
    });
}
