/**
 * KiCad 4/5 projects published without their symbol cache (googlecreativelab/open-nsynth-super): the
 * viewer finds the missing symbols, the server picks them from KiCad's standard libraries, and the
 * schematic draws them. Also: KiCad 4 components without a library prefix resolve from the
 * project's own .lib, and a GitHub import brings the libraries a .pro lists.
 */
import assert from "node:assert/strict";
import { legacyLibraries, missingLegacySymbols, STANDARD_LIBRARY_PATH } from "../src/vendor/eelib/kicad-legacy";
import { referencedFiles } from "../src/lib/maker/github-projects";

const enc = new TextEncoder();
const lib = (defs: string) => `EESchema-LIBRARY Version 2.3\n#encoding utf-8\n${defs}\n#End Library\n`;
const def = (name: string, alias = "") =>
  `#\n# ${name}\n#\nDEF ${name} U 0 40 Y Y 1 F N\nF0 "U" 0 100 50 H V C CNN\nF1 "${name}" 0 -100 50 H V C CNN\n${alias ? "ALIAS " + alias + "\n" : ""}DRAW\nS -100 100 100 -100 0 1 0 N\nX A 1 -200 0 100 R 50 50 1 1 P\nENDDRAW\nENDDEF`;
const sch = `EESchema Schematic File Version 2\nLIBS:power\nLIBS:custom\n$Comp\nL touch T1\nU 1 1 5A000000\nP 1000 1000\n$EndComp\n$Comp\nL R R1\nU 1 1 5A000001\nP 2000 1000\n$EndComp\n$Comp\nL CONN_01X08 J3\nU 1 1 5A000002\nP 3000 1000\n$EndComp\n$EndSCHEMATC\n`;
const pro = "[eeschema/libraries]\nLibName1=power\nLibName2=device\nLibName3=conn\nLibName4=custom\n";
const assets = [
  { path: "p/board.sch", bytes: enc.encode(sch) },
  { path: "p/board.pro", bytes: enc.encode(pro) },
  { path: "p/custom.lib", bytes: enc.encode(lib(def("touch"))) },
];

// The project's own symbol resolves without a prefix; the standard ones are reported missing, with
// the .pro's library list.
const missing = missingLegacySymbols(assets)!;
assert.equal(missing.version, 4);
assert.deepEqual(missing.names.sort(), ["CONN_01X08", "R"]);
assert.deepEqual(missing.libraries, ["power", "device", "conn", "custom"]);

// With the standard library added (as the viewer does), nothing is missing; case-insensitive match
// covers KiCad 4.0.7's renamed Conn_01x08.
const withStd = [...assets, { path: STANDARD_LIBRARY_PATH, bytes: enc.encode(lib(def("R") + "\n" + def("Conn_01x08"))) }];
assert.equal(missingLegacySymbols(withStd), null);
assert.ok(legacyLibraries(withStd).byName.size >= 2);

// KiCad 5 nicknames.
const sch5 = sch.replace("L touch T1", "L Device:R R9").replace("L R R1", "L Connector:Conn_01x08 J1").replace("L CONN_01X08 J3", "L power:GND #PWR1");
const m5 = missingLegacySymbols([{ path: "b.sch", bytes: enc.encode(sch5) }])!;
assert.equal(m5.version, 5);
assert.deepEqual(m5.libraries.sort(), ["Connector", "Device", "power"]);

// A KiCad 4/5 .pro brings the libraries it lists into a GitHub import.
assert.deepEqual(referencedFiles("hw/board.pro", pro), ["hw/power.lib", "hw/device.lib", "hw/conn.lib", "hw/custom.lib"]);

// Server: picks the requested symbols from the named standard libraries, aliases and case included.
void (async () => {
  const realFetch = globalThis.fetch;
  const served: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    served.push(url);
    if (url.endsWith("/power.lib")) return new Response(lib(def("GND")));
    if (url.endsWith("/device.lib")) return new Response(lib(def("R") + "\n" + def("TPS76316", "TPS76333 TPS76350")));
    if (url.endsWith("/conn.lib")) return new Response(lib(def("Conn_01x08")));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  const { legacyStandardSymbols } = await import("../src/lib/maker/kicad-legacy-symbols");
  const out = await legacyStandardSymbols(4, ["power", "device", "conn", "custom"], ["R", "GND", "TPS76333", "CONN_01X08", "NOPE"]);
  assert.deepEqual(out.found.sort(), ["CONN_01X08", "GND", "R", "TPS76333"]);
  assert.deepEqual(out.missing, ["NOPE"]);
  assert.match(out.text, /^EESchema-LIBRARY/);
  assert.match(out.text, /DEF CONN_01X08 /, "case-insensitive match renamed to the requested name");
  assert.ok(served.every((u) => u.startsWith("https://raw.githubusercontent.com/KiCad/kicad-library/4.0.7/library/")));
  globalThis.fetch = realFetch;
  console.log("legacy symbols checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
