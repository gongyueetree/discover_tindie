"use client";
import { useState, useRef } from "react";
import { BrandLogo } from "@/components/BrandLogo";
import { TAXONOMY } from "@/lib/taxonomy";
import { useHomeSearch, matchText } from "@/components/HomeSearch";
import { trackItem } from "@/lib/track-client";

const lbl = (bg: string, fg: string): React.CSSProperties => ({ fontSize: 10, fontWeight: 600, padding: "2px 7px", borderRadius: 5, background: bg, color: fg });

function Card({ r }: { r: any }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 11, padding: 15, display: "flex", flexDirection: "column", gap: 11 }}>
      <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
        <BrandLogo name={r.name} src={r.logo} size={40} />
        <div style={{ flex: 1 }}>
          <h4 style={{ fontSize: 14, color: "#2f3438", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>{r.name}
            {r.isPick && <span style={lbl("#fff0e0", "#c25a14")}>★ Pick</span>}
            {r.isPartner && <span style={lbl("#e7f5ee", "#268a52")}>Partner</span>}
          </h4>
          <div style={{ fontSize: 12.5, color: "#8a9499", marginTop: 2 }}>{r.description}</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 10.5, background: "#f0f5f6", color: "#1c6e7e", padding: "3px 8px", borderRadius: 5 }}>{r.capLabel}</span>
        <a href={r.url} target="_blank" rel="noreferrer" onClick={() => trackItem("resource", r.id)} style={{ fontSize: 12, fontWeight: 600, color: "#22b8c4", border: "1px solid #22b8c4", borderRadius: 6, padding: "5px 16px" }}>Visit ↗</a>
      </div>
    </div>
  );
}

// Browse-by-category icon cards + directory tabs + filtered grid, all sharing one selected category.
export function BrowseAndDirectory({ resources }: { resources: any[] }) {
  const { q } = useHomeSearch();
  const [cat, setCat] = useState<string>("all");
  const dirRef = useRef<HTMLDivElement>(null);
  const counts: Record<string, number> = {};
  resources.forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });

  const byCat = cat === "all" ? resources : resources.filter((r) => r.category === cat);
  const filtered = q.trim()
    ? byCat.filter((r) => matchText([r.name, r.description, r.capLabel, r.category].filter(Boolean).join(" "), q))
    : byCat;
  const shown = filtered;

  function pick(id: string) {
    setCat(id);
    // scroll the directory into view so the result is visible after clicking a category card
    setTimeout(() => dirRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }

  return (
    <section ref={dirRef} style={{ padding: "6px 0 32px", scrollMarginTop: 80 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, gap: 12, flexWrap: "wrap" }}>
        <h2 style={{ fontSize: 21, fontWeight: 600, color: "#2f3438" }}>Curated Resource Directory</h2>
        {cat !== "all" && <button onClick={() => setCat("all")} style={{ fontSize: 12.5, fontWeight: 600, color: "#1aa0ab", background: "none", border: 0, cursor: "pointer", fontFamily: "inherit" }}>← Show all categories</button>}
      </div>
      <p style={{ color: "#8a9499", fontSize: 14, marginBottom: 18 }}>
        {cat === "all" ? `${resources.length}+ trusted platforms, tools, communities, and services for hardware creators.` : `${filtered.length} in ${TAXONOMY.find((t) => t.id === cat)?.name ?? cat}.`}
      </p>

      {/* Category filter cards (formerly the separate "Browse by category" section) */}
      <div className="cat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 13, marginBottom: 22 }}>
        {TAXONOMY.map((t) => {
          const active = cat === t.id;
          return (
            <button key={t.id} onClick={() => pick(t.id)}
              style={{
                background: active ? `${t.col}10` : "#fff",
                border: active ? `1.5px solid ${t.col}` : "1px solid #ececec",
                borderRadius: 11, padding: "16px 14px", textAlign: "center",
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                cursor: "pointer", fontFamily: "inherit",
              }}>
              <img src={`/cat/${t.id}.png`} alt={t.name} width={56} height={56} style={{ width: 56, height: 56, borderRadius: 12, display: "block", objectFit: "cover" }} />
              <h4 style={{ fontSize: 13, fontWeight: 600, color: "#2f3438", lineHeight: 1.25 }}>{t.name}</h4>
              <p style={{ fontSize: 11.5, color: "#8a9499" }}>{counts[t.id] || 0} resources</p>
            </button>
          );
        })}
      </div>

      <div className="dir-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 15 }}>
        {shown.map((r) => <Card key={r.id} r={r} />)}
      </div>
      {filtered.length === 0 && <p style={{ color: "#8a9499", fontSize: 14, textAlign: "center", padding: "30px 0" }}>No resources in this category yet.</p>}
    </section>
  );
}

