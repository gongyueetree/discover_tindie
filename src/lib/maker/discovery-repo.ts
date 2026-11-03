import "server-only";
import { githubUsable } from "@/lib/maker/github-server";

/**
 * The GitHub project behind a discovery, when it has design files the Open hardware viewer can open.
 *
 * A discovery's source is usually an article (Hackaday, a blog…) rather than the repository, so:
 *   1. the source URL itself, when it is a github.com repository or folder;
 *   2. otherwise the GitHub repositories the article links to, in page order (at most three checked).
 * A repository counts only if it holds a supported, non-LFS schematic / board project (githubUsable).
 * Answers are cached a day per discovery (a short time when GitHub or the article could not be read).
 */
const cache = new Map<number, { until: number; value: Promise<string | null> }>();

/** github.com paths that are site pages, not repository owners. */
const NOT_OWNERS = new Set(
  "about apps blog collections contact customer-stories enterprise events explore features git-guides github login logout marketplace new notifications orgs organizations pricing readme security sessions settings site sponsors team topics trending users".split(
    " ",
  ),
);

export function githubRepoLinks(html: string): string[] {
  const out: string[] = [];
  const re = /https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})(\/tree\/[^\s"'<>#?]+)?/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const owner = m[1];
    const repo = m[2].replace(/\.git$/, "").replace(/[.)]+$/, "");
    if (!repo || NOT_OWNERS.has(owner.toLowerCase()) || /^(issues|pulls|wiki|releases|actions)$/i.test(repo)) continue;
    const url = `https://github.com/${owner}/${repo}${m[3] ? m[3].replace(/[.)]+$/, "") : ""}`;
    if (!out.some((u) => u.toLowerCase() === url.toLowerCase())) out.push(url);
  }
  return out;
}

const isRepoUrl = (u: string) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/tree\/.+)?\/?$/.test(u);

/** Public https page only: no IP literals, no local names; redirects followed by hand and re-checked. */
export function allowed(u: URL) {
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.endsWith(".local") || h.endsWith(".internal") || h === "localhost") return false;
  if (/^[\d.]+$/.test(h) || h.includes(":") || h.startsWith("[")) return false;
  return true;
}

async function articleHtml(url: string): Promise<string> {
  let target = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (!allowed(target)) throw Error("blocked");
    const r = await fetch(target, {
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "TindieDiscover/1.0 (+https://www.tindie.com)", Accept: "text/html" },
      cache: "no-store",
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const next = r.headers.get("location");
      if (!next) throw Error("redirect");
      target = new URL(next, target);
      continue;
    }
    if (!r.ok || !/html/i.test(r.headers.get("content-type") || "")) throw Error("not html");
    // Read at most ~1.5 MB: links to a project are near the top of an article.
    const reader = r.body?.getReader();
    if (!reader) return "";
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < 1_500_000) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    void reader.cancel().catch(() => undefined);
    return new TextDecoder().decode(Buffer.concat(chunks));
  }
  throw Error("too many redirects");
}

export function discoveryRepo(id: number, sourceUrl: string | null): Promise<string | null> {
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return hit.value;
  if (cache.size > 2000) cache.clear();
  let unsure = false;
  const value = (async () => {
    if (!sourceUrl) return null;
    let candidates: string[];
    if (isRepoUrl(sourceUrl.replace(/\/$/, ""))) candidates = [sourceUrl.replace(/\/$/, "")];
    else {
      try {
        candidates = githubRepoLinks(await articleHtml(sourceUrl)).slice(0, 3);
      } catch {
        unsure = true;
        return null;
      }
    }
    for (const c of candidates) {
      const ok = await githubUsable(c);
      if (ok) return c;
      if (ok === null) unsure = true;
    }
    return null;
  })();
  cache.set(id, { until: Date.now() + 86_400_000, value });
  value.then(() => {
    if (unsure) cache.set(id, { until: Date.now() + 15 * 60_000, value });
  });
  return value;
}
