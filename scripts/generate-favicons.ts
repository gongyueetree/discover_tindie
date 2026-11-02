import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { resources } from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";

const OUT_DIR = path.join(process.cwd(), "public", "logos");

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

async function tryFetch(url: string): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (favicon-fetch)" }, signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!/image|icon|octet-stream/i.test(ct)) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 70) return null;
    return Buffer.from(ab);
  } catch { return null; }
}

// Try several favicon sources in order; first that works wins.
async function getFavicon(domain: string): Promise<{ buf: Buffer; ext: string } | null> {
  const candidates = [
    { url: `https://icons.duckduckgo.com/ip3/${domain}.ico`, ext: "ico" },
    { url: `https://${domain}/favicon.ico`, ext: "ico" },
    { url: `https://www.google.com/s2/favicons?domain=${domain}&sz=128`, ext: "png" },
    { url: `https://favicon.yandex.net/favicon/${domain}`, ext: "png" },
  ];
  for (const c of candidates) {
    const buf = await tryFetch(c.url);
    if (buf) return { buf, ext: c.ext };
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const all = await db.select().from(resources);
  console.log(`Found ${all.length} resources. Fetching favicons...`);
  let saved = 0, skipped = 0, failed = 0;

  for (const r of all) {
    if (r.logo && r.logo.startsWith("/logos/")) { skipped++; continue; }
    const domain = domainOf(r.url);
    if (!domain) { console.log(`  x no domain: ${r.name}`); failed++; continue; }

    const fav = await getFavicon(domain);
    if (!fav) { console.log(`  x failed: ${r.name} (${domain})`); failed++; continue; }

    const file = `${r.slug}.${fav.ext}`;
    fs.writeFileSync(path.join(OUT_DIR, file), fav.buf);
    await db.update(resources).set({ logo: `/logos/${file}` }).where(sql`${resources.id} = ${r.id}`);
    console.log(`  ok ${r.name}  (${domain})`);
    saved++;
  }
  console.log(`\nDone. Saved ${saved}, skipped ${skipped}, failed ${failed}.`);
  console.log("Next: commit the new public/logos/* files and push.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

