import { auth } from "@/lib/auth";

/** Defense-in-depth role check for admin API handlers and the admin page. The middleware
 *  (src/middleware.ts) is the primary gate, but handlers also call this so a
 *  future middleware-bypass class of bug can't expose admin mutations.
 *
 *  The role in the session token is only a hint: it was written at sign-in and lives up to 7 days.
 *  The current role is read from the users table, so demoting or removing an editor takes effect
 *  on their next admin request. */
export async function isEditor(): Promise<boolean> {
  const session = await auth();
  const user = session?.user as { id?: string; email?: string | null; role?: string } | undefined;
  const tokenRole = user?.role;
  if (tokenRole !== "editor" && tokenRole !== "admin") return false;
  try {
    const [{ db }, { users }, { eq }] = await Promise.all([import("@/db"), import("@/db/schema"), import("drizzle-orm")]);
    const where = user?.id ? eq(users.id, user.id) : user?.email ? eq(users.email, user.email) : null;
    if (!where) return false;
    const [row] = await db.select({ role: users.role }).from(users).where(where).limit(1);
    return row?.role === "editor" || row?.role === "admin";
  } catch {
    return false; // cannot confirm the role: refuse
  }
}
