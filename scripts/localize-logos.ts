import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { resources } from "../src/db/schema";
import * as fs from "fs";
import * as path from "path";

/* ----------------------------------------------------------------------------
   Download each resource's logo (Google favicon or any external image URL) into
   public/logos/<slug>.png, then point the DB logo field at the LOCAL path.

   After this runs:
     - icons are served from your own /logos/* (Vercel global CDN, no Google call)
     - works in regions where Google is slow/blocked (better for Asia)

   Re-runnable. Skips logos that are already local (start with "/logos/").
   Must be run LOCALLY (needs internet to fetch the icons), then commit + push
   the new public/logos/*.png files.
---------------------------------------------------------------------------- */

const OUT_DIR = path.join(process.cwd(), "public", "logos");

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 100) return null; // too small => probably a blank/placeholder
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const all = await db.select().from(resources);
  let saved = 0, skipped = 0, failed = 0;

  for (const r of all) {
    const logo = r.logo || "";
    // already local, or no logo to fetch
    if (!logo || logo.startsWith("/logos/")) { skipped++; continue; }
    // only fetch http(s) URLs
    if (!/^https?:\/\//.test(logo)) { skipped++; continue; }

    const buf = await fetchBuffer(logo);
    if (!buf) {
      console.log(`  ✗ failed: ${r.name} (${logo.slice(0, 60)})`);
      failed++;
      continue;
    }
    // Google favicons are PNG; save as .png keyed by slug (unique, URL-safe)
    const file = `${r.slug}.png`;
    fs.writeFileSync(path.join(OUT_DIR, file), buf);
    const localPath = `/logos/${file}`;
    await db.update(resources).set({ logo: localPath }).where(sql`${resources.id} = ${r.id}`);
    console.log(`  ✓ ${r.name} -> public/logos/${file}`);
    saved++;
  }

  console.log(`\nDone. Saved ${saved}, skipped ${skipped} (already local / none), failed ${failed}.`);
  console.log("Next: commit the new public/logos/*.png files and push so Vercel serves them.");
  if (failed > 0) console.log("Failed ones kept their old URL — you can set a logo manually in admin, or re-run.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

