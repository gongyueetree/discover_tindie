import { sql } from "drizzle-orm";
import { db } from "../src/db";

// Create the `recommendations` table if it doesn't exist. Safe to run multiple
// times. Does NOT touch any existing table.
//
//   DATABASE_URL='<tindie connection string>' npx tsx scripts/ensure-recommendations.ts

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS recommendations (
      id           serial PRIMARY KEY,
      title        text NOT NULL,
      body         text NOT NULL DEFAULT '',
      url          text,
      cta_label    text DEFAULT 'Learn more',
      starts_at    timestamp,
      ends_at      timestamp,
      status       varchar(12) NOT NULL DEFAULT 'active',
      impressions  integer NOT NULL DEFAULT 0,
      clicks       integer NOT NULL DEFAULT 0,
      created_at   timestamp NOT NULL DEFAULT now()
    );
  `);
  console.log("OK: recommendations table ensured.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

