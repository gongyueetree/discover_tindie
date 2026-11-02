export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { trackRecommendation } from "@/lib/queries";
import { enforceRateLimit } from "@/lib/ratelimit";

const schema = z.object({
  id: z.number().int().positive(),
  kind: z.enum(["impression", "click"]),
});

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, { name: "track", limit: 30, window: "1 m" });
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { id, kind } = parsed.data;
  try {
    await trackRecommendation(id, kind);
  } catch {
    // Tracking is best-effort; never block the user on a failed count.
    return NextResponse.json({ ok: false });
  }
  return NextResponse.json({ ok: true });
}

