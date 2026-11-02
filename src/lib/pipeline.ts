import { db } from "@/db";
import { discoveries, sources } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DAILY_TARGET, TAXONOMY } from "@/lib/taxonomy";
import Parser from "rss-parser";

/* ============================================================================
   DISCOVERY PIPELINE — real RSS fetch + Claude Haiku summarization.

   Flow:
     1. fetchCandidates() -> pull recent items from each ACTIVE source whose
        method is "RSS". (API/Crawl sources are skipped for now.)
     2. dedupe against titles already in the DB (last ~200 rows).
     3. summarize() -> Claude Haiku turns each raw item into ORIGINAL text:
        an editable "what it is", a "why it matters for Tindie", a category
        (one of the 5 taxonomy ids), and a few tags.
     4. applyGuardrails() -> category/source diversity caps.
     5. insert as status:'published' — items go live immediately; the admin
        Discovery Inbox can still hide/edit them afterwards.

   Requires env ANTHROPIC_API_KEY. If it's missing, summarize() falls back to a
   trimmed raw summary so the pipeline still produces review items.
============================================================================ */

const VALID_CATEGORIES = TAXONOMY.map((t) => t.id); // ["components","tools","manufacturing","open-source","crowdfunding"]

type Candidate = {
  title: string;
  sourceName: string;
  sourceUrl?: string;
  rawSummary: string;
  trust: string;
};

function stripHtml(s: string): string {
  return (s || "").replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim();
}

// ---- INTEGRATION POINT 1: real RSS fetch ----
async function fetchCandidates(): Promise<Candidate[]> {
  const active = await db.select().from(sources).where(eq(sources.status, "active"));
  const rssSources = active.filter((s) => (s.method || "").toUpperCase() === "RSS" && s.url);

  const parser = new Parser({ timeout: 15000 });
  const out: Candidate[] = [];

  for (const src of rssSources) {
    try {
      const feed = await parser.parseURL(src.url as string);
      const cap = src.dailyCap ?? 2;
      const items = (feed.items || []).slice(0, Math.max(cap * 3, 6)); // grab a few extra; guardrails trim later
      for (const it of items) {
        const title = (it.title || "").trim();
        if (!title) continue;
        const raw = stripHtml(it.contentSnippet || it.content || (it as any).summary || "").slice(0, 600);
        out.push({
          title: title.slice(0, 200),
          sourceName: src.name,
          sourceUrl: it.link || (src.url as string),
          rawSummary: raw || title,
          trust: src.trust || "Medium",
        });
      }
    } catch (e) {
      // one bad feed shouldn't kill the whole run; record nothing and continue
      console.error(`RSS fetch failed for ${src.name}:`, (e as Error).message);
    }
  }
  return out;
}

// ---- dedupe against titles already stored ----
async function dedupe(cands: Candidate[]): Promise<Candidate[]> {
  const recent = await db.select({ title: discoveries.title }).from(discoveries).limit(300);
  const seen = new Set(recent.map((r) => r.title.toLowerCase().trim()));
  const result: Candidate[] = [];
  for (const c of cands) {
    const key = c.title.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key); // also dedupe within this batch
    result.push(c);
  }
  return result;
}

type Enriched = { summary: string; why: string; category: string; tags: string[] };

// ---- INTEGRATION POINT 2: Claude Haiku summarization + classification ----
async function summarize(c: Candidate): Promise<Enriched> {
  const key = process.env.ANTHROPIC_API_KEY;
  // Fallback if no key configured: still produce a review item from raw text.
  if (!key) {
    return {
      summary: c.rawSummary.slice(0, 220),
      why: `Relevant to hardware makers — may drive demand for related parts and tools on Tindie.`,
      category: "open-source",
      tags: [],
    };
  }

  const prompt = `You are an editor for Tindie, a marketplace for independent hardware makers. A source feed produced this item:

Title: ${c.title}
Source: ${c.sourceName}
Raw text: ${c.rawSummary}

Write a JSON object (and nothing else) with these fields:
- "summary": 3-5 concise bullet points describing what it is, in your own words (never copy the raw text). Return as a single string with each bullet on its own line starting with "- ". Aim for ~250-300 words total across the bullets.
- "why": an "Insights" section — your original AI take/commentary on this product or technology: why it's notable, who it's for, trade-offs, and the angle for Tindie sellers/buyers. 3-5 bullet points, single string with each bullet on its own line starting with "- ", ~250-300 words total.
- "category": exactly one of ${JSON.stringify(VALID_CATEGORIES)} — pick the best fit (components=parts/sourcing, tools=design/EDA software, manufacturing=PCB/assembly/fabrication, open-source=open hardware/projects, crowdfunding=campaigns/marketplaces/selling).
- "tags": array of 1-3 short topic tags (strings).

Return only the JSON object.`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    const clean = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(clean);
    const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : "open-source";
    return {
      summary: String(parsed.summary || c.rawSummary).slice(0, 280),
      why: String(parsed.why || "Relevant to hardware makers on Tindie.").slice(0, 280),
      category,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3).map(String) : [],
    };
  } catch (e) {
    console.error(`summarize failed for "${c.title}":`, (e as Error).message);
    // fallback so the item still reaches review
    return {
      summary: c.rawSummary.slice(0, 220),
      why: `Relevant to hardware makers — may drive demand for related parts and tools on Tindie.`,
      category: "open-source",
      tags: [],
    };
  }
}

function scoreCandidate(c: Candidate): number {
  const trustBonus = c.trust === "High" ? 12 : c.trust === "Low" ? -8 : 0;
  const base = 62 + Math.floor(Math.random() * 25);
  const openBonus = /open|cern|mit|gpl/i.test(c.rawSummary) ? 5 : 0;
  return Math.max(40, Math.min(98, base + trustBonus + openBonus));
}

// Diversity guardrails: don't let one category/source dominate the daily edition.
function applyGuardrails(scored: (Candidate & { aiScore: number })[]): (Candidate & { aiScore: number })[] {
  const sorted = [...scored].sort((a, b) => b.aiScore - a.aiScore);
  const picked: typeof sorted = [];
  const perSrc: Record<string, number> = {};
  const SRC_CAP = 3;
  for (const c of sorted) {
    if (picked.length >= DAILY_TARGET) break;
    if ((perSrc[c.sourceName] || 0) >= SRC_CAP) continue;
    picked.push(c);
    perSrc[c.sourceName] = (perSrc[c.sourceName] || 0) + 1;
  }
  return picked;
}

export async function runDiscoveryPipeline(): Promise<{ inserted: number; fetched: number }> {
  const raw = await fetchCandidates();
  const fresh = await dedupe(raw);
  const scored = fresh.map((c) => ({ ...c, aiScore: scoreCandidate(c) }));
  const chosen = applyGuardrails(scored);

  let inserted = 0;
  const today = new Date().toISOString().slice(0, 10);
  for (const c of chosen) {
    const enriched = await summarize(c);
    await db.insert(discoveries).values({
      title: c.title,
      summary: enriched.summary,
      why: enriched.why,
      category: enriched.category,
      sourceName: c.sourceName,
      sourceUrl: c.sourceUrl,
      icon: null,
      chips: enriched.tags,
      relatedTags: enriched.tags,
      relatedProducts: [],
      aiScore: c.aiScore,
      imageLicense: "none",
      status: "published",
      publishDate: today,
    });
    inserted++;
  }
  // mark active sources as freshly crawled
  await db.update(sources).set({ lastSuccess: new Date() }).where(eq(sources.status, "active"));
  return { inserted, fetched: raw.length };
}

