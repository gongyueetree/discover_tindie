export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { addComment } from "@/lib/queries";
import { zText } from "@/lib/validate";
import { enforceRateLimit } from "@/lib/ratelimit";

const schema = z.object({ discoveryId: z.number().int().positive(), body: zText(2000, 1), tag: zText(40).optional() });

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, { name: "comment", limit: 5, window: "1 m" });
  if (limited) return limited;
  const session = await auth();
  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const name = (session?.user?.name || session?.user?.email || "anonymous") as string;
  try {
    await addComment(parsed.data.discoveryId, parsed.data.body, parsed.data.tag || null, name, (session?.user as any)?.id || null);
  } catch {
    // e.g. discoveryId doesn't exist (FK violation) — treat as bad request.
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}

