import { createHash } from "node:crypto";
import type { Who } from "./request-context";
import { SESSION_COOKIE, verifySession } from "./session";

/** Hashed client IP (Vercel sets x-forwarded-for) and the verified anonymous session, if any. */
export async function identify(req: Request): Promise<Who> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
  const cookie = (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  return { ip: createHash("sha256").update(ip).digest("hex").slice(0, 32), sid: await verifySession(cookie && decodeURIComponent(cookie)) };
}
