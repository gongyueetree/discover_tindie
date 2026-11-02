export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordEvents } from "@/lib/analytics";
import { enforceRateLimit } from "@/lib/ratelimit";
import { TRACK_SECTION_IDS } from "@/lib/sections";

// Batched, anonymous section analytics. The client sends one request per page
// load (all view events) plus small click batches, so the per-IP limit is
// generous. Sections are whitelisted; anything else is dropped server-side.
const schema = z.object({
  events: z.array(z.object({
    section: z.enum(TRACK_SECTION_IDS as [string, ...string[]]),
    kind: z.enum(["view", "click"]),
  })).min(1).max(50),
});

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, { name: "track-analytics", limit: 60, window: "1 m" });
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    await recordEvents(parsed.data.events);
  } catch {
    // Analytics is best-effort — never surface a failure to the visitor.
    return NextResponse.json({ ok: false });
  }
  return NextResponse.json({ ok: true });
}

