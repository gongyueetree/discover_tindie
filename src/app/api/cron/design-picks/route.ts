export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
import { NextResponse } from "next/server";
import { runDesignPicks } from "@/lib/design-picks";
import { bearerMatches } from "@/lib/secret";

// Daily open-hardware picks for the Open hardware tab (vercel.json, after the discovery run).
// Protected by CRON_SECRET and fails closed, like /api/cron/discover: it spends Claude API credit.
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runDesignPicks();
    return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
  } catch (e) {
    console.error("[design-picks]", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
