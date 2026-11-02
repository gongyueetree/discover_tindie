import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { resources } from "../src/db/schema";

// Backfill favicons for resources that don't have a logo yet.
// Uses Google's favicon service: https://www.google.com/s2/favicons?domain=<host>&sz=128
// Only fills empty logos — never overwrites a logo an editor set manually.
// Pass --force to overwrite every logo with a fresh favicon.
const FORCE = process.argv.includes("--force");

function domainOf(url: string): string | null {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "");
  } catch { return null; }
}

async function main() {
  const all = await db.select().from(resources);
  let updated = 0, skipped = 0;
  for (const r of all) {
    if (!FORCE && r.logo) { skipped++; continue; }
    const host = domainOf(r.url);
    if (!host) { skipped++; continue; }
    const favicon = `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
    await db.update(resources).set({ logo: favicon }).where(sql`${resources.id} = ${r.id}`);
    updated++;
    console.log(`  ✓ ${r.name} -> ${host}`);
  }
  console.log(`\nDone. Updated ${updated}, skipped ${skipped}.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

