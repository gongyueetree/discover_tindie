/**
 * Older and less common CAD formats as GitHub projects publish them, through the browser's path
 * (files → parser → drawers) and the GitHub project discovery:   (part of npm test)
 * - KiCad legacy board (.brd, "PCBNEW-BOARD Version 1/2", KiCad ≤ 2013) beside its .pro / .sch
 * - KiCad .kicad_pcb version 3 with renamed copper layers ((15 Top signal), (layer Top))
 * - Autodesk Fusion Electronics .fsch / .fbrd (a ZIP holding the design as EAGLE XML), and a
 *   Fusion .f3z holding only mechanical .f3d designs
 * - binary EAGLE (≤ 5), gEDA and ASCII Altium PCB: no drawing, but a message naming the file
 * Fixtures are synthetic (scripts/fixtures/cad/kicad-legacy) or built here from the EAGLE fixture.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import { filesToInputAssets } from "../src/vendor/canon/lib/eda/archive";
import { parseEdaProject } from "../src/vendor/canon/lib/eda/parse";
import { legacyBoardToKicadPcb } from "../src/vendor/canon/lib/eda/kicad-legacy-board";
import { boardSilkscreen } from "../src/vendor/canon/lib/models/board-silkscreen";
import { buildBoardMeshes } from "../src/vendor/canon/lib/models/board-mesh";
import { splinePoints } from "../src/vendor/canon/lib/eda/eagle";
import { parseXml } from "../src/vendor/canon/lib/eda/eagle-xml";
import { drawSchematics } from "../src/vendor/eelib/view";
import { discoverProjects, type RepoFile } from "../src/lib/maker/github-projects";
import { unsupportedCadReason } from "../src/lib/maker/unsupported-cad";

const DIR = "scripts/fixtures/cad/";
const enc = new TextEncoder();
const file = (name: string, bytes: Uint8Array | string) => new File([typeof bytes === "string" ? enc.encode(bytes) : bytes], name);
async function open(files: File[]) {
  const r = await filesToInputAssets(files);
  const bundle = await parseEdaProject(r.assets, r.diagnostics);
  return { r, bundle, sheets: bundle.schematics.length ? drawSchematics(bundle as any, r.assets) : [] };
}
const results: string[] = [];

(async () => {
  // ── KiCad legacy board (1/10000 inch) with its project and schematic ──
  const brd = readFileSync(DIR + "kicad-legacy/blink.brd");
  const sch = "EESchema Schematic File Version 2  date Mon 19 Dec 2011\nLIBS:power\nEELAYER 25  0\nEELAYER END\n$Descr A4 11700 8267\n$EndDescr\nWire Wire Line\n\t1000 1000 2000 1000\n$EndSCHEMATC\n";
  let r = await open([file("blink.brd", brd), file("blink.pro", "update=Mon 19 Dec 2011\nlast_client=pcbnew\n"), file("blink.sch", sch)]);
  assert.equal(r.bundle.project.sourceFormat, "kicad");
  assert.equal(r.bundle.schematics.length, 1, "legacy schematic beside the board");
  let pcb = r.bundle.pcbs[0];
  assert.ok(pcb, "legacy .brd read as a board");
  assert.deepEqual(pcb.footprints.map((f) => f.reference).sort(), ["D1", "R1"]);
  const r1 = pcb.footprints.find((f) => f.reference === "R1")!;
  assert.equal(Number(r1.position!.x), 38.1, "decimils → mm (15000 × 0.00254)");
  assert.equal(r1.rotation, "90", "tenths of a degree");
  assert.equal(r1.value, "330");
  assert.equal(r1.models?.[0]?.path, "smd/resistors/r_0805.wrl");
  const d1 = pcb.footprints.find((f) => f.reference === "D1")!;
  assert.equal(d1.side, "back", "module on legacy layer 0 is on the back");
  const pads = pcb.pads.filter((p) => p.footprintId === d1.id);
  assert.equal(pads.length, 2);
  assert.deepEqual(pads.find((p) => p.number === "2")!.drill, { x: "0.8128", y: "1.27" }, "oval drill");
  assert.ok(pads.every((p) => p.layers.includes("*.Cu")), "through-hole pads on every copper layer");
  assert.deepEqual(pcb.pads.find((p) => p.number === "1" && p.footprintId === r1.id)!.layers.sort(), ["F.Cu", "F.Mask", "F.Paste"], "pad layer mask");
  assert.equal(pcb.boardOutline.length, 4);
  assert.equal(Number(pcb.physicalDimensions?.width), 50.8, "outline 2 inch wide");
  assert.deepEqual(pcb.tracks.map((t) => t.layer), ["F.Cu", "B.Cu"]);
  assert.equal(pcb.vias.length, 1);
  assert.equal(pcb.vias[0].drill, "0.635", "via drill from the board default");
  assert.equal(pcb.zones.length, 1);
  assert.deepEqual(pcb.zones[0].layers, ["B.Cu"]);
  assert.equal(pcb.zones[0].shape?.fills.length, 1, "zone fill polygon");
  assert.ok(r.bundle.nets.some((n) => n.canonicalName === "/LED" && n.endpoints.length >= 3), "net names and pads joined");
  const silk = boardSilkscreen(pcb as any, r.r.assets);
  assert.ok(silk.some((m) => m.text === "BLINK") && silk.some((m) => m.text === "R1"), "board and footprint silkscreen text");
  results.push(`KiCad legacy .brd v1: ${pcb.footprints.length} footprints, ${pcb.tracks.length} tracks, ${silk.length} silk marks`);

  // Version 2 (mm): the same board scaled
  const v2 = legacyBoardToKicadPcb(new TextDecoder().decode(brd).replace("Version 1", "Version 2").replace("encoding utf-8", "encoding utf-8\nUnits mm").replace(/^Po (-?\d+) (-?\d+) (\d+) (\d+)/m, "Po 38.1 38.1 $3 $4"))!;
  assert.match(v2, /\(module "SM0805" \(layer F\.Cu\) \(at 38\.1 38\.1 90\)/, "version 2 coordinates are millimetres");
  assert.equal(legacyBoardToKicadPcb("(kicad_pcb (version 4))"), undefined);
  results.push("KiCad legacy .brd v2 (mm)");

  // ── .kicad_pcb version 3 with renamed copper layers ──
  r = await open([file("renamed.kicad_pcb", readFileSync(DIR + "kicad-legacy/renamed-v3.kicad_pcb"))]);
  pcb = r.bundle.pcbs[0];
  assert.deepEqual(pcb.layers.filter((l) => l.copper).map((l) => l.name), ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"], "Top/GND/PWR/Bottom → KiCad names, inner order as KiCad converts");
  assert.deepEqual(pcb.tracks.map((t) => t.layer), ["F.Cu", "B.Cu"]);
  assert.deepEqual(pcb.vias[0].layers, ["F.Cu", "B.Cu"]);
  assert.equal(pcb.footprints[0].side, "front");
  assert.deepEqual(pcb.pads[0].layers, ["F.Cu", "F.Mask"]);
  assert.deepEqual(pcb.zones[0].layers, ["In1.Cu"]);
  results.push("KiCad v3 renamed copper layers");

  // ── Fusion Electronics: .fsch / .fbrd are ZIPs with the design as EAGLE XML ──
  const fusion = (folder: string, ext: string, xml: Uint8Array) =>
    zipSync({ "Manifest.dat": new Uint8Array([1, 2, 3]), [`${folder}[Active]/electron.BlobParts/ExtFile.0b3b08d7-5fa4.${ext}`]: xml, [`${folder}[Active]/Previews/small.png`]: new Uint8Array(8) });
  const fsch = fusion("Schematic Document Asset", "sch", readFileSync(DIR + "eagle/blinky.sch"));
  const fbrd = fusion("PCB Document Asset", "brd", readFileSync(DIR + "eagle/blinky.brd"));
  r = await open([file("blinky-v1.fsch", fsch), file("blinky-v1.fbrd", fbrd)]);
  assert.equal(r.bundle.project.sourceFormat, "eagle");
  assert.deepEqual(r.r.assets.map((a) => a.path).sort(), ["blinky-v1.brd", "blinky-v1.sch"], "the EAGLE document stands in for the Fusion file");
  assert.ok(r.bundle.pcbs.length === 1 && r.sheets[0]?.symbols.length > 0, "Fusion schematic drawn and board read");
  // …also inside a project ZIP (as the GitHub import delivers them), under a folder
  r = await open([file("project.zip", zipSync({ "hw/fusion/board.fsch": fsch, "hw/fusion/board.fbrd": fbrd, "README.md": enc.encode("x") }))]);
  assert.ok(r.bundle.schematics.length && r.bundle.pcbs.length, "Fusion documents inside a ZIP");
  assert.ok(r.r.assets.some((a) => a.path === "hw/fusion/board.brd"));
  results.push(`Fusion .fsch/.fbrd: ${r.sheets[0].symbols.length} symbols, ${r.bundle.pcbs[0].footprints.length} footprints`);
  // A Fusion document without its design, and a .f3z with only mechanical designs: named, not guessed
  r = await open([file("empty.fbrd", zipSync({ "Manifest.dat": new Uint8Array(4) }))]);
  assert.match(unsupportedCadReason(r.r.assets, r.bundle.diagnostics)!, /empty\.fbrd: this Fusion Electronics document does not contain its design/);
  r = await open([file("case.f3z", zipSync({ "Manifest.json": enc.encode("{}"), "e91d3428.f3d": zipSync({ "FusionAssetName[Active]/x.dat": new Uint8Array(4) }) }))]);
  assert.match(unsupportedCadReason(r.r.assets, r.bundle.diagnostics)!, /case\.f3z is a Fusion 360 3D design/);
  // A .f3z that does carry Fusion Electronics documents opens them
  r = await open([file("design.f3z", zipSync({ "Manifest.json": enc.encode("{}"), "board.fbrd": fbrd, "model.f3d": new Uint8Array(4) }))]);
  assert.equal(r.bundle.pcbs.length, 1, "board inside a .f3z");

  // ── 3D board from an outline drawn loosely (as in jawbreaker.brd, a Fusion DXF outline) ──
  const P = (x: number, y: number) => ({ x: String(x), y: String(y), unit: "mm" });
  const edge = (a: number[], b: number[]) => ({ id: "e", kind: "line", geometry: { start: P(a[0], a[1]), end: P(b[0], b[1]) } });
  const board = (outline: any[]) => buildBoardMeshes({ boardOutline: outline, pads: [], vias: [] } as any);
  const square = [edge([0, 0], [20.127, 0]), edge([20, 0], [20, 10]), edge([20, 10], [0, 10]), edge([0, 10], [0, 0])];
  assert.equal(board(square).length, 1, "a corner that overshoots by 0.127 mm still closes");
  assert.equal(board([...square, square[1], edge([5, 5], [6, 6])]).length, 1, "a doubled edge and a stray stroke are left out");
  assert.throws(() => board([edge([0, 0], [20, 0]), edge([20, 0], [20, 10]), edge([20, 10], [0, 10])]), /board outline is incomplete/, "an open outline is still refused");
  // Fusion's <spline> (a cubic B-spline through <vertex> control points), e.g. a board-outline corner
  const curve = splinePoints(parseXml('<spline degree="3" rational="no" knots="0 0 0 0 1 1 1 1"><vertex x="0" y="0"/><vertex x="1" y="1"/><vertex x="2" y="1"/><vertex x="3" y="0"/></spline>'));
  assert.deepEqual(curve[0], [0, 0]);
  assert.deepEqual(curve.at(-1), [3, 0]);
  assert.deepEqual(curve[curve.length >> 1].map((v) => Number(v.toFixed(6))), [1.5, 0.75], "Bézier midpoint");
  results.push("3D outline tolerance, Fusion splines");

  // ── KiCad 7+ Edge.Cuts gr_poly with (arc …) rounded corners (GlasgowEmbedded/glasgow revD1) ──
  const polyPcb = `(kicad_pcb (version 20260206) (generator "pcbnew")
  (layers (0 "F.Cu" signal) (2 "B.Cu" signal) (25 "Edge.Cuts" user))
  (gr_poly (pts
    (arc (start 30 25) (mid 28.535534 28.535534) (end 25 30))
    (arc (start 5 30) (mid 1.464466 28.535534) (end 0 25))
    (arc (start 0 5) (mid 1.464466 1.464466) (end 5 0))
    (arc (start 25 0) (mid 28.535534 1.464466) (end 30 5)))
    (stroke (width 0.05) (type solid)) (fill no) (layer "Edge.Cuts") (uuid "84111b1e-3beb-457b-b46d-1545baea5729")))`;
  r = await open([file("rounded.kicad_pcb", enc.encode(polyPcb))]);
  const ol = r.bundle.pcbs[0].boardOutline;
  assert.deepEqual(ol.map((o: any) => o.kind), ["arc", "line", "arc", "line", "arc", "line", "arc", "line"], "corners and the straight edges between them");
  assert.equal(r.bundle.pcbs[0].physicalDimensions?.width, "30");
  assert.equal(board(ol).length, 1, "the rounded outline closes in 3D");
  results.push("KiCad gr_poly outline with arc corners");

  // ── Files that cannot be drawn: the message names the file and why ──
  const binaryEagle = new Uint8Array(64);
  binaryEagle.set([0x10, 0x00, 0x13, 0x00, 0x00, 0x00, 0x00, 0x00]);
  r = await open([file("XuLA2.sch", binaryEagle), file("XuLA2.brd", binaryEagle)]);
  assert.equal(r.bundle.schematics.length + r.bundle.pcbs.length, 0);
  assert.match(unsupportedCadReason(r.r.assets, r.bundle.diagnostics)!, /^XuLA2\.(sch|brd), XuLA2\.(sch|brd) are binary EAGLE \(version 5 or older\)/);
  r = await open([file("Gen7Board.sch", "v 20110115 2\nC 40300 40400 1 0 0 gnd-1.sym\n")]);
  assert.match(unsupportedCadReason(r.r.assets, r.bundle.diagnostics)!, /Gen7Board\.sch is a gEDA \/ Lepton \(gschem\) design/);
  r = await open([file("export.PcbDoc", "|RECORD=Board|KIND=Protel_Advanced_PCB|VERSION=5.00\n|RECORD=Track|LAYER=TOP|X1=0mil\n")]);
  // An ASCII PcbDoc is now read (altium-ascii-pcb-checks.ts): a board, and no "unsupported" reason.
  assert.equal(r.bundle.pcbs.length, 1, "ASCII PcbDoc read");
  assert.equal(unsupportedCadReason(r.r.assets, r.bundle.diagnostics), undefined);
  assert.equal(unsupportedCadReason([{ path: "notes.txt", bytes: enc.encode("hello") }], []), undefined);
  results.push("binary EAGLE / gEDA / Fusion mechanical named; ASCII PcbDoc read");

  // ── GitHub discovery: Fusion documents and legacy KiCad projects ──
  const f = (path: string): RepoFile => ({ path, sha: "0", size: 10, type: "blob" });
  const projects = discoverProjects(
    ["Hardware/Battery-v1.fsch", "Hardware/Battery-v1.fbrd", "pcb/NBES_Board.fbrd", "pcb/NBES_Schematic.fsch", "hardware/ubertooth-one/ubertooth-one.pro", "hardware/ubertooth-one/ubertooth-one.sch", "hardware/ubertooth-one/ubertooth-one.brd", "paper/frame.f3z"].map(f),
  );
  const by = (dir: string) => projects.find((p) => p.directory === dir)!;
  assert.equal(by("Hardware").format, "Fusion Electronics");
  assert.deepEqual(by("Hardware").roots.sort(), ["Hardware/Battery-v1.fbrd", "Hardware/Battery-v1.fsch"]);
  assert.deepEqual(by("pcb").roots.sort(), ["pcb/NBES_Board.fbrd", "pcb/NBES_Schematic.fsch"], "a lone schematic beside the board joins it");
  assert.equal(by("hardware/ubertooth-one").format, "KiCad (legacy)");
  assert.equal(by("hardware/ubertooth-one").roots.length, 3);
  assert.ok(!projects.some((p) => p.directory === "paper"), "a mechanical .f3z is not offered as a PCB project");
  results.push("discovery: Fusion Electronics, KiCad (legacy)");

  console.log("PASS: " + results.join(" · "));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
