/**
 * "View design files" on Today's discoveries: which GitHub links in an article count as projects,
 * and the article fetch never leaves public https hosts (redirects re-checked).
 */
import assert from "node:assert/strict";
import { allowed, discoveryRepo, githubRepoLinks } from "../src/lib/maker/discovery-repo";

const html = `
  <a href="https://github.com/sponsors/someone">Sponsor</a>
  <a href="https://github.com/features/actions">Actions</a>
  <a href="https://github.com/acme/widget-board">Project</a>
  <a href="https://github.com/acme/widget-board.git">clone</a>
  <a href="https://github.com/acme/widget-board/issues">issues</a>
  <a href="https://www.github.com/maker/keeb/tree/main/pcb">PCB folder</a>
  See https://github.com/other/repo).`;
assert.deepEqual(githubRepoLinks(html), [
  "https://github.com/acme/widget-board",
  "https://github.com/maker/keeb/tree/main/pcb",
  "https://github.com/other/repo",
]);

for (const bad of ["http://hackaday.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://[::1]/x", "https://intranet/x", "https://a.b:8443/x", "https://u:p@a.com/"])
  assert.equal(allowed(new URL(bad)), false, bad);
assert.equal(allowed(new URL("https://hackaday.com/2026/11/03/post/")), true);

void (async () => {
// A redirect to a private address stops the lookup before anything else is fetched.
const seen: string[] = [];
globalThis.fetch = (async (input: any) => {
  seen.push(String(input));
  return new Response(null, { status: 302, headers: { location: "https://10.0.0.5/admin" } });
}) as typeof fetch;
assert.equal(await discoveryRepo(1, "https://blog.example.com/post"), null);
assert.deepEqual(seen, ["https://blog.example.com/post"]);

// No source, no lookup.
assert.equal(await discoveryRepo(2, null), null);
console.log("discovery repo checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
