import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth.config";

// Edge-safe NextAuth instance for middleware only (no DB adapter).
export const { auth } = NextAuth(authConfig);

