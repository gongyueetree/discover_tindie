import { NextResponse } from "next/server";
import { pdProbe } from "@/lib/partdata/client";

// Editor/admin only (src/middleware.ts protects /api/admin/*).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await pdProbe(), { headers: { "Cache-Control": "no-store" } });
}
