import { sql } from "drizzle-orm";
import { db } from "../src/db";

// One-time, safe: add sort_order to resources. IF NOT EXISTS means it won't
// error or touch data if already present. Existing rows get the default (0),
// so they keep showing — nothing is deleted or changed.
async function main() {
  console.log("Adding sort_order column to resources…");
  await db.execute(sql`ALTER TABLE resources ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0`);
  // Seed an initial order within each category based on current name order,
  // so the ▲▼ buttons have something sensible to start from. Only sets rows
  // that are still at the default 0 — re-running is safe.
  await db.execute(sql`
    WITH ranked AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY category ORDER BY name) - 1 AS rn
      FROM resources
    )
    UPDATE resources r SET sort_order = ranked.rn
    FROM ranked WHERE r.id = ranked.id AND r.sort_order = 0
  `);
  console.log("✓ Done. sort_order is present and initialised per category.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

