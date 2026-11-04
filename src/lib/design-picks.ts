import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { designPicks, discoveries } from "@/db/schema";
import { discoveryRepo } from "@/lib/maker/discovery-repo";
import { githubNewHardware, githubRepoFacts, githubUsable, type RepoFacts } from "@/lib/maker/github-server";
import { choose, pickKey, SYSTEM, tidy, userPrompt, Verdict, type Candidate } from "./design-picks-core";

/* ============================================================================
   DAILY OPEN-HARDWARE PICKS (Open hardware tab → "Fresh open hardware").

   1. Candidates: GitHub projects behind the last 10 days of published discoveries (the sources managed in
      /admin → Sources), plus — with a GitHub token — new repositories tagged kicad / open-hardware / pcb /
      easyeda. Only designs the viewer can open (githubUsable) and not judged before.
   2. Facts from GitHub (licence, stars, dates, README, project files); Claude reads them with the article
      and decides whether to recommend the design, writing a short intro, highlights and caveats.
   3. The best few (DESIGN_PICKS_PER_DAY, default 3) are published. A design found on GitHub alone also gets
      a Resources article, so "Read more" always has somewhere to go. Designs Claude turned down are kept
      as "rejected" so they are not judged (and paid for) again.

   Requires ANTHROPIC_API_KEY; without it nothing is written (no made-up summaries).
============================================================================ */

const MODEL = process.env.DESIGN_PICKS_MODEL || "claude-opus-5-5";
const PER_DAY = Math.max(1, Math.min(6, Number(process.env.DESIGN_PICKS_PER_DAY) || 3));
const MAX_JUDGED = Math.max(1, Math.min(20, Number(process.env.DESIGN_PICKS_MAX_JUDGED) || 10));

let tableReady: Promise<void> | null = null;
/** Same SQL as drizzle/0003_design_picks.sql: the table is created on first use, no manual migration needed. */
const DDL = [
  `CREATE TABLE IF NOT EXISTS "design_picks" (
  "id" serial PRIMARY KEY NOT NULL,
  "repo_url" text NOT NULL UNIQUE,
  "discovery_id" integer,
  "title" text NOT NULL,
  "intro" text NOT NULL,
  "highlights" jsonb DEFAULT '[]'::jsonb,
  "caveat" text,
  "license" text,
  "eda_tool" text,
  "stars" integer,
  "repo_created_at" timestamp,
  "repo_pushed_at" timestamp,
  "image_url" text,
  "score" integer DEFAULT 0,
  "pick_date" varchar(10) NOT NULL,
  "status" varchar(12) DEFAULT 'published' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);`,
  `CREATE INDEX IF NOT EXISTS "design_picks_date_idx" ON "design_picks" ("status", "pick_date");`,
];
export function ensurePicksTable() {
  if (!tableReady) {
    tableReady = (async () => {
      for (const stmt of DDL) await db.execute(sql.raw(stmt));
    })();
    tableReady.catch(() => (tableReady = null));
  }
  return tableReady;
}

const day = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

async function candidates(seen: Set<string>, log: string[]): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const add = (c: Candidate) => {
    const k = pickKey(c.url);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };
  const recent = await db
    .select()
    .from(discoveries)
    .where(and(eq(discoveries.status, "published"), gte(discoveries.createdAt, new Date(Date.now() - 10 * 86_400_000))))
    .orderBy(desc(discoveries.createdAt))
    .limit(40);
  for (const d of recent) {
    const repo = await discoveryRepo(d.id, d.sourceUrl).catch(() => null);
    if (repo)
      add({ url: repo, discovery: { id: d.id, title: d.title, summary: d.summary, why: d.why, sourceName: d.sourceName, sourceUrl: d.sourceUrl } });
  }
  log.push(`discoveries checked: ${recent.length}, with an openable design: ${out.length}`);
  if (process.env.MAKER_GITHUB_TOKEN) {
    try {
      const found = await githubNewHardware(day(7));
      let n = 0;
      for (const url of found) {
        if (out.length >= MAX_JUDGED * 2 || seen.has(pickKey(url))) continue;
        if ((await githubUsable(url)) === true) {
          add({ url, discovery: null });
          n++;
        }
      }
      log.push(`new GitHub hardware repositories: ${found.length}, openable: ${n}`);
    } catch (e) {
      log.push("GitHub search failed: " + (e instanceof Error ? e.message : e));
    }
  } else log.push("GitHub search skipped (no MAKER_GITHUB_TOKEN)");
  return out;
}

async function judge(client: Anthropic, c: Candidate, f: RepoFacts): Promise<Verdict | null> {
  const msg = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: betaZodOutputFormat(Verdict) },
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt(c, f) }],
  });
  if (msg.stop_reason === "refusal" || !msg.parsed_output) return null;
  return tidy(msg.parsed_output);
}

