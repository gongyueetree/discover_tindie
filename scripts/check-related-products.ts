import { sql } from "drizzle-orm";
import { db } from "../src/db";

// Diagnostic: print each published discovery and what's stored in related_products.
async function main() {
  const rows: any = await db.execute(sql`SELECT id, title, related_products FROM discoveries WHERE status = 'published' ORDER BY id`);
  const list = rows.rows ?? rows;
  console.log(`\n${list.length} published discoveries:\n`);
  for (const r of list) {
    const rp = r.related_products;
    const n = Array.isArray(rp) ? rp.length : (rp ? "(non-array)" : 0);
    console.log(`#${r.id}  ${r.title}`);
    console.log(`     related_products: ${JSON.stringify(rp)}  [count: ${n}]`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

