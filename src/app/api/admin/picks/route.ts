export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
import { NextResponse } from "next/server";
import { z } from "zod";
import { isEditor } from "@/lib/guard";
import { adminPicks, runDesignPicks, setPickStatus } from "@/lib/design-picks";

// Admin → Design picks: list the last 30 days, hide / restore a pick, or run today's selection now.
export async function GET() {
  if (!(await isEditor())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ items: await adminPicks() });
}

const schema = z.object({ action: z.enum(["hide", "publish", "run"]), id: z.number().int().positive().optional() });

export async function POST(req: Request) {
  if (!(await isEditor())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { action, id } = parsed.data;
  if (action === "run") return NextResponse.json({ ok: true, ...(await runDesignPicks()) });
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await setPickStatus(id, action === "hide" ? "hidden" : "published");
  return NextResponse.json({ ok: true });
}
