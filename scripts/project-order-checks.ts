/** A repository with several projects offers the design first, not a stray board file in doc/gen. */
import assert from "node:assert/strict";
import { discoverProjects } from "../src/lib/maker/github-projects";

const f = (path: string) => ({ path, size: 5000, sha: "x", type: "blob" });
// mlab-modules/STM32TQ6401: doc/gen/*.brd is a BRDOUT text export, not an EAGLE board.
const projects = discoverProjects([
  f("doc/gen/STM32TQ6401.brd"),
  f("hw/sch_pcb/STM32TQ6401.kicad_pro"),
  f("hw/sch_pcb/STM32TQ6401.kicad_sch"),
  f("hw/sch_pcb/STM32TQ6401.kicad_pcb"),
  f("hw/sch_pcb/STM32_Overview/STM32_Overview.kicad_pro"),
  f("hw/sch_pcb/STM32_Overview/STM32_Overview.kicad_sch"),
  f("hw/sch_pcb/STM32_Overview/STM32_Overview.kicad_pcb"),
]);
assert.deepEqual(projects.map((p) => p.directory), ["hw/sch_pcb", "hw/sch_pcb/STM32_Overview", "doc/gen"]);
console.log("project order checks passed");
