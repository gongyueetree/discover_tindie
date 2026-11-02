/**
 * GitHub API redirects (renamed / transferred repositories) and timeouts, with a mocked fetch.
 * mossmann/hackrf moved to greatscottgadgets/hackrf: the API answers the old name with 301.
 */
import assert from "node:assert/strict";

const SHA = "a".repeat(40);
let mode: "ok" | "evil" | "slow" = "ok";
const seen: string[] = [];
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  seen.push(url.href);
  assert.equal(init.redirect, "manual", "redirects are never followed blindly");
  if (mode === "slow") throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const go = (to: string) => new Response(null, { status: 301, headers: { location: to } });
  const p = url.pathname;
  if (p === "/repos/mossmann/hackrf") return go(mode === "evil" ? "https://evil.example/repositories/1" : "https://api.github.com/repositories/1");
  if (p === "/repositories/1") return Response.json({ full_name: "greatscottgadgets/hackrf", default_branch: "main", private: false });
  if (p === `/repos/greatscottgadgets/hackrf/commits/${SHA}`)
    return Response.json({ sha: SHA, commit: { tree: { sha: "t1" }, committer: { date: "2024-01-01T00:00:00Z" } } });
  if (p === "/repos/greatscottgadgets/hackrf/git/trees/t1")
    return Response.json({
      truncated: false,
      tree: ["hackrf-one.kicad_pro", "hackrf-one.kicad_sch", "hackrf-one.kicad_pcb"].map((f) => ({
        path: "hardware/hackrf-one/" + f, type: "blob", mode: "100644", sha: f, size: 100,
      })),
    });
  return Response.json({ message: "Not Found" }, { status: 404 });
}) as typeof fetch;

async function main() {
  const { scanGithub } = await import("../src/lib/maker/github-server");
  const r = await scanGithub(`https://github.com/mossmann/hackrf/tree/${SHA}/hardware/hackrf-one`);
  assert.equal(r.repo, "greatscottgadgets/hackrf", "continues under the repository's current name");
  assert.equal(r.projects.length, 1);
  assert.ok(seen.includes("https://api.github.com/repositories/1"), "API redirect followed");

  mode = "evil";
  await assert.rejects(scanGithub(`https://github.com/mossmann/hackrf/tree/${"b".repeat(40)}`), /unexpected address/);
  mode = "slow";
  await assert.rejects(scanGithub(`https://github.com/mossmann/hackrf/tree/${"c".repeat(40)}`), /took too long/);
  console.log("PASS: renamed-repository redirects followed within api.github.com only; timeouts reported as such");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
