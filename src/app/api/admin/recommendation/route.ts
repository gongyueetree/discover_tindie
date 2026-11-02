export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createRecommendation, updateRecommendation, deleteRecommendation } from "@/lib/queries";
import { zText, zUrlOptional, zIsoDateOrNull } from "@/lib/validate";
import { isEditor } from "@/lib/guard";

// Whitelisted, length-capped fields — no pass-through of arbitrary keys.
const fieldsSchema = z.object({
  title: zText(200).optional(),
  body: zText(5000).optional(),
  url: zUrlOptional,
  imageUrl: zUrlOptional,
  ctaLabel: zText(60).optional(),
  startsAt: zIsoDateOrNull,
  endsAt: zIsoDateOrNull,
  status: z.enum(["active", "paused"]).optional(),
});

const schema = z.object({
  id: z.number().int().positive().optional(),
  action: z.enum(["create", "update", "delete"]),
  fields: fieldsSchema.optional(),
});

export async function POST(req: Request) {
  if (!(await isEditor())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const { id, action, fields } = parsed.data;
  if (action === "create" && fields) await createRecommendation(fields as any);
  else if (action === "update" && id != null && fields) await updateRecommendation(id, fields as any);
  else if (action === "delete" && id != null) await deleteRecommendation(id);
  else return NextResponse.json({ error: "Bad request" }, { status: 400 });
  return NextResponse.json({ ok: true });
}

