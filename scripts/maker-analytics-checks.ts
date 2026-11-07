/**
 * Discover traffic (lib/maker-analytics.ts): term normalisation, crawler filter, daily visitor hash —
 * and, when TEST_DATABASE_URL points at a scratch PostgreSQL database, the real SQL (tables created
 * on first use, views / unique visitors per day, search terms with empty-result counts, ranges).
 *   TEST_DATABASE_URL=postgres://… node --conditions=react-server --import tsx scripts/maker-analytics-checks.ts
 */
import assert from "node:assert/strict";

const TEST_DB = process.env.TEST_DATABASE_URL || "";
delete process.env.APP_DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.DATABASE_URL;
if (TEST_DB) process.env.APP_DATABASE_URL = TEST_DB;
process.env.AUTH_SECRET = "c".repeat(40);

void (async () => {
  const a = await import("../src/lib/maker-analytics");

  assert.equal(a.normalizeTerm("  STM32F103   C8T6 "), "stm32f103 c8t6");
  assert.equal(a.normalizeTerm("x".repeat(200)).length, 80);
  assert.ok(a.isBot("Mozilla/5.0 (compatible; Googlebot/2.1)"));
  assert.ok(a.isBot(null), "no user agent is not a visitor");
  assert.ok(!a.isBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15"));
  const v1 = a.dailyVisitor("s:abc", "2026-11-07");
  assert.match(v1, /^[0-9a-f]{16}$/);
  assert.equal(v1, a.dailyVisitor("s:abc", "2026-11-07"), "stable within a day");
  assert.notEqual(v1, a.dailyVisitor("s:abc", "2026-11-08"), "a different id the next day: no following people across days");
  assert.ok(!v1.includes("abc"));
  assert.ok(a.isPage("open-hardware") && !a.isPage("admin"));

  if (!TEST_DB) {
    // Without a database recording is a no-op and the dashboard is empty.
    await a.recordPageView("components", "s:x");
    await a.recordTerm("components", "lm358", 0);
    assert.deepEqual(await a.makerTraffic(7), { days: 7, daily: [], totals: [], terms: [] });
    console.log("PASS: maker analytics (pure checks; set TEST_DATABASE_URL to also check the SQL)");
    process.exit(0);
  }

  const { db } = await import("../src/db");
  const { sql } = await import("drizzle-orm");
  for (const t of ["maker_traffic_daily", "maker_visitors_daily", "maker_terms_daily"]) await db.execute(sql.raw(`DROP TABLE IF EXISTS ${t}`));

  // Views and unique visitors: 3 views by 2 visitors on Components, 1 on Open hardware.
  await a.recordPageView("components", "s:alice");
  await a.recordPageView("components", "s:alice");
  await a.recordPageView("components", "n:bob-ip");
  await a.recordPageView("open-hardware", "s:alice");
  // A row from 10 days ago: inside 30 days, outside 7.
  const old = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
  await db.execute(sql`INSERT INTO maker_traffic_daily (day, page, views) VALUES (${old}, 'components', 5)`);
  await db.execute(sql`INSERT INTO maker_visitors_daily (day, page, visitor) VALUES (${old}, 'components', 'aaaaaaaaaaaaaaaa')`);

  // Searches: repeated (different case/spacing), one with no results; opened designs.
  await a.recordTerm("components", "LM358", 3);
  await a.recordTerm("components", "  lm358 ", 0);
  await a.recordTerm("components", "ne555", 2);
  await a.recordTerm("components", "x", 0); // too short: not recorded
  await a.recordTerm("open:design", "HackRF One");

  const week = await a.makerTraffic(7);
  const comp = week.totals.find((t) => t.page === "components")!;
  assert.deepEqual([comp.views, comp.visitors], [3, 2], "views and unique visitors today");
  assert.equal(week.totals.find((t) => t.page === "open-hardware")!.views, 1);
  assert.equal(week.daily.length, 2, "one row per day and tab");
  const lm = week.terms.find((t) => t.scope === "components" && t.term === "lm358")!;
  assert.deepEqual([lm.count, lm.empty], [2, 1], "same term merged; empty results counted");
  assert.deepEqual(week.terms.filter((t) => t.scope === "components").map((t) => t.term), ["lm358", "ne555"], "most searched first");
  assert.ok(!week.terms.some((t) => t.term === "x"));
  assert.equal(week.terms.find((t) => t.scope === "open:design")!.term, "hackrf one");

  const month = await a.makerTraffic(30);
  const comp30 = month.totals.find((t) => t.page === "components")!;
  assert.deepEqual([comp30.views, comp30.visitors], [8, 3], "a longer range adds the older day");

  // Concurrent recording does not lose counts or fail.
  await Promise.all(Array.from({ length: 20 }, (_, i) => a.recordPageView("pcb-planner", "s:" + (i % 5))));
  const p = (await a.makerTraffic(1)).totals.find((t) => t.page === "pcb-planner")!;
  assert.deepEqual([p.views, p.visitors], [20, 5]);

  for (const t of ["maker_traffic_daily", "maker_visitors_daily", "maker_terms_daily"]) await db.execute(sql.raw(`DROP TABLE IF EXISTS ${t}`));
  console.log("PASS: maker analytics (pure checks + PostgreSQL)");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
