"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Cpu,
  CircuitBoard,
  BookOpen,
  LayoutGrid,
  ArrowUpRight,
} from "lucide-react";
export const TOOL_LINKS = [
  { slug: "components", label: "Components", icon: Cpu },
  { slug: "circuits", label: "Explore circuits", icon: CircuitBoard },
  { slug: "planner", label: "PCB planner", icon: LayoutGrid },
  { slug: "resources", label: "Resources", icon: BookOpen },
];
export function ToolShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="maker">
      <header className="maker-header">
        <Link href="/" className="maker-wordmark">
          tindie<span> / maker tools</span>
        </Link>
        <nav>
          <a href="https://www.tindie.com" target="_blank" rel="noreferrer">
            Marketplace <ArrowUpRight size={14} />
          </a>
        </nav>
        <span className="public-label">
          <i /> Free to explore. No account.
        </span>
      </header>
      <div className="maker-toolnav">
        {TOOL_LINKS.map((t) => (
          <Link
            className={path === `/tools/${t.slug}` ? "active" : ""}
            href={`/tools/${t.slug}`}
            key={t.slug}
          >
            <t.icon size={17} />
            {t.label}
          </Link>
        ))}
      </div>
      {children}
      <footer className="maker-footer">
        <span>
          <b>tindie</b> · A little help for your next big idea.
        </span>
        <span>Open files. Real parts. Your next project.</span>
      </footer>
    </div>
  );
}
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
      <div className="heading-actions">{actions}</div>
    </div>
  );
}
