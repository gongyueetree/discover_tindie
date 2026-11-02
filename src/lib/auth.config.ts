import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe base config — NO database or Node-only imports.
 * Used by middleware (Edge runtime). The full config in auth.ts
 * extends this and adds the Drizzle adapter + Credentials provider.
 */
export const authConfig: NextAuthConfig = {
  // JWT sessions carry the role. Cap the lifetime so a revoked/demoted admin
  // loses access within a week instead of the 30-day default (the edge
  // middleware can't re-check the DB, so a shorter token is the bound).
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [], // real providers added in auth.ts (Node runtime)
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.role = (user as any).role || "user";
      return token;
    },
    async session({ session, token }) {
      if (session.user) (session.user as any).role = token.role || "user";
      return session;
    },
  },
};

