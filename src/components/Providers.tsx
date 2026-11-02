"use client";
import {usePathname} from "next/navigation";
import { SessionProvider } from "next-auth/react";

export function Providers({ children }: { children: React.ReactNode }) {
  const path=usePathname();
  const publicTools=path === "/" || path === "/embed" || path === "/discover" || path.startsWith("/tools/");
  return <SessionProvider session={publicTools ? null : undefined} refetchOnWindowFocus={!publicTools}>{children}</SessionProvider>;
}

