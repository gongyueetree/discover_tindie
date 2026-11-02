import { child, children, list, parseXml, type XmlElement } from "@/vendor/canon/lib/eda/eagle-xml";
import { arcPolyline, deviceName, librariesOf, libraryFor, place, rotOf, shownPinName, type Rot } from "@/vendor/canon/lib/eda/eagle";
import type { Circle, Ink, Path, SheetDrawing, SymbolHit, Text } from "./kicad-schematic";

/**
 * An EAGLE schematic's sheets as the viewer's drawing primitives (the same
 * `SheetDrawing` a KiCad sheet gives, kicad-schematic.ts): each instance drawn
 * from the symbol its schematic embeds — placed, turned and mirrored as EAGLE
 * places it — with its pins (names and pad numbers as EAGLE shows them), its
 * name and value (a smashed part's where it was moved to), the nets' wires,
 * junctions and labels, the buses, the sheet's own drawing and EAGLE's frames.
 *
 * EAGLE's frame is y up and has no page: each sheet is laid out on a page as
 * large as its frame (a FRAME part, or a `frame` it draws), else its drawing
 * with a margin, and the viewer draws no KiCad page border (`frame: false`).
 * Texts are kept readable, as EAGLE shows them. Nothing is inferred: an item
 * this reader does not draw is counted in `skipped`.
 */
type XY = [number, number];

const LINE = 0.1524;
const JUNCTION_R = 0.4572;
const PAD_TEXT = 1.27;
const PIN_TEXT = 1.778;
const MARGIN = 10;
const FRAME_BORDER = 3.81;
const PIN_LENGTH: Record<string, number> = { point: 0, short: 2.54, middle: 5.08, long: 7.62 };

const num = (value: string | undefined, fallback = 0) => {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
};
const round = (value: number) => Math.round(value * 1000) / 1000;

/** A placement: where the item's origin is and how it is turned (EAGLE's frame). */
type Frame = { origin: XY; rot: Rot };
const IDENTITY: Frame = { origin: [0, 0], rot: { degrees: 0, mirror: false, spin: false } };
const at = (frame: Frame, p: XY): XY => place(frame.origin, frame.rot, p);
/** A direction turned as the frame turns it (no translation). */
const turn = (frame: Frame, v: XY): XY => place([0, 0], frame.rot, v);

/** Ink by EAGLE's schematic layer. */
const LAYER_INK: Record<number, Ink> = { 91: "wire", 92: "bus", 93: "pin", 94: "body", 95: "field", 96: "field", 97: "note", 98: "note" };

type Raw = {
  paths: (Omit<Path, "d"> & { pts: XY[] })[];
  circles: (Omit<Circle, "x" | "y"> & { c: XY })[];
  texts: (Omit<Text, "x" | "y"> & { a: XY })[];
  symbols: { reference: string; value: string; pts: XY[] }[];
  frames: { a: XY; b: XY; columns: number; rows: number; border: boolean }[];
  skipped: Record<string, number>;
};

/** How a text is drawn readable: its anchor kept, its reading direction 0 or 90, its alignment turned with it. */
function readable(along: XY, up: XY, align: string | undefined): Pick<Text, "angle" | "h" | "v"> {
  const value = (align ?? "bottom-left").toLowerCase();
  const [vertical, horizontal] = value === "center" ? ["center", "center"] : value.split("-");
  let h: Text["h"] = horizontal === "center" ? "middle" : horizontal === "right" ? "end" : "start";
  let v: Text["v"] = vertical === "top" ? "top" : vertical === "center" ? "middle" : "bottom";
  const angle: 0 | 90 = Math.abs(along[0]) >= Math.abs(along[1]) ? 0 : 90;
  const drawAlong: XY = angle === 0 ? [1, 0] : [0, 1];
  const drawUp: XY = angle === 0 ? [0, 1] : [-1, 0];
  if (along[0] * drawAlong[0] + along[1] * drawAlong[1] < 0) h = h === "start" ? "end" : h === "end" ? "start" : h;
  if (up[0] * drawUp[0] + up[1] * drawUp[1] < 0) v = v === "top" ? "bottom" : v === "bottom" ? "top" : v;
  return { angle, h, v };
}

