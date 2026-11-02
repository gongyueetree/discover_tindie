import { db } from "@/db";
import { analyticsDaily, discoveries, resources } from "@/db/schema";
import { and, gte, eq, desc, sql } from "drizzle-orm";
import { isTrackSection, isTrackKind } from "@/lib/sections";

/** Record a batch of view/click events into the per-day counters. Invalid
 *  section/kind pairs are dropped. Each pair increments its (day, section,
 *  kind) row for the current UTC day via UPSERT — no per-event row growth. */
export async function recordEvents(events: { section: string; kind: string }[]): Promise<number> {
  const day = new Date().toISOString().slice(0, 10); // UTC YYYY-MM-DD
  // Collapse the batch to counts per (section, kind) so one page load with
  // several view events becomes a handful of increments.
  const tally = new Map<string, { section: string; kind: string; n: number }>();
  for (const e of events) {
    if (!isTrackSection(e.section) || !isTrackKind(e.kind)) continue;
    const key = `${e.section}:${e.kind}`;
    const cur = tally.get(key);
    if (cur) cur.n += 1;
    else tally.set(key, { section: e.section, kind: e.kind, n: 1 });
  }
  if (tally.size === 0) return 0;
  for (const { section, kind, n } of tally.values()) {
    await db.insert(analyticsDaily)
      .values({ day, section, kind, count: n })
      .onConflictDoUpdate({
        target: [analyticsDaily.day, analyticsDaily.section, analyticsDaily.kind],
        set: { count: sql`${analyticsDaily.count} + ${n}` },
      });
  }
  return tally.size;
}

/* -------- per-item counters (article reads, resource-link clicks) -------- */

// A "read": one open of a discovery's detail drawer. Bumps the article's
// lifetime counter AND a per-day bucket (section 'article', kind 'read') so
// we can chart reads over calendar time. Best-effort.
export async function recordArticleView(id: number): Promise<void> {
  await db.update(discoveries)
    .set({ views: sql`${discoveries.views} + 1` })
    .where(eq(discoveries.id, id));
  const day = new Date().toISOString().slice(0, 10); // UTC
  await db.insert(analyticsDaily)
    .values({ day, section: "article", kind: "read", count: 1 })
    .onConflictDoUpdate({
      target: [analyticsDaily.day, analyticsDaily.section, analyticsDaily.kind],
      set: { count: sql`${analyticsDaily.count} + 1` },
    });
}

// Per-calendar-day total article reads (event time), last `days` days.
export async function getDailyReads(days = 365): Promise<{ day: string; reads: number }[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = await db
    .select({ day: analyticsDaily.day, reads: analyticsDaily.count })
    .from(analyticsDaily)
    .where(and(eq(analyticsDaily.section, "article"), eq(analyticsDaily.kind, "read"), gte(analyticsDaily.day, since)))
    .orderBy(analyticsDaily.day);
  return rows as { day: string; reads: number }[];
}

// One click on a resource's "Visit" link. Best-effort +1.
export async function recordResourceClick(id: number): Promise<void> {
  await db.update(resources)
    .set({ clicks: sql`${resources.clicks} + 1` })
    .where(eq(resources.id, id));
}

export type DayReads = { day: string; articles: number; reads: number };
export type ArticleReads = { id: number; title: string; publishDate: string | null; views: number };
export type ResourceClicks = { id: number; name: string; url: string | null; category: string; clicks: number };

// Total reads of all articles PUBLISHED on each day (grouped by publish date).
export async function getReadsByDay(): Promise<DayReads[]> {
  const rows = await db
    .select({
      day: discoveries.publishDate,
      articles: sql<number>`count(*)::int`,
      reads: sql<number>`coalesce(sum(${discoveries.views}),0)::int`,
    })
    .from(discoveries)
    .where(eq(discoveries.status, "published"))
    .groupBy(discoveries.publishDate)
    .orderBy(desc(discoveries.publishDate));
  return rows.filter((r) => r.day) as DayReads[];
}

// Every published article with its lifetime reads, most-read first.
export async function getArticleReads(): Promise<ArticleReads[]> {
  const rows = await db
    .select({ id: discoveries.id, title: discoveries.title, publishDate: discoveries.publishDate, views: discoveries.views })
    .from(discoveries)
    .where(eq(discoveries.status, "published"))
    .orderBy(desc(discoveries.views), desc(discoveries.publishDate));
  return rows as ArticleReads[];
}

// All 39 active resource links with their lifetime click counts.
export async function getResourceClicks(): Promise<ResourceClicks[]> {
  const rows = await db
    .select({ id: resources.id, name: resources.name, url: resources.url, category: resources.category, clicks: resources.clicks })
    .from(resources)
    .where(eq(resources.status, "active"))
    .orderBy(desc(resources.clicks), resources.name);
  return rows as ResourceClicks[];
}

export type AnalyticsRow = { day: string; section: string; kind: string; count: number };

/** All daily counter rows within the last `days` days (default 365 — enough to
 *  cover the dashboard's day/week/month views). The client buckets them. */
export async function getAnalytics(days = 365): Promise<AnalyticsRow[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const rows = await db.select().from(analyticsDaily)
    .where(and(gte(analyticsDaily.day, since)))
    .orderBy(analyticsDaily.day);
  return rows as AnalyticsRow[];
}

