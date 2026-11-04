import { NextResponse } from "next/server";
import { auth } from "@/lib/auth.edge";
import { PREVIEW_COOKIE, previewKeyMatches, toolsAllowed } from "@/lib/maker/visibility";
import { SESSION_COOKIE, newSessionValue, verifySession } from "@/lib/maker/session";

export default auth(async (req) => {
  const { pathname } = req.nextUrl;
  const role = (req.auth?.user as { role?: string } | undefined)?.role;

  // The legacy seller project import (private repositories via a GitHub App, AI analysis) is not part of
  // the Discover site: off unless PROJECT_IMPORT_ENABLED=1. The Open hardware GitHub import
  // (/api/maker/github/*) is separate and public-repository only.
  if (pathname.startsWith("/api/project-import") || pathname.startsWith("/seller/import-project") || pathname === "/import-project") {
    if (process.env.PROJECT_IMPORT_ENABLED !== "1") {
      if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const url = req.nextUrl.clone();
      url.pathname = "/";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  // New Discover tabs: hidden from the public until MAKER_TOOLS_PUBLIC=1 (see lib/maker/visibility.ts).
  if (pathname === "/tools/preview") {
    const key = req.nextUrl.searchParams.get("key");
    const url = req.nextUrl.clone();
    url.search = "";
    url.pathname = previewKeyMatches(key) ? "/tools/components" : "/";
    const res = NextResponse.redirect(url);
    if (previewKeyMatches(key))
      res.cookies.set(PREVIEW_COOKIE, key!, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 30 * 86400 });
    return res;
  }
  const isTools = pathname.startsWith("/tools/") || pathname.startsWith("/api/maker/") || pathname.startsWith("/api/models/");
  if (isTools) {
    if (toolsAllowed(role, req.cookies.get(PREVIEW_COOKIE)?.value)) {
      const res = NextResponse.next();
      // Anonymous visitor session (lib/maker/session.ts): issued once, no sign-up. SameSite=None so it
      // also works inside the tindie.com iframe where the browser allows it; without it, the IP is used.
      if (!(await verifySession(req.cookies.get(SESSION_COOKIE)?.value))) {
        const value = await newSessionValue();
        if (value) res.cookies.set(SESSION_COOKIE, value, { httpOnly: true, secure: true, sameSite: "none", path: "/", maxAge: 30 * 86400 });
      }
      return res;
    }
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Protect the admin area and admin write APIs.
  const isAdminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (!isAdminArea) return NextResponse.next();

  const allowed = role === "editor" || role === "admin";
  if (allowed) return NextResponse.next();

  // Not authorized -> redirect UI to login, return 401 for APIs.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
});

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/api/project-import/:path*", "/seller/import-project/:path*", "/import-project", "/tools/:path*", "/api/maker/:path*", "/api/models/:path*"],
};

