import { projectImportDisabled } from "@/lib/project-import/enabled";
import { NextRequest, NextResponse } from "next/server";
import { CONNECTION_COOKIE, decodeConnections, encodeConnections } from "@/lib/project-import/connection-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const off = projectImportDisabled();
  if (off) return off;
  let installationId = 0;
  try {
    const body = (await request.json()) as { installationId?: number };
    installationId = Number(body.installationId || 0);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    return NextResponse.json({ error: "Invalid installation id." }, { status: 400 });
  }

  const current = decodeConnections(request.cookies.get(CONNECTION_COOKIE)?.value);
  const next = current.filter((item) => item.installationId !== installationId);
  const response = NextResponse.json({ ok: true, githubConnections: next });
  response.cookies.set(CONNECTION_COOKIE, encodeConnections(next), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}

