#!/usr/bin/env node
// npm test — runs every scripts/*-checks.ts(x). Offline: no partdata, GitHub or KiCad network needed,
// except kicad name resolution which reads the committed index.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = readdirSync(new URL(".", import.meta.url)).filter((f) => /-checks\.tsx?$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  // React DOM server rendering (.tsx) must not run under the react-server condition.
  const args = [...(f.endsWith(".tsx") ? [] : ["--conditions=react-server"]), "--no-deprecation", "--import", "tsx", "scripts/" + f];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, PARTDATA_API_BASE: "", PARTDATA_API_KEY: "", PARTDATA_API_SECRET: "" } });
  const ok = r.status === 0;
  if (!ok) failed++;
  const last = (r.stdout || "").trim().split("\n").filter(Boolean).at(-1) || "";
  console.log(`${ok ? "PASS" : "FAIL"}  ${f}${ok ? "" : "\n" + (r.stderr || r.stdout).slice(-1500)}`);
  if (ok && process.env.VERBOSE) console.log("      " + last);
}
console.log(`\n${files.length - failed}/${files.length} check files passed`);
process.exit(failed ? 1 : 0);
