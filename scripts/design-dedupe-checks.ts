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


// A circuit module's list built from several component-family lists (parts database without the module
// filter): the folder record arrives through one family, the project-page record through another.
import http from "node:http";
const raw = (d: any) => ({ id: d.id, name: d.name, kind: d.kind, source_url: d.sourceUrl, license: d.license, stars: d.stars, eda_tool: d.edaTool, part_count: d.partCount });
const server = http.createServer((req, res) => {
  const u = new URL(req.url!, "http://x");
  const send = (code: number, body: any) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (u.pathname === "/api/pub/v1/designs" && u.searchParams.has("function")) return send(400, { error: { code: "bad_request", message: "unknown filter" } });
  if (u.pathname.startsWith("/api/kg/v1/rankings/functions/")) return send(200, { data: { items: [{ family: "FAM_A" }, { family: "FAM_B" }] } });
  if (u.pathname === "/api/pub/v1/designs") {
    const items = u.searchParams.get("family") === "FAM_A" ? [one] : [page, opera];
    return send(200, { data: { items: items.map(raw) }, meta: { pagination: { total: items.length } } });
  }
  send(404, {});
});
server.listen(0, async () => {
  const port = (server.address() as any).port;
  process.env.PARTDATA_API_BASE = `http://127.0.0.1:${port}`;
  process.env.PARTDATA_API_KEY = "k";
  process.env.PARTDATA_API_SECRET = "s";
  try {
    const { designsBy } = await import("../src/lib/partdata/maker");
    const r = await designsBy({ function: "mcu" }, 0, "visitor");
    assert.equal(r.approximate, true);
    assert.deepEqual(r.items.map((d) => d.id).sort(), ["d_a", "d_c"], "the same board through two families is listed once");
    console.log("design dedupe across families passed");
  } finally {
    server.close();
  }
});
