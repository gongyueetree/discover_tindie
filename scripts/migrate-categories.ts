import { sql } from "drizzle-orm";
import { db } from "../src/db";

// One-time migration: collapse 8 categories into 5.
// marketplaces -> crowdfunding, boards -> crowdfunding, testing -> components
async function main() {
  console.log("Migrating categories…");
  await db.execute(sql`UPDATE resources SET category = 'crowdfunding' WHERE category IN ('marketplaces','boards')`);
  await db.execute(sql`UPDATE resources SET category = 'components' WHERE category = 'testing'`);
  await db.execute(sql`UPDATE discoveries SET category = 'crowdfunding' WHERE category IN ('marketplaces','boards')`);
  await db.execute(sql`UPDATE discoveries SET category = 'components' WHERE category = 'testing'`);

  const rows = await db.execute(sql`SELECT category, count(*)::int AS n FROM resources GROUP BY category ORDER BY category`);
  console.log("Resource category counts after migration:");
  console.table((rows as any).rows ?? rows);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

