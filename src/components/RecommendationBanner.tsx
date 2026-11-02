"use client";
import { useEffect, useRef } from "react";
import { safeLinkHref } from "@/lib/safe-url";

type Rec = {
  id: number;
  title: string;
  body: string;       // Markdown
  url?: string | null;
  imageUrl?: string | null;
  ctaLabel?: string | null;
};

// Minimal, safe Markdown -> React. Supports **bold**, *italic*, `code`,
// [text](url), line breaks, and "- " bullet lines. No raw HTML is injected.
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  // Tokenize on the supported inline patterns.
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[2] !== undefined) nodes.push(<strong key={`${keyBase}-b${i}`}>{m[2]}</strong>);
    else if (m[3] !== undefined) nodes.push(<em key={`${keyBase}-i${i}`}>{m[3]}</em>);
    else if (m[4] !== undefined) nodes.push(<code key={`${keyBase}-c${i}`} style={{ background: "#e3f3f5", color: "#1c6e7e", padding: "1px 5px", borderRadius: 4 }}>{m[4]}</code>);
    else if (m[5] !== undefined) {
      // Only render as a link if the href is a safe http(s) URL. Anything else
      // (javascript:, data:, etc.) falls back to plain text so a crafted body
      // can't inject a script-executing link on the public page.
      const href = safeLinkHref(m[6]);
      nodes.push(href
        ? <a key={`${keyBase}-a${i}`} href={href} target="_blank" rel="noreferrer" style={{ color: "#1c8693", fontWeight: 600, textDecoration: "underline" }}>{m[5]}</a>
        : <span key={`${keyBase}-a${i}`}>{m[5]}</span>);
    }
    last = m.index + m[0].length; i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ text }: { text: string }) {
  const lines = (text || "").split(/\n/);
  const out: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(
        <ul key={`ul-${out.length}`} style={{ margin: "6px 0", paddingLeft: 22, listStyleType: "disc", listStylePosition: "outside" }}>
          {bullets.map((b, i) => <li key={i} style={{ marginBottom: 3, display: "list-item", listStyleType: "disc" }}>{renderInline(b, `li-${out.length}-${i}`)}</li>)}
        </ul>
      );
      bullets = [];
    }
  };
  lines.forEach((ln, idx) => {
    const t = ln.trim();
    if (/^[-*]\s+/.test(t)) { bullets.push(t.replace(/^[-*]\s+/, "")); return; }
    flush();
    if (t) out.push(<p key={`p-${idx}`} style={{ margin: "4px 0" }}>{renderInline(t, `p-${idx}`)}</p>);
  });
  flush();
  return <>{out}</>;
}

export function RecommendationBanner({ rec }: { rec: Rec | null }) {
  const tracked = useRef(false);
  useEffect(() => {
    if (!rec || tracked.current) return;
    tracked.current = true;
    // Best-effort impression count.
    fetch("/api/recommendation/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: rec.id, kind: "impression" }),
      keepalive: true,
    }).catch(() => {});
  }, [rec]);

  if (!rec) return null;

  function onClick() {
    fetch("/api/recommendation/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: rec!.id, kind: "click" }),
      keepalive: true,
    }).catch(() => {});
  }

  return (
    <div style={{ marginTop: 16, background: "#f4fafb", border: "1px solid #d8edef", borderLeft: "4px solid #22b8c4", borderRadius: 12, padding: "18px 22px", color: "#3a4a4f" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 22, alignItems: "stretch" }}>
        <div style={{ flex: "1 1 340px", minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".6px", textTransform: "uppercase", color: "#1c8693", marginBottom: 6 }}>Recommended</div>
          <h3 style={{ fontSize: 19, fontWeight: 700, margin: "0 0 6px", color: "#1f2d31" }}>{rec.title}</h3>
          <div style={{ fontSize: 14, lineHeight: 1.55, color: "#4a5b60" }}><Markdown text={rec.body} /></div>
          {rec.url && (
            <a href={rec.url} target="_blank" rel="noreferrer" onClick={onClick}
              style={{ display: "inline-block", marginTop: 12, background: "#22b8c4", color: "#fff", fontWeight: 600, fontSize: 13.5, padding: "9px 18px", borderRadius: 8, textDecoration: "none" }}>
              {rec.ctaLabel || "Learn more"} →
            </a>
          )}
        </div>
        {rec.imageUrl && (
          <div style={{ flex: "0 1 380px", minWidth: 240, display: "flex" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={rec.imageUrl} alt={rec.title} loading="lazy"
              style={{ width: "100%", height: "100%", minHeight: 180, objectFit: "contain", borderRadius: 10, border: "1px solid #d8edef", display: "block", background: "#eef6f7" }} />
          </div>
        )}
      </div>
    </div>
  );
}

