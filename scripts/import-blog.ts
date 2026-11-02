import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import { importBlogPosts } from "../src/lib/blog-import";

// Manual importer for the Tindie blog RSS feed. Re-runnable (dedupes by url).
//   POSTGRES_URL=... npx tsx scripts/import-blog.ts
const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) { console.error("Missing POSTGRES_URL / DATABASE_URL"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql, { schema });

async function main() {
  console.log("Importing Tindie blog posts from blog.tindie.com/feed/ …");
  const r = await importBlogPosts(db);
  console.log(`  ✓ fetched ${r.fetched}, inserted ${r.inserted}, skipped ${r.skipped}, kept ${r.kept}`);
  await sql.end();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

