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
        path: "hardware/hackrf-one/" + f, type: "blob", mode: "100644", sha: f, size: 50_000,
      })),
    });
  // acme/lfs: Altium files stored with Git LFS (pointer-sized); acme/none: no engineering files; acme/quota: rate limited
  if (p === "/repos/acme/lfs" || p === "/repos/acme/none") return Response.json({ full_name: p.slice(7), default_branch: "main", private: false });
  if (p === "/repos/acme/quota") return Response.json({ message: "rate limit" }, { status: 403 });
  if (/^\/repos\/acme\/(lfs|none)\/commits\//.test(p))
    return Response.json({ sha: SHA, commit: { tree: { sha: p.includes("lfs") ? "tl" : "tn" }, committer: { date: "2024-01-01T00:00:00Z" } } });
  if (p === "/repos/acme/lfs/git/trees/tl")
    return Response.json({ truncated: false, tree: ["board.PrjPcb", "board.SchDoc", "board.PcbDoc"].map((f) => ({ path: "hw/" + f, type: "blob", mode: "100644", sha: f, size: 131 })) });
  if (p === "/repos/acme/none/git/trees/tn")
    return Response.json({ truncated: false, tree: [{ path: "README.md", type: "blob", mode: "100644", sha: "r", size: 900 }] });
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
  mode = "ok";
  const { githubUsable } = await import("../src/lib/maker/github-server");
  assert.equal(await githubUsable(`https://github.com/mossmann/hackrf/tree/${SHA}/hardware/hackrf-one`), true, "real KiCad files");
  assert.equal(await githubUsable(`https://github.com/acme/lfs/tree/${SHA}`), false, "Git LFS pointers only");
  assert.equal(await githubUsable(`https://github.com/acme/none/tree/${SHA}`), false, "no engineering project");
  assert.equal(await githubUsable(`https://github.com/acme/quota/tree/${SHA}`), null, "quota: unknown, never hidden");
  console.log("PASS: openable-design check (real files / LFS pointers / no project / quota)");
  console.log("PASS: renamed-repository redirects followed within api.github.com only; timeouts reported as such");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
