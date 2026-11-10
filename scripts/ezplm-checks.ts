/** ezPLM direct: signature matches ezPLM's demo, rows map to parts, search merges them and respects 429. Offline. */
import assert from "node:assert/strict";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
process.env.EZPLM_API_KEY = "test-key";
process.env.EZPLM_API_BASE = "https://ezplm.test";

(async () => {
  const ez = await import("../src/lib/ezplm/client");

  // Same canonical string and encoding as ezPLM's Python demo (value computed with that code).
  assert.equal(ez.canonicalQuery({ pageSize: 10, keyword: "TPS79301DBVR", empty: "" }), "keyword=TPS79301DBVR&pageSize=10");
  assert.equal(ez.canonicalQuery({ keyword: "LM358 DR/x", pageSize: 5 }), "keyword=LM358%20DR%2Fx&pageSize=5");
  assert.equal(
    ez.signature("test-key", "GET", "/api/v1/api-key/parts", "keyword=TPS79301DBVR&pageSize=10", "1700000000", "n-1"),
    "GorksYSaqXXLTxlhKpKcPk4lBf1VIVpgzxQpmFHGm5Y",
  );
  const h = ez.signedHeaders("GET", "/p", "a=1", 1_700_000_000_500, "n-2");
  assert.equal(h["X-Timestamp"], "1700000000", "Unix seconds");
  assert.equal(h["X-API-Key"], "test-key");

  // Row mapping: objects or strings; attributes as object or list; unsafe links dropped.
  const p = ez.toPart({
    id: "019137eb",
    mpn: "TPS79301DBVR",
    manufacturer: { name: "Texas Instruments" },
    description: "LDO 200mA",
    category: { name: "LDO" },
    pdf: "https://qn.ezplm.com/x.pdf",
    officialUrl: "javascript:alert(1)",
    footprint: "SOT-23-6",
    symbol: { name: "TPS79301" },
    attributes: [{ name: "Vout", value: "1.2-5.5V" }],
  })!;
  assert.equal(p.id, "ez:019137eb");
  assert.equal(p.source, "ezPLM");
  assert.equal(p.datasheet, "https://qn.ezplm.com/x.pdf");
  assert.equal(p.productUrl, undefined);
  assert.equal(p.footprintName, "SOT-23-6");
  assert.equal(p.symbolName, "TPS79301");
  assert.deepEqual(p.parameters, { Vout: "1.2-5.5V" });
  assert.deepEqual(ez.toPart({ mpn: "X" }), null, "no id: dropped");

  // search(): the parts database is not configured here; ezPLM rows still come back, and a repeat is cached.
  const original = globalThis.fetch;
  let calls = 0;
  let status = 200;
  let lastHeaders: Record<string, string> = {};
  globalThis.fetch = (async (url: string, init: any) => {
    if (!String(url).startsWith("https://ezplm.test/")) return new Response("{}", { status: 503 });
    calls++;
    lastHeaders = init.headers;
    if (status !== 200) return new Response('{"code":"QUOTA"}', { status });
    return Response.json({ data: [{ id: "a1", mpn: "RP2350B", manufacturer: { name: "Raspberry Pi" }, description: "MCU" }], meta: {} });
  }) as typeof fetch;
  try {
    const { search } = await import("../src/lib/maker/server");
    const r = await search("RP2350B", "visitor-1");
    assert.ok(r.items.some((x) => x.id === "ez:a1"), "ezPLM row listed");
    assert.ok(r.sources.some((s) => s.source === "ezPLM" && s.status === "ready"));
    assert.ok(lastHeaders["X-Signature"], "signed");
    await search("rp2350b", "visitor-2");
    assert.equal(calls, 1, "same query (any case): served from cache, no second ezPLM call");

    status = 429;
    const r2 = await search("STM32F103", "visitor-1");
    const s2 = r2.sources.find((s) => s.source === "ezPLM")!;
    assert.equal(s2.status, "error");
    assert.match(s2.message || "", /daily API quota/);
    const before = calls;
    const r3 = await search("ESP32-S3", "visitor-1");
    assert.equal(calls, before, "after a 429, ezPLM is not called again during the cooldown");
    assert.match(r3.sources.find((s) => s.source === "ezPLM")!.message || "", /daily API quota/);
  } finally {
    globalThis.fetch = original;
  }

  // Signed links (?e=<unix seconds>) bound how long a cached answer is kept.
  const { linksValidFor } = await import("../src/lib/maker/server");
  const now = 1_700_000_000_000;
  const signed = { ...p, datasheet: "https://qn.ezplm.com/pdf/x.pdf?e=" + (now / 1000 + 3600) + "&token=t" };
  assert.equal(linksValidFor([signed], 86_400, now), 3300, "expires in 1 h: kept 55 min");
  assert.equal(linksValidFor([p], 86_400, now), 86_400, "no signed link: a day");
  assert.equal(linksValidFor([], 86_400, now), 86_400, "empty answer: a day");
  assert.equal(linksValidFor([{ ...p, datasheet: "https://x/y.pdf?e=" + (now / 1000 + 60) }], 86_400, now), 600, "at least 10 min");

  // A Chinese description that cannot be translated: the English category and package instead.
  const { englishParts } = await import("../src/lib/maker/translation");
  const [zh] = await englishParts([{ ...p, description: "具有使能功能的 200mA、低压降稳压器", category: "Power management (PMIC)" }]);
  assert.equal(zh.description, "Power management (PMIC) · SOT-23-6");
  const [bare] = await englishParts([{ ...p, description: "安全的双核芯片，带有加密引擎", category: undefined, footprintName: null }]);
  assert.equal(bare.description, "English description unavailable");
  const [lbl] = await englishParts([{ ...p, parameters: { 电源输入电压范围: "Min 2.7 V; Max 5.5 V" } }]);
  assert.deepEqual(lbl.parameters, { "Supply input voltage range": "Min 2.7 V; Max 5.5 V" });

  // Without a key nothing is called and the source reads "not configured".
  delete process.env.EZPLM_API_KEY;
  assert.equal(ez.ezplmConfigured(), false);
  console.log("ezplm checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
