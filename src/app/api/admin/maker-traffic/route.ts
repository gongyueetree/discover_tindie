export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { isEditor } from "@/lib/guard";
import { makerTraffic } from "@/lib/maker-analytics";

// Admin → Discover traffic: page views, unique visitors and search terms for the last N days.
export async function GET(req: Request) {
  if (!(await isEditor())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const days = Number(new URL(req.url).searchParams.get("days")) || 30;
  try {
    return NextResponse.json(await makerTraffic(days), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Analytics unavailable" }, { status: 500 });
  }
}
