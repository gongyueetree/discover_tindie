/** EasyEDA Standard boards in 3D: millimetres, KiCad copper names, body envelopes from outline3D. */
import assert from "node:assert/strict";
import { bodyHeight, easyEdaBodies, isEasyEdaStandard, pcbInMm } from "../src/lib/maker/easyeda-3d";

assert.equal(bodyHeight("C0402_L1.0-W0.5-H0.5"), 0.5);
assert.equal(bodyHeight("CAP-TH_D8.0-H8.0-P3.50"), 8);
assert.equal(bodyHeight("HDR-M-2.54_1x3"), 8.5);
assert.equal(bodyHeight("WIRELM-SMD_ESP32-S3-WROOM-1"), 3.1);
assert.equal(bodyHeight("something-unknown"), 1.5);

const pcb: any = {
  coordinateSystem: { sourceUnits: "EasyEDA standard source token" },
  pads: [{ position: { x: "100", y: "200", unit: "mm" }, size: { x: "10", y: "5" }, layers: ["TopLayer", "Multi-Layer"], number: "12", rotation: "90" }],
  footprints: [{ reference: "U1", position: { x: "4053", y: "3589" }, rotation: "90", side: "back" }],
  tracks: [{ start: { x: "0", y: "0" }, end: { x: "10", y: "0" }, width: "1" }],
  sourceRefs: [{ path: "PCB.json" }],
};
assert.ok(isEasyEdaStandard(pcb));
const mm: any = pcbInMm(pcb);
assert.deepEqual(mm.pads[0].position, { x: "25.4", y: "50.8", unit: "mm" });
assert.deepEqual(mm.pads[0].size, { x: "2.54", y: "1.27" });
assert.deepEqual(mm.pads[0].layers, ["F.Cu", "*.Cu"]);
assert.equal(mm.pads[0].number, "12", "pad numbers are not lengths");
assert.equal(mm.pads[0].rotation, "90", "angles are not lengths");
assert.equal(mm.tracks[0].width, "0.254");

const lib =
  "LIB~4053~3589~package`X`~90~~gge1~1#@$" +
  'SVGNODE~{"nodeName":"g","attrs":{"c_etype":"outline3D","title":"C0603_L1.6-W0.8-H0.8","z":"0"},"childNodes":[{"nodeName":"polyline","attrs":{"points":"4050 3580 4056 3580 4056 3598 4050 3598"}}]}';
const asset = { path: "PCB.json", bytes: new TextEncoder().encode(JSON.stringify({ head: { docType: "3" }, shape: [lib, "TRACK~1~1~~0 0 1 1"] })) };
const bodies = easyEdaBodies(pcb, [asset]);
assert.equal(bodies.length, 1);
const b = bodies[0];
assert.equal(b.reference, "U1");
assert.ok(Math.abs(b.x - 4053 * 0.254) < 1e-6 && Math.abs(b.y - 3589 * 0.254) < 1e-6);
assert.ok(Math.abs(b.w - 6 * 0.254) < 1e-6 && Math.abs(b.h - 18 * 0.254) < 1e-6);
assert.equal(b.height, 0.8);
assert.equal(b.bottom, true);
assert.deepEqual(easyEdaBodies(pcb, [{ path: "SCH.json", bytes: new TextEncoder().encode('{"head":{"docType":"1"},"shape":[]}') }]), []);
console.log("easyeda 3d checks passed");

// EasyEDA OBJ: inline materials, quads fanned into triangles, faces grouped by material.
import { parseEasyEdaObj } from "../src/lib/maker/easyeda-3d";
const obj = parseEasyEdaObj(
  ["newmtl a", "Kd 0.1 0.2 0.3", "d 0", "endmtl", "newmtl b", "Kd 1 1 1", "d 0.5", "endmtl", "v 0 0 0", "v 1 0 0", "v 1 1 0", "v 0 1 0", "v 0 0 1", "usemtl a", "f 1/1/1 2/2/2 3/3/3 4/4/4", "usemtl b", "f 1 2 5", "f 1 2 99"].join("\n"),
);
assert.equal(obj.length, 2);
assert.deepEqual(obj[0].color, [0.1, 0.2, 0.3]);
assert.equal(obj[0].positions.length, 2 * 3 * 3, "a quad is two triangles");
assert.equal(obj[1].opacity, 0.5);
assert.equal(obj[1].positions.length, 9, "a face pointing past the vertex list is dropped");
