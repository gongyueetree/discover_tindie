export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { runDiscoveryPipeline } from "@/lib/pipeline";
import { bearerMatches } from "@/lib/secret";

// Triggered by Vercel Cron (see vercel.json). Protected by CRON_SECRET.
// Fails CLOSED: if CRON_SECRET is unset, every request is rejected so the
// paid Anthropic pipeline can never be triggered by an anonymous caller.
// Vercel injects `Authorization: Bearer <CRON_SECRET>` automatically when the
// env var exists, so the legitimate scheduled run keeps working.
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await runDiscoveryPipeline();
  return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
}

