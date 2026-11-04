/**
 * Third audit (2026-11-04, T01–T04), against mocks (no real Redis, distributors or Azure):
 *  T01 only the request holding the shared lock may fetch; waiters give up at their deadline; a Redis
 *      error starts no paid fetch
 *  T02 time left is checked again after cache / lock waits; the request deadline and the client
 *      leaving abort the real network request (not just stop awaiting it)
 *  T04 signed anonymous session; daily distinct-resource limits per session and per network; at most
 *      N concurrent jobs; paid budgets per session with a looser per-network cap
 */
import assert from "node:assert/strict";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;
delete process.env.DIGIKEY_CLIENT_ID;
process.env.MOUSER_API_KEY = "test-mouser";
process.env.AUTH_SECRET = "a".repeat(40);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-memory Redis; eval runs the same logic as limits.ts's Lua scripts. */
function fakeRedis(opts: { getDelay?: number; failSet?: boolean } = {}) {
  const kv = new Map<string, any>();
  const num = (k: string) => Number(kv.get(k) || 0);
  return {
    kv,
    async get(k: string) {
      if (opts.getDelay) await sleep(opts.getDelay);
      return kv.has(k) ? kv.get(k) : null;
    },
    async set(k: string, v: any, o: any = {}) {
      if (opts.failSet) throw Error("redis down");
      if (o.nx && kv.has(k)) return null;
      kv.set(k, v);
      return "OK";
    },
    async incr(k: string) {
      kv.set(k, num(k) + 1);
      return num(k);
    },
    async decr(k: string) {
      kv.set(k, num(k) - 1);
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
      const amount = Number(args[0]);
      const n = keys.length - 1;
      for (let i = 0; i < n; i++)
        if (num(keys[i]) + amount > Number(args[i + 1])) {
          kv.set(keys[n], num(keys[n]) + 1);
          return 0;
        }
      for (let i = 0; i < n; i++) kv.set(keys[i], num(keys[i]) + amount);
      return 1;
    },
  };
}

const realFetch = globalThis.fetch;
let mouserMode: "answer" | "hang" = "answer";
const mouserCalls: { at: number; signal?: AbortSignal }[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith("https://api.mouser.com/")) {
    mouserCalls.push({ at: Date.now(), signal: init?.signal });
    if (mouserMode === "hang")
      return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason ?? new Error("aborted"))));
    const kw = JSON.parse(init.body).SearchByKeywordRequest.keyword;
    return Response.json({ SearchResults: { Parts: [{ MouserPartNumber: "M-" + kw, ManufacturerPartNumber: kw, Manufacturer: "ACME", Description: "d", PriceBreaks: [], Availability: "" }] } });
  }
  return realFetch(input, init);
}) as typeof fetch;

