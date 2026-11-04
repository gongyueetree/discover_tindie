import { projectImportDisabled } from "@/lib/project-import/enabled";
import { NextRequest, NextResponse } from "next/server";
import {
  CONNECTION_COOKIE,
  CONNECTION_STATE_COOKIE,
  decodeConnections,
  encodeConnections,
} from "@/lib/project-import/connection-cookie";
import { getGithubInstallationConnection, isGithubAppConfigured, userCanAccessInstallation } from "@/lib/project-import/github-app";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const off = projectImportDisabled();
  if (off) return off;
  const target = new URL("/seller/import-project", request.url);
  if (!isGithubAppConfigured()) {
    target.searchParams.set("github", "not-configured");
    return NextResponse.redirect(target);
  }

  const state = request.nextUrl.searchParams.get("state") || "";
  const expectedState = request.cookies.get(CONNECTION_STATE_COOKIE)?.value || "";
  const rawInstallationId = request.nextUrl.searchParams.get("installation_id") || "";
  const installationId = Number(rawInstallationId);

  if (!state || !expectedState || state !== expectedState) {
    target.searchParams.set("github", "state-error");
    return NextResponse.redirect(target);
  }
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    target.searchParams.set("github", "installation-error");
    return NextResponse.redirect(target);
  }

  try {
    // The installation id in the URL can be anyone's: only connect it if the GitHub user who just
    // authorised the App can access it (user OAuth during installation must be enabled on the App).
    if (!(await userCanAccessInstallation(request.nextUrl.searchParams.get("code") || "", installationId))) {
      target.searchParams.set("github", "installation-unverified");
      return NextResponse.redirect(target);
    }
    const connection = await getGithubInstallationConnection(installationId);
    const current = decodeConnections(request.cookies.get(CONNECTION_COOKIE)?.value);
    const next = [connection, ...current.filter((item) => item.installationId !== installationId)].slice(0, 12);
    const response = NextResponse.redirect(new URL("/seller/import-project?connected=github", request.url));
    response.cookies.set(CONNECTION_COOKIE, encodeConnections(next), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    response.cookies.set(CONNECTION_STATE_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    target.searchParams.set("github", "connect-error");
    target.searchParams.set("reason", error instanceof Error ? error.message.slice(0, 120) : "unknown");
    return NextResponse.redirect(target);
  }
}

