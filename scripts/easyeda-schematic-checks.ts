/**
 * EasyEDA Standard schematics draw from their own shapes (easyeda-schematic.ts), and part attributes
 * (c_para key`value pairs) reach the BOM as manufacturer / MPN.
 */
import assert from "node:assert/strict";
import { drawEasyEdaSchematic, svgPolylines } from "../src/lib/maker/easyeda-schematic";
import { parseEdaProject } from "../src/vendor/canon/lib/eda/parse";

assert.deepEqual(svgPolylines("M 795 -680 v 10"), [[795, -680, 795, -670]]);
assert.deepEqual(svgPolylines("M 0 0 L 10 0 L 10 10 Z"), [[0, 0, 10, 0, 10, 10, 0, 0]]);
const arc = svgPolylines("M 0 0 A 10 10 0 0 1 20 0")[0];
assert.ok(arc.length > 8 && Math.abs(arc.at(-2)! - 20) < 1e-6 && Math.abs(arc.at(-1)!) < 1e-6, "arc ends at its end point");

const lib =
  "LIB~100~100~package`SOT-23`Manufacturer`Texas Instruments`Manufacturer Part`TLV9001IDBVR`pre`U?`~0~0~gge1~~0#@$" +
  "T~P~95~90~0~#000080~Arial~~~~~comment~U7~1~start~gge2~0~#@$" +
  "T~N~95~115~0~#000080~Arial~~~~~comment~TLV9001~1~start~gge3~0~#@$" +
  "R~90~95~2~2~20~10~#880000~1~0~none~gge4~0~#@$" +
  "P~show~0~1~80~100~180~gge5~0^^80~100^^M 80 100 h 10~#880000^^1~92~104~0~IN+~start~~~#0000FF^^1~85~99~0~1~end~~~#0000FF^^0~87~100^^0~M 90 97 L 93 100 L 90 103";
const sheet = {
  head: { docType: "1" },
  canvas: "CA~1000~1000",
  shape: [
    lib,
    "W~60 100 80 100~#008800~1~0~none~gge6~0",
    "J~60~100~2.5~#CC0000~gge7~0",
    "F~part_netLabel_gnD~60~120~0~gge8~~0^^60~120^^GND~#000000~55~130~0~start~1~Times New Roman~9pt~flag^^PL~55 120 65 120~#000000~1~0~transparent~gge9~0",
    "T~L~40~60~0~#0000FF~~9pt~~~~comment~POWER~1~start~gge10~0~pinpart",
    "Pimage~unsupported",
  ],
};
const [d] = drawEasyEdaSchematic(JSON.stringify(sheet), "SCH_test.json");
assert.equal(d.frame, false);
assert.deepEqual(d.symbols.map((s) => [s.reference, s.value]), [["U7", "TLV9001"]]);
assert.ok(d.texts.some((t) => t.t === "IN+" && t.ink === "pinName"));
assert.ok(d.texts.some((t) => t.t === "1" && t.ink === "pinNumber"));
assert.ok(d.texts.some((t) => t.t === "POWER" && t.ink === "note"));
assert.ok(d.paths.some((p) => p.ink === "wire") && d.circles.some((c) => c.ink === "junction"));
assert.deepEqual(d.nets, ["GND"]);
assert.equal(d.skipped.Pimage, 1, "unsupported records are counted, not drawn");
const minX = Math.min(...d.paths.flatMap((p) => p.d.filter((_, k) => k % 2 === 0)));
assert.ok(Math.abs(minX - 5) < 1e-6, "drawing starts at the page margin");

// A project export holds several sheets.
const project = { docType: "5", schematics: [{ title: "Main", dataStr: sheet }, { title: "IO", dataStr: JSON.stringify(sheet) }] };
assert.deepEqual(drawEasyEdaSchematic(JSON.stringify(project), "SCH_p.json").map((s) => s.name), ["Main", "IO"]);
assert.deepEqual(drawEasyEdaSchematic('{"head":{"docType":"3"},"shape":[]}', "PCB_x.json"), [], "PCB documents are not schematics");

void (async () => {
  const bundle: any = await parseEdaProject([{ path: "SCH_test.json", bytes: new TextEncoder().encode(JSON.stringify(sheet)) }]);
  const u7 = bundle.parts.find((p: any) => p.reference === "U7");
  assert.equal(u7?.mpnRaw, "TLV9001IDBVR");
  assert.equal(u7?.manufacturerRaw, "Texas Instruments");
  console.log("easyeda schematic checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
