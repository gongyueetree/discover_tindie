/**
 * Fourth audit (2026-11-04, F01–F05). Redis is the in-memory lua-redis fixture, which runs the app's
 * real Lua scripts; the Redis-deadline check uses the real Upstash client against a slow local HTTP
 * server. No real Redis, distributor, partdata or CDN is involved: CDN behaviour (F02) is covered by
 * the response headers in maker-api-checks and still needs checking on a real preview deployment.
 *
 *  F01 a refused resource stays refused on retry and under concurrency; both subjects consistent;
 *      the full resource identity is used (no prefix collisions); the same in local mode
 *  F03 Redis commands, shared waits and shared fetches stop at the request deadline; the ezPLM model
 *      stream is cancelled by the client leaving; legacy symbol downloads stop at the deadline
 *  F04 job leases: a dead job's slot expires on time and refused retries do not extend it
 *  F05 a malformed session cookie is no session (not an exception)
 *  +   download bytes per day
 */
import assert from "node:assert/strict";
import http from "node:http";
import { luaRedis } from "./fixtures/lua-redis";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;
process.env.AUTH_SECRET = "b".repeat(40);
process.env.PARTDATA_API_BASE = "https://partdata.test";
process.env.PARTDATA_API_KEY = "pk";
process.env.PARTDATA_API_SECRET = "sk";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const keepAlive = setInterval(() => undefined, 1000);
void keepAlive;

const realFetch = globalThis.fetch;
const fetches: { url: string; at: number; signal?: AbortSignal }[] = [];
let libDelay = 35;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = String(input instanceof Request ? input.url : input);
  fetches.push({ url, at: Date.now(), signal: init?.signal });
  if (url.startsWith("https://partdata.test/"))
    return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  if (url.startsWith("https://gitlab.com/kicad/libraries/kicad-symbols/")) {
    await sleep(libDelay);
    const name = decodeURIComponent(url.split("/").pop()!.replace(/\.lib$/, ""));
    return new Response(`EESchema-LIBRARY Version 2.3\n#\nDEF ${name}_X U 0 40 Y Y 1 F N\nENDDEF\n#\n#End Library\n`);
  }
  return realFetch(input, init);
}) as typeof fetch;

