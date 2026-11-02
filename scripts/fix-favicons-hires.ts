import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { resources } from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";

// Fetch the SHARPEST available icon for each target site by reading its HTML
// <head> for apple-touch-icon / large <link rel=icon> declarations (usually
// 180x180+), which are far crisper than Google's low-res favicon.
// Falls back to Google s2 (sz=128) only if nothing better is found.
//
// Run locally (needs normal internet access to each site):
//   DATABASE_URL='<tindie connection string>' npx tsx scripts/fix-favicons-hires.ts
//
// To process ALL resources instead of just the targets, set ALL=1:
//   ALL=1 DATABASE_URL='...' npx tsx scripts/fix-favicons-hires.ts

const OUT_DIR = path.join(process.cwd(), "public", "logos");
const PROCESS_ALL = process.env.ALL === "1";

const TARGET_DOMAINS = [
  "tindie.com", "easyeda.com", "pcbway.com",
  "octopart.com", "findchips.com", "mouser.com",
];

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,*/*" }, signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; }
}

async function fetchBuf(url: string): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "image/*,*/*" }, signal: ctrl.signal, redirect: "follow" });
    clearTimeout(t);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 200) return null;
    return Buffer.from(ab);
  } catch { return null; }
}

// Parse <link rel="apple-touch-icon|icon" ...> from HTML and rank by size.
function findIconLinks(html: string, baseUrl: string): string[] {
  const links: { href: string; size: number; apple: boolean }[] = [];
  const re = /<link\b[^>]*>/gi;
  const tags = html.match(re) || [];
  for (const tag of tags) {
    if (!/rel\s*=\s*["'][^"']*icon[^"']*["']/i.test(tag)) continue;
    const hrefM = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefM) continue;
    const sizesM = tag.match(/sizes\s*=\s*["'](\d+)x\d+["']/i);
    const size = sizesM ? parseInt(sizesM[1], 10) : 0;
    const apple = /apple-touch-icon/i.test(tag);
    let href = hrefM[1];
    try { href = new URL(href, baseUrl).href; } catch { continue; }
    links.push({ href, size, apple });
  }
  // Prefer apple-touch-icon, then larger declared sizes, then PNG over ico.
  links.sort((a, b) => {
    if (a.apple !== b.apple) return a.apple ? -1 : 1;
    if (b.size !== a.size) return b.size - a.size;
    const ap = /\.png(\?|$)/i.test(a.href) ? 1 : 0;
    const bp = /\.png(\?|$)/i.test(b.href) ? 1 : 0;
    return bp - ap;
  });
  return links.map((l) => l.href);
}

async function bestIcon(siteUrl: string, domain: string): Promise<Buffer | null> {
  const html = await fetchText(siteUrl) || await fetchText(`https://${domain}/`);
  if (html) {
    const candidates = findIconLinks(html, siteUrl);
    // Also try the conventional apple-touch-icon path as a strong default.
    candidates.push(`https://${domain}/apple-touch-icon.png`, `https://${domain}/apple-touch-icon-precomposed.png`);
    for (const url of candidates.slice(0, 6)) {
      const buf = await fetchBuf(url);
      if (buf) { console.log(`    via ${url} (${buf.byteLength}b)`); return buf; }
    }
  }
  // Fallback: Google high-res.
  const g = await fetchBuf(`https://www.google.com/s2/favicons?domain=${domain}&sz=128`);
  if (g) { console.log(`    via google fallback (${g.byteLength}b)`); return g; }
  return null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const all = await db.select().from(resources);
  const targets = PROCESS_ALL ? all : all.filter((r) => { const d = domainOf(r.url); return d && TARGET_DOMAINS.includes(d); });
  console.log(`Processing ${targets.length} resource(s)${PROCESS_ALL ? " (ALL)" : ""}...`);

  let saved = 0, failed = 0;
  for (const r of targets) {
    const domain = domainOf(r.url);
    if (!domain) { failed++; continue; }
    console.log(`  ${r.name} (${domain})`);
    const buf = await bestIcon(r.url, domain);
    if (!buf) { console.log(`    x failed`); failed++; continue; }
    const file = `${r.slug}.png`;
    fs.writeFileSync(path.join(OUT_DIR, file), buf);
    const newPath = `/logos/${file}`;
    if (r.logo !== newPath) await db.update(resources).set({ logo: newPath }).where(sql`${resources.id} = ${r.id}`);
    console.log(`    ok -> ${file}`);
    saved++;
  }
  console.log(`\nDone. Saved ${saved}, failed ${failed}.`);
  console.log("Eyeball public/logos/*.png, then commit & push.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

