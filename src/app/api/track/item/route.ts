export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { recordArticleView, recordResourceClick } from "@/lib/analytics";
import { enforceRateLimit } from "@/lib/ratelimit";

// Per-item analytics: a discovery "read" (drawer open) or a resource "Visit"
// click. Anonymous, rate-limited, best-effort — never blocks the visitor.
const schema = z.object({
  type: z.enum(["discovery", "resource"]),
  id: z.number().int().positive(),
});

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, { name: "track-item", limit: 120, window: "1 m" });
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });
  try {
    if (parsed.data.type === "discovery") await recordArticleView(parsed.data.id);
    else await recordResourceClick(parsed.data.id);
  } catch {
    return NextResponse.json({ ok: false });
  }
  return NextResponse.json({ ok: true });
}

