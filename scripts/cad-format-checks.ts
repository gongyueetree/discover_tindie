/**
 * Every CAD format the viewer opens, through the same path the browser takes:
 * files → eelib parser (vendor/canon/lib/eda, eelib refir 1.7.2) → eelib schematic drawers (vendor/eelib/view).
 * Altium / EAGLE / KiCad fixtures are eelib's own test packages; EasyEDA ones follow eelib's tests.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { filesToInputAssets } from "../src/vendor/canon/lib/eda/archive";
import { parseEdaProject } from "../src/vendor/canon/lib/eda/parse";
import { drawSchematics } from "../src/vendor/eelib/view";

const DIR = "scripts/fixtures/cad/";
const file = (path: string, bytes?: Uint8Array) => new File([bytes ?? readFileSync(DIR + path)], path.split("/").pop()!);
async function open(files: File[]) {
  const r = await filesToInputAssets(files);
  const bundle = await parseEdaProject(r.assets, r.diagnostics);
  return { bundle, sheets: drawSchematics(bundle as any, r.assets) };
}
const enc = new TextEncoder();
const results: string[] = [];

(async () => {
  // KiCad 6+ hierarchy
  let r = await open(readdirSync(DIR + "hierarchy").map((n) => file("hierarchy/" + n)));
  assert.equal(r.bundle.project.sourceFormat, "kicad");
  assert.ok(r.sheets.length >= 3, "KiCad hierarchy sheets drawn");
  results.push(`KiCad: ${r.sheets.length} sheets`);

  // EAGLE 6+ XML: schematic + board
  r = await open(["eagle/blinky.sch", "eagle/blinky.brd"].map((n) => file(n)));
  assert.equal(r.bundle.project.sourceFormat, "eagle");
  assert.ok(r.bundle.pcbs.length === 1 && r.sheets.length >= 1 && r.sheets[0].symbols.length > 0, "EAGLE drawn from source");
  results.push(`EAGLE: ${r.sheets[0].symbols.length} symbols, ${r.bundle.pcbs[0].footprints.length} footprints`);

  // Altium Designer packages (one from a Chinese desktop: GBK names in the zip)
  for (const zip of ["altium-test.zip", "chinese-desktop-altium.zip"]) {
    r = await open([file(zip)]);
    assert.equal(r.bundle.project.sourceFormat, "altium", zip);
    assert.ok(r.bundle.schematics.length + r.bundle.pcbs.length > 0, zip + " parsed");
    results.push(`Altium ${zip}: ${r.sheets.length} sheets drawn, ${r.bundle.pcbs.length} boards, ${r.bundle.parts.length} parts`);
  }

  // EasyEDA Standard board (JSON)
  const standard = JSON.stringify({
    head: { docType: "3", editorVersion: "6.5.40" }, title: "silk",
    canvas: "CA~1000~1000~#000000~yes~#FFFFFF~10~1000~1000~line~0.5~mm~1~45~visible~0.5~4000~3000~0~yes",
    layers: ["1~TopLayer~#FF0000~true~true~true~", "3~TopSilkLayer~#FFCC00~true~false~true~", "10~BoardOutLine~#FF00FF~true~false~true~"],
    shape: [
      "TRACK~1~10~~4000 3000 4100 3000 4100 3060 4000 3060 4000 3000~gge1~0",
      "TRACK~1~1~GND~4040 3040 4060 3040~gge3~0",
      ["LIB~4020~3030~package`R0603`~0~~gge10~1~~0~1", "PAD~RECT~4017~3030~3~3~1~GND~1~0~~0~gge14~0~~Y~0~0~0.4~4017,3030"].join("#@$"),
    ],
  });
  r = await open([file("PCB_silk.json", enc.encode(standard))]);
  assert.equal(r.bundle.project.sourceFormat, "easyeda");
  assert.ok(r.bundle.pcbs[0]?.boardOutline.length, "EasyEDA board outline");
  results.push(`EasyEDA Standard: board with ${r.bundle.pcbs[0].tracks.length} tracks`);

  // JLCEDA / EasyEDA Pro board (record stream)
  const pro = [
    ["DOCTYPE", "PCB", "1.8"], ["HEAD", { editorVersion: "2.2" }],
    ["LAYER", 1, "TOP", "Top Layer", 3, "#ff0000", 1, "#7f0000", 1],
    ["LAYER", 3, "TOP_SILK", "Top Silkscreen Layer", 3, "#ffcc00", 1, "#7f6600", 1],
    ["COMPONENT", "e1", 0, 1, 100, 200, 0, {}, 0],
    ["ATTR", "e2", 0, "e1", 3, 95, 210, "Designator", "R7", 0, 1, "default", 30, 6, 0, 0, 7, 0, 0, 0, 0, 0],
    ["POLY", "e5", 0, "", 3, 6, [80, 180, "L", 120, 180, 120, 220], 0],
  ].map((l) => JSON.stringify(l)).join("\n");
  r = await open([file("board.epcb", enc.encode(pro))]);
  assert.equal(r.bundle.project.sourceFormat, "easyeda");
  assert.equal(r.bundle.pcbs.length, 1, "JLCEDA Pro board parsed");
  results.push(`JLCEDA Pro: board with ${r.bundle.pcbs[0].footprints.length} footprint(s)`);

  console.log("PASS: " + results.join(" · "));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
