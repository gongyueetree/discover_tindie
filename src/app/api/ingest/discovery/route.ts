export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { discoveries } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TAXONOMY } from "@/lib/taxonomy";
import { safeHttpUrl, cleanText } from "@/lib/validate";
import { bearerMatches } from "@/lib/secret";

const VALID_CATEGORIES = TAXONOMY.map((t) => t.id);

/**
 * POST /api/ingest/discovery
 *
 * External ingest endpoint — accepts pre-summarised discovery items
 * (e.g. from eetree pipeline or any third‑party scraper) and publishes
 * them immediately (status = "published").
 *
 * Auth:  Authorization: Bearer <INGEST_SECRET>
 *        INGEST_SECRET must be set in Vercel env vars.
 */
export async function POST(req: Request) {
  // ---- auth (constant-time, fails closed when the secret is unset) ----
  const secret = process.env.TINDIE_INGEST_SECRET || process.env.INGEST_SECRET;
  if (!bearerMatches(req.headers.get("authorization"), secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ---- parse body ----
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = cleanText(body.title, 200);
  const summary = cleanText(body.summary, 500);
  const why = cleanText(body.why, 500);
  const category = cleanText(body.category, 60);
  const sourceName = cleanText(body.sourceName, 120);
  const sourceUrl = typeof body.sourceUrl === "string" && body.sourceUrl.trim() ? safeHttpUrl(body.sourceUrl) : "";
  const tags = Array.isArray(body.tags)
    ? body.tags.filter((t): t is string => typeof t === "string").map((t) => cleanText(t, 40)).filter(Boolean).slice(0, 5)
    : [];

  // ---- validate ----
  const errors: string[] = [];
  if (!title) errors.push("title is required");
  if (!summary) errors.push("summary is required");
  if (!why) errors.push("why is required");
  if (!VALID_CATEGORIES.includes(category)) {
    errors.push(`category must be one of: ${VALID_CATEGORIES.join(", ")}`);
  }
  if (!sourceName) errors.push("sourceName is required");
  if (typeof body.sourceUrl === "string" && body.sourceUrl.trim() && sourceUrl === null) {
    errors.push("sourceUrl must be a public http(s) URL");
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
  }

  // ---- dedupe by title ----
  const existing = await db
    .select({ id: discoveries.id })
    .from(discoveries)
    .where(eq(discoveries.title, title))
    .limit(1);

  if (existing.length > 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: "duplicate title" });
  }

  // ---- insert ----
  const today = new Date().toISOString().slice(0, 10);

  await db.insert(discoveries).values({
    title: title.slice(0, 200),
    summary: summary.slice(0, 500),
    why: why.slice(0, 500),
    category,
    sourceName,
    sourceUrl: sourceUrl || null,
    chips: tags,
    relatedTags: tags,
    relatedProducts: [],
    aiScore: 70,
    status: "published",
    publishDate: today,
    imageLicense: "none",
  });

  return NextResponse.json({ ok: true, inserted: true });
}

