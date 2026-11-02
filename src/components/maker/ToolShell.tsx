"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function ToolShell({ children }: { children: React.ReactNode }) {
  const path = usePathname() || "/";
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
  description: string;
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
