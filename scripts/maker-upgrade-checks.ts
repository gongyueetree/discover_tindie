import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import {
  discoverProjects,
  referencedFiles,
  resolveRepoPath,
} from "../src/lib/maker/github-projects";
import { ibomData, scriptJson } from "../src/lib/maker/ibom";
import { filesToInputAssets } from "../src/vendor/canon/lib/eda/archive";
import { parseEdaProject } from "../src/vendor/canon/lib/eda/parse";
import { hasChinese, terminology, withUnit } from "../src/lib/maker/english";
async function main() {
  const f = (path: string) => ({ path, size: 100, sha: "x", type: "blob" });
  const projects = discoverProjects(
    [
      "hw/v1/board.kicad_pcb",
      "hw/v1/board.kicad_sch",
      "hw/v2/board.kicad_pcb",
      "hw/v2/board.kicad_sch",
      "other/board.brd",
      "other/board.sch",
      "backups/board.kicad_pcb",
      "firmware/test.sch",
    ].map(f),
  );
  assert.equal(projects.length, 2);
  assert.equal(projects[0].id, "hw/v2/board.kicad_pcb");
  assert.equal(projects[0].recommended, true);
  assert.deepEqual(projects[0].roots, [
    "hw/v2/board.kicad_pcb",
    "hw/v2/board.kicad_sch",
  ]);
  assert.deepEqual(
    referencedFiles(
      "hw/main.kicad_sch",
      '(property "Sheetfile" "sheets/power.kicad_sch") (model "${KIPRJMOD}/3d/u1.step")',
    ),
    ["hw/sheets/power.kicad_sch", "hw/3d/u1.step"],
  );
  assert.equal(resolveRepoPath("hw", "../../outside"), null);
  assert.equal(resolveRepoPath("hw", "https://evil.test/x"), null);
  assert.equal(withUnit("64 MHz", "MHz"), "64 MHz");
  assert.equal(withUnit(16, "KB"), "16 KB");
  assert.equal(hasChinese(terminology("供电电压")), false);
  for (const name of ["kicad-demo", "eagle-led"]) {
    const input = await filesToInputAssets([
      new File(
        [readFileSync("public/examples/" + name + ".zip")],
        name + ".zip",
      ),
    ]);
    const b = await parseEdaProject(input.assets, input.diagnostics);
    const p = b.pcbs[0];
    const d = ibomData(b, p);
    assert.equal(d.footprints.length, p.footprints.length);
    assert.equal(
      d.footprints.flatMap((f) => f.pads).length,
      p.pads.filter((p) => p.footprintId).length,
    );
    assert.ok(d.edges.length > 0);
    assert.ok(d.bom.both.flat().length === p.footprints.length);
    assert.ok(d.edges_bbox.maxx > d.edges_bbox.minx);
    p.footprints[0].side = "back";
    const d2 = ibomData(b, p);
    assert.ok(d2.bom.B.flat().some((r) => r[1] === 0));
    const part =
      b.parts.find((x) => x.footprintInstanceId === p.footprints[0].id) ||
      b.parts.find((x) => x.reference === p.footprints[0].reference);
    assert.ok(part);
    part.variantStatus = "dnp";
    const d3 = ibomData(b, p);
    assert.ok(d3.bom.skipped.includes(0));
    assert.ok(!d3.bom.both.flat().some((r) => r[1] === 0));
  }
  assert.ok(
    !scriptJson({ title: "</script><img src=x onerror=alert(1)>" }).includes(
      "<",
    ),
  );
  console.log(
    "GitHub project selection/revisions/dependencies, unit handling, KiCad + Eagle iBOM geometry/sides/DNP and safe script embedding passed.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