/** A text item (`<text>`, a smashed `<attribute>`) placed by `frame`, with its own rotation and alignment. */
function pushText(out: Raw, frame: Frame, item: XmlElement, t: string, ink: Ink) {
  if (!t) return;
  const own = rotOf(item.attrs.rot);
  const local: Frame = { origin: [0, 0], rot: own };
  const along = turn(frame, turn(local, [1, 0]));
  const up = turn(frame, turn(local, [0, 1]));
  out.texts.push({ a: at(frame, [num(item.attrs.x), num(item.attrs.y)]), t, size: round(num(item.attrs.size, PIN_TEXT)), ink, ...readable(along, up, item.attrs.align) });
}

/** A drawn item (wire, circle, rectangle, polygon) placed by `frame`; the points it covers. */
function pushShape(out: Raw, frame: Frame, item: XmlElement, ink: Ink, net?: string): XY[] {
  switch (item.name) {
    case "wire": {
      const a: XY = [num(item.attrs.x1), num(item.attrs.y1)];
      const b: XY = [num(item.attrs.x2), num(item.attrs.y2)];
      const curve = num(item.attrs.curve, 0);
      const pts = (curve ? arcPolyline(a, b, curve, 12) : [a, b]).map((p) => at(frame, p));
      out.paths.push({ pts, ink, w: round(num(item.attrs.width, LINE) || LINE), ...(net ? { net } : {}), ...(item.attrs.style && item.attrs.style !== "continuous" ? { dash: item.attrs.style === "shortdash" ? "dot" : item.attrs.style === "dashdot" ? "dash_dot" : "dash" } : {}) });
      return pts;
    }
    case "circle": {
      const c = at(frame, [num(item.attrs.x), num(item.attrs.y)]);
      const r = num(item.attrs.radius);
      const width = num(item.attrs.width, LINE);
      out.circles.push({ c, r: round(r), ink, w: round(width || LINE), ...(width === 0 ? { fill: "ink" as const } : {}) });
      return [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]];
    }
    case "rectangle": {
      const [x1, y1, x2, y2] = [num(item.attrs.x1), num(item.attrs.y1), num(item.attrs.x2), num(item.attrs.y2)];
      const c: XY = [(x1 + x2) / 2, (y1 + y2) / 2];
      const own: Frame = { origin: c, rot: rotOf(item.attrs.rot) };
      const pts = ([[x1, y1], [x2, y1], [x2, y2], [x1, y2]] as XY[]).map(([x, y]) => at(frame, at(own, [x - c[0], y - c[1]])));
      out.paths.push({ pts, ink, w: LINE, closed: true, fill: "ink" });
      return pts;
    }
    case "polygon": {
      const vertices = children(item, "vertex").map((vertex) => ({ p: [num(vertex.attrs.x), num(vertex.attrs.y)] as XY, curve: num(vertex.attrs.curve, 0) }));
      const loop: XY[] = vertices.flatMap((vertex, index) => {
        const next = vertices[(index + 1) % vertices.length]!;
        return vertex.curve ? arcPolyline(vertex.p, next.p, vertex.curve, 8).slice(0, -1) : [vertex.p];
      });
      const pts = loop.map((p) => at(frame, p));
      if (pts.length >= 3) out.paths.push({ pts, ink, w: round(num(item.attrs.width, LINE) || LINE), closed: true, fill: "ink" });
      return pts;
    }
    case "frame": {
      const a = at(frame, [num(item.attrs.x1), num(item.attrs.y1)]);
      const b = at(frame, [num(item.attrs.x2), num(item.attrs.y2)]);
      const border = ["border-left", "border-top", "border-right", "border-bottom"].some((side) => item.attrs[side] !== "no");
      out.frames.push({ a, b, columns: Math.max(0, Math.round(num(item.attrs.columns, 0))), rows: Math.max(0, Math.round(num(item.attrs.rows, 0))), border });
      return [a, b];
    }
    default:
      // Descriptions are not drawn; anything else this reader does not draw is counted.
      if (item.name !== "description") out.skipped[item.name] = (out.skipped[item.name] ?? 0) + 1;
      return [];
  }
}

