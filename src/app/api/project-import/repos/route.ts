import { NextRequest, NextResponse } from "next/server";
import { CONNECTION_COOKIE, decodeConnections } from "@/lib/project-import/connection-cookie";
import { listGithubInstallationRepositories } from "@/lib/project-import/github-app";
import { listGithubRepositories } from "@/lib/project-import/github";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams.get("q")?.trim() || "";
  const rawInstallationId = request.nextUrl.searchParams.get("installationId")?.trim() || "";

  if (rawInstallationId) {
    const installationId = Number(rawInstallationId);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      return NextResponse.json({ error: "Invalid GitHub installation id." }, { status: 400 });
    }
    const allowedConnections = decodeConnections(request.cookies.get(CONNECTION_COOKIE)?.value);
    const connection = allowedConnections.find((item) => item.installationId === installationId);
    if (!connection) {
      return NextResponse.json({ error: "GitHub connection is not available in this browser session." }, { status: 403 });
    }
    try {
      const repositories = await listGithubInstallationRepositories(installationId, search);
      return NextResponse.json({
        repositories,
        owner: connection.accountLogin,
        authenticated: true,
        connection,
      });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Unable to load connected GitHub repositories." },
        { status: 502 }
      );
    }
  }

  const owner = request.nextUrl.searchParams.get("owner")?.trim() || "gongyueetree";
  if (!/^[A-Za-z0-9-]{1,39}$/.test(owner)) {
    return NextResponse.json({ error: "Invalid GitHub owner." }, { status: 400 });
  }

  try {
    const repositories = await listGithubRepositories(owner, search);
    return NextResponse.json({
      repositories,
      owner,
      authenticated: Boolean(process.env.GITHUB_TOKEN),
      publicMode: true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load GitHub repositories." },
      { status: 502 }
    );
  }
}

