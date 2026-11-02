import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Missing POSTGRES_URL / DATABASE_URL");
  process.exit(1);
}

async function main() {
  const sql = postgres(connectionString!, { max: 1 });
  const db = drizzle(sql);
  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("✓ Migrations complete");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