void (async () => {
  const limits = await import("../src/lib/maker/limits");
  const ctx = await import("../src/lib/maker/request-context");
  const as = <T>(who: { ip: string; sid: string | null }, fn: () => Promise<T>, ms = 5_000) => ctx.withRequestDeadline(ms, undefined, fn, who);
  const status = (p: Promise<unknown>) => p.then(() => 200, (e: any) => e.status ?? 500);

  /* ---------------------------------------------------------------- F01 */
  for (const mode of ["redis", "local"] as const) {
    limits.__setRedisForTests(mode === "redis" ? luaRedis() : null);
    process.env.MAKER_DAILY_FILES = "1";
    process.env.MAKER_NETWORK_DAILY_FILES = "1";
    const A = { ip: `f01-${mode}`, sid: "a".repeat(32) };
    assert.equal(await status(as(A, () => limits.noteResource("file", "A"))), 200);
    const tries = [];
    for (let i = 0; i < 10; i++) tries.push(await status(as(A, () => limits.noteResource("file", "B"))));
    assert.deepEqual(tries, Array(10).fill(429), `${mode}: retrying a refused resource stays refused`);
    assert.equal(await status(as(A, () => limits.noteResource("file", "A"))), 200, `${mode}: revisiting an admitted resource is free`);
    // Network room left but the visitor's is used up (and the other way round): refused, nothing marked.
    process.env.MAKER_NETWORK_DAILY_FILES = "100";
    assert.equal(await status(as(A, () => limits.noteResource("file", "C"))), 429);
    const A2 = { ip: A.ip, sid: "c".repeat(32) };
    assert.equal(await status(as(A2, () => limits.noteResource("file", "C"))), 200, `${mode}: a refusal does not use another visitor's allowance`);
    // Long identities sharing a 300-character prefix are different files.
    const long = "https://example.com/" + "x".repeat(300);
    const L = { ip: `f01-long-${mode}`, sid: "d".repeat(32) };
    assert.equal(await status(as(L, () => limits.noteResource("file", long + "/one.pdf"))), 200);
    assert.equal(await status(as(L, () => limits.noteResource("file", long + "/two.pdf"))), 429, `${mode}: no prefix collision`);
    // 20 different resources at once against a visitor allowance of 5: exactly 5 admitted.
    process.env.MAKER_DAILY_FILES = "5";
    const P = { ip: `f01-par-${mode}`, sid: "e".repeat(32) };
    const res = await Promise.all(Array.from({ length: 20 }, (_, i) => status(as(P, () => limits.noteResource("file", "par" + i)))));
    assert.equal(res.filter((s) => s === 200).length, 5, `${mode}: concurrency cannot exceed the allowance`);
    // The admitted ones stay free; the refused ones stay refused.
    const again = await Promise.all(Array.from({ length: 20 }, (_, i) => status(as(P, () => limits.noteResource("file", "par" + i)))));
    assert.deepEqual(again, res, `${mode}: same answers on retry`);
  }
  delete process.env.MAKER_DAILY_FILES;
  delete process.env.MAKER_NETWORK_DAILY_FILES;

  /* ---------------------------------------------------------------- F03 Redis bounded by the deadline */
  const slow = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => setTimeout(() => res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ result: 1 })), 250));
  });
  await new Promise<void>((r) => slow.listen(0, "127.0.0.1", r));
  const port = (slow.address() as any).port;
  limits.__setRedisForTests(limits.makeRedis(`http://127.0.0.1:${port}`, "t"));
  let t = Date.now();
  await as({ ip: "f03", sid: null }, async () => {
    await limits.noteResource("detail", "x").catch(() => undefined);
    await limits.noteResource("detail", "y").catch(() => undefined);
  }, 50);
  assert.ok(Date.now() - t < 200, `two slow Redis calls stop at a 50 ms deadline (took ${Date.now() - t} ms)`);
  t = Date.now();
  const ok = await as({ ip: "f03", sid: null }, () => limits.reserveBudgets("mouser", 1, [["", 10]]), 50);
  assert.equal(ok, false, "a budget write cut off by the deadline does not allow the paid call");
  assert.ok(Date.now() - t < 200);
  slow.close();

  // A shared in-flight lookup: a second request waiting on it leaves at its own deadline.
  limits.__setRedisForTests(null);
  const long1 = limits.supplierCached("mk:sup:mouser:WAIT", () => sleep(1_000).then(() => "late"), Date.now() + 5_000);
  t = Date.now();
  await assert.rejects(as({ ip: "f03", sid: null }, () => limits.supplierCached("mk:sup:mouser:WAIT", async () => "never"), 500), limits.SupplierUnavailable);
  assert.ok(Date.now() - t < 800, "the waiter did not wait for the other request's lookup");
  assert.equal((await long1).value, "late");

  // sharedFetchSignal after the deadline: already aborted (no new shared work).
  await as({ ip: "f03", sid: null }, async () => {
    await sleep(80);
    assert.equal(ctx.sharedFetchSignal(20_000).aborted, true, "expired request: shared signal already aborted");
  }, 50);

  // Legacy KiCad libraries: no download starts after the deadline.
  const { legacyStandardSymbols } = await import("../src/lib/maker/kicad-legacy-symbols");
  fetches.length = 0;
  libDelay = 400;
  const t0 = Date.now();
  await as({ ip: "f03", sid: null }, () => legacyStandardSymbols(5, ["L1", "L2", "L3", "L4"], ["nope"]), 1_200);
  const late = fetches.filter((f) => f.url.includes("kicad-symbols") && f.at > t0 + 1_200);
  assert.equal(late.length, 0, "no library fetch after the deadline");
  assert.ok(fetches.length < 4, `stopped early (${fetches.length} of 4 libraries)`);

  // ezPLM model stream: the visitor leaving cancels it even before headers arrive.
  const { pdGetStream } = await import("../src/lib/partdata/client");
  fetches.length = 0;
  const leave = new AbortController();
  const pending = ctx.withRequestDeadline(30_000, leave.signal, () => pdGetStream("/api/pub/v1/parts/p_x/cad/model", 1000)).catch(() => "cancelled");
  await sleep(30);
  leave.abort();
  assert.equal(await pending, "cancelled");
  assert.equal(fetches[0].signal?.aborted, true, "pdGetStream's fetch was cancelled with the client");

  /* ---------------------------------------------------------------- F04 job leases */
  let clock = 1_000_000;
  const realNow = Date.now;
  Date.now = () => clock;
  const r4 = luaRedis({ now: () => clock });
  limits.__setRedisForTests(r4);
  const W = { ip: "f04", sid: "f".repeat(32) };
  // Two jobs whose functions die mid-job (their finally never runs).
  void as(W, () => limits.withTaskSlot(() => new Promise(() => undefined), 2, 6), 1e8);
  void as(W, () => limits.withTaskSlot(() => new Promise(() => undefined), 2, 6), 1e8);
  await sleep(10);
  const slotKey = `mk:jobs:s:${W.sid}`;
  const expiry = r4.expiresIn(slotKey)!;
  for (let s = 10; s <= 80; s += 10) {
    clock += 10_000;
    assert.equal(await status(as(W, () => limits.withTaskSlot(async () => 1, 2, 6), 1e8)), 429, "dead jobs still hold their slots");
  }
  assert.equal(r4.expiresIn(slotKey), expiry - 80_000, "refused retries did not extend the dead jobs' leases");
  clock += 11_000; // past 90 s
  assert.equal(await status(as(W, () => limits.withTaskSlot(async () => 1, 2, 6), 1e8)), 200, "dead jobs' slots expired on time");
  // Interleaved jobs release only their own lease.
  let releaseA!: () => void;
  const a = as(W, () => limits.withTaskSlot(() => new Promise<void>((r) => (releaseA = r)), 2, 6), 1e8);
  const b = as(W, () => limits.withTaskSlot(() => sleep(5), 2, 6), 1e8);
  await b;
  await sleep(5);
  assert.equal(await status(as(W, () => limits.withTaskSlot(async () => 1, 2, 6), 1e8)), 200, "b's slot freed while a still runs");
  releaseA();
  await a;
  // Redis failing: local leases still apply.
  limits.__setRedisForTests({ eval: async () => { throw Error("down"); } });
  let hold!: () => void;
  const h1 = as(W, () => limits.withTaskSlot(() => new Promise<void>((r) => (hold = r)), 1, 6), 1e8);
  await sleep(5);
  assert.equal(await status(as(W, () => limits.withTaskSlot(async () => 1, 1, 6), 1e8)), 429, "local leases when Redis is down");
  hold();
  await h1;
  Date.now = realNow;

  /* ---------------------------------------------------------------- download bytes */
  limits.__setRedisForTests(luaRedis());
  process.env.MAKER_DAILY_DOWNLOAD_MB = "1";
  const D = { ip: "bytes", sid: "9".repeat(32) };
  await as(D, async () => {
    await limits.checkDownloadBudget();
    const big = new Uint8Array(1024 * 1024 + 10);
    const out = limits.meteredStream(new Blob([big]).stream());
    let n = 0;
    for await (const c of out as any) n += c.byteLength;
    assert.equal(n, big.byteLength, "a download in progress is not cut off");
  });
  await sleep(20);
  assert.equal(await status(as(D, () => limits.checkDownloadBudget())), 429, "over today's bytes: the next download is refused");
  delete process.env.MAKER_DAILY_DOWNLOAD_MB;

  /* ---------------------------------------------------------------- F05 */
  const { identify } = await import("../src/lib/maker/identify");
  const session = await import("../src/lib/maker/session");
  for (const bad of ["%", "%E0%A4%A", "abc%zz"]) {
    const who = await identify(new Request("http://x/", { headers: { cookie: `${session.SESSION_COOKIE}=${bad}` } }));
    assert.equal(who.sid, null, "malformed cookie → no session");
  }
  const v = (await session.newSessionValue())!;
  assert.ok((await identify(new Request("http://x/", { headers: { cookie: `${session.SESSION_COOKIE}=${v}` } }))).sid);

  limits.__setRedisForTests(null);
  console.log("fourth audit checks passed");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
