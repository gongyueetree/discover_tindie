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
  return h ? Response.json(h(c)) : Response.json({ error: { code: "not_found", message: "nf" } }, { status: 404 });
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
