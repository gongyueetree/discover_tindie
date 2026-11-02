import { auth } from "@/lib/auth";

/** Defense-in-depth role check for admin API handlers. The middleware
 *  (src/middleware.ts) is the primary gate, but handlers also call this so a
 *  future middleware-bypass class of bug can't expose admin mutations. */
export async function isEditor(): Promise<boolean> {
  const session = await auth();
  const role = (session?.user as { role?: string } | undefined)?.role;
  return role === "editor" || role === "admin";
}

