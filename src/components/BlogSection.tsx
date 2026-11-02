"use client";
import { useEffect, useRef, useState } from "react";
import { safeLinkHref } from "@/lib/safe-url";

type BlogPost = {
  id: number;
  title: string;
  author?: string | null;
  excerpt?: string | null;
  imageUrl?: string | null;
  url: string;
  publishedAt?: string | Date | null;
};

function fmtDate(d?: string | Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function BlogSection({ posts = [] }: { posts?: BlogPost[] }) {
  const gridRef = useRef<HTMLDivElement>(null);
  // Columns the responsive grid currently lays out; 0 until measured (SSR).
  const [cols, setCols] = useState(0);

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const measure = () => {
      const tpl = getComputedStyle(el).gridTemplateColumns;
      const c = tpl ? tpl.split(" ").filter(Boolean).length : 1;
      setCols(c > 0 ? c : 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!posts.length) return null; // nothing mirrored yet -> hide the whole block

  // Show only whole rows so the last row is never left with empty slots.
  // Before measuring (cols===0) render everything; if there aren't even enough
  // for one full row, show them all rather than nothing.
  const n = posts.length;
  const shown = cols > 0 && Math.floor(n / cols) >= 1 ? Math.floor(n / cols) * cols : n;
  const list = posts.slice(0, shown);

  return (
    <section style={{ padding: "26px 0 28px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h2 style={{ fontSize: 21, fontWeight: 600, color: "#2f3438" }}>📝 From the Blog</h2>
        <a href="https://blog.tindie.com/" target="_blank" rel="noreferrer" style={{ fontSize: 13.5, fontWeight: 600, color: "#1aa0ab" }}>View all posts →</a>
      </div>
      <p style={{ color: "#8a9499", fontSize: 14, marginBottom: 18 }}>Latest posts from the Tindie blog.</p>

      <div ref={gridRef} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 16 }}>
        {list.map((p) => {
          const href = safeLinkHref(p.url);
          const img = safeLinkHref(p.imageUrl || "");
          const meta = [p.author, fmtDate(p.publishedAt)].filter(Boolean).join(" · ");
          return (
            <a key={p.id} href={href || undefined} target="_blank" rel="noreferrer"
              style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 10, display: "flex", flexDirection: "column", textDecoration: "none", overflow: "hidden", cursor: "pointer" }}>
              {/* 16:9 image, cover; light placeholder when missing */}
              <div style={{ width: "100%", aspectRatio: "16 / 9", background: "#eef2f3", overflow: "hidden" }}>
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={p.title} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                )}
              </div>
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", flex: 1 }}>
                <h4 style={{ fontSize: 15.5, margin: "0 0 6px", color: "#2f3438", lineHeight: 1.3 }}>{p.title}</h4>
                {meta && <div style={{ fontSize: 11.5, color: "#8a9499", marginBottom: 9 }}>{meta}</div>}
                {p.excerpt && <div style={{ fontSize: 13, color: "#6b7479", flex: 1, lineHeight: 1.5 }}>{p.excerpt}</div>}
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}

