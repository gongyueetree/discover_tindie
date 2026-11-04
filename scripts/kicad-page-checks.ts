/**
 * Exported KiCad boards sit in the middle of the A4 sheet instead of over its top-left corner:
 * top-level items move, footprint contents (relative to the footprint) do not.
 */
import assert from "node:assert/strict";
import { pageOffset, shiftBoard } from "../src/lib/maker/planner-export";

assert.deepEqual(pageOffset(80, 60), { x: 109, y: 75 });
assert.deepEqual(pageOffset(400, 300), { x: 10, y: 10 }, "never closer than 10 mm to the sheet corner");

const src = `(kicad_pcb (version 20250114)
  (gr_line (start 4.8 0) (end 75.2 0) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_arc (start 75.2 0) (mid 78.5941 1.4059) (end 80 4.8) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts"))
  (gr_poly (pts (xy 0 0) (xy 1 2)) (layer "Edge.Cuts"))
  (via (at 3 4) (size 0.6) (drill 0.3) (layers "F.Cu" "B.Cu") (net 0))
  (footprint "X:Y" (layer "F.Cu") (at 40 30 90) (property "Reference" "U1" (at 0 -3) (layer "F.SilkS"))
    (pad "1" smd rect (at -1 2 90) (size 1 1) (layers "F.Cu")))
)`;
const out = shiftBoard(src, 109, 75);
assert.match(out, /\(gr_line \(start 113\.8 75\) \(end 184\.2 75\)/);
assert.match(out, /\(gr_arc \(start 184\.2 75\) \(mid 187\.5941 76\.4059\) \(end 189 79\.8\)/);
assert.match(out, /\(pts \(xy 109 75\) \(xy 110 77\)\)/);
assert.match(out, /\(via \(at 112 79\)/);
assert.match(out, /\(footprint "X:Y" \(layer "F\.Cu"\) \(at 149 105 90\)/, "footprint position moves, rotation kept");
assert.match(out, /\(property "Reference" "U1" \(at 0 -3\)/, "footprint-relative text stays");
assert.match(out, /\(pad "1" smd rect \(at -1 2 90\)/, "pads stay relative to the footprint");
assert.equal(shiftBoard(src, 0, 0), src);
console.log("kicad page checks passed");
