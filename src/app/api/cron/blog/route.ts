export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { importBlogPosts } from "@/lib/blog-import";
import { bearerMatches } from "@/lib/secret";

// Daily Vercel Cron (see vercel.json) that refreshes the mirrored blog posts.
// Fails CLOSED: rejects everything if CRON_SECRET is unset. Vercel injects
// `Authorization: Bearer <CRON_SECRET>` automatically when the env var exists.
export async function GET(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await importBlogPosts(db);
  return NextResponse.json({ ok: true, ...result, at: new Date().toISOString() });
}

