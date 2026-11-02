import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { zipSync } from "fflate";
import { SourceError } from "./server";
import { boundedBody } from "@/vendor/canon/lib/allegro-http";
import {
  discoverProjects,
  ignoredPath,
  referencedFiles,
  type RepoFile,
  type GithubProject,
} from "./github-projects";
// Must be the same on every server instance (scan and import can hit different serverless instances).
const secret =
  process.env.MAKER_IMPORT_SECRET || process.env.AUTH_SECRET || randomBytes(32).toString("hex");
type Snapshot = {
  repo: string;
  commit: string;
  ref: string;
  prefix: string;
  files: RepoFile[];
  projects: GithubProject[];
  expires: number;
};
const snapshots = new Map<string, Snapshot>();
// Overridable for local integration tests only (a mock GitHub); production uses the defaults.
const GITHUB_API = (process.env.MAKER_GITHUB_API_BASE || "https://api.github.com").replace(/\/$/, "");
const GITHUB_RAW = (process.env.MAKER_GITHUB_RAW_BASE || "https://raw.githubusercontent.com").replace(/\/$/, "");
// Scans of URLs pinned to a full commit SHA are immutable: reuse them (saves GitHub API quota).
const pinnedScans = new Map<string, { until: number; result: Promise<Awaited<ReturnType<typeof scanFresh>>> }>();
function headers() {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "Tindie-Maker-Tools",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(process.env.MAKER_GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.MAKER_GITHUB_TOKEN}` }
      : {}),
  };
}
/**
 * GitHub API GET. Renamed or transferred repositories (mossmann/hackrf → greatscottgadgets/hackrf)
 * answer with a redirect; it is followed only within the API origin, at most 3 times.
 */
async function github(path: string) {
  const origin = new URL(GITHUB_API).origin;
  let url = GITHUB_API + path;
  let r: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    try {
      r = await fetch(url, {
        headers: headers(),
        redirect: "manual",
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
    } catch (e) {
      throw new SourceError(
        e instanceof Error && e.name === "TimeoutError"
          ? "GitHub took too long to respond. Please retry in a moment."
          : "GitHub is unreachable from this server.",
        502,
      );
    }
    if (![301, 302, 307, 308].includes(r.status)) break;
    let next: URL | null = null;
    try {
      next = new URL(r.headers.get("location") || "", url);
    } catch {}
    if (!next || next.origin !== origin) throw new SourceError("GitHub redirected to an unexpected address.", 502);
    url = next.href;
    r = null;
  }
  if (!r) throw new SourceError("GitHub redirected too many times.", 502);
  if (!r.ok)
    throw new SourceError(
      r.status === 403 || r.status === 429
        ? "GitHub API quota reached. Retry later or configure a server-side GitHub token."
        : `GitHub returned HTTP ${r.status}. Check the public repository URL.`,
      r.status,
    );
  return r.json();
}
export function parseGithubUrl(raw: string) {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SourceError("Enter a github.com repository or folder URL.", 400);
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== "github.com" ||
    u.username ||
    u.password ||
    u.port
  )
    throw new SourceError("Only HTTPS github.com URLs are supported.", 400);
  const p = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (
    p.length < 2 ||
    !p.slice(0, 2).every((x) => /^[\w.-]+$/.test(x)) ||
    p.some((x) => x === "..")
  )
    throw new SourceError("Invalid repository URL.", 400);
  if (p[2] && !["tree", "blob"].includes(p[2]))
    throw new SourceError("Use a repository, tree or file URL.", 400);
  return {
    repo: p
      .slice(0, 2)
      .join("/")
      .replace(/\.git$/, ""),
    kind: p[2] || "",
    tail: p.slice(3),
  };
}
/**
 * Selection token = base64url({repo, commit, ref, prefix, expiry}) + "." + HMAC. It is
 * self-describing, so an instance that did not perform the scan can rebuild the snapshot
 * from GitHub at the same immutable commit instead of failing.
 */
type TokenData = { r: string; c: string; f: string; p: string; e: number };
function token(id: string) {
  return id + "." + createHmac("sha256", secret).update(id).digest("hex");
}
function tokenId(d: TokenData) {
  return Buffer.from(JSON.stringify(d)).toString("base64url");
}
async function snapshot(value: string): Promise<Snapshot> {
  const [id, sig] = value.split(".");
  if (
    !id ||
    !sig ||
    !/^[A-Za-z0-9_-]{1,2000}$/.test(id) ||
    !/^[a-f0-9]{64}$/.test(sig) ||
    !timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(token(id).split(".")[1], "hex"))
  )
    throw new SourceError("Invalid import selection.", 400);
  let d: TokenData;
  try {
    d = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
  } catch {
    throw new SourceError("Invalid import selection.", 400);
  }
  if (!d || typeof d.e !== "number" || d.e < Date.now())
    throw new SourceError("The import selection expired. Scan the repository again.", 410);
  const cached = snapshots.get(id);
  if (cached) return cached;
  // Not scanned on this instance: rebuild from the same commit (immutable).
  if (!/^[\w.-]+\/[\w.-]+$/.test(d.r) || !/^[0-9a-f]{40}$/.test(d.c))
    throw new SourceError("Invalid import selection.", 400);
  const commit = await github(`/repos/${d.r}/commits/${d.c}`);
  const tree = await github(`/repos/${d.r}/git/trees/${commit.commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new SourceError("This repository tree is too large to scan safely.", 413);
  const files: RepoFile[] = tree.tree
    .filter((f: any) => f.type === "blob" && f.mode !== "120000")
    .map((f: any) => ({ path: f.path, sha: f.sha, size: f.size || 0, type: f.type, mode: f.mode }));
  const s: Snapshot = { repo: d.r, commit: d.c, ref: d.f, prefix: d.p, files, projects: discoverProjects(files, d.p), expires: d.e };
  if (snapshots.size >= 25) snapshots.delete(snapshots.keys().next().value!);
  snapshots.set(id, s);
  return s;
}
export function scanGithub(url: string) {
  if (!/\/tree\/[0-9a-f]{40}(\/|$)/.test(url)) return scanFresh(url);
  const hit = pinnedScans.get(url);
  if (hit && hit.until > Date.now()) return hit.result;
  if (pinnedScans.size > 100) pinnedScans.clear();
  const result = scanFresh(url);
  pinnedScans.set(url, { until: Date.now() + 25 * 60 * 1000, result });
  result.catch(() => pinnedScans.delete(url));
  return result;
}
async function scanFresh(url: string) {
  const parsed = parseGithubUrl(url);
  const repo = await github("/repos/" + parsed.repo);
  // A renamed / transferred repository: continue (and build raw file URLs) under its current name.
  if (typeof repo.full_name === "string" && /^[\w.-]+\/[\w.-]+$/.test(repo.full_name)) parsed.repo = repo.full_name;
  const base = "/repos/" + parsed.repo;
  if (repo.private)
    throw new SourceError(
      "Only public repositories can be imported without signing in.",
      403,
    );
  let ref = repo.default_branch,
    prefix = "";
  let commit: any;
  if (parsed.tail.length) {
    for (let n = parsed.tail.length; n > 0; n--) {
      try {
        commit = await github(
          base +
            "/commits/" +
            encodeURIComponent(parsed.tail.slice(0, n).join("/")),
        );
        ref = parsed.tail.slice(0, n).join("/");
        prefix = parsed.tail.slice(n).join("/");
        break;
      } catch (e) {
        if (
          !(e instanceof SourceError) ||
          (e.status !== 404 && e.status !== 422)
        )
          throw e;
      }
    }
    if (!commit)
      throw new SourceError(
        "The branch, tag or commit could not be resolved.",
        404,
      );
  } else commit = await github(base + "/commits/" + encodeURIComponent(ref));
  const tree = await github(
    base + "/git/trees/" + commit.commit.tree.sha + "?recursive=1",
  );
  if (tree.truncated)
    throw new SourceError(
      "This repository tree is too large to scan safely. Download the desired design folder and import it locally.",
      413,
    );
  const files: RepoFile[] = tree.tree
    .filter((f: any) => f.type === "blob" && f.mode !== "120000")
    .map((f: any) => ({
      path: f.path,
      sha: f.sha,
      size: f.size || 0,
      type: f.type,
      mode: f.mode,
    }));
  if (parsed.kind === "blob")
    prefix = prefix.includes("/")
      ? prefix.slice(0, prefix.lastIndexOf("/"))
      : "";
  const projects = discoverProjects(files, prefix);
  if (!projects.length)
    throw new SourceError(
      "No supported current engineering projects found in this folder. ZIP-only repositories can be downloaded and opened locally.",
      404,
    );
  for (const [id, s] of snapshots)
    if (s.expires < Date.now()) snapshots.delete(id);
  if (snapshots.size >= 25) snapshots.delete(snapshots.keys().next().value!);
  const expires = Date.now() + 30 * 60 * 1000;
  const id = tokenId({ r: parsed.repo, c: commit.sha, f: ref, p: prefix, e: expires });
  snapshots.set(id, {
    repo: parsed.repo,
    commit: commit.sha,
    ref,
    prefix,
    files,
    projects,
    expires,
  });
  return {
    token: token(id),
    repo: parsed.repo,
    commit: commit.sha,
    ref,
    projects,
    ignoredCount: files.filter((f) => ignoredPath(f.path)).length,
    scope: prefix || "Repository root",
    committedAt: commit.commit.committer.date,
  };
}
export async function importGithub(selection: string, projectId: string) {
  const s = await snapshot(selection),
    project = s.projects.find((p) => p.id === projectId);
  if (!project)
    throw new SourceError(
      "Select a project returned by the repository scan.",
      400,
    );
  const files = new Map(s.files.map((f) => [f.path, f]));
  const data: Record<string, Uint8Array> = {};
  const queue = [...project.roots];
  const skipped: string[] = [];
  let bytes = 0;
  // Only this project's root files, directly referenced sheets/models and local library tables.
  for (const n of ["sym-lib-table", "fp-lib-table"]) {
    const path = [project.directory, n].filter(Boolean).join("/");
    if (files.has(path)) queue.push(path);
  }
  for (const f of s.files) {
    const dir = f.path.includes("/")
      ? f.path.slice(0, f.path.lastIndexOf("/"))
      : "";
    const name = f.path.split("/").pop()!;
    if (
      (!dir || dir === project.directory) &&
      /^(LICENSE|LICENCE|COPYING|NOTICE)(\.[a-z]+)?$/i.test(name) &&
      !queue.includes(f.path)
    )
      queue.push(f.path);
    // KiCad 5 projects keep the symbols their sheets use in <project>-cache.lib (and -rescue.lib);
    // without them a legacy schematic can only be drawn as bare pins.
    if (dir === project.directory && /-(cache|rescue)\.lib$/i.test(name) && !queue.includes(f.path))
      queue.push(f.path);
  }
  const queued = new Set(queue);
  while (queue.length) {
    if (Object.keys(data).length >= 200)
      throw new SourceError(
        "Selected project exceeds the 200-file import limit.",
        413,
      );
    const path = queue.shift()!,
      f = files.get(path);
    if (!f || ignoredPath(path)) {
      skipped.push(path);
      continue;
    }
    if (f.size > 25 * 1024 * 1024 || bytes + f.size > 75 * 1024 * 1024)
      throw new SourceError(
        "Selected design exceeds the 75 MB import limit.",
        413,
      );
    const url = `${GITHUB_RAW}/${s.repo}/${s.commit}/${path.split("/").map(encodeURIComponent).join("/")}`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Tindie-Maker-Tools" },
      redirect: "error",
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok)
      throw new SourceError(`Unable to read selected file: ${path}`, 502);
    const b = await boundedBody(r.body, 25 * 1024 * 1024);
    if (
      new TextDecoder()
        .decode(b.subarray(0, 100))
        .startsWith("version https://git-lfs.github.com/spec")
    ) {
      skipped.push(path + " (Git LFS pointer)");
      continue;
    }
    bytes += b.byteLength;
    if (bytes > 75 * 1024 * 1024)
      throw new SourceError("Selected design exceeds 75 MB.", 413);
    data[path] = b;
    if (
      /\.(kicad_sch|kicad_pcb|kicad_pro|sch|brd|PrjPcb)$/i.test(path) ||
      /lib-table$/.test(path)
    ) {
      for (const dep of referencedFiles(path, new TextDecoder().decode(b))) {
        const candidates = files.has(dep)
          ? [dep]
          : s.files
              .filter(
                (f) =>
                  f.path.startsWith(dep.replace(/\/$/, "") + "/") &&
                  /\.kicad_mod$/i.test(f.path),
              )
              .map((f) => f.path);
        if (!candidates.length) skipped.push(dep);
        for (const p of candidates)
          if (!queued.has(p)) {
            queued.add(p);
            queue.push(p);
          }
      }
    }
  }
  if (
    !Object.keys(data).some((p) =>
      /\.(kicad_sch|kicad_pcb|sch|brd|SchDoc|PcbDoc|epro|esch|epcb|json)$/i.test(p),
    )
  )
    throw new SourceError("No usable design files could be imported.", 422);
  data["TINDIE-IMPORT.json"] = new TextEncoder().encode(
    JSON.stringify(
      {
        repository: s.repo,
        ref: s.ref,
        commit: s.commit,
        project: project.id,
        files: Object.keys(data),
        skipped,
        note: "Pinned snapshot of the chosen project; unrelated files and backup/history folders excluded.",
      },
      null,
      2,
    ),
  );
  return { bytes: zipSync(data), name: project.name + ".zip" };
}