type PartInfo = { name: string; value: string; packaged: boolean; gates: number; symbolOf: (gate: string) => XmlElement | undefined; attributes: Record<string, string> };

/** One instance (a gate of a part) with its symbol, pins, name and value. */
function drawInstance(out: Raw, instance: XmlElement, part: PartInfo) {
  const gate = instance.attrs.gate ?? "";
  const symbol = part.symbolOf(gate);
  if (!symbol) {
    out.skipped.symbol_without_definition = (out.skipped.symbol_without_definition ?? 0) + 1;
    return;
  }
  const frame: Frame = { origin: [num(instance.attrs.x), num(instance.attrs.y)], rot: rotOf(instance.attrs.rot) };
  const smashed = instance.attrs.smashed === "yes";
  const shownName = part.gates > 1 && !gate.startsWith("G$") ? `${part.name}${gate}` : part.name;
  const covered: XY[] = [];
  for (const item of symbol.children) {
    if (item.name === "pin") {
      const p: XY = [num(item.attrs.x), num(item.attrs.y)];
      const own: Frame = { origin: p, rot: rotOf(item.attrs.rot) };
      const length = PIN_LENGTH[item.attrs.length ?? "long"] ?? 7.62;
      const start = at(frame, p);
      const end = at(frame, at(own, [length, 0]));
      const dir = turn(frame, turn({ origin: [0, 0], rot: own.rot }, [1, 0]));
      const up: XY = [-dir[1], dir[0]];
      covered.push(start, end);
      const fn = item.attrs.function ?? "none";
      const bubble = fn === "dot" || fn === "dotclk" ? 0.3175 : 0;
      if (length > 0) out.paths.push({ pts: [start, [end[0] - dir[0] * bubble * 2, end[1] - dir[1] * bubble * 2]], ink: "pin", w: LINE });
      if (bubble) out.circles.push({ c: [end[0] - dir[0] * bubble, end[1] - dir[1] * bubble], r: bubble, ink: "pin", w: LINE });
      if (fn === "clk" || fn === "dotclk") out.paths.push({ pts: [[end[0] + up[0] * 0.5, end[1] + up[1] * 0.5], [end[0] + dir[0] * 0.8, end[1] + dir[1] * 0.8], [end[0] - up[0] * 0.5, end[1] - up[1] * 0.5]], ink: "pin", w: LINE });
      const visible = item.attrs.visible ?? "both";
      const pinName = shownPinName(item.attrs.name ?? "");
      if ((visible === "both" || visible === "pin") && pinName) {
        const anchor: XY = [end[0] + dir[0] * 0.762, end[1] + dir[1] * 0.762];
        out.texts.push({ a: anchor, t: pinName, size: PIN_TEXT, ink: "pinName", ...readable(dir, up, "center-left") });
      }
      const pads = part.packaged ? padsOf(part, gate, item.attrs.name ?? "") : "";
      if ((visible === "both" || visible === "pad") && pads && length > 0) {
        const mid: XY = [(start[0] + end[0]) / 2 + up[0] * 0.254, (start[1] + end[1]) / 2 + up[1] * 0.254];
        out.texts.push({ a: mid, t: pads, size: PAD_TEXT, ink: "pinNumber", ...readable(dir, up, "bottom-center") });
      }
      continue;
    }
    if (item.name === "text") {
      const raw = item.text.trim();
      if (smashed && /^>(NAME|VALUE)$/i.test(raw)) continue;
      const key = raw.startsWith(">") ? raw.slice(1).toUpperCase() : null;
      const t = key === null ? raw : key === "NAME" ? shownName : key === "VALUE" ? part.value : key === "PART" ? part.name : key === "GATE" ? gate : (Object.entries(part.attributes).find(([name]) => name.toUpperCase() === key)?.[1] ?? "");
      const layer = num(item.attrs.layer, 94);
      pushText(out, frame, item, t, key === "NAME" || key === "VALUE" ? "field" : key ? "fieldOther" : (LAYER_INK[layer] ?? "body"));
      continue;
    }
    const layer = num(item.attrs.layer, 94);
    covered.push(...pushShape(out, frame, item, item.name === "frame" ? "frame" : (LAYER_INK[layer] ?? "body")));
  }
  if (smashed) {
    for (const attribute of children(instance, "attribute")) {
      if (attribute.attrs.display === "off" || attribute.attrs.x === undefined) continue;
      const key = (attribute.attrs.name ?? "").toUpperCase();
      const value = key === "NAME" ? shownName : key === "VALUE" ? part.value : (Object.entries(part.attributes).find(([name]) => name.toUpperCase() === key)?.[1] ?? attribute.attrs.value ?? "");
      const shown = attribute.attrs.display === "name" ? (attribute.attrs.name ?? "") : attribute.attrs.display === "both" ? `${attribute.attrs.name} = ${value}` : value;
      pushText(out, IDENTITY, attribute, shown, key === "NAME" || key === "VALUE" ? "field" : "fieldOther");
    }
  }
  if (part.packaged && covered.length) out.symbols.push({ reference: part.name, value: part.value, pts: covered });
}