// AbortSignal.timeout timers do not keep Node alive on their own (a server always is): keep the test running.
const keepAlive = setInterval(() => undefined, 1000);
void keepAlive;
void (async () => {
  const limits = await import("../src/lib/maker/limits");
  const ctx = await import("../src/lib/maker/request-context");
  const server = await import("../src/lib/maker/server");

  /* ---------------------------------------------------------------- T01 */
  let loads = 0;
  const held = fakeRedis();
  limits.__setRedisForTests(held);
  await held.set("mk:sup:mouser:HELD:lock", "other-instance", { nx: true });
  const t0 = Date.now();
  await assert.rejects(
    limits.supplierCached("mk:sup:mouser:HELD", async () => (loads++, 1), Date.now() + 2_000),
    (e: any) => e instanceof limits.SupplierUnavailable,
  );
  assert.equal(loads, 0, "a waiter whose time runs out never fetches without the lock");
  assert.ok(Date.now() - t0 < 3_000, "and gives up within its deadline");
  limits.__setRedisForTests(fakeRedis({ failSet: true }));
  await assert.rejects(limits.supplierCached("mk:sup:mouser:DOWN", async () => (loads++, 1), Date.now() + 2_000), (e: any) => e instanceof limits.SupplierUnavailable);
  assert.equal(loads, 0, "Redis failing: no paid fetch");
  // The holder finishing while others wait: they get its answer.
  const shared = fakeRedis();
  limits.__setRedisForTests(shared);
  const slow = limits.supplierCached("mk:sup:mouser:SLOW", async () => (await sleep(600), loads++, "answer"), Date.now() + 5_000);
  await sleep(50);
  // A second instance: same Redis, its own in-flight map → simulate by a different key holder check.
  assert.equal(shared.kv.has("mk:sup:mouser:SLOW:lock"), true, "the first request holds the lock while it fetches");
  assert.equal((await slow).value, "answer");
  assert.equal(loads, 1);
  limits.__setRedisForTests(null);

  /* ---------------------------------------------------------------- T02 */
  // Cache lookup slow enough to eat the time left: no distributor call is started afterwards.
  limits.__setRedisForTests(fakeRedis({ getDelay: 2_500 }));
  mouserCalls.length = 0;
  const r1 = await ctx.withRequestDeadline(9_000, undefined, () => server.search("LM7805", "t02-a", true, { partdata: false }));
  assert.equal(mouserCalls.length, 0, "time re-checked after the cache wait: no late paid call");
  assert.match(r1.sources.find((s) => s.source === "Mouser direct")!.message || "", /Skipped/);
  limits.__setRedisForTests(null);
  // A hanging distributor: the request deadline aborts the real fetch.
  mouserMode = "hang";
  mouserCalls.length = 0;
  const t1 = Date.now();
  const r2 = await ctx.withRequestDeadline(8_500, undefined, () => server.search("NE555", "t02-b", true, { partdata: false }));
  assert.equal(mouserCalls.length, 1);
  assert.equal(mouserCalls[0].signal?.aborted, true, "the network request itself was aborted");
  assert.ok(Date.now() - t1 < 10_000, "the request finished at its deadline");
  assert.equal(r2.sources.find((s) => s.source === "Mouser direct")!.status, "error");
  // The visitor leaving aborts it too.
  mouserCalls.length = 0;
  const leave = new AbortController();
  setTimeout(() => leave.abort(), 200);
  const t2 = Date.now();
  await ctx.withRequestDeadline(30_000, leave.signal, () => server.search("TL431", "t02-c", true, { partdata: false }));
  assert.equal(mouserCalls[0].signal?.aborted, true, "client cancel aborts the upstream fetch");
  assert.ok(Date.now() - t2 < 2_000);
  mouserMode = "answer";

  /* ---------------------------------------------------------------- T04 session */
  const session = await import("../src/lib/maker/session");
  const v = (await session.newSessionValue())!;
  const sid = await session.verifySession(v);
  assert.ok(sid && sid.length === 32);
  assert.equal(await session.verifySession(v.slice(0, -2) + "xx"), null, "a tampered session is refused");
  assert.equal(await session.verifySession("0".repeat(32) + ".abcdefghijklmnopqrstuvwxyz"), null);
  const { identify } = await import("../src/lib/maker/identify");
  const who = await identify(new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4", cookie: `${session.SESSION_COOKIE}=${v}` } }));
  assert.equal(who.sid, sid);
  assert.equal((await identify(new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4" } }))).sid, null);

  /* ---------------------------------------------------------------- T04 distinct resources */
  process.env.MAKER_DAILY_DETAILS = "3";
  process.env.MAKER_NETWORK_DAILY_DETAILS = "5";
  limits.__setRedisForTests(fakeRedis());
  const A = { ip: "net-1", sid: "a".repeat(32) };
  const B = { ip: "net-1", sid: "b".repeat(32) };
  const as = <T>(w: { ip: string; sid: string | null }, fn: () => Promise<T>) => ctx.withRequestDeadline(5_000, undefined, fn, w);
  for (const id of ["p1", "p2", "p3", "p1", "p2"]) await as(A, () => limits.noteResource("detail", id));
  await assert.rejects(as(A, () => limits.noteResource("detail", "p4")), (e: any) => e.status === 429, "4th different item for one visitor");
  await as(B, () => limits.noteResource("detail", "p5"));
  await as(B, () => limits.noteResource("detail", "p6"));
  await assert.rejects(as(B, () => limits.noteResource("detail", "p7")), (e: any) => e.status === 429, "the network allowance caps many sessions from one IP");
  await as({ ip: "net-2", sid: null }, () => limits.noteResource("detail", "p8"));

  /* ---------------------------------------------------------------- T04 concurrent jobs */
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const job = () => as(A, () => limits.withTaskSlot(() => gate, 2, 6));
  const j1 = job();
  const j2 = job();
  await sleep(20);
  await assert.rejects(job(), (e: any) => e.status === 429, "a 3rd concurrent job is refused");
  release();
  await Promise.all([j1, j2]);
  await as(A, () => limits.withTaskSlot(async () => 1, 2, 6));

  /* ---------------------------------------------------------------- T04 paid budgets */
  process.env.SUPPLIER_VISITOR_DAILY_BUDGET = "2";
  process.env.SUPPLIER_NETWORK_DAILY_BUDGET = "3";
  const C = { ip: "net-3", sid: "c".repeat(32) };
  const D = { ip: "net-3", sid: "d".repeat(32) };
  const got = [];
  for (let i = 0; i < 3; i++) got.push(await as(C, () => limits.reserveSupplierCall("mouser", "x")));
  assert.deepEqual(got, [true, true, false], "a session's own daily allowance");
  assert.equal(await as(D, () => limits.reserveSupplierCall("mouser", "x")), true);
  assert.equal(await as(D, () => limits.reserveSupplierCall("mouser", "x")), false, "a new session on the same network does not get a fresh allowance past the network cap");
  limits.__setRedisForTests(null);

  console.log("third audit checks passed");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
