/**
 * Route-level checks for /api/maker/* against a mocked partdata Partner API.
 *   npm run test:maker:api
 * Verifies request signing headers are sent, partdata responses map to the UI shapes,
 * BOM statuses map without guessing, and failures surface as visitor-facing errors.
 */
import assert from "node:assert/strict";
import { NextRequest } from "next/server";

process.env.PARTDATA_API_BASE = "https://partdata.test";
process.env.PARTDATA_API_KEY = "pk_test";
process.env.PARTDATA_API_SECRET = "secret";

type Call = { url: URL; method: string; headers: Headers; body: string };
const calls: Call[] = [];
const P = (id: string, mpn: string, mfr = "意法半导体") => ({
  id, mpn, manufacturer: mfr, category: "微控制器（MCU）", description_en: "MCU", lifecycle: "量产",
});
const routes: Record<string, (c: Call) => unknown> = {
  "/api/pub/v1/parts/lookup": (c) => ({ data: { match: c.url.searchParams.get("mpn") === "STM32F103C8T6" ? "exact" : "none", items: c.url.searchParams.get("mpn") === "STM32F103C8T6" ? [P("p_aaaaaaaaaa", "STM32F103C8T6")] : [] }, meta: {} }),
  "/api/pub/v1/parts/search": () => ({ data: { items: [P("p_aaaaaaaaaa", "STM32F103C8T6"), P("p_bbbbbbbbbb", "STM32F103CBT6")] }, meta: { pagination: { has_more: false } } }),
  "/api/pub/v1/designs": (c) => ({
    data: {
      items: [
        { id: "d_cccccccccc", name: "Board", kind: "open_source", source_url: "https://github.com/a/b/tree/abc1234", license: "MIT", stars: 5, eda_tool: "KiCad", part_count: 9, summary: null },
        { id: "d_dddddddddd", name: "Zero-star board", kind: "open_source", source_url: "https://github.com/a/z", license: "MIT", stars: 0, eda_tool: "KiCad", part_count: 9, summary: null },
        { id: "d_eeeeeeeeee", name: "RS-485 reference", kind: "vendor", source_url: "https://www.ti.com/tool/TIDA-00001", license: null, stars: null, eda_tool: null, part_count: 7, summary: null },
      ],
    },
    meta: { pagination: { total: 3 } },
  }),
  "/api/pub/v1/parts/p_ezezezezez": () => ({
    data: { ...P("p_ezezezezez", "WS2812B-FIX", "Worldsemi"), symbol: { value: "EZ_WS2812B" }, footprint: { value: "EZ_LED_5050" },
      used_in_designs: 0, ezplm_library: { symbol: true, footprint: true, model: false } },
    meta: {},
  }),
  "/api/pub/v1/parts/p_ezezezezez/cad/footprint": () =>
    new Response('(footprint "EZ_LED_5050" (layer "F.Cu") (pad "1" smd rect (at 0 0) (size 1 1) (layers "F.Cu")))', { headers: { "content-type": "application/x-kicad-footprint" } }),
  "/api/pub/v1/parts/p_ezezezezez/cad/symbol": () =>
    new Response('(kicad_symbol_lib (symbol "EZ_WS2812B" (symbol "EZ_WS2812B_1_1" (pin input line (at -5.08 0 0) (length 2.54) (name "DIN") (number "4")))))', { headers: { "content-type": "application/x-kicad-symbol" } }),
  "/api/kg/v1/snapshots/current": () => ({ data: { snapshot_id: 1, designs: 40 }, meta: { computed_at: "2026-11-01T00:00:00Z" } }),
  "/api/kg/v1/rankings/functions/mcu/families": () => ({
    data: { items: [{ family: "RP2040", label: "RP2040", manufacturer: "树莓派", kind: "ic", adoption_count: 12 }, { family: "W25Q128", label: "W25Q128JVSIQ", manufacturer: "Winbond", kind: "ic", adoption_count: 9 }] },
    meta: { denominator_count: 20, pagination: { total: 2 } },
  }),
  "/api/kg/v1/neighborhood": (c) => ({
    data: { edges: c.url.searchParams.get("entity_id") === "fam:RP2040" ? [{ source: "RP2040", target: "W25Q128", support_count: 8, jaccard: 0.6 }] : [] },
    meta: {},
  }),
  "/api/pub/v1/bom/match": (c) => ({
    data: { lines: JSON.parse(c.body).lines.map((l: any) => ({ ref: l.ref, status: l.mpn === "STM32F103C8T6" ? "exact" : l.mpn === "LM358" ? "candidates" : "not_found", items: l.mpn === "STM32F103C8T6" ? [P("p_aaaaaaaaaa", "STM32F103C8T6")] : l.mpn === "LM358" ? [P("p_dddddddddd", "LM358DR", "Texas Instruments")] : [] })) },
    meta: {},
  }),
};
let mode: "ok" | "quota" | "down" = "ok";
const VENDOR_PAGES: Record<string, string> = {
  "https://www.ti.com/tool/TIDA-00001": '<html><head><meta property="og:image" content="https://www.ti.com/content/dam/ticom/images/tida-00001.png"></head>',
  "https://evil.example/tool/x": '<html><head><meta property="og:image" content="https://evil.example/x.png"></head>',
};
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  if (VENDOR_PAGES[url.href] !== undefined) {
    const res = new Response(VENDOR_PAGES[url.href], { headers: { "content-type": "text/html; charset=utf-8" } });
    Object.defineProperty(res, "url", { value: url.href });
    return res;
  }
  const c = { url, method: init.method || "GET", headers: new Headers(init.headers), body: String(init.body || "") };
  calls.push(c);
  if (mode === "down") throw new TypeError("fetch failed");
  if (mode === "quota") return Response.json({ error: { code: "visitor_quota_exceeded", message: "x", retryable: false } }, { status: 429 });
  const h = routes[url.pathname];
  const out = h?.(c);
  return out instanceof Response ? out : out !== undefined ? Response.json(out) : Response.json({ error: { code: "not_found", message: "nf" } }, { status: 404 });
}) as typeof fetch;