/* ------------------------------------------------------------------ README: intro + picture */

export type ReadmeInfo = { intro: string | null; image: string | null; readmeUrl: string | null };
const readmes = new Map<string, { until: number; value: Promise<ReadmeInfo> }>();
const BADGE = /shields\.io|badge|travis-ci|circleci|codecov|coveralls|github\.com\/[^/]+\/[^/]+\/(?:actions|workflows)|gitter|liberapay|ko-fi|buymeacoffee|patreon|opencollective|zenodo|deepwiki|\.svg(?:\?|$)/i;

/** Plain text from Markdown/HTML: drops code, images, badges, tables, headings and markup. */
export function readmeIntro(md: string) {
  const text = md
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "\n\n")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|h\d|table|tr|li|ul|ol)[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
  const paras = text
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split("\n")
        .filter((l) => !/^\s*(#{1,6}\s|\||[-=*_]{3,}\s*$|\[[^\]]+\]:\s)/.test(l))
        .join(" ")
        .replace(/[*_`]+/g, "")
        .replace(/^\s*(?:[-*+]|\d+\.)\s+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((p) => p.length >= 40 && /[a-z]{3}/i.test(p) && !/^(table of contents|license|copyright)\b/i.test(p));
  let out = "";
  for (const p of paras) {
    if (out && out.length + p.length > 700) break;
    out += (out ? "\n\n" : "") + p;
    if (out.length > 320) break;
  }
  if (out.length > 700) out = out.slice(0, 690).replace(/\s+\S*$/, "") + "…";
  return out || null;
}

/** First non-badge picture of a README, resolved against the README's raw location. */
export function readmeImage(md: string, base: string) {
  const re = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<img[^>]+src=["']([^"']+)["']/gi;
  for (let m = re.exec(md); m; m = re.exec(md)) {
    const raw = (m[1] || m[2] || "").trim();
    if (!raw || BADGE.test(raw)) continue;
    try {
      let u = new URL(raw, base);
      // github.com/<repo>/blob/<ref>/<path> → raw file
      const blob = u.hostname === "github.com" && u.pathname.match(/^\/([^/]+\/[^/]+)\/(?:blob|raw)\/(.+)$/);
      if (blob) u = new URL(`https://raw.githubusercontent.com/${blob[1]}/${blob[2]}`);
      if (u.protocol !== "https:" || u.username || u.password) continue;
      if (!/\.(png|jpe?g|gif|webp)$/i.test(u.pathname) && !/user-attachments|user-images\.githubusercontent|githubusercontent\.com\/.+\/assets\//i.test(u.href)) continue;
      return u.href;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * README of a public repository (optionally the folder the design lives in, falling back to
 * the repository root): a short plain-text introduction and its first real picture.
 * One GitHub API call per repository and folder, cached for a day (misses included).
 */
export function githubReadme(repo: string, commit: string | null, subdir = ""): Promise<ReadmeInfo> {
  const key = `${repo}@${commit || ""}/${subdir}`;
  const hit = readmes.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (readmes.size > 1000) readmes.clear();
  const value = (async (): Promise<ReadmeInfo> => {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || (commit && !/^[\w.-]{1,100}$/.test(commit))) return { intro: null, image: null, readmeUrl: null };
    const ref = commit ? `?ref=${commit}` : "";
    const dirs = [...new Set([subdir.replace(/^\/+|\/+$/g, ""), ""])];
    for (const dir of dirs) {
      if (dir && !dir.split("/").every((x) => /^[^.][^/]*$/.test(x))) continue;
      try {
        const d = await github(`/repos/${repo}/readme${dir ? "/" + dir.split("/").map(encodeURIComponent).join("/") : ""}${ref}`);
        if (d?.encoding !== "base64" || typeof d.content !== "string" || (d.size || 0) > 400_000) continue;
        const md = Buffer.from(d.content, "base64").toString("utf8");
        const base = typeof d.download_url === "string" ? d.download_url : `https://raw.githubusercontent.com/${repo}/${commit || "HEAD"}/${d.path || "README.md"}`;
        return { intro: readmeIntro(md), image: readmeImage(md, base), readmeUrl: typeof d.html_url === "string" ? d.html_url : null };
      } catch {
        continue;
      }
    }
    return { intro: null, image: null, readmeUrl: null };
  })();
  readmes.set(key, { until: Date.now() + 86_400_000, value });
  return value;
}

/** owner/repo, ref and folder of a github.com repository / tree URL (null for anything else). */
export function githubRepoOf(url: string) {
  const m = url.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:\/tree\/([\w.-]+)(?:\/(.*?))?)?\/?$/);
  if (!m) return null;
  let subdir = "";
  try {
    subdir = m[3] ? decodeURIComponent(m[3]) : "";
  } catch {
    subdir = "";
  }
  return { repo: m[1], commit: m[2] || null, subdir };
}

/* ------------------------------------------------------------------ can this design be opened? */

const usable = new Map<string, { until: number; value: Promise<boolean | null> }>();
/** A Git LFS pointer is ~130 bytes; real schematic / board files are far larger. */
const LFS_POINTER_MAX = 400;

/**
 * Whether a GitHub source holds an engineering project the viewer can import: a supported project
 * whose schematic / board files are real files, not Git LFS pointers. Uses the same scan as an import
 * (no file downloads). true / false are cached a day (a week for pinned commits); null = could not tell
 * (GitHub quota, outage), never cached for long, and callers must not hide the design for it.
 */
export function githubUsable(url: string): Promise<boolean | null> {
  const hit = usable.get(url);
  if (hit && hit.until > Date.now()) return hit.value;
  if (usable.size > 2000) usable.clear();
  const pinned = /\/tree\/[0-9a-f]{40}(\/|$)/.test(url);
  const value = (async (): Promise<boolean | null> => {
    try {
      const scan = await scanGithub(url);
      const snap = snapshots.get(scan.token.split(".")[0]);
      if (!snap) return null;
      const size = new Map(snap.files.map((f) => [f.path, f.size]));
      return scan.projects.some((p) =>
        p.roots.some((r) => /\.(kicad_sch|kicad_pcb|sch|brd|SchDoc|PcbDoc|epro|esch|epcb|json)$/i.test(r) && (size.get(r) || 0) > LFS_POINTER_MAX),
      );
    } catch (e) {
      // No supported project (404), repository gone (404) or too large to scan (413): it cannot be opened.
      if (e instanceof SourceError && (e.status === 404 || e.status === 413)) return false;
      return null;
    }
  })();
  usable.set(url, { until: Date.now() + (pinned ? 7 : 1) * 86_400_000, value });
  value.then((v) => {
    if (v === null) usable.set(url, { until: Date.now() + 10 * 60_000, value });
  });
  return value;
}