/** Runs in batches of 3 so a slow call does not hold up the rest. */
async function inBatches<T, R>(items: T[], size: number, fn: (x: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export async function runDesignPicks() {
  const log: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) return { picked: 0, judged: 0, log: ["ANTHROPIC_API_KEY is not set: nothing written"] };
  await ensurePicksTable();
  const seen = new Set((await db.select({ u: designPicks.repoUrl }).from(designPicks)).map((r) => pickKey(r.u)));
  const cands = (await candidates(seen, log)).slice(0, MAX_JUDGED);
  const client = new Anthropic();
  const judged = (
    await inBatches(cands, 3, async (c) => {
      try {
        const facts = await githubRepoFacts(c.url);
        if (facts.fork || facts.archived) return null;
        const verdict = await judge(client, c, facts);
        return verdict ? { c, facts, verdict } : null;
      } catch (e) {
        log.push(`${c.url}: ${e instanceof Error ? e.message : e}`);
        return null;
      }
    })
  ).filter((x): x is NonNullable<typeof x> => !!x);
  const picks = new Set(choose(judged, PER_DAY));
  const today = day();
  for (const j of judged) {
    const chosen = picks.has(j);
    let discoveryId = j.c.discovery?.id ?? null;
    if (chosen && !discoveryId) {
      // Found on GitHub alone: publish a Resources article for it too.
      const [row] = await db
        .insert(discoveries)
        .values({
          title: j.verdict.title,
          summary: j.verdict.article_summary,
          why: j.verdict.article_why,
          category: "open-source",
          sourceName: "GitHub",
          sourceUrl: j.c.url,
          icon: null,
          chips: j.verdict.tags,
          relatedTags: j.verdict.tags,
          relatedProducts: [],
          license: j.facts.license,
          aiScore: j.verdict.score,
          imageLicense: "none",
          status: "published",
          publishDate: today,
        })
        .returning({ id: discoveries.id });
      discoveryId = row.id;
    }
    await db
      .insert(designPicks)
      .values({
        repoUrl: j.c.url,
        discoveryId,
        title: j.verdict.title,
        intro: j.verdict.intro,
        highlights: j.verdict.highlights,
        caveat: j.verdict.caveat,
        license: j.facts.license,
        edaTool: [...new Set(j.facts.projects.map((p) => p.format))].join(", ") || null,
        stars: j.facts.stars,
        repoCreatedAt: j.facts.createdAt ? new Date(j.facts.createdAt) : null,
        repoPushedAt: j.facts.pushedAt ? new Date(j.facts.pushedAt) : null,
        imageUrl: j.facts.image,
        score: j.verdict.score,
        pickDate: today,
        status: chosen ? "published" : "rejected",
      })
      .onConflictDoNothing();
  }
  return { picked: picks.size, judged: judged.length, candidates: cands.length, model: MODEL, log };
}

export type PublicPick = {
  id: number;
  repoUrl: string;
  discoveryId: number | null;
  title: string;
  intro: string;
  highlights: string[];
  caveat: string | null;
  license: string | null;
  edaTool: string | null;
  stars: number | null;
  imageUrl: string | null;
  pickDate: string;
  repoCreatedAt: string | null;
  repoPushedAt: string | null;
};

/** Published picks of the last `days` days, newest day first, best first within a day. */
export async function recentPicks(days = 14, limit = 9): Promise<PublicPick[]> {
  await ensurePicksTable();
  const rows = await db
    .select()
    .from(designPicks)
    .where(and(eq(designPicks.status, "published"), gte(designPicks.pickDate, day(days))))
    .orderBy(desc(designPicks.pickDate), desc(designPicks.score))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    repoUrl: r.repoUrl,
    discoveryId: r.discoveryId,
    title: r.title,
    intro: r.intro,
    highlights: (r.highlights as string[] | null) || [],
    caveat: r.caveat,
    license: r.license,
    edaTool: r.edaTool,
    stars: r.stars,
    imageUrl: r.imageUrl,
    pickDate: r.pickDate,
    repoCreatedAt: r.repoCreatedAt?.toISOString() ?? null,
    repoPushedAt: r.repoPushedAt?.toISOString() ?? null,
  }));
}

/** Admin: every pick of the last 30 days, any status. */
export async function adminPicks() {
  await ensurePicksTable();
  return db.select().from(designPicks).where(gte(designPicks.pickDate, day(30))).orderBy(desc(designPicks.pickDate), desc(designPicks.score));
}

export async function setPickStatus(id: number, status: "published" | "hidden") {
  await ensurePicksTable();
  await db.update(designPicks).set({ status }).where(eq(designPicks.id, id));
}
