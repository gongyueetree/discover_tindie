export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { submitResource } from "@/lib/queries";
import { zText, safeHttpUrl } from "@/lib/validate";
import { enforceRateLimit } from "@/lib/ratelimit";

// Public, anonymous endpoint — the most probed surface of the site
// (2026-08-13: SQLi strings, SSRF URLs, 5000-char fuzzing). Everything is
// length-capped, control-chars stripped, and URLs must be public http(s).
const schema = z.object({
  name: zText(140, 1),
  url: z.string().max(2048).optional(),
  category: zText(60).optional(),
  why: zText(1000).optional(),
});

export async function POST(req: Request) {
  const limited = await enforceRateLimit(req, { name: "submit", limit: 5, window: "1 m" });
  if (limited) return limited;
  const session = await auth();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  // URL is optional, but if given it must be a plain public http(s) link.
  let url: string | undefined;
  if (parsed.data.url && parsed.data.url.trim()) {
    const safe = safeHttpUrl(parsed.data.url);
    if (!safe) return NextResponse.json({ error: "URL must be a public http(s) link" }, { status: 400 });
    url = safe;
  }

  await submitResource({
    name: parsed.data.name,
    url,
    category: parsed.data.category || undefined,
    why: parsed.data.why || undefined,
    submittedBy: session?.user?.email || "anonymous",
  });
  return NextResponse.json({ ok: true });
}

