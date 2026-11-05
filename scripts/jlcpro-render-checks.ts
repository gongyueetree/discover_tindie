/**
 * JLCEDA / EasyEDA Pro projects render as EasyEDA draws them: the schematic from its sheets and
 * symbols (jlcpro-schematic.ts), the board with its footprints' pads, arcs, fills, pours, outline and
 * silkscreen (jlcpro-pcb.ts), a real board before a panel, and body envelopes for 3D (jlcpro-3d.ts).
 * Fixtures: scripts/fixtures/jlcpro — a small synthetic project in EasyEDA Pro's record format.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { jlcProSheets } from "../src/lib/maker/jlcpro-schematic";
import { isJlcProBoard, jlcProBodies, jlcProPcb3d } from "../src/lib/maker/jlcpro-3d";
import { arcBySweep, pathPoints } from "../src/vendor/canon/lib/eda/jlcpro-records";
import { cleanOutline } from "../src/vendor/canon/lib/eda/jlcpro-pcb";
import { parseEdaProject } from "../src/vendor/canon/lib/eda/parse";
import { drawSchematics } from "../src/vendor/eelib/view";

const root = join(__dirname, "fixtures/jlcpro");
const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));
const assets = walk(root).map((file) => ({ path: `demo.epro/${relative(root, file)}`, bytes: new Uint8Array(readFileSync(file)) }));
const near = (a: number, b: number, tol = 1e-3) => Math.abs(a - b) <= tol;

// Geometry: a quarter turn counter-clockwise (y up) passes through the 45° point; a path's ARC is sampled.
const quarter = arcBySweep([1, 0], [0, 1], 90);
assert.ok(quarter.length > 2 && quarter.every(([x, y]) => near(Math.hypot(x, y), 1) && x > -1e-9 && y > -1e-9), "a +90° sweep turns counter-clockwise about the origin");
assert.ok(arcBySweep([1, 0], [0, -1], -90).every(([x, y]) => near(Math.hypot(x, y), 1) && x > -1e-9 && y < 1e-9), "a −90° sweep turns clockwise");
assert.ok(pathPoints([0, 0, "L", 10, 0, "ARC", 90, 20, 10]).length > 4, "ARC pieces are sampled");
assert.equal(pathPoints(["R", 0, 10, 20, 10, 0, 0]).length, 5, "R is a closed rectangle, extending down from its top-left corner");
assert.deepEqual(pathPoints(["R", 0, 10, 20, 10, 0, 0])[2], [20, 0]);

// An outline drawn twice over and with a hair-thin arc at a joint is cleaned into one loop.
const outline = cleanOutline([
  { kind: "line", start: [0, 0], end: [100, 0] },
  { kind: "line", start: [100, 0], end: [100, 100] },
  { kind: "line", start: [100, 100], end: [0, 100] },
  { kind: "line", start: [0, 100], end: [0, 0] },
  { kind: "line", start: [0, 30], end: [0, 60] },
  { kind: "arc", start: [100, 50], mid: [100.1, 50.05], end: [100.2, 50.1] },
]);
assert.ok(outline.every((p) => p.kind === "line"), "the dangling hair arc is dropped");
const degree = new Map<string, number>();
for (const p of outline) if (p.kind === "line") for (const end of [p.start, p.end]) degree.set(String(end), (degree.get(String(end)) ?? 0) + 1);
assert.ok([...degree.values()].every((n) => n === 2), "duplicates merged: one closed loop");

// Schematic: symbols from .esym placed per COMPONENT, fields, pins, wires, junctions, net flags, notes.
const [sheet] = jlcProSheets(assets);
assert.ok(sheet, "the sheet is drawn");
assert.equal(sheet.name, "Main sheet", "named as the project names it");
const texts = sheet.texts.map((t) => t.t);
for (const t of ["U1", "ACME-LDO33", "IN", "OUT", "1", "2", "LDO", "GND", "+3V3", "Power"]) assert.ok(texts.includes(t), `text ${t} drawn`);
assert.ok(sheet.paths.filter((p) => p.ink === "body").length >= 3, "symbol graphics (rect, polygon, arc) drawn");
assert.equal(sheet.circles.filter((c) => c.ink === "body").length, 2, "symbol circle and round ellipse drawn");
assert.equal(sheet.paths.filter((p) => p.ink === "pin").length, 3, "three pins (two on U1, one on the net flag)");
assert.ok(sheet.paths.filter((p) => p.ink === "wire").length === 3 && sheet.paths.some((p) => p.ink === "wire" && p.net === "+3V3"), "wires with their nets");
assert.equal(sheet.circles.filter((c) => c.ink === "junction").length, 1, "the T junction gets a dot");
assert.ok(sheet.paths.some((p) => p.ink === "graphic" && p.dash), "the grey dashed section box");
assert.ok(sheet.texts.some((t) => t.t === "Power" && t.ink === "sheet"), "dark red heading");
assert.deepEqual(sheet.nets, ["+3V3", "GND"]);
assert.deepEqual(sheet.symbols.map((s) => [s.reference, s.value]), [["U1", "ACME-LDO33"]]);
assert.equal(sheet.skipped.image, 1, "images are counted, not drawn");
// U1 is turned 90°: its IN pin (left in the symbol) ends below it, at the GND wire. y is flipped: below is larger y.
const pinEnds = sheet.paths.filter((p) => p.ink === "pin").map((p) => [p.d[0], p.d[1]]);
const wireEnd = sheet.paths.find((p) => p.net === "GND")!;
assert.ok(pinEnds.some(([x, y]) => near(x, wireEnd.d[0]) && near(y, wireEnd.d[1])), "the rotated pin meets its wire");

void (async () => {
  const bundle: any = await parseEdaProject(assets);
  assert.equal(bundle.project.sourceFormat, "easyeda");
  // The viewer draws the Pro sheet, not the IR fallback.
  const drawn = drawSchematics(bundle, assets);
  assert.equal(drawn.length, 1);
  assert.ok(drawn[0].texts.some((t) => t.t === "ACME-LDO33"));

  // Parts take the device's fields; pins come from the symbol and join their nets.
  const u1 = bundle.parts.find((p: any) => p.reference === "U1");
  assert.equal(u1.value, "ACME-LDO33");
  assert.equal(u1.mpnRaw, "ACME-LDO33");
  assert.equal(u1.manufacturerRaw, "Acme");
  assert.equal(u1.footprint, "SOT-23-3");
  assert.equal(bundle.schematics[0].pins.length, 2);
  const gnd = bundle.nets.find((n: any) => n.domain === "schematic_logical" && n.canonicalName === "GND");
  assert.ok(gnd.endpoints.some((e: any) => e.type === "symbol_pin" && e.identifier.pin === "1"), "U1.1 is on GND");
  assert.ok(!bundle.diagnostics.some((d: any) => /1\.esch/.test(d.message) && d.code === "JLCEDA_RECORDS_PARTIAL"), "the sheet's drawing records are all read");

  // Boards: a real board first, the panel last; both kept.
  assert.deepEqual(bundle.pcbs.map((p: any) => p.name), ["Demo board", "Demo panel"]);
  const pcb = bundle.pcbs[0];
  assert.ok(isJlcProBoard(pcb));
  assert.equal(pcb.units, "mm");
  assert.deepEqual([pcb.physicalDimensions.width, pcb.physicalDimensions.height], ["25.4", "25.4"], "1000 mil square outline");
  assert.equal(pcb.physicalDimensions.thickness, "1.6");
  assert.equal(pcb.boardOutline.filter((o: any) => o.kind === "arc").length, 4, "outline: four corner arcs, the hair arc dropped");
  const ends = new Map<string, number>();
  for (const o of pcb.boardOutline) for (const p of [o.geometry.start, o.geometry.end]) ends.set(`${p.x},${p.y}`, (ends.get(`${p.x},${p.y}`) ?? 0) + 1);
  assert.ok([...ends.values()].every((n) => n === 2), "outline: one closed loop, the doubled edge merged");

  // Footprint pads, placed, turned and (bottom) mirrored, with sizes, shapes, drills and nets.
  const top = pcb.footprints.find((f: any) => f.reference === "U1");
  const bottom = pcb.footprints.find((f: any) => f.reference === "U2");
  assert.equal(top.libraryIdentifier, "SOT-23-3");
  assert.equal(top.fields["Manufacturer Part"], "ACME-LDO33");
  assert.equal(bottom.side, "back");
  const pad = (fp: any, n: string) => pcb.pads.find((p: any) => p.footprintId === fp.id && p.number === n);
  const p1 = pad(top, "1");
  // Local (−37.4, −40) mil turned 90° counter-clockwise → (40, −37.4); board (540, 462.6) mil; y flipped.
  assert.ok(near(Number(p1.position.x), 540 * 0.0254) && near(Number(p1.position.y), -462.6 * 0.0254), "pad placed and turned");
  assert.equal(p1.shape, "roundrect");
  assert.deepEqual([p1.size.x, p1.size.y], ["0.762", "1.016"]);
  assert.equal(p1.rotation, "90");
  assert.equal(p1.netName, "GND");
  assert.deepEqual(p1.layers, ["Top Layer"]);
  assert.equal(pad(top, "2").shape, "oval");
  assert.equal(pad(top, "2").netName, "VIN");
  const p3 = pad(top, "3");
  assert.equal(p3.padType, "thru_hole");
  assert.deepEqual(p3.drill, { x: "0.508", y: "0.508" });
  assert.equal(p3.shape, "circle");
  const b1 = pad(bottom, "1");
  // Bottom: local x mirrored → (37.4, −40) → board (337.4, 260).
  assert.ok(near(Number(b1.position.x), 337.4 * 0.0254) && near(Number(b1.position.y), -260 * 0.0254), "bottom pad mirrored");
  assert.deepEqual(b1.layers, ["Bottom Layer"]);
  assert.equal(pad(bottom, "3").netName, "GND");
  assert.ok(pcb.pads.some((p: any) => p.padType === "thru_hole" && p.netName === "VIN" && p.shape === "roundrect"), "a pad placed on the board itself");

  // Tracks, arcs, vias, copper fills, pours (poured copper scaled from tenths), keep-outs.
  assert.ok(pcb.tracks.some((t: any) => t.kind === "segment" && t.layer === "Top Layer" && t.width === "0.254"));
  const arc = pcb.tracks.find((t: any) => t.kind === "arc");
  assert.ok(arc?.mid && arc.layer === "Bottom Layer", "ARC is an arc track with its middle");
  assert.equal(pcb.vias.length, 1);
  assert.deepEqual([pcb.vias[0].drill, pcb.vias[0].size], ["0.3048", "0.6096"]);
  const fill = pcb.zones.find((z: any) => z.shape?.fills.length === 2);
  assert.ok(fill && fill.layers[0] === "Bottom Layer" && !fill.shape.keepout, "FILL with its hole");
  const pour = pcb.zones.find((z: any) => z.shape?.outline.length && z.layers[0] === "Top Layer" && z.shape.fills.length === 1);
  assert.ok(pour, "POUR with what EasyEDA poured");
  assert.ok(near(Math.max(...pour.shape.fills[0].points.map(([x]: number[]) => x)), 970 * 0.0254), "POURED in tenths, scaled into its outline");
  assert.ok(pcb.zones.some((z: any) => z.shape?.keepout), "REGION is a keep-out");

  // Silkscreen: the footprints' strokes and dots, the board's strokes, texts and shown designators.
  const silk = pcb.silkscreen;
  assert.ok(silk.graphics.filter((g: any) => g.layer === "F.SilkS").length >= 5, "footprint outline + board stroke on the top silkscreen");
  assert.ok(silk.graphics.some((g: any) => g.layer === "B.SilkS"), "the bottom part's outline is on the bottom silkscreen");
  assert.ok(silk.polygons.some((p: any) => p.layer === "F.SilkS") && silk.polygons.some((p: any) => p.layer === "B.SilkS"), "pin-1 dots");
  const demo = silk.texts.find((t: any) => t.text === "DEMO");
  assert.ok(demo?.inverse && demo.justify.horizontal === "left" && demo.justify.vertical === "bottom", "inverse text, anchored left bottom");
  assert.ok(silk.texts.find((t: any) => t.text === "BACK")?.mirrored, "bottom text reads from the back");
  assert.ok(silk.texts.some((t: any) => t.text === "U1" && t.kind === "reference") && silk.texts.some((t: any) => t.text === "U2" && t.layer === "B.SilkS"));
  assert.ok(bundle.diagnostics.some((d: any) => /b2\.epcb/.test(d.message) && /IMAGE/.test(d.message)), "images are reported, not drawn");

  // 3D: KiCad copper names, a body per placed part from its Component Shape, heights from the model name.
  const three = jlcProPcb3d(pcb);
  assert.deepEqual(three.pads.find((p: any) => p.id === p3.id)!.layers, ["*.Cu"]);
  assert.deepEqual(three.pads.find((p: any) => p.id === b1.id)!.layers, ["B.Cu"]);
  const bodies = jlcProBodies(pcb);
  assert.equal(bodies.length, 2);
  const body = bodies.find((b) => b.reference === "U1")!;
  assert.ok(near(body.w, 60 * 0.0254) && near(body.h, 50 * 0.0254) && body.height === 1.1 && !body.bottom);
  assert.ok(near(body.x, 500 * 0.0254) && near(body.y, -500 * 0.0254), "the body sits on its part");
  assert.ok(bodies.find((b) => b.reference === "U2")!.bottom);
  console.log("PASS: JLCEDA Pro schematic (symbols, fields, pins, wires, junctions, flags), board (pads, arcs, vias, fills, pours, outline, silkscreen), board order, 3D bodies");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
