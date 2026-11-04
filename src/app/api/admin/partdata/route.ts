import { NextResponse } from "next/server";
import { pdProbe } from "@/lib/partdata/client";
import { isEditor } from "@/lib/guard";

// Editor/admin only (src/middleware.ts protects /api/admin/*).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  // Checked here too, not only in middleware (defence in depth).
  if (!(await isEditor())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await pdProbe(), { headers: { "Cache-Control": "no-store" } });
}