const connectsOf = new WeakMap<PartInfo, Map<string, string>>();
function padsOf(part: PartInfo, gate: string, pin: string): string {
  return connectsOf.get(part)?.get(`${gate}\u0000${pin}`) ?? "";
}

/** A label: the net's name where the label is; an `xref` label in its flag. */
function drawLabel(out: Raw, item: XmlElement, net: string) {
  const rot = rotOf(item.attrs.rot);
  const frame: Frame = { origin: [num(item.attrs.x), num(item.attrs.y)], rot };
  const along = turn(frame, [1, 0]);
  const up = turn(frame, [0, 1]);
  const size = num(item.attrs.size, PIN_TEXT);
  const anchor = at(frame, [0, 0]);
  if (item.attrs.xref === "yes") {
    const length = net.length * size * 0.82 + size * 1.5;
    const half = size * 0.75;
    const pts = ([[0, 0], [half, half], [length, half], [length, -half], [half, -half]] as XY[]).map((p) => at(frame, p));
    out.paths.push({ pts, ink: "global", w: LINE, closed: true });
    const c = at(frame, [half + (length - half) / 2, 0]);
    out.texts.push({ a: c, t: net, size: round(size), ink: "global", ...readable(along, up, "center") });
    return;
  }
  out.texts.push({ a: anchor, t: net, size: round(size), ink: "label", ...readable(along, up, item.attrs.align ?? "bottom-left") });
}

