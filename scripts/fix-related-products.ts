import { sql } from "drizzle-orm";
import { db } from "../src/db";

/* ----------------------------------------------------------------------------
   Fix double-serialized related_products.

   Some rows stored related_products as a JSON *string* (e.g. "[{...}]") instead
   of a real jsonb array. Array.isArray() is then false on the frontend, so the
   products don't render. This rewrites any string-typed value into a proper
   jsonb array.

   Safe + re-runnable: only touches rows where the column is currently a JSON
   string; real arrays are left alone.
---------------------------------------------------------------------------- */
async function main() {
  console.log("Scanning discoveries for string-typed related_products...");
  const rows: any = await db.execute(sql`
    SELECT id, title
    FROM discoveries
    WHERE related_products IS NOT NULL
      AND jsonb_typeof(related_products) = 'string'
  `);
  const list = rows.rows ?? rows;
  console.log(`Found ${list.length} rows to fix.`);

  let fixed = 0;
  for (const r of list) {
    // related_products holds a JSON string like "[{...}]".
    // (#>> '{}') extracts the text content; cast that text back to jsonb -> real array.
    await db.execute(sql`
      UPDATE discoveries
      SET related_products = (related_products #>> '{}')::jsonb
      WHERE id = ${r.id}
    `);
    console.log(`  fixed #${r.id}  ${r.title}`);
    fixed++;
  }
  console.log(`\nDone. Fixed ${fixed} rows. related_products is now a real jsonb array.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