async function main() {
  const { GET, POST } = await import("../src/app/api/maker/[...path]/route");
  const get = (path: string) => GET(new NextRequest("http://localhost/api/maker/" + path, { headers: { "x-forwarded-for": "203.0.113.9" } }), { params: { path: path.split("?")[0].split("/") } });

  // search: lookup + prefix search, exact first, English display, signed headers
  let r = await get("parts?q=STM32F103C8T6");
  let d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(d.items.map((p: any) => p.mpn), ["STM32F103C8T6", "STM32F103CBT6"]);
  assert.equal(d.items[0].manufacturer, "STMicroelectronics");
  assert.equal(d.items[0].category, "Microcontrollers (MCU)");
  const signed = calls.find((c) => c.url.pathname === "/api/pub/v1/parts/lookup")!;
  for (const h of ["X-Api-Key", "X-Timestamp", "X-Nonce", "X-Signature", "X-End-User"]) assert.ok(signed.headers.get(h), h);
  assert.match(signed.headers.get("X-End-User")!, /^[0-9a-f]{32}$/, "visitor is an anonymous hash, not the IP");
  assert.ok(!JSON.stringify(d).includes("secret"), "no credentials in responses");

  // too short is a 400 for the visitor, before calling partdata
  const before = calls.length;
  r = await get("parts?q=ST");
  assert.equal(r.status, 400);
  assert.equal(calls.length, before);

  // designs for a part
  r = await get("references/p_aaaaaaaaaa");
  d = await r.json();
  assert.deepEqual(d.items.map((x: any) => x.id).sort(), ["d_cccccccccc", "d_eeeeeeeeee"], "0-star open source dropped, vendor kept");
  assert.equal(d.items.find((x: any) => x.kind === "vendor").vendor, "Texas Instruments", "vendor named from its site");
  assert.equal(calls.at(-1)!.url.searchParams.get("part"), "p_aaaaaaaaaa");
  // vendor design pictures: og:image from the vendor's own page, known manufacturer sites only
  const { vendorImage } = await import("../src/lib/partdata/maker");
  assert.equal(await vendorImage("https://www.ti.com/tool/TIDA-00001"), "https://www.ti.com/content/dam/ticom/images/tida-00001.png");
  assert.equal(await vendorImage("https://evil.example/tool/x"), null, "unknown sites are not fetched");
  assert.equal(await vendorImage("http://www.ti.com/tool/TIDA-00001"), null, "HTTPS only");
  // ezPLM's own library: CAD preview and download when the official KiCad library lacks the part
  r = await get("cad/p_ezezezezez");
  d = await r.json();
  assert.equal(d.footprint.library, "ezPLM:EZ_LED_5050");
  assert.ok(d.footprint.preview, "ezPLM footprint drawn");
  assert.equal(d.symbol.library, "ezPLM:EZ_WS2812B");
  assert.equal(d.footprint.source, "/api/maker/cad/p_ezezezezez/footprint", "download goes through this site, never a partdata URL");
  r = await get("cad/p_ezezezezez/footprint");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition")!, /attachment; filename="EZ_LED_5050\.kicad_mod"/);
  assert.match(await r.text(), /^\(footprint "EZ_LED_5050"/);
  r = await get("cad/p_ezezezezez/model");
  assert.equal(r.status, 404, "no model in ezPLM's library → 404 without asking partdata");
  // circuit-module graph: the module's most used families and their co-occurrence
  const { GET: graphGet } = await import("../src/app/api/maker/graph/route");
  r = await graphGet(new NextRequest("http://localhost/api/maker/graph?module=mcu", { headers: { "x-forwarded-for": "203.0.113.9" } }));
  d = await r.json();
  assert.deepEqual(d.nodes.map((n: any) => n.id), ["RP2040", "W25Q128"]);
  assert.equal(d.edges.length, 1);
  assert.deepEqual(d.scope.module, { id: "mcu", designs: 20, items: [
    { family: "RP2040", label: "RP2040", manufacturer: "Raspberry Pi", count: 12 },
    { family: "W25Q128", label: "W25Q128JVSIQ", manufacturer: "Winbond", count: 9 },
  ] });
  // one visitor action = one call attributed to the visitor; the fan-out counts only toward the key
  const graphCalls = calls.filter((c) => c.url.pathname.startsWith("/api/kg/v1/"));
  assert.ok(graphCalls.length >= 3, "graph fans out");
  assert.equal(graphCalls.filter((c) => c.headers.get("X-End-User")).length, 1, "only the first graph call carries X-End-User");
  r = await graphGet(new NextRequest("http://localhost/api/maker/graph?module=..%2Fx"));
  assert.equal(r.status, 400);
  // card pictures load by themselves: never attributed to the visitor
  const nCover = calls.length;
  await get("circuits/d_cccccccccc/cover");
  assert.ok(calls.length > nCover && calls.slice(nCover).every((c) => !c.headers.get("X-End-User")), "passive lookups are not charged");
  // design ids are validated before any upstream call
  r = await get("circuits/../../etc");
  assert.equal(r.status, 404);

  // BOM: one partdata call for the batch; exact / review / unmatched, never a guessed substitute
  const nBefore = calls.filter((c) => c.url.pathname === "/api/pub/v1/bom/match").length;
  const rows = [
    { id: "1", reference: "U1", quantity: 1, value: "", mpn: "STM32F103C8T6", manufacturer: "ST", package: "" },
    { id: "2", reference: "U2", quantity: 1, value: "", mpn: "LM358", manufacturer: "", package: "" },
    { id: "3", reference: "U3", quantity: 1, value: "", mpn: "NOPE12345", manufacturer: "", package: "" },
  ];
  r = await POST(new NextRequest("http://localhost/api/maker/match", { method: "POST", body: JSON.stringify({ rows }) }), { params: { path: ["match"] } });
  d = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(d.rows.map((x: any) => x.status), ["exact", "review", "unmatched"]);
  assert.equal(d.rows[1].selected, undefined, "prefix candidates are not auto-selected");
  const bomCalls = calls.filter((c) => c.url.pathname === "/api/pub/v1/bom/match");
  assert.equal(bomCalls.length - nBefore, 1, "one partdata call per batch");
  assert.equal(JSON.parse(bomCalls.at(-1)!.body).lines[0].manufacturer, "STMicroelectronics", "abbreviation canonicalised");

  // errors: quota and outage become visitor-facing messages, not 500s
  mode = "quota";
  r = await get("references/p_zzzzzzzzzz");
  assert.equal(r.status, 429);
  assert.match((await r.json()).error, /lookup limit/);
  mode = "down";
  r = await get("circuits?mpn=NEW123456");
  assert.equal(r.status, 502);
  assert.match((await r.json()).error, /unreachable/);

  // unconfigured: search still answers (distributor fallback) and says the database is not connected
  mode = "ok";
  delete process.env.PARTDATA_API_KEY;
  r = await get("parts?q=NEWPART999");
  d = await r.json();
  assert.equal(r.status, 200);
  assert.equal(d.sources.find((s: any) => s.source === "Tindie parts database").status, "unconfigured");
  console.log("PASS: signed requests, anonymous visitor hash, search/designs mapping, batched no-guess BOM matching, quota/outage/unconfigured handling");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
