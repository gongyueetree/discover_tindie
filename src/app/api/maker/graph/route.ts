import { NextRequest, NextResponse } from "next/server";
import { rateLimit, asSourceError } from "@/lib/maker/server";
import { visitorHash } from "@/lib/partdata/client";
import { kgGraph } from "@/lib/partdata/maker";

/**
 * Component-family graph from the partdata knowledge graph snapshot
 * (same-board co-occurrence over representative open-source designs).
 * Responses are cached by the partdata client for 10 minutes.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "local";
  try {
    rateLimit(ip);
    const focus = (req.nextUrl.searchParams.get("mpn") || "").trim();
    if (focus.length > 120) return NextResponse.json({ error: "Part number too long" }, { status: 400 });
    const data = await kgGraph(focus, visitorHash(ip));
    return NextResponse.json(data, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (e) {
    const err = asSourceError(e);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
