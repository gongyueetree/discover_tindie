import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import bcrypt from "bcryptjs";
import * as schema from "../src/db/schema";
import { SEED_RESOURCES, SEED_SOURCES, SEED_DISCOVERIES } from "../src/lib/seed-data";

const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
if (!connectionString) { console.error("Missing POSTGRES_URL / DATABASE_URL"); process.exit(1); }

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql, { schema });

async function main() {
  console.log("Seeding database…");

  // --- users ---
  // No default password: an admin is created only with an explicit, strong SEED_ADMIN_PASSWORD.
  const adminEmail = process.env.SEED_ADMIN_EMAIL || "admin@tindie.test";
  const adminPass = process.env.SEED_ADMIN_PASSWORD || "";
  if (adminPass.length < 12) {
    console.error("Set SEED_ADMIN_PASSWORD (12+ characters) to create the admin user.");
    process.exit(1);
  }
  const hash = await bcrypt.hash(adminPass, 10);
  await db.insert(schema.users).values({ email: adminEmail, name: "Admin", role: "admin", passwordHash: hash })
    .onConflictDoNothing();
  console.log(`  ✓ admin user: ${adminEmail} (password not shown)`);

  // --- resources ---
  for (const r of SEED_RESOURCES) {
    await db.insert(schema.resources).values({
      slug: r.slug, name: r.name, url: r.url, description: r.description, category: r.category,
      capLabel: r.capLabel, tags: (r as any).tags || [], pricing: (r as any).pricing,
      platforms: (r as any).platforms || [], isPick: !!(r as any).isPick, isPartner: !!(r as any).isPartner,
      isVerified: !!(r as any).isVerified, linkOk: (r as any).linkOk !== false,
      verifiedAt: (r as any).isVerified ? new Date() : null, status: "active",
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${SEED_RESOURCES.length} resources`);

  // --- sources ---
  for (const s of SEED_SOURCES) {
    await db.insert(schema.sources).values({
      name: s.name, method: s.method, frequency: s.frequency, trust: s.trust,
      dailyCap: s.dailyCap, errorRate: s.errorRate, status: s.status, lastSuccess: new Date(),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${SEED_SOURCES.length} sources`);

  // --- discoveries (published get today's date; needs_review stay queued) ---
  const today = new Date().toISOString().slice(0, 10);
  for (const d of SEED_DISCOVERIES) {
    await db.insert(schema.discoveries).values({
      title: d.title, summary: d.summary, why: d.why, category: d.category,
      sourceName: d.sourceName, icon: d.icon, chips: d.chips || [], relatedTags: d.relatedTags || [],
      license: d.license, availability: d.availability, aiScore: d.aiScore,
      isSponsored: !!(d as any).isSponsored, isPick: !!(d as any).isPick, flag: (d as any).flag || null,
      saveCount: d.saveCount || 0, commentCount: d.commentCount || 0,
      status: d.status, publishDate: d.status === "published" ? today : null,
    });
  }
  console.log(`  ✓ ${SEED_DISCOVERIES.length} discoveries`);

  console.log("✓ Seed complete");
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });

