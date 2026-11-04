/**
 * Second audit (2026-11-04, R01–R07): each finding reproduced against mocks, then shown fixed.
 *  R01 a refused reservation charges nothing; budgets of 0 switch a provider off
 *  R02 every translation path (incl. englishParts) is budgeted, on the masked text actually sent
 *  R03 no shared ledger in production → no paid calls; cross-instance lock → one load per cold key
 *  R04 a lookup that cannot finish before the request deadline is not started
 *  R07 connection cookies expire on the server
 */
import assert from "node:assert/strict";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;
delete process.env.DIGIKEY_CLIENT_ID;
process.env.MOUSER_API_KEY = "test-mouser";
process.env.AZURE_TRANSLATOR_KEY = "test-azure";

/** In-memory Redis with the commands limits.ts uses; eval runs the same logic as its Lua scripts. */
function fakeRedis() {
  const kv = new Map<string, any>();
  const num = (k: string) => Number(kv.get(k) || 0);
  return {
    kv,
    async get(k: string) {
      return kv.has(k) ? kv.get(k) : null;
    },
    async set(k: string, v: any, o: any = {}) {
      if (o.nx && kv.has(k)) return null;
      kv.set(k, v);
      return "OK";
    },
    async incr(k: string) {
      kv.set(k, num(k) + 1);
      return num(k);
    },
    async incrby(k: string, n: number) {
      kv.set(k, num(k) + n);
      return num(k);
    },
    async expire() {
      return 1;
    },
    async eval(script: string, keys: string[], args: string[]) {
      if (script.includes("DEL")) {
        if (kv.get(keys[0]) === args[0]) kv.delete(keys[0]);
        return 1;
      }
      const [amount, siteLimit, mineLimit] = args.map(Number);
      if (num(keys[0]) + amount > siteLimit || num(keys[1]) + amount > mineLimit) {
        kv.set(keys[2], num(keys[2]) + 1);
        return 0;
      }
      kv.set(keys[0], num(keys[0]) + amount);
      kv.set(keys[1], num(keys[1]) + amount);
      return 1;
    },
  };
}

const realFetch = globalThis.fetch;
const sent: { url: string; body?: any }[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.mouser.com/")) {
    sent.push({ url });
    const kw = JSON.parse(init.body).SearchByKeywordRequest.keyword;
    return Response.json({ SearchResults: { Parts: [{ MouserPartNumber: "M-" + kw, ManufacturerPartNumber: kw, Manufacturer: "ACME", Description: "d", PriceBreaks: [], Availability: "" }] } });
  }
  if (url.startsWith("https://api.cognitive.microsofttranslator.com/")) {
    const body = JSON.parse(init.body);
    sent.push({ url, body });
    return Response.json(body.map((b: any) => ({ translations: [{ to: "en", text: b.Text.replace(/[一-鿿]+/g, "resistor") }] })));
  }
  return realFetch(input, init);
}) as typeof fetch;

void (async () => {
  const limits = await import("../src/lib/maker/limits");

  /* ---------------------------------------------------------------- R01 */
  for (const backend of ["redis", "local"] as const) {
    const r = backend === "redis" ? fakeRedis() : null;
    limits.__setRedisForTests(r);
    const name = "r01-" + backend;
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await limits.reserveDaily(name, "visitor-a", 1, 5, 2));
    assert.deepEqual(results, [true, true, false, false, false], `${backend}: visitor A gets 2`);
    for (let i = 0; i < 1000; i++) await limits.reserveDaily(name, "visitor-a", 1, 5, 2);
    assert.equal(await limits.reserveDaily(name, "visitor-b", 1, 5, 2), true, `${backend}: refused requests did not use up the site budget`);
    if (r) assert.equal(r.kv.get(`mk:budget:${name}:${new Date().toISOString().slice(0, 10)}`), 3, "site budget counts only real reservations");
  }
  limits.__setRedisForTests(null);
  assert.equal(await limits.reserveDaily("zero", "v", 1, 0, 10), false, "a site budget of 0 switches it off");
  process.env.MOUSER_DAILY_BUDGET = "0";
  assert.equal(await limits.reserveSupplierCall("mouser", "v"), false, "MOUSER_DAILY_BUDGET=0 is honoured, not replaced by the default");
  delete process.env.MOUSER_DAILY_BUDGET;
  assert.equal(limits.envBudget("NOT_SET_ANYWHERE", 7), 7);

  /* ---------------------------------------------------------------- R03 ledger */
  (process.env as any).NODE_ENV = "production";
  assert.equal(await limits.reserveSupplierCall("mouser", "prod-visitor"), false, "production without Redis: no paid calls");
  assert.equal(await limits.reserveTranslation(null, 10), false, "production without Redis: no paid translation");
  process.env.MAKER_LOCAL_BUDGET = "1";
  assert.equal(await limits.reserveSupplierCall("mouser", "prod-visitor"), true, "explicit opt-in to a per-instance ledger");
  delete process.env.MAKER_LOCAL_BUDGET;
  (process.env as any).NODE_ENV = "test";

  /* ---------------------------------------------------------------- R03 cross-instance merge */
  const shared = fakeRedis();
  limits.__setRedisForTests(shared);
  let loads = 0;
  await shared.set("mk:sup:mouser:COLD:lock", "another-instance", { nx: true });
  setTimeout(() => void shared.set("mk:sup:mouser:COLD", [{ from: "other instance" }]), 300);
  const waited = await limits.supplierCached("mk:sup:mouser:COLD", async () => (loads++, [{ from: "me" }]));
  assert.equal(loads, 0, "another instance holds the lock: wait for its cached answer instead of loading");
  assert.deepEqual(waited.value, [{ from: "other instance" }]);
  const first = await limits.supplierCached("mk:sup:mouser:FRESH", async () => (loads++, [{ n: 1 }]));
  assert.equal(loads, 1);
  assert.equal(first.cached, false);
  assert.ok(shared.kv.has("mk:sup:mouser:FRESH"), "the answer is written to the shared cache before returning");
  assert.ok(!shared.kv.has("mk:sup:mouser:FRESH:lock"), "the lock is released");
  limits.__setRedisForTests(null);

  /* ---------------------------------------------------------------- R02 */
  const { englishParts, translateTexts } = await import("../src/lib/maker/translation");
  process.env.TRANSLATE_DAILY_CHARS = "0";
  sent.length = 0;
  await englishParts([{ id: "x", mpn: "X", manufacturer: "", description: "贴片电阻器件 10K 0402", source: "", parameters: {}, cad: [], offers: [] } as any]);
  await translateTexts(["贴片电阻器件 22K"], "visitor-t");
  assert.equal(sent.filter((s) => s.url.includes("microsofttranslator")).length, 0, "no Azure call once the budget is used up, from any path");
  delete process.env.TRANSLATE_DAILY_CHARS;
  const ledger = fakeRedis();
  limits.__setRedisForTests(ledger);
  sent.length = 0;
  await translateTexts(["贴片电阻器件 10K 0402 1% 0.1W"], "visitor-m");
  const azure = sent.find((s) => s.url.includes("microsofttranslator"))!;
  const submitted = azure.body.reduce((n: number, b: any) => n + b.Text.length, 0);
  assert.equal(ledger.kv.get(`mk:budget:translate:${new Date().toISOString().slice(0, 10)}:visitor-m`), submitted, "the characters actually sent (masked) are what is charged");
  limits.__setRedisForTests(null);

  /* ---------------------------------------------------------------- R04 */
  const server = await import("../src/lib/maker/server");
  sent.length = 0;
  const late = await server.search("NE5532", "deadline-visitor", true, { partdata: false, deadline: Date.now() + 5_000 });
  assert.equal(sent.filter((s) => s.url.includes("mouser")).length, 0, "no distributor call that could outlive the request");
  assert.match(late.sources.find((s) => s.source === "Mouser direct")!.message || "", /Skipped/);
  const early = await server.search("NE5532", "deadline-visitor", true, { partdata: false, deadline: Date.now() + 40_000 });
  assert.equal(early.sources.find((s) => s.source === "Mouser direct")!.status, "ready");

  /* ---------------------------------------------------------------- R07 */
  process.env.CONNECTION_SIGNING_SECRET = "s".repeat(32);
  const cookie = await import("../src/lib/project-import/connection-cookie");
  const value = cookie.encodeConnections([{ id: "c", installationId: 7, accountLogin: "a" }] as any);
  assert.equal(cookie.decodeConnections(value).length, 1);
  const now = Date.now;
  Date.now = () => now() + cookie.CONNECTION_TTL_MS + 1000;
  assert.deepEqual(cookie.decodeConnections(value), [], "an expired connection is refused by the server");
  Date.now = now;
  const { projectImportDisabled } = await import("../src/lib/project-import/enabled");
  delete process.env.PROJECT_IMPORT_ENABLED;
  assert.equal(projectImportDisabled()?.status, 404, "handlers refuse too when the feature is off");

  console.log("re-audit checks passed");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
