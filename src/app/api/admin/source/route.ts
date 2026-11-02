export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { toggleSource, createSource, deleteSource, updateSource } from "@/lib/queries";
import { zText, zUrlOptional } from "@/lib/validate";
import { isEditor } from "@/lib/guard";

// Whitelisted, length-capped fields — no pass-through of arbitrary keys.
const fieldsSchema = z.object({
  name: zText(200).optional(),
  method: z.enum(["RSS", "API", "Crawl"]).optional(),
  url: zUrlOptional,
  category: zText(60).optional(),
  frequency: zText(20).optional(),
  trust: z.enum(["High", "Medium", "Low"]).optional(),
  dailyCap: z.number().int().min(0).max(100).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

const schema = z.object({
  id: z.number().int().positive().optional(),
  action: z.enum(["toggle", "create", "delete", "update"]).optional(),
  fields: fieldsSchema.optional(),
});

export async function POST(req: Request) {
  if (!(await isEditor())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { id, action, fields } = parsed.data;
  // Backwards compatible: no action + id => toggle (old Pause/Resume buttons)
  if ((action === "toggle" || !action) && id != null) {
    const status = await toggleSource(id);
    return NextResponse.json({ ok: true, status });
  }
  if (action === "create" && fields) { await createSource(fields as any); return NextResponse.json({ ok: true }); }
  if (action === "update" && id != null && fields) { await updateSource(id, fields as any); return NextResponse.json({ ok: true }); }
  if (action === "delete" && id != null) { await deleteSource(id); return NextResponse.json({ ok: true }); }
  return NextResponse.json({ error: "Bad request" }, { status: 400 });
}

