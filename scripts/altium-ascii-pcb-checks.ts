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
  "",
];
(async () => {
  const bytes = new TextEncoder().encode(lines.join("\r\n"));
  const bundle: any = await parseEdaProject([{ path: "board.PcbDoc", bytes }] as any);
  const pcb = bundle.pcbs[0];
  assert.ok(pcb, "a PCB is produced");
  assert.equal(pcb.boardOutline.length, 4, "outline: 4 edges (closing vertex not repeated)");
  assert.equal(pcb.footprints.length, 1);
  assert.equal(pcb.footprints[0].reference, "C1");
  assert.equal(pcb.footprints[0].padIds.length, 2);
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
  assert.equal(pcb.tracks.filter((t: any) => t.kind === "segment").length, 1, "copper track");
  assert.equal(pcb.tracks.filter((t: any) => t.kind === "arc").length, 1, "copper arc");
  assert.equal(pcb.silkscreen.graphics.length, 1, "overlay line goes to the silkscreen");
  assert.equal(pcb.vias.length, 1);
  assert.equal(pcb.zones.length, 1, "free copper region");
  assert.ok(!bundle.diagnostics.some((d: any) => d.code === "ALTIUM_ASCII_PCB_UNSUPPORTED"));
  console.log("altium ascii pcb checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
