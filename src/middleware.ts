import { NextResponse } from "next/server";
import { auth } from "@/lib/auth.edge";

export default auth((req) => {
  const { pathname } = req.nextUrl;
  // Protect the admin area and admin write APIs.
  const isAdminArea = pathname.startsWith("/admin") || pathname.startsWith("/api/admin");
  if (!isAdminArea) return NextResponse.next();

  const user = req.auth?.user as { role?: string } | undefined;
  const allowed = user && (user.role === "editor" || user.role === "admin");
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
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};

