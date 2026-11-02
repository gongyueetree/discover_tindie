import { NextRequest, NextResponse } from "next/server";
import { CONNECTION_COOKIE, decodeConnections, encodeConnections } from "@/lib/project-import/connection-cookie";
import { getGithubInstallationConnection, isGithubAppConfigured } from "@/lib/project-import/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const stored = decodeConnections(request.cookies.get(CONNECTION_COOKIE)?.value);
  const validated = [];

  if (isGithubAppConfigured()) {
    for (const item of stored) {
      try {
        const current = await getGithubInstallationConnection(item.installationId, item.connectedAt);
        validated.push(current);
      } catch {
        // The GitHub App may have been uninstalled or access revoked.
      }
    }
  }

  const response = NextResponse.json({
    githubAppConfigured: isGithubAppConfigured(),
    githubConnections: validated,
    publicGithubFallback: true,
  });

  if (validated.length !== stored.length) {
    response.cookies.set(CONNECTION_COOKIE, encodeConnections(validated), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 90,
    });
  }

  return response;
}

