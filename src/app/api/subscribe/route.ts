export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { subscribe } from "@/lib/queries";
import { enforceRateLimit } from "@/lib/ratelimit";

const schema = z.object({ email: z.string().max(254).email().transform((v) => v.toLowerCase().trim()) });

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, { name: "subscribe", limit: 3, window: "1 m" });
  if (limited) return limited;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  await subscribe(parsed.data.email);
  return NextResponse.json({ ok: true });
}

