#!/usr/bin/env node
// Builds src/data/kicad-index.json: name → library for the official KiCad symbol and
// footprint libraries at a pinned tag. partdata returns bare names ("STM32H503KBUx",
// "QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm"); this index resolves them to exact files on
// gitlab.com without paging the GitLab API at request time.
//
//   node scripts/build-kicad-index.mjs            # uses KICAD_TAG (default 10.0.0)
//
// Needs git and network access to gitlab.com. Only the file list is fetched (no blobs).
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TAG = process.env.KICAD_TAG || "10.0.0";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function list(repo) {
  const dir = mkdtempSync(join(tmpdir(), repo + "-"));
  try {
    const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8", maxBuffer: 64 << 20 });
    git("init", "-q");
    git("remote", "add", "origin", `https://gitlab.com/kicad/libraries/${repo}.git`);
    git("fetch", "-q", "--depth", "1", "--filter=blob:none", "origin", "tag", TAG);
    return git("ls-tree", "-r", "--name-only", "FETCH_HEAD").split("\n").filter(Boolean);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function group(paths, dirSuffix, fileSuffix) {
  const out = {};
  for (const p of paths) {
    const m = p.match(new RegExp(`^([^/]+)\\${dirSuffix}/([^/]+)\\${fileSuffix}$`));
    if (!m) continue;
    (out[m[1]] ||= []).push(m[2]);
  }
  for (const k of Object.keys(out)) out[k].sort();
  return out;
}

const symbols = group(list("kicad-symbols"), ".kicad_symdir", ".kicad_sym");
const footprints = group(list("kicad-footprints"), ".pretty", ".kicad_mod");
const count = (o) => Object.values(o).reduce((n, v) => n + v.length, 0);
const out = { tag: TAG, generatedAt: new Date().toISOString(), symbols, footprints };
mkdirSync(join(root, "src/data"), { recursive: true });
writeFileSync(join(root, "src/data/kicad-index.json"), JSON.stringify(out));
console.log(`KiCad ${TAG}: ${count(symbols)} symbols in ${Object.keys(symbols).length} libraries, ` +
  `${count(footprints)} footprints in ${Object.keys(footprints).length} libraries`);
