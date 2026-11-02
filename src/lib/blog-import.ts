import Parser from "rss-parser";
import { desc, notInArray } from "drizzle-orm";
import { blogPosts } from "../db/schema";

// Reusable Tindie-blog importer, shared by scripts/import-blog.ts (its own
// connection) and /api/cron/blog (the app's db). `db` is passed in so this
// module has no @/db import and works under tsx (relative paths) too.
// Kept loose (any) to avoid coupling to the drizzle instance's exact generics.
type DB = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const FEED_URL = "https://blog.tindie.com/feed/";
const KEEP = 20; // only retain the most recent 20 posts

function stripHtml(s: string): string {
  return (s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;|&#8216;|&rsquo;|&lsquo;|&#039;|&apos;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;|&quot;/g, '"')
    .replace(/&#8230;|&hellip;/g, "…")
    .replace(/&#8211;|&#8212;|&ndash;|&mdash;/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function firstImage(html: string): string | null {
  const m = /<img[^>]+src=["']([^"']+)["']/i.exec(html || "");
  return m ? m[1] : null;
}

export async function importBlogPosts(db: DB): Promise<{ fetched: number; inserted: number; skipped: number; kept: number }> {
  const parser = new Parser({
    timeout: 15000,
    customFields: {
      item: [
        ["dc:creator", "creator"],
        ["content:encoded", "contentEncoded"],
        ["description", "descriptionRaw"],
      ],
    },
  });

  const feed = await parser.parseURL(FEED_URL);
  // Newest first, cap to the most recent 20.
  const items = (feed.items || [])
    .slice()
    .sort((a: any, b: any) => new Date(b.pubDate || b.isoDate || 0).getTime() - new Date(a.pubDate || a.isoDate || 0).getTime())
    .slice(0, KEEP);

  let inserted = 0, skipped = 0;
  for (const it of items as any[]) {
    const title = (it.title || "").trim();
    const url = (it.link || "").trim();
    if (!title || !url) { skipped++; continue; }

    const author = (it.creator || "").trim() || null;
    const excerpt = stripHtml(it.descriptionRaw || it.contentSnippet || it.content || "").slice(0, 200) || null;
    const imageUrl = firstImage(it.contentEncoded || it.content || "");
    const publishedAt = it.pubDate ? new Date(it.pubDate) : (it.isoDate ? new Date(it.isoDate) : null);

    // Dedupe on the unique url — re-runnable, existing posts are skipped.
    const res = await db.insert(blogPosts)
      .values({ title, author, excerpt, imageUrl, url, publishedAt })
      .onConflictDoNothing({ target: blogPosts.url })
      .returning({ id: blogPosts.id });
    if (res.length) inserted++; else skipped++;
  }

  // Retain only the most recent KEEP posts overall.
  const keepRows = await db.select({ id: blogPosts.id }).from(blogPosts)
    .orderBy(desc(blogPosts.publishedAt))
    .limit(KEEP);
  const keepIds = keepRows.map((r: any) => r.id);
  if (keepIds.length) await db.delete(blogPosts).where(notInArray(blogPosts.id, keepIds));

  return { fetched: items.length, inserted, skipped, kept: keepIds.length };
}

