export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { moderateSubmission } from "@/lib/queries";
import { isEditor } from "@/lib/guard";

const schema = z.object({ id: z.number(), action: z.enum(["approve", "reject"]) });

export async function POST(req: Request) {
  if (!(await isEditor())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  await moderateSubmission(parsed.data.id, parsed.data.action);
  return NextResponse.json({ ok: true });
}

