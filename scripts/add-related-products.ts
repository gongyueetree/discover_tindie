import { sql } from "drizzle-orm";
import { db } from "../src/db";

// One-time: add related_products column to discoveries (safe if already exists).
async function main() {
  console.log("Adding related_products column…");
  await db.execute(sql`ALTER TABLE discoveries ADD COLUMN IF NOT EXISTS related_products jsonb DEFAULT '[]'::jsonb`);
  console.log("✓ Done. Column related_products is present.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

