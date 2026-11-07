import "server-only";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";

/* ============================================================================
   TRAFFIC FOR THE DISCOVER TABS (Resources, Components, Open hardware, PCB planner).

   Three small tables, counted per UTC day (pre-aggregated, like analytics_daily):
   - maker_traffic_daily   page views per tab;
   - maker_visitors_daily  one row per (day, tab, visitor) for unique visitors. The visitor is a
                           hash of the anonymous session (or IP) with the day and a server secret:
                           no IP or cookie value is stored, and the same person cannot be followed
                           from one day to the next;
   - maker_terms_daily     what people searched (per search box), with how many searches found
                           nothing, and which designs / parts they opened.
   Recording is best-effort: no database, or a failing one, never affects a visitor.
   Tables are created on first use (same SQL as drizzle/0004_maker_analytics.sql).
============================================================================ */

export const PAGES = [
  { id: "resources", label: "Resources" },
  { id: "components", label: "Components" },
  { id: "open-hardware", label: "Open hardware" },
  { id: "pcb-planner", label: "PCB planner" },
] as const;
export type PageId = (typeof PAGES)[number]["id"];
export const isPage = (x: unknown): x is PageId => PAGES.some((p) => p.id === x);

/** Search boxes and "opened" lists, as recorded by the Maker API. */
export const SCOPES = {
  components: "Components search",
  "open-hardware": "Open hardware search (part number)",
  "pcb-planner": "PCB planner part search",
  "github-import": "Import from GitHub",
  "open:part": "Parts opened",
  "open:design": "Designs opened",
} as const;
export type Scope = keyof typeof SCOPES;

const hasDb = () => Boolean(process.env.APP_DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL);
const day = (offset = 0) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

const DDL = [
  `CREATE TABLE IF NOT EXISTS "maker_traffic_daily" (
  "day" varchar(10) NOT NULL, "page" varchar(24) NOT NULL, "views" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "maker_traffic_daily_pk" PRIMARY KEY ("day", "page"));`,
  `CREATE TABLE IF NOT EXISTS "maker_visitors_daily" (
  "day" varchar(10) NOT NULL, "page" varchar(24) NOT NULL, "visitor" varchar(16) NOT NULL,
  CONSTRAINT "maker_visitors_daily_pk" PRIMARY KEY ("day", "page", "visitor"));`,
  `CREATE TABLE IF NOT EXISTS "maker_terms_daily" (
  "day" varchar(10) NOT NULL, "scope" varchar(24) NOT NULL, "term" varchar(120) NOT NULL,
  "count" integer DEFAULT 0 NOT NULL, "empty" integer DEFAULT 0 NOT NULL,
  CONSTRAINT "maker_terms_daily_pk" PRIMARY KEY ("day", "scope", "term"));`,
];
let ready: Promise<void> | null = null;
function ensureTables() {
  if (!ready) {
    ready = (async () => {
      for (const s of DDL) await db.execute(sql.raw(s));
    })();
    ready.catch(() => (ready = null));
  }
  return ready;
}

/** A visitor id for today only: hash(day, session-or-IP, secret), 16 hex characters. */
export function dailyVisitor(who: string, d = day()) {
  const secret = process.env.MAKER_SESSION_SECRET || process.env.AUTH_SECRET || "tindie-discover";
  return createHash("sha256").update(`${d}\0${who}\0${secret}`).digest("hex").slice(0, 16);
}

/** Crawlers and link previews are not visitors. */
export const isBot = (ua: string | null) =>
  !ua || /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|go-http/i.test(ua);

export async function recordPageView(page: PageId, who: string) {
  if (!hasDb()) return;
  await ensureTables();
  const d = day();
  await db.execute(sql`INSERT INTO maker_traffic_daily (day, page, views) VALUES (${d}, ${page}, 1)
    ON CONFLICT (day, page) DO UPDATE SET views = maker_traffic_daily.views + 1`);
  await db.execute(sql`INSERT INTO maker_visitors_daily (day, page, visitor) VALUES (${d}, ${page}, ${dailyVisitor(who, d)})
    ON CONFLICT DO NOTHING`);
}

/** Search text as people mean it: trimmed, spaces collapsed, case-insensitive, at most 80 characters. */
export function normalizeTerm(raw: string) {
  return raw.trim().replace(/\s+/g, " ").toLowerCase().slice(0, 80);
}

/** One search (or one "opened" item) for `scope`; `found` = how many results it had (0 counts as empty). */
export async function recordTerm(scope: Scope, raw: string, found?: number) {
  if (!hasDb()) return;
  const term = normalizeTerm(raw);
  if (term.length < 2) return;
  await ensureTables();
  const empty = found === 0 ? 1 : 0;
  await db.execute(sql`INSERT INTO maker_terms_daily (day, scope, term, count, empty) VALUES (${day()}, ${scope}, ${term}, 1, ${empty})
    ON CONFLICT (day, scope, term) DO UPDATE SET count = maker_terms_daily.count + 1, empty = maker_terms_daily.empty + ${empty}`);
}

/** Fire and forget from a request handler: never awaited, never throws. */
export function noteAsync(p: () => Promise<unknown>) {
  void p().catch(() => undefined);
}

export type MakerTraffic = {
  days: number;
  daily: { day: string; page: PageId; views: number; visitors: number }[];
  totals: { page: PageId; views: number; visitors: number }[];
  terms: { scope: Scope; term: string; count: number; empty: number }[];
};

/** Everything the admin dashboard shows for the last `days` days (1–400). */
export async function makerTraffic(days = 30): Promise<MakerTraffic> {
  days = Math.max(1, Math.min(400, Math.floor(days)));
  if (!hasDb()) return { days, daily: [], totals: [], terms: [] };
  await ensureTables();
  const since = day(days - 1);
  // Old visitor hashes are not needed after the longest range the dashboard shows.
  await db.execute(sql`DELETE FROM maker_visitors_daily WHERE day < ${day(400)}`).catch(() => undefined);
  const daily = await db.execute(sql`
    SELECT t.day, t.page, t.views::int AS views, COALESCE(v.n, 0)::int AS visitors
    FROM maker_traffic_daily t
    LEFT JOIN (SELECT day, page, count(*) AS n FROM maker_visitors_daily WHERE day >= ${since} GROUP BY day, page) v
      ON v.day = t.day AND v.page = t.page
    WHERE t.day >= ${since} ORDER BY t.day`);
  const totals = await db.execute(sql`
    SELECT t.page, t.views::int AS views, COALESCE(v.n, 0)::int AS visitors
    FROM (SELECT page, sum(views) AS views FROM maker_traffic_daily WHERE day >= ${since} GROUP BY page) t
    LEFT JOIN (SELECT page, count(DISTINCT visitor || day) AS n FROM maker_visitors_daily WHERE day >= ${since} GROUP BY page) v
      ON v.page = t.page`);
  const terms = await db.execute(sql`
    SELECT scope, term, count, empty FROM (
      SELECT scope, term, sum(count)::int AS count, sum(empty)::int AS empty,
             row_number() OVER (PARTITION BY scope ORDER BY sum(count) DESC, term) AS rank
      FROM maker_terms_daily WHERE day >= ${since} GROUP BY scope, term) ranked
    WHERE rank <= 50 ORDER BY scope, count DESC, term`);
  return {
    days,
    daily: [...daily] as unknown as MakerTraffic["daily"],
    totals: [...totals] as unknown as MakerTraffic["totals"],
    terms: [...terms] as unknown as MakerTraffic["terms"],
  };
}
