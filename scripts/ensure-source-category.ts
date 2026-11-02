import { sql } from "drizzle-orm";
import { db } from "../src/db";

// Add a `category` column to the sources table so sources can be organized
// with the same taxonomy as the Resource Directory. Safe to run repeatedly.
//
//   DATABASE_URL='<tindie connection string>' npx tsx scripts/ensure-source-category.ts

async function main() {
  await db.execute(sql`
    ALTER TABLE sources ADD COLUMN IF NOT EXISTS category varchar(40);
  `);
  console.log("OK: sources.category column ensured.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

