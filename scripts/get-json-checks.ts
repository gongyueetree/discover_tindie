/** Design lists: a dropped request or a gateway timeout is retried once; what still fails reads plainly. */
import assert from "node:assert/strict";
import { getJson, NETWORK_MESSAGE, BUSY_MESSAGE } from "../src/lib/maker/get-json";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function seq(...steps: (() => Response)[]) {
  let n = 0;
  const f = (async () => steps[Math.min(n++, steps.length - 1)]()) as unknown as typeof fetch;
  return { f, calls: () => n };
}
const drop = () => {
  throw new TypeError("Load failed");
};

(async () => {
  let s = seq(drop, () => json(200, { items: [1] }));
  assert.deepEqual(await getJson("/x", { fetcher: s.f, retryMs: 1 }), { items: [1] }, "one dropped request is retried");
  assert.equal(s.calls(), 2);

  s = seq(drop, drop);
  await assert.rejects(getJson("/x", { fetcher: s.f, retryMs: 1 }), { message: NETWORK_MESSAGE });
  assert.equal(s.calls(), 2, "only one retry");

  s = seq(() => new Response("<html>timeout</html>", { status: 504 }), () => new Response("<html>timeout</html>", { status: 504 }));
  await assert.rejects(getJson("/x", { fetcher: s.f, retryMs: 1 }), { message: BUSY_MESSAGE });
  assert.equal(s.calls(), 2);

  s = seq(() => json(400, { error: "Choose a module." }));
  await assert.rejects(getJson("/x", { fetcher: s.f, retryMs: 1 }), { message: "Choose a module." });
  assert.equal(s.calls(), 1, "a 400 is not retried");

  s = seq(() => json(503, { error: "Tindie parts database unavailable" }), () => json(200, { ok: 1 }));
  assert.deepEqual(await getJson("/x", { fetcher: s.f, retryMs: 1 }), { ok: 1 });
  console.log("get-json checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
