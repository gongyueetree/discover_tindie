export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/ratelimit";
import { identify } from "@/lib/maker/identify";
import { PAGES, isBot, noteAsync, recordPageView } from "@/lib/maker-analytics";

// One view of a Discover tab (Resources, Components, Open hardware, PCB planner), sent by the tab bar.
// Anonymous: the visitor is counted by a daily hash (lib/maker-analytics.ts). Crawlers are not counted.
const schema = z.object({ page: z.enum(PAGES.map((p) => p.id) as [string, ...string[]]) });

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, { name: "track-page", limit: 60, window: "1 m" });
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  if (isBot(req.headers.get("user-agent"))) return NextResponse.json({ ok: true });
  const who = await identify(req);
  noteAsync(() => recordPageView(parsed.data.page as (typeof PAGES)[number]["id"], who.sid ? "s:" + who.sid : "n:" + who.ip));
  return NextResponse.json({ ok: true });
}
