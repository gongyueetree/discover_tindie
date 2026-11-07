"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { BookOpen, Cpu, CircuitBoard, LayoutGrid } from "lucide-react";

/**
 * The four tabs of the Discover page. This app is embedded in tindie.com (iframe), which
 * already provides the site header and footer, so the shell renders only the tab bar —
 * same 1200px column, Poppins and turquoise as the live Discover page.
 */
export const TOOL_LINKS = [
  { href: "/", label: "Resources", icon: BookOpen, match: ["/", "/embed", "/tools/resources", "/discover"] },
  { href: "/tools/components", label: "Components", icon: Cpu, match: ["/tools/components"] },
  { href: "/tools/circuits", label: "Open hardware", icon: CircuitBoard, match: ["/tools/circuits", "/tools/viewer"] },
  { href: "/tools/planner", label: "PCB planner", icon: LayoutGrid, match: ["/tools/planner", "/tools/bom"] },
];

/** Tab ids counted by the admin dashboard's Discover traffic (lib/maker-analytics.ts). */
const PAGE_IDS: Record<string, string> = {
  "/": "resources",
  "/tools/components": "components",
  "/tools/circuits": "open-hardware",
  "/tools/planner": "pcb-planner",
};

/** One anonymous page view per tab opened (fire and forget; never affects the page). */
function usePageView(path: string) {
  useEffect(() => {
    const link = TOOL_LINKS.find((t) => t.match.includes(path));
    const page = link && PAGE_IDS[link.href];
    if (!page) return;
    const body = JSON.stringify({ page });
    try {
      if (navigator.sendBeacon?.("/api/track/page", new Blob([body], { type: "application/json" }))) return;
    } catch {
      /* fall back to fetch */
    }
    fetch("/api/track/page", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  }, [path]);
}

export function ToolShell({ children, tools = true }: { children: React.ReactNode; tools?: boolean }) {
  const path = usePathname() || "/";
  usePageView(path);
  // While the new tabs are in preview, the public sees the original page without a tab bar.
  if (!tools) return <div className="maker">{children}</div>;
  return (
    <div className="maker">
      <nav className="tindie-tabs" aria-label="Discover sections">
        <div className="wrap" role="tablist">
          {TOOL_LINKS.map((t) => {
            const active = t.match.includes(path);
            return (
              <Link
                key={t.href}
                href={t.href}
                role="tab"
                aria-selected={active}
                aria-current={active ? "page" : undefined}
                className={active ? "active" : ""}
              >
                <t.icon size={17} aria-hidden="true" />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
      {children}
    </div>
  );
}

/** Page title band, styled like the live "Hardware Discovery" header. */
export function ToolHeading({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="tool-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="heading-actions">{actions}</div>}
    </div>
  );
}