/** The frame EAGLE draws: its outline, its border and the column numbers and row letters in it. */
function drawFrame(paths: Path[], texts: Text[], box: { x: number; y: number; w: number; h: number }, columns: number, rows: number, border: boolean) {
  const rect = (x: number, y: number, w: number, h: number) => paths.push({ d: [x, y, x + w, y, x + w, y + h, x, y + h].map(round), ink: "frame", w: 0.254, closed: true });
  rect(box.x, box.y, box.w, box.h);
  if (!border) return;
  const b = FRAME_BORDER;
  rect(box.x + b, box.y + b, box.w - 2 * b, box.h - 2 * b);
  const inner = { w: box.w - 2 * b, h: box.h - 2 * b };
  for (let i = 0; i < columns; i += 1) {
    const x = box.x + b + (inner.w * (i + 0.5)) / columns;
    for (const y of [box.y + b / 2, box.y + box.h - b / 2]) texts.push({ x: round(x), y: round(y), t: String(i + 1), size: 2, angle: 0, h: "middle", v: "middle", ink: "frame" });
    if (i > 0) {
      const xi = round(box.x + b + (inner.w * i) / columns);
      paths.push({ d: [xi, box.y, xi, box.y + b].map(round), ink: "frame", w: 0.254 }, { d: [xi, box.y + box.h - b, xi, box.y + box.h].map(round), ink: "frame", w: 0.254 });
    }
  }
  for (let j = 0; j < rows; j += 1) {
    const y = box.y + b + (inner.h * (j + 0.5)) / rows;
    for (const x of [box.x + b / 2, box.x + box.w - b / 2]) texts.push({ x: round(x), y: round(y), t: String.fromCharCode(65 + (j % 26)), size: 2, angle: 0, h: "middle", v: "middle", ink: "frame" });
    if (j > 0) {
      const yj = round(box.y + b + (inner.h * j) / rows);
      paths.push({ d: [box.x, yj, box.x + b, yj].map(round), ink: "frame", w: 0.254 }, { d: [box.x + box.w - b, yj, box.x + box.w, yj].map(round), ink: "frame", w: 0.254 });
    }
  }
}

