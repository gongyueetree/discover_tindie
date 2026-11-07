/**
 * Parts-database requests that fail (lib/partdata/client.ts pdGet):
 *  - a dropped connection or a 5xx is tried once more, so one hiccup does not show "unavailable";
 *  - a timeout is not retried (the time is spent) and says "did not answer in time";
 *  - a 4xx is never retried.
 */
import assert from "node:assert/strict";

process.env.PARTDATA_API_BASE = "https://partdata.test";
process.env.PARTDATA_API_KEY = "pk";
process.env.PARTDATA_API_SECRET = "sk";
delete process.env.APP_DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;

type Step = "drop" | "500" | "400" | "timeout" | "ok";
let script: Step[] = [];
let calls = 0;
globalThis.fetch = (async (_input: any, init?: any) => {
  calls++;
  const step = script.shift() ?? "ok";
  if (step === "drop") throw new TypeError("fetch failed");
  if (step === "timeout") throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  if (step === "500") return Response.json({ detail: { error: { code: "internal" } } }, { status: 500 });
  if (step === "400") return Response.json({ detail: { error: { code: "bad_request" } } }, { status: 400 });
  void init;
  return Response.json({ data: { items: [{ id: "p_aaaaaaaaaa" }] }, meta: {} });
}) as typeof fetch;

void (async () => {
  const { pdGet, PartdataError } = await import("../src/lib/partdata/client");
  const ctx = await import("../src/lib/maker/request-context");
  const run = (q: string) => ctx.withRequestDeadline(30_000, undefined, () => pdGet("/api/pub/v1/parts/search", { q }));

  script = ["drop", "ok"];
  calls = 0;
  assert.equal((await run("a1")).data.items.length, 1, "a dropped connection is retried");
  assert.equal(calls, 2);

  script = ["500", "ok"];
  calls = 0;
  await run("a2");
  assert.equal(calls, 2, "a 5xx is retried once");

  script = ["500", "500"];
  calls = 0;
  await assert.rejects(run("a3"), (e: any) => e instanceof PartdataError && e.status === 500);
  assert.equal(calls, 2, "only once");

  script = ["timeout", "ok"];
  calls = 0;
  await assert.rejects(run("a4"), (e: any) => e.code === "timeout" && /did not answer in time/.test(e.message));
  assert.equal(calls, 1, "a timeout is not retried");

  script = ["400", "ok"];
  calls = 0;
  await assert.rejects(run("a5"), (e: any) => e.status === 400);
  assert.equal(calls, 1, "a 4xx is not retried");

  console.log("PASS: parts database retries (connection drop, 5xx once; never a timeout or 4xx)");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
