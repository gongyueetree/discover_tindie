/**
 * Pre-launch audit (2026-11-04) regressions, all against mocks (no real GitHub, distributors or Redis):
 *  A01 legacy import never lists or reads private repositories with the deployment token
 *  A11 connection cookies are refused without a signing secret
 *  A02 an installation id is only connected when the authorising user can access it
 *  A04 a visitor over the parts-database quota does not fall through to paid distributors
 *  A05 identical distributor lookups are served from cache; budgets are reserved before calling
 *  A03 request rate limits; the paid-call ledger fails closed when Redis errors
 *  A07 streamed files: head check and byte cap
 */
import assert from "node:assert/strict";
import http from "node:http";

process.env.MOUSER_API_KEY = "test-mouser";
process.env.SUPPLIER_VISITOR_DAILY_BUDGET = "3";
delete process.env.DIGIKEY_CLIENT_ID;
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.KV_REST_API_URL;

const realFetch = globalThis.fetch;
const calls: string[] = [];
let githubRepos: any[] = [];
globalThis.fetch = (async (input: any, init?: any) => {
  const u = String(input instanceof Request ? input.url : input);
  calls.push(u);
  if (u.startsWith("https://api.mouser.com/")) {
    const kw = JSON.parse(init.body).SearchByKeywordRequest.keyword;
    return Response.json({ SearchResults: { Parts: [{ MouserPartNumber: "M-" + kw, ManufacturerPartNumber: kw, Manufacturer: "ACME", Description: "d", PriceBreaks: [{ Quantity: 1, Price: "$1.00", Currency: "USD" }], Availability: "5 In Stock" }] } });
  }
  if (u.startsWith("https://api.github.com/user/repos") || u.includes("/users/acme/repos")) return Response.json(githubRepos);
  if (u.startsWith("https://api.github.com/repos/acme/secret")) return Response.json({ id: 1, name: "secret", full_name: "acme/secret", owner: { login: "acme" }, description: "", html_url: "", default_branch: "main", updated_at: "", language: null, stargazers_count: 0, private: true });
  if (u.startsWith("https://github.com/login/oauth/access_token")) return Response.json({ access_token: "user-token" });
  if (u.startsWith("https://api.github.com/user/installations")) return Response.json({ installations: [{ id: 111 }] });
  return realFetch(input, init);
}) as typeof fetch;

