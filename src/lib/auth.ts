import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, accounts, sessions, verificationTokens } from "@/db/schema";
import { authConfig } from "@/lib/auth.config";
import { checkRateLimit, clientIp } from "@/lib/ratelimit";

// A valid bcrypt hash (of a random string) used only to burn equivalent CPU
// time when an email isn't found, so login timing can't be used to tell
// registered emails from unregistered ones. The value is never matched.
const DUMMY_HASH = "$2a$10$5dVNKrR5jkVbPFERyfQaIuJqPyqoY4KXVre5YUrRdertAqo3G8M66";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(creds, req) {
        const email = String(creds?.email || "").toLowerCase().trim();
        const password = String(creds?.password || "");
        if (!email || !password) return null;
        // Brute-force guard: cap login attempts per client IP (fails open if
        // the rate-limit backend isn't configured/reachable).
        const ip = req ? clientIp(req as unknown as Request) : "unknown";
        if (!(await checkRateLimit(`login:${ip}`, { name: "login", limit: 10, window: "1 m" }))) {
          return null;
        }
        const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
        const user = rows[0];
        // Always run a bcrypt compare — against a fixed dummy hash when the
        // account doesn't exist — so response time doesn't reveal whether an
        // email is registered (defeats user enumeration by timing).
        const hash = user?.passwordHash || DUMMY_HASH;
        const ok = await bcrypt.compare(password, hash);
        if (!ok || !user?.passwordHash) return null;
        return { id: user.id, email: user.email, name: user.name, role: user.role } as any;
      },
    }),
  ],
});

