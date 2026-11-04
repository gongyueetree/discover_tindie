/**
 * A KiCad board with a huge filled zone (googlecreativelab/open-nsynth-super: 7.8 MB, KiCad 4) used to
 * fail with "Maximum call stack size exceeded": children and point lists were spread into function
 * arguments (push(...xs), Math.min(...xs)), which overflows past ~100k items.
 */
import assert from "node:assert/strict";
import { filesToInputAssets } from "../src/vendor/canon/lib/eda/archive";
import { parseEdaProject } from "../src/vendor/canon/lib/eda/parse";

const N = 200_000;
const pts: string[] = [];
for (let i = 0; i < N; i++) pts.push(`(xy ${(i % 1000) / 10} ${Math.floor(i / 1000) / 10})`);
const pcb = `(kicad_pcb (version 4) (host pcbnew 4.0.6)
  (layers (0 F.Cu signal) (31 B.Cu signal) (44 Edge.Cuts user))
  (gr_line (start 0 0) (end 100 0) (layer Edge.Cuts) (width 0.1))
  (gr_line (start 100 0) (end 100 20) (layer Edge.Cuts) (width 0.1))
  (gr_line (start 100 20) (end 0 20) (layer Edge.Cuts) (width 0.1))
  (gr_line (start 0 20) (end 0 0) (layer Edge.Cuts) (width 0.1))
  (zone (net 0) (net_name "") (layer F.Cu) (tstamp 0) (hatch edge 0.508)
    (polygon (pts (xy 0 0) (xy 100 0) (xy 100 20) (xy 0 20)))
    (filled_polygon (pts ${pts.join(" ")}))))`;

void (async () => {
  const r = await filesToInputAssets([new File([pcb], "big.kicad_pcb")]);
  const bundle: any = await parseEdaProject(r.assets, r.diagnostics);
  assert.equal(bundle.pcbs.length, 1, "the board parses");
  console.log("large board checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