void (async () => {
  /* ---------------------------------------------------------------- A01 */
  process.env.GITHUB_TOKEN = "deployment-token";
  const gh = await import("../src/lib/project-import/github");
  githubRepos = [
    { id: 1, name: "open", full_name: "acme/open", owner: { login: "acme" }, description: "", html_url: "", default_branch: "main", updated_at: "", language: null, stargazers_count: 1, private: false },
    { id: 2, name: "secret", full_name: "acme/secret", owner: { login: "acme" }, description: "", html_url: "", default_branch: "main", updated_at: "", language: null, stargazers_count: 1, private: true },
  ];
  assert.deepEqual((await gh.listGithubRepositories("acme")).map((r) => r.name), ["open"], "private repositories are never listed in public mode");
  calls.length = 0;
  await assert.rejects(gh.loadGithubProject("acme", "secret"), /not public/);
  assert.ok(!calls.some((u) => /readme|git\/trees|contents/.test(u)), "no README or tree request for a private repository");

  /* ---------------------------------------------------------------- A11 */
  delete process.env.CONNECTION_SIGNING_SECRET;
  delete process.env.AUTH_SECRET;
  delete process.env.GITHUB_APP_CLIENT_SECRET;
  const cookie = await import("../src/lib/project-import/connection-cookie");
  const conn = [{ id: "c", installationId: 222, accountLogin: "victim" }] as any;
  assert.equal(cookie.encodeConnections(conn), "", "nothing stored without a signing secret");
  const unsigned = Buffer.from(JSON.stringify({ version: 1, github: conn })).toString("base64url");
  assert.deepEqual(cookie.decodeConnections(unsigned), [], "an unsigned cookie is refused");
  process.env.CONNECTION_SIGNING_SECRET = "s".repeat(32);
  assert.equal(cookie.decodeConnections(cookie.encodeConnections(conn))[0].installationId, 222);
  assert.deepEqual(cookie.decodeConnections(unsigned), [], "an unsigned cookie is refused with a secret too");

  /* ---------------------------------------------------------------- A02 */
  const app = await import("../src/lib/project-import/github-app");
  delete process.env.GITHUB_APP_CLIENT_ID;
  assert.equal(await app.userCanAccessInstallation("code", 111), false, "no OAuth client settings: refuse");
  process.env.GITHUB_APP_CLIENT_ID = "id";
  process.env.GITHUB_APP_CLIENT_SECRET = "secret";
  assert.equal(await app.userCanAccessInstallation("", 111), false, "no code: refuse");
  assert.equal(await app.userCanAccessInstallation("code", 111), true, "the user's own installation");
  assert.equal(await app.userCanAccessInstallation("code", 222), false, "someone else's installation id");

  /* ---------------------------------------------------------------- A04 / A05 */
  const pd = http.createServer((req, res) => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { code: "visitor_quota_exceeded", message: "Daily limit reached" } }));
  });
  await new Promise<void>((r) => pd.listen(0, r));
  process.env.PARTDATA_API_BASE = `http://127.0.0.1:${(pd.address() as any).port}`;
  process.env.PARTDATA_API_KEY = "k";
  process.env.PARTDATA_API_SECRET = "s";
  const server = await import("../src/lib/maker/server");
  calls.length = 0;
  await assert.rejects(server.search("STM32F103", "visitor-a"), (e: any) => e.status === 429);
  assert.equal(calls.filter((u) => u.includes("mouser")).length, 0, "quota exhausted: no distributor calls");

  calls.length = 0;
  const one = await server.search("NE555", "visitor-a", true, { partdata: false });
  const two = await server.search("ne555 ", "visitor-a", true, { partdata: false });
  assert.equal(calls.filter((u) => u.includes("mouser")).length, 1, "the same lookup twice: one Mouser call");
  assert.equal(one.items[0].mpn, "NE555");
  assert.equal(two.items[0].offers.length, 1, "cached offers are copies, not merged into the cache");
  await server.search("LM358", "visitor-a", true, { partdata: false });
  await server.search("TL072", "visitor-a", true, { partdata: false });
  const over = await server.search("LM317", "visitor-a", true, { partdata: false });
  assert.equal(calls.filter((u) => u.includes("mouser")).length, 3, "the visitor's 4th new lookup is not sent");
  assert.match(over.sources.find((s) => s.source === "Mouser direct")!.message || "", /paused/);
  const other = await server.search("LM317", "visitor-b", true, { partdata: false });
  assert.equal(other.sources.find((s) => s.source === "Mouser direct")!.status, "ready", "another visitor still has budget");
  pd.close();

  /* ---------------------------------------------------------------- A03 */
  const limits = await import("../src/lib/maker/limits");
  for (let i = 0; i < 120; i++) await limits.limitRequest("ip-x", "api");
  await assert.rejects(limits.limitRequest("ip-x", "api"), (e: any) => e.status === 429);
  for (let i = 0; i < 20; i++) await limits.limitRequest("ip-y", "translate");
  await assert.rejects(limits.limitRequest("ip-y", "translate"), (e: any) => e.status === 429);
  const req = new Request("http://x/api/maker/datasheet", { headers: { "x-forwarded-for": "9.9.9.9" } });
  for (let i = 0; i < 240; i++) assert.equal(await limits.limitRoute(req, "files"), null);
  assert.equal((await limits.limitRoute(req, "files"))!.status, 429, "datasheet / library / model routes are rate limited");
  // Redis configured but failing: rate limits fail open, the paid-call ledger fails closed.
  limits.__setRedisForTests({ incr: async () => { throw Error("down"); }, incrby: async () => { throw Error("down"); }, expire: async () => 1, get: async () => { throw Error("down"); }, set: async () => { throw Error("down"); } });
  await limits.limitRequest("ip-z", "api");
  assert.equal(await limits.reserveSupplierCall("mouser", "visitor-c"), false);
  assert.equal(await limits.reserveTranslation("visitor-c", 10), false);
  limits.__setRedisForTests(null);

  /* ---------------------------------------------------------------- A07 */
  const { peekStream, chunkStream } = await import("../src/lib/maker/stream-body");
  const src = (n: number) => new Response(new Uint8Array(n).fill(65)).body;
  const ok = await peekStream(src(5000), 1024, 10_000);
  assert.ok(ok.head.length >= 1024);
  assert.equal((await new Response(ok.stream).arrayBuffer()).byteLength, 5000);
  let n = 0;
  const chunks = new ReadableStream<Uint8Array>({ pull: (c) => (n++ < 10 ? c.enqueue(new Uint8Array(5000)) : c.close()) });
  const big = await peekStream(chunks, 10, 20_000);
  await assert.rejects(new Response(big.stream).arrayBuffer(), "a stream over its cap errors");
  assert.equal((await new Response(chunkStream(new Uint8Array(700_000))).arrayBuffer()).byteLength, 700_000);

  console.log("prelaunch audit checks passed");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
