import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL;
  const pass = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !pass) {
    console.error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD env vars.");
    process.exit(1);
  }
  const hash = await bcrypt.hash(pass, 10);

  // Try update first; if no row, insert.
  const existing = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (existing.length > 0) {
    await db.update(schema.users)
      .set({ passwordHash: hash, role: "admin" })
      .where(eq(schema.users.email, email));
    console.log(`✓ Updated password for existing admin: ${email}`);
  } else {
    await db.insert(schema.users).values({ email, name: "Admin", role: "admin", passwordHash: hash });
    console.log(`✓ Created new admin: ${email}`);
  }
  console.log(`  email:    ${email}`);
  console.log("  password: (as set in SEED_ADMIN_PASSWORD; not shown)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });

