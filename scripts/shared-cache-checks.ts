/**
 * The cache shared by all serverless instances (lib/maker/limits.ts sharedValue / sharedPutMany /
 * sharedPeek), against the in-memory Redis fixture: a value is loaded once and then reused, failures
 * are not stored, a stored null is a hit, and a design card remembered from a list is found again.
 */
import assert from "node:assert/strict";
import { luaRedis } from "./fixtures/lua-redis";

delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

void (async () => {
  const limits = await import("../src/lib/maker/limits");
  const r = luaRedis();
  limits.__setRedisForTests(r);

  let loads = 0;
  const load = async () => (loads++, { items: [1, 2, 3] });
  assert.deepEqual(await limits.sharedValue("k1", 60, load), { items: [1, 2, 3] });
  await sleep(10);
  assert.deepEqual(await limits.sharedValue("k1", 60, load), { items: [1, 2, 3] });
  assert.equal(loads, 1, "the second instance reuses the stored answer");
  assert.ok((r.expiresIn("k1") ?? 0) > 50_000, "stored with its time to live");

  // A failure (store() says no) is not stored; the next request loads again.
  loads = 0;
  await limits.sharedValue("k2", 60, async () => (loads++, null), () => false);
  await sleep(10);
  await limits.sharedValue("k2", 60, async () => (loads++, null), () => false);
  assert.equal(loads, 2);

  // A real "nothing" (no picture) is stored and found: null is a hit, not a miss.
  loads = 0;
  await limits.sharedValue("k3", 60, async () => (loads++, null));
  await sleep(10);
  assert.equal(await limits.sharedValue("k3", 60, async () => (loads++, "x")), null);
  assert.equal(loads, 1);

  // An error in load propagates and stores nothing.
  await assert.rejects(limits.sharedValue("k4", 60, async () => { throw Error("upstream down"); }));
  assert.equal(r.kv.has("k4"), false);

  // Several values in one round trip, read back one by one.
  await limits.sharedPutMany([["mk:design:d_a", { id: "d_a", name: "A" }], ["mk:design:d_b", { id: "d_b", name: "B" }]], 3600);
  assert.deepEqual(await limits.sharedPeek("mk:design:d_b"), { id: "d_b", name: "B" });
  assert.equal(await limits.sharedPeek("mk:design:d_missing"), undefined);

  // Redis failing: the value is simply loaded.
  limits.__setRedisForTests({ get: async () => { throw Error("down"); }, set: async () => { throw Error("down"); } });
  assert.equal(await limits.sharedValue("k5", 60, async () => 42), 42);

  // Without Redis: same.
  limits.__setRedisForTests(null);
  assert.equal(await limits.sharedValue("k6", 60, async () => 7), 7);
  assert.equal(await limits.sharedPeek("k6"), undefined);

  console.log("PASS: shared cache (reuse across instances, failures not stored, stored null is a hit, batch put)");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
