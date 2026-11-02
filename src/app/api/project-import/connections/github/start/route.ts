import { NextRequest, NextResponse } from "next/server";
import { CONNECTION_STATE_COOKIE, createConnectionState } from "@/lib/project-import/connection-cookie";
import { githubInstallUrl, isGithubAppConfigured } from "@/lib/project-import/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const fallback = new URL("/seller/import-project?github=not-configured", request.url);
  if (!isGithubAppConfigured()) return NextResponse.redirect(fallback);

  const state = createConnectionState();
  const response = NextResponse.redirect(githubInstallUrl(state));
  response.cookies.set(CONNECTION_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  return response;
}

