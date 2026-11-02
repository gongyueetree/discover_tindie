import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { resources } from "../src/db/schema";
import { execFile } from "child_process";
import { promisify } from "util";
import * as fs from "fs";
import * as path from "path";

const execFileP = promisify(execFile);

// Regenerate ALL resource favicons from Google's s2 endpoint, but using curl
// with the EXACT full browser headers that were verified to return crisp,
// real logos (the Node fetch version got placeholder/blurry images because its
// headers looked like a bot to Google).
//
// Run locally (your network must reach google.com — the same one where the
// favicon looked correct in your browser):
//   DATABASE_URL='<tindie connection string>' npx tsx scripts/regen-favicons-curl.ts
//
// Then: commit public/logos/*.png and push.

const OUT_DIR = path.join(process.cwd(), "public", "logos");
const SIZE = 128;
const MIN_BYTES = 200; // smaller than this is almost certainly a placeholder

function domainOf(url: string): string | null {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

async function fetchViaCurl(domain: string): Promise<Buffer | null> {
  const url = `https://www.google.com/s2/favicons?domain=${domain}&sz=${SIZE}`;
  const tmp = path.join("/tmp", `fav-${domain.replace(/[^a-z0-9]/gi, "_")}.png`);
  try {
    await execFileP("curl", [
      "-s", "-L", "--max-time", "20",
      "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "-H", "Accept: image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      "-H", "Accept-Language: en-US,en;q=0.9",
      "-H", "Referer: https://www.google.com/",
      "-H", "Sec-Fetch-Dest: image",
      "-H", "Sec-Fetch-Mode: no-cors",
      "-H", "Sec-Fetch-Site: same-origin",
      "-o", tmp,
      url,
    ]);
    if (!fs.existsSync(tmp)) return null;
    const buf = fs.readFileSync(tmp);
    fs.unlinkSync(tmp);
    if (buf.byteLength < MIN_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const all = await db.select().from(resources);
  console.log(`Found ${all.length} resources. Fetching via curl (Google sz=${SIZE}, full browser headers)...`);
  let saved = 0, failed = 0, small = 0;

  for (const r of all) {
    const domain = domainOf(r.url);
    if (!domain) { console.log(`  x no domain: ${r.name}`); failed++; continue; }

    const buf = await fetchViaCurl(domain);
    if (!buf) { console.log(`  x failed/too-small: ${r.name} (${domain})`); failed++; continue; }

    const file = `${r.slug}.png`;
    fs.writeFileSync(path.join(OUT_DIR, file), buf);
    const newPath = `/logos/${file}`;
    if (r.logo !== newPath) {
      await db.update(resources).set({ logo: newPath }).where(sql`${resources.id} = ${r.id}`);
    }
    const flag = buf.byteLength < 600 ? "  (small — check)" : "";
    if (buf.byteLength < 600) small++;
    console.log(`  ok ${r.name}  (${domain})  ${buf.byteLength}b${flag}`);
    saved++;
  }

  console.log(`\nDone. Saved ${saved}, failed ${failed}. ${small} were small (<600b) — eyeball those.`);
  console.log("Next: open a few public/logos/*.png to verify, then commit & push.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

