import { NextResponse } from "next/server";
import { auth } from "@/lib/auth.edge";
import { PREVIEW_COOKIE, previewKeyMatches, toolsAllowed } from "@/lib/maker/visibility";

export default auth((req) => {
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
    if (toolsAllowed(role, req.cookies.get(PREVIEW_COOKIE)?.value)) return NextResponse.next();
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

