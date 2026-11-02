import { sql } from "drizzle-orm";
import { db } from "../src/db";

// One-time, safe to re-run: ensure the columns the latest code needs exist on the live DB.
// Does NOT touch or delete any existing data.
async function main() {
  console.log("Ensuring columns exist…");
  await db.execute(sql`ALTER TABLE resources   ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0`);
  await db.execute(sql`ALTER TABLE resources   ADD COLUMN IF NOT EXISTS is_featured boolean DEFAULT false`);
  await db.execute(sql`ALTER TABLE discoveries ADD COLUMN IF NOT EXISTS related_products jsonb DEFAULT '[]'::jsonb`);
  console.log("✓ Done. sort_order + is_featured (resources) and related_products (discoveries) are present.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

