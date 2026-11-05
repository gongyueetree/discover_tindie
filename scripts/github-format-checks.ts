/**
 * GitHub project discovery for every format the viewer opens: KiCad (6+ and 5), Eagle,
 * Altium Designer, EasyEDA standard and JLCEDA Pro.   (part of npm test)
 */
import assert from "node:assert/strict";
import { discoverProjects, referencedFiles, type RepoFile } from "../src/lib/maker/github-projects";

const f = (path: string): RepoFile => ({ path, sha: "0", size: 10, type: "blob" });
const files = [
  "kicad6/board.kicad_pro", "kicad6/board.kicad_sch", "kicad6/board.kicad_pcb",
  "kicad5/main.sch", "kicad5/main.kicad_pcb", "kicad5/main-cache.lib",
  "eagle/led.sch", "eagle/led.brd",
  "altium/Controller.PrjPcb", "altium/Power.SchDoc", "altium/MCU.SchDoc", "altium/Controller.PcbDoc",
  "easyeda/Schematic_Blackbox_2021-01-02.json", "easyeda/PCB_Blackbox_2021-01-02.json",
  "hw/jlc/Blackbox.epro",
  "firmware/package.json", "docs/settings.json", "web/tsconfig.json",
].map(f);
const projects = discoverProjects(files);
const by = (dir: string) => projects.filter((p) => p.directory === dir);

assert.equal(by("kicad6")[0].format, "KiCad");
assert.deepEqual(by("kicad5")[0].roots.sort(), ["kicad5/main.kicad_pcb", "kicad5/main.sch"]);
assert.equal(by("eagle")[0].format, "Eagle");
const altium = by("altium")[0];
assert.equal(altium.format, "Altium");
assert.equal(altium.name, "Controller");
assert.equal(altium.roots.length, 4, "every Altium document in the folder");
const easy = by("easyeda")[0];
assert.equal(easy.format, "EasyEDA");
assert.equal(easy.roots.length, 2);
const pro = by("hw/jlc")[0];
assert.equal(pro.format, "JLCEDA Pro");
assert.deepEqual(pro.roots, ["hw/jlc/Blackbox.epro"]);
assert.ok(!projects.some((p) => /firmware|docs|web/.test(p.directory)), "unrelated JSON is not a design");

assert.deepEqual(referencedFiles("altium/Controller.PrjPcb", "[Document1]\r\nDocumentPath=Sheets\\IO.SchDoc\r\n"), ["altium/Sheets/IO.SchDoc"]);
assert.deepEqual(referencedFiles("kicad5/main.sch", 'EESchema Schematic File Version 4\n$Sheet\nF0 "Power" 50\nF1 "power.sch" 50\n$EndSheet\n'), ["kicad5/power.sch"]);
// KiCad 5 writes these unquoted: project symbol libraries (sym-lib-table) and 3D models.
assert.deepEqual(
  referencedFiles("hardware/sym-lib-table", "(sym_lib_table\n  (lib (name -Chip)(type Legacy)(uri ${KIPRJMOD}/library/symbol/Chip.lib)(options \"\")(descr \"\"))\n  (lib (name power)(type Legacy)(uri ${KICAD_SYMBOL_DIR}/power.lib)(options \"\")(descr \"\"))\n)"),
  ["hardware/library/symbol/Chip.lib"],
);
assert.deepEqual(
  referencedFiles("hardware/PD_Micro.kicad_pcb", "(module x (model ${KIPRJMOD}/library/3d_model/Passive/C_0402.STEP\n (at (xyz 0 0 0))))(model ${KISYS3DMOD}/Diode_SMD.3dshapes/D_SOD-123.wrl"),
  ["hardware/library/3d_model/Passive/C_0402.STEP"],
);
console.log("PASS: KiCad 6 / KiCad 5 / Eagle / Altium / EasyEDA / JLCEDA Pro project discovery and references");
