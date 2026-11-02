import { NextRequest, NextResponse } from "next/server";
import { analyzeGithubProject, analyzeProjectUrl } from "@/lib/project-import/agent";
import { CONNECTION_COOKIE, decodeConnections } from "@/lib/project-import/connection-cookie";
import { createGithubInstallationToken } from "@/lib/project-import/github-app";
import { withGithubAccessToken } from "@/lib/project-import/github";
import type { AnalyzeInput } from "@/lib/project-import/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  let input: AnalyzeInput;
  try {
    input = (await request.json()) as AnalyzeInput;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    if (input.sourceType === "github") {
      if (!input.owner || !input.repo) {
        return NextResponse.json({ error: "GitHub owner and repository are required." }, { status: 400 });
      }

      if (input.installationId) {
        const allowedConnections = decodeConnections(request.cookies.get(CONNECTION_COOKIE)?.value);
        const connection = allowedConnections.find((item) => item.installationId === input.installationId);
        if (!connection) {
          return NextResponse.json({ error: "GitHub connection is not available in this browser session." }, { status: 403 });
        }
        const token = await createGithubInstallationToken(input.installationId);
        const result = await withGithubAccessToken(token, () => analyzeGithubProject(input.owner, input.repo));
        result.sourceIR = {
          provider: "github",
          accountId: connection.id,
          projectId: result.sourceUrl,
          projectUrl: result.sourceUrl,
          projectName: result.projectName,
          visibility: "unknown",
          metadata: { installationId: connection.installationId, accountLogin: connection.accountLogin },
        };
        return NextResponse.json({ result });
      }

      const result = await analyzeGithubProject(input.owner, input.repo);
      result.sourceIR = {
        provider: "github",
        accountId: null,
        projectId: result.sourceUrl,
        projectUrl: result.sourceUrl,
        projectName: result.projectName,
        visibility: "public",
      };
      return NextResponse.json({ result });
    }

    if (["hackaday", "hackster", "url", "ezplm"].includes(input.sourceType)) {
      if (!("url" in input) || !input.url) {
        return NextResponse.json({ error: "Project URL is required." }, { status: 400 });
      }
      const result = await analyzeProjectUrl(input);
      result.sourceIR = {
        provider: input.sourceType,
        accountId: null,
        projectId: input.url,
        projectUrl: input.url,
        projectName: result.projectName,
        visibility: "public",
      };
      return NextResponse.json({ result });
    }

    return NextResponse.json({ error: "Unsupported project source." }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Project analysis failed." },
      { status: 502 }
    );
  }
}

