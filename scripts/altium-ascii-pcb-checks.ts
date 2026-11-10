/** A PcbDoc saved as "PCB ASCII" (one |RECORD=…| line per record) is read like a binary board. Offline, synthetic board. */
import assert from "node:assert/strict";
import { parseEdaProject } from "../src/vendor/canon/lib/eda/parse";

const lines = [
  "|RECORD=Board|KIND=Protel_Advanced_PCB|VERSION=5.01|KIND0=0|VX0=0mil|VY0=0mil|KIND1=0|VX1=1000mil|VY1=0mil|KIND2=0|VX2=1000mil|VY2=500mil|KIND3=0|VX3=0mil|VY3=500mil|KIND4=0|VX4=0mil|VY4=0mil",
  "|RECORD=Board|LAYER1NAME=Top|LAYER1NEXT=32",
  "|RECORD=Net|ID=0|NAME=GND",
  "|RECORD=Net|ID=1|NAME=VCC",
  "|RECORD=Component|ID=0|LAYER=TOP|X=500mil|Y=250mil|ROTATION=90|PATTERN=C0402|SOURCEDESIGNATOR=C1",
  "|RECORD=Pad|COMPONENT=0|NET=0|LAYER=TOP|NAME=1|HOLESIZE=0mil|X=480mil|Y=250mil|XSIZE=20mil|YSIZE=24mil|SHAPE=RECTANGLE|ROTATION=90",
  "|RECORD=Pad|COMPONENT=0|NET=1|LAYER=MULTILAYER|NAME=2|HOLESIZE=12mil|PLATED=TRUE|X=520mil|Y=250mil|XSIZE=30mil|YSIZE=30mil|SHAPE=ROUND",
  "|RECORD=Track|LAYER=TOP|NET=1|X1=520mil|Y1=250mil|X2=800mil|Y2=250mil|WIDTH=8mil",
  "|RECORD=Track|LAYER=TOPOVERLAY|X1=450mil|Y1=200mil|X2=550mil|Y2=200mil|WIDTH=6mil",
  "|RECORD=Arc|LAYER=BOTTOM|NET=0|WIDTH=8mil|LOCATION.X=200mil|LOCATION.Y=200mil|STARTANGLE=0|ENDANGLE=90|RADIUS=50mil",
  "|RECORD=Via|NET=1|HOLESIZE=10mil|X=800mil|Y=250mil|DIAMETER=20mil|STARTLAYER=TOP|ENDLAYER=BOTTOM",
  "|RECORD=Region|NET=0|LAYER=BOTTOM|KIND=0|KIND0=0|VX0=100mil|VY0=100mil|KIND1=0|VX1=300mil|VY1=100mil|KIND2=0|VX2=300mil|VY2=300mil",
  // A 0402 resistor (KiCad R_0402_1005Metric pads: ±0.51 mm, 0.54 × 0.64 mm), turned 90° — and one on the bottom.
  "|RECORD=Component|ID=1|LAYER=TOP|X=300mil|Y=400mil|ROTATION=90|PATTERN=R0402|SOURCEDESIGNATOR=R1",
  "|RECORD=Pad|COMPONENT=1|NET=0|LAYER=TOP|NAME=1|HOLESIZE=0mil|X=300mil|Y=379.9213mil|XSIZE=21.2598mil|YSIZE=25.1969mil|SHAPE=RECTANGLE|ROTATION=90",
  "|RECORD=Pad|COMPONENT=1|NET=1|LAYER=TOP|NAME=2|HOLESIZE=0mil|X=300mil|Y=420.0787mil|XSIZE=21.2598mil|YSIZE=25.1969mil|SHAPE=RECTANGLE|ROTATION=90",
  "|RECORD=Component|ID=2|LAYER=BOTTOM|X=700mil|Y=400mil|ROTATION=0|PATTERN=R0402|SOURCEDESIGNATOR=R2",
  "|RECORD=Pad|COMPONENT=2|NET=0|LAYER=BOTTOM|NAME=1|HOLESIZE=0mil|X=720.0787mil|Y=400mil|XSIZE=21.2598mil|YSIZE=25.1969mil|SHAPE=RECTANGLE|ROTATION=0",
  "|RECORD=Pad|COMPONENT=2|NET=1|LAYER=BOTTOM|NAME=2|HOLESIZE=0mil|X=679.9213mil|Y=400mil|XSIZE=21.2598mil|YSIZE=25.1969mil|SHAPE=RECTANGLE|ROTATION=0",
  // The real board shape on Keep-Out, inside the rectangular board region: two edges and two half circles.
  "|RECORD=Track|LAYER=KEEPOUT|X1=200mil|Y1=100mil|X2=800mil|Y2=100mil|WIDTH=4mil",
  "|RECORD=Arc|LAYER=KEEPOUT|WIDTH=4mil|LOCATION.X=800mil|LOCATION.Y=250mil|STARTANGLE=270|ENDANGLE=450|RADIUS=150mil",
  "|RECORD=Track|LAYER=KEEPOUT|X1=800mil|Y1=400mil|X2=200mil|Y2=400mil|WIDTH=4mil",
  "|RECORD=Arc|LAYER=KEEPOUT|WIDTH=4mil|LOCATION.X=200mil|LOCATION.Y=250mil|STARTANGLE=90|ENDANGLE=270|RADIUS=150mil",
  "",
];
(async () => {
  const bytes = new TextEncoder().encode(lines.join("\r\n"));
  const bundle: any = await parseEdaProject([{ path: "board.PcbDoc", bytes }] as any);
  const pcb = bundle.pcbs[0];
  assert.ok(pcb, "a PCB is produced");
  assert.deepEqual(pcb.boardOutline.map((e: any) => e.kind).sort(), ["arc", "arc", "line", "line"], "outline: the closed Keep-Out loop, not the board region");
  assert.equal(pcb.footprints.length, 3);
  assert.equal(pcb.footprints[0].reference, "C1");
  assert.equal(pcb.footprints[0].padIds.length, 2);
  // Standard models matched by the pads (package-models.ts), said so.
  const [, r1, r2] = pcb.footprints;
  assert.match(r1.models?.[0]?.path ?? "", /R_0402_1005Metric\.step$/, "turned top-side 0402 matched");
  assert.equal(r1.models[0].standard.rule.length > 0, true);
  assert.match(r2.models?.[0]?.path ?? "", /R_0402_1005Metric\.step$/, "bottom-side 0402 matched");
  assert.equal(pcb.footprints[0].models, undefined, "C1's two pads are not a standard 0402 layout: no model");
  const [smd, tht] = pcb.pads;
  assert.equal(smd.padType, "smd");
  assert.equal(smd.shape, "rect");
  assert.deepEqual(smd.layers, ["F.Cu"]);
  assert.equal(Number(smd.size.x).toFixed(3), "0.508");
  assert.equal(tht.padType, "thru_hole");
  assert.equal(tht.shape, "circle");
  assert.deepEqual(tht.layers, ["*.Cu"]);
  assert.equal(tht.netName, "VCC");
  assert.equal(Number(pcb.pads[0].position.y).toFixed(3), "-6.350", "Y flipped like the binary reader");
  assert.equal(pcb.tracks.filter((t: any) => t.kind === "segment" && t.layer === "F.Cu").length, 1, "copper track");
  assert.equal(pcb.tracks.filter((t: any) => t.kind === "arc" && t.layer === "B.Cu").length, 1, "copper arc");
  assert.equal(pcb.silkscreen.graphics.length, 1, "overlay line goes to the silkscreen");
  assert.equal(pcb.vias.length, 1);
  assert.equal(pcb.zones.length, 1, "free copper region");
  assert.ok(!bundle.diagnostics.some((d: any) => d.code === "ALTIUM_ASCII_PCB_UNSUPPORTED"));
  console.log("altium ascii pcb checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