/** Every sheet of an EAGLE schematic, in its order. Throws when the file is not an EAGLE schematic it can read. */
export function drawEagleSchematic(source: string, file: string): SheetDrawing[] {
  const root = parseXml(source);
  const schematic = child(child(root, "drawing"), "schematic");
  if (root.name !== "eagle" || !schematic) return [];
  const libraries = librariesOf(schematic);
  const parts = new Map<string, PartInfo>();
  for (const element of list(schematic, "parts")) {
    const library = libraryFor(libraries, element);
    const deviceset = library?.devicesets.get(element.attrs.deviceset ?? "");
    const device = children(child(deviceset, "devices"), "device").find((entry) => (entry.attrs.name ?? "") === (element.attrs.device ?? ""));
    const gates = children(child(deviceset, "gates"), "gate");
    const technology = element.attrs.technology ?? "";
    const attributes = {
      ...Object.fromEntries(children(children(child(device, "technologies"), "technology").find((entry) => (entry.attrs.name ?? "") === technology), "attribute").map((entry) => [entry.attrs.name ?? "", entry.attrs.value ?? ""])),
      ...Object.fromEntries(children(element, "attribute").filter((entry) => entry.attrs.value !== undefined).map((entry) => [entry.attrs.name ?? "", entry.attrs.value ?? ""])),
    };
    const info: PartInfo = {
      name: element.attrs.name ?? "",
      value: element.attrs.value ?? (deviceset ? deviceName(deviceset.attrs.name ?? "", element.attrs.device ?? "", technology) : ""),
      packaged: !!device?.attrs.package,
      gates: gates.length,
      symbolOf: (gate) => library?.symbols.get(gates.find((entry) => entry.attrs.name === gate)?.attrs.symbol ?? ""),
      attributes,
    };
    connectsOf.set(info, new Map(children(child(device, "connects"), "connect").map((connect) => [`${connect.attrs.gate}\u0000${connect.attrs.pin}`, (connect.attrs.pad ?? "").split(/\s+/).filter(Boolean).join(",")])));
    parts.set(info.name, info);
  }

  const sheets = list(schematic, "sheets");
  const stem = file.replace(/\.[^.]+$/, "");
  return sheets.map((sheet, index) => {
    const out: Raw = { paths: [], circles: [], texts: [], symbols: [], frames: [], skipped: {} };
    for (const item of list(sheet, "plain")) {
      if (item.name === "text") pushText(out, IDENTITY, item, item.text.trim(), LAYER_INK[num(item.attrs.layer, 97)] ?? "note");
      else pushShape(out, IDENTITY, item, item.name === "frame" ? "frame" : item.name === "wire" && num(item.attrs.layer) === 94 ? "body" : "note");
    }
    for (const instance of list(sheet, "instances")) {
      const part = parts.get(instance.attrs.part ?? "");
      if (part) drawInstance(out, instance, part);
      else out.skipped.instance_without_part = (out.skipped.instance_without_part ?? 0) + 1;
    }
    const nets = new Set<string>();
    for (const net of list(sheet, "nets")) {
      const name = net.attrs.name ?? "";
      for (const segment of children(net, "segment")) {
        for (const item of segment.children) {
          if (item.name === "wire") {
            pushShape(out, IDENTITY, item, "wire", name);
            nets.add(name);
          } else if (item.name === "junction") out.circles.push({ c: [num(item.attrs.x), num(item.attrs.y)], r: JUNCTION_R, ink: "junction", w: 0, fill: "ink" });
          else if (item.name === "label") drawLabel(out, item, name);
        }
      }
    }
    for (const bus of list(sheet, "busses")) {
      for (const segment of children(bus, "segment")) {
        for (const item of segment.children) {
          if (item.name === "wire") pushShape(out, IDENTITY, item, "bus");
          else if (item.name === "label") drawLabel(out, item, bus.attrs.name ?? "");
        }
      }
    }
    if (list(sheet, "moduleinsts").length) out.skipped.module_instance = list(sheet, "moduleinsts").length;

    // The page: the frames' extent when the sheet has frames, else the drawing's with a margin; y flipped down.
    const points: XY[] = [
      ...out.paths.flatMap((path) => path.pts),
      ...out.circles.flatMap(({ c, r }) => [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]] as XY[]),
      ...out.texts.map((text) => text.a),
      ...out.frames.flatMap((frame) => [frame.a, frame.b]),
    ];
    if (points.length === 0) points.push([0, 0]);
    const all = points.reduce((box, [x, y]) => ({ minX: Math.min(box.minX, x), maxX: Math.max(box.maxX, x), minY: Math.min(box.minY, y), maxY: Math.max(box.maxY, y) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const margin = out.frames.length > 0 ? 2 : MARGIN;
    const toPage = ([x, y]: XY): XY => [round(x - all.minX + margin), round(all.maxY - y + margin)];
    const width = round(all.maxX - all.minX + margin * 2);
    const height = round(all.maxY - all.minY + margin * 2);

    const paths: Path[] = out.paths.map(({ pts, ...rest }) => ({ ...rest, d: pts.flatMap((p) => toPage(p)) }));
    const texts: Text[] = out.texts.map(({ a, ...rest }) => {
      const [x, y] = toPage(a);
      return { ...rest, x, y };
    });
    for (const frame of out.frames) {
      const [ax, ay] = toPage(frame.a);
      const [bx, by] = toPage(frame.b);
      drawFrame(paths, texts, { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) }, frame.columns, frame.rows, frame.border);
    }
    const symbols: SymbolHit[] = out.symbols.map(({ reference, value, pts }) => {
      const placed = pts.map(toPage);
      const px = placed.map(([x]) => x);
      const py = placed.map(([, y]) => y);
      return { reference, value, box: [Math.min(...px), Math.min(...py), Math.max(...px), Math.max(...py)] };
    });
    const description = child(sheet, "description")?.text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    const name = description || (sheets.length > 1 ? `${stem} (${index + 1}/${sheets.length})` : stem);
    return {
      file: sheets.length > 1 ? `${file}#${index + 1}` : file,
      name,
      paper: { size: "User", width, height },
      titleBlock: { title: name, date: "", rev: "", company: "", comments: [] },
      frame: false as const,
      paths,
      circles: out.circles.map(({ c, ...rest }) => {
        const [x, y] = toPage(c);
        return { ...rest, x, y };
      }),
      texts,
      symbols,
      sheets: [],
      nets: [...nets].filter(Boolean).sort(),
      skipped: out.skipped,
    };
  });
}
