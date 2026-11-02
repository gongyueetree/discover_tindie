import { sql } from "drizzle-orm";
import { db } from "../src/db";
async function main() {
  const rows: any = await db.execute(sql`
    SELECT id, title, jsonb_array_length(COALESCE(related_products,'[]'::jsonb)) AS n
    FROM discoveries WHERE status='published'
    ORDER BY created_at DESC LIMIT 6
  `);
  const list = rows.rows ?? rows;
  console.log("首页实际显示的最新 6 条 (按 created_at):");
  for (const r of list) console.log(`  #${r.id}  [商品:${r.n}]  ${r.title}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

