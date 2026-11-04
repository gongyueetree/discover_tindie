/** One board recorded twice (folder import + project page linking the repository) is listed once. */
import assert from "node:assert/strict";
import { dedupeDesigns } from "../src/lib/partdata/maker";

const base = { kind: "open_source" as const, license: null, stars: 8186, edaTool: "kicad", summary: null };
const one = { ...base, id: "d_a", name: "hackrf - hackrf-one", partCount: 99, sourceUrl: "https://github.com/greatscottgadgets/hackrf/tree/abc123/hardware/hackrf-one", license: "CERN-OHL-P-2.0" };
const page = { ...base, id: "d_b", name: "Opera Cake: DOPPLER DIRECTION FINDING WITH SOFTWARE DEFINED RADIO", partCount: 99, sourceUrl: "https://github.com/greatscottgadgets/hackrf/tree/abc123", license: "GPL-2.0" };
const opera = { ...base, id: "d_c", name: "hackrf - operacake", partCount: 41, sourceUrl: "https://github.com/greatscottgadgets/hackrf/tree/abc123/hardware/operacake" };
const other = { ...base, id: "d_d", name: "other", partCount: 99, sourceUrl: "https://github.com/someone/else" };
const vendor = { ...base, id: "d_e", kind: "vendor" as const, name: "TI board", partCount: 99, sourceUrl: "https://www.ti.com/tool/X" };

assert.deepEqual(dedupeDesigns([page, one, opera, other, vendor] as any).map((d) => d.id), ["d_a", "d_c", "d_d", "d_e"]);
assert.deepEqual(dedupeDesigns([one, page] as any).map((d) => d.id), ["d_a"], "order does not matter");
console.log("design dedupe checks passed");
