import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { resources } from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";

// Regenerate ALL resource favicons, preferring Google's high-res (sz=128)
// service, falling back to other sources only when Google fails.
// Unlike generate-favicons.ts, this OVERWRITES existing local logos.
//
// Run locally (needs access to google.com — use a proxy if in CN):
//   DATABASE_URL='<tindie connection string>' npx tsx scripts/regen-favicons-google.ts
//
// After it finishes: commit the new public/logos/* files and push.

const OUT_DIR = path.join(process.cwd(), "public", "logos");
const SIZE = 128;
// Google's "no real favicon" fallback (a generic globe) is tiny; anything
// under this many bytes is treated as a miss so we try the next source.
const MIN_BYTES = 120;

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

async function tryFetch(url: string): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (favicon-fetch)" }, signal: ctrl.signal, redirect: "follow" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!/image|icon|octet-stream/i.test(ct)) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < MIN_BYTES) return null;
    return Buffer.from(ab);
  } catch { return null; }
}

// Google first (high-res), then fallbacks. All normalized to .png on disk.
async function getFavicon(domain: string): Promise<Buffer | null> {
  const candidates = [
    `https://www.google.com/s2/favicons?domain=${domain}&sz=${SIZE}`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
    `https://${domain}/favicon.ico`,
    `https://favicon.yandex.net/favicon/${domain}`,
  ];
  for (const url of candidates) {
    const buf = await tryFetch(url);
    if (buf) return buf;
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const all = await db.select().from(resources);
  console.log(`Found ${all.length} resources. Regenerating favicons (Google sz=${SIZE}, overwrite)...`);
  let saved = 0, failed = 0;

  for (const r of all) {
    const domain = domainOf(r.url);
    if (!domain) { console.log(`  x no domain: ${r.name}`); failed++; continue; }

    const buf = await getFavicon(domain);
    if (!buf) { console.log(`  x failed: ${r.name} (${domain})`); failed++; continue; }

    // Always write .png with a stable name per slug, overwriting any prior file.
    const file = `${r.slug}.png`;
    fs.writeFileSync(path.join(OUT_DIR, file), buf);
    const newPath = `/logos/${file}`;
    if (r.logo !== newPath) {
      await db.update(resources).set({ logo: newPath }).where(sql`${resources.id} = ${r.id}`);
    }
    console.log(`  ok ${r.name}  (${domain})  ${buf.byteLength}b`);
    saved++;
  }

  console.log(`\nDone. Saved ${saved}, failed ${failed}.`);
  console.log("Next: commit the new public/logos/*.png files and push.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

