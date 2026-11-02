"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { RELATED_PRODUCTS } from "@/lib/taxonomy";
import { useHomeSearch, matchText } from "@/components/HomeSearch";
import { safeLinkHref } from "@/lib/safe-url";
import { trackItem } from "@/lib/track-client";

export type Discovery = {
  id: number; title: string; summary: string; why: string; category: string;
  sourceName: string; sourceUrl?: string | null; icon: string | null; chips: string[]; license: string | null;
  availability: string | null; relatedTags: string[]; isSponsored: boolean | null;
  relatedProducts?: { name: string; seller?: string; price?: string; url?: string }[] | null;
  isPick: boolean | null; saveCount: number | null; commentCount: number | null;
};

export function DiscoveryGrid({ items }: { items: Discovery[] }) {
  const { q } = useHomeSearch();
  const [detail, setDetail] = useState<Discovery | null>(null);

  let shown = items;
  if (q.trim()) {
    shown = items.filter((d) =>
      matchText([d.title, d.summary, d.why, (d.chips || []).join(" "), d.sourceName].join(" "), q)
    );
  }

  return (
    <>
      <div className="disc-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 16 }}>
        {shown.map((d) => <DiscoveryCard key={d.id} d={d} onOpen={() => { setDetail(d); trackItem("discovery", d.id); }} />)}
        {shown.length === 0 && <div style={{ gridColumn: "1/-1", color: "#8a9499", padding: 30, textAlign: "center", border: "1px dashed #ececec", borderRadius: 10 }}>No discoveries match your search.</div>}
      </div>
      {detail && <DetailDrawer d={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function DiscoveryCard({ d, onOpen }: { d: Discovery; onOpen: () => void }) {
  const tags = (d.chips || []).slice(0, 4);
  return (
    <div onClick={onOpen} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }} style={{ background: "#fff", border: "1px solid #ececec", borderRadius: 10, display: "flex", flexDirection: "column", cursor: "pointer" }}>
      <div style={{ padding: "15px 16px", display: "flex", flexDirection: "column", flex: 1 }}>
        {(d.isSponsored || d.isPick) && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
            {d.isSponsored ? <span style={{ fontSize: 10, fontWeight: 600, background: "#fbf2dc", color: "#9a6b08", padding: "2px 7px", borderRadius: 4 }}>Sponsored</span>
              : <span style={{ fontSize: 10, fontWeight: 600, background: "#fdebdf", color: "#c25a14", padding: "2px 7px", borderRadius: 4 }}>★ Tindie Pick</span>}
          </div>
        )}
        <h4 style={{ fontSize: 15.5, margin: "0 0 6px", color: "#2f3438", lineHeight: 1.3 }}>{d.title}</h4>
        <div style={{ fontSize: 11.5, color: "#8a9499", marginBottom: 9 }}><b style={{ color: "#5a6b72" }}>{d.sourceName}</b></div>
        <div style={{ fontSize: 13, color: "#6b7479", flex: 1, lineHeight: 1.5 }}>{flatten(d.summary)}</div>
        <div style={{ fontSize: 12, color: "#1c6e7e", background: "#eef7f8", borderRadius: 7, padding: "8px 10px", marginTop: 11 }}><b>Insights:</b> {flatten(d.why)}</div>
        {tags.length > 0 && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 11 }}>
            {tags.map((t) => <span key={t} style={{ fontSize: 11, background: "#f0f5f6", color: "#1c6e7e", padding: "3px 9px", borderRadius: 5 }}>{t}</span>)}
          </div>
        )}
      </div>
    </div>
  );
}

function DetailDrawer({ d, onClose }: { d: Discovery; onClose: () => void }) {
  // While the detail drawer is open, hide the fixed bottom tab bar so it
  // doesn't cover the drawer's content. BottomTabBar listens for this event.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("tindie:drawer", { detail: { open: true } }));
    // Lock the background page scroll so only the drawer scrolls (fixes the
    // double-scrollbar where the page scrolled behind the drawer). To avoid
    // the page shifting when the scrollbar disappears, pad the body by the
    // scrollbar's width.
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPadding = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;
    // Close on Escape for convenience.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.dispatchEvent(new CustomEvent("tindie:drawer", { detail: { open: false } }));
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPadding;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const rawProducts: any = (d as any).relatedProducts;
  const productList: { name: string; seller?: string; price?: string; url?: string }[] =
    Array.isArray(rawProducts) ? rawProducts
    : (typeof rawProducts === "string" && rawProducts.trim().startsWith("["))
      ? (() => { try { return JSON.parse(rawProducts); } catch { return []; } })()
      : [];
  const manual = productList.map((p) => ({ t: p.name, s: p.seller || "", p: p.price || "", ic: "🛒", url: p.url || "" }));
  const fallback = (d.relatedTags || []).flatMap((k) => RELATED_PRODUCTS[k] || []).map((r: any) => ({ ...r, url: "" }));
  const rel = manual.length > 0 ? manual : fallback;

  // Image slot: show only if the pipeline captured an image for this discovery.
  const imageUrl: string | null = (d as any).imageUrl || (d as any).image || null;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 30 }} />
      <div style={{ position: "fixed", top: 0, right: 0, width: "min(520px, 100vw)", height: "100vh", background: "#fff", zIndex: 31, overflowY: "auto", WebkitOverflowScrolling: "touch", boxShadow: "-8px 0 30px rgba(0,0,0,.12)" }}>
        <div style={{ padding: "28px 20px 20px" }}>
          {(d.isSponsored || d.isPick) && <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", color: "#22b8c4", fontWeight: 600 }}>{d.isSponsored ? "Sponsored" : "Tindie Pick"}</div>}
          <div style={{ fontSize: 22, fontWeight: 600, color: "#2f3438", margin: "6px 0 4px" }}>{d.title}</div>
          <div style={{ fontSize: 12.5, color: "#8a9499", marginBottom: 16 }}><b>{d.sourceName}</b> · curated</div>
          {imageUrl && (
            <img src={imageUrl} alt={d.title} style={{ width: "100%", borderRadius: 10, marginBottom: 18, display: "block", objectFit: "cover", maxHeight: 280 }} />
          )}
          <Block h="What it is"><Bullets text={d.summary} /></Block>
          <div style={{ background: "#eef7f8", borderRadius: 9, padding: "13px 15px", marginBottom: 18 }}><h3 style={h3()}>Insights</h3><Bullets text={d.why} fontSize={14} /></div>
          {safeLinkHref(d.sourceUrl) && (
            <a href={safeLinkHref(d.sourceUrl)!} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5, fontWeight: 600, color: "#fff", background: "#22b8c4", borderRadius: 8, padding: "9px 16px", textDecoration: "none", marginBottom: 18 }}>Read original on {d.sourceName} ↗</a>
          )}
          {(() => {
            const lic = (d.license || "").trim();
            const avail = (d.availability || "").trim();
            if (!lic && !avail) return null;
            const parts = [lic && `License: ${lic}`, avail && `Availability: ${avail}`].filter(Boolean);
            return <Block h="At a glance"><p style={{ fontSize: 13, color: "#8a9499" }}>{parts.join(" · ")}</p></Block>;
          })()}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>{(d.chips || []).map((c) => <Link key={c} href={`/tag/${encodeURIComponent(c)}`} style={{ fontSize: 11, background: "#e9f5f6", color: "#1c6e7e", padding: "3px 9px", borderRadius: 5, textDecoration: "none", cursor: "pointer" }}>{c}</Link>)}</div>
          {rel.length > 0 && (
            <div style={{ border: "1px solid #ececec", borderRadius: 10, padding: 14, background: "#fafcfc", marginBottom: 20 }}>
              <h3 style={h3()}>Related products on Tindie</h3>
              <div style={{ fontSize: 11.5, color: "#8a9499", marginBottom: 10 }}>Turn this discovery into a sale — modules and tools makers already sell.</div>
              {rel.map((r) => {
                const inner = (
                  <>
                    <div style={{ width: 46, height: 46, borderRadius: 8, background: "#eef2f3", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>{r.ic}</div>
                    <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: "#2f3438" }}>{r.t}</div><div style={{ fontSize: 11.5, color: "#8a9499" }}>{r.s}{r.p ? <> · <span style={{ fontWeight: 700, color: "#f2762e" }}>{r.p}</span></> : null}</div></div>
                    {r.url ? <span style={{ fontSize: 11, color: "#22b8c4", alignSelf: "center" }}>Visit ↗</span> : null}
                  </>
                );
                const rHref = safeLinkHref(r.url);
                return rHref
                  ? <a key={r.t} href={rHref} target="_blank" rel="noreferrer" style={{ display: "flex", gap: 11, padding: "9px 0", borderTop: "1px solid #ececec", textDecoration: "none" }}>{inner}</a>
                  : <div key={r.t} style={{ display: "flex", gap: 11, padding: "9px 0", borderTop: "1px solid #ececec" }}>{inner}</div>;
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Block({ h, children }: { h: string; children: React.ReactNode }) {
  return <div style={{ marginBottom: 18 }}><h3 style={h3()}>{h}</h3>{children}</div>;
}
function flatten(text?: string | null, max = 180): string {
  let s = (text || "").trim();
  if (!s) return "";
  s = s.replace(/^\s*[-•]\s*/gm, "").replace(/\n+/g, " · ").replace(/\s{2,}/g, " ").trim();
  if (s.length > max) s = s.slice(0, max).replace(/[\s·]+\S*$/, "") + "…";
  return s;
}

function Bullets({ text, fontSize = 14.5 }: { text?: string | null; fontSize?: number }) {
  const raw = (text || "").trim();
  if (!raw) return null;
  let parts: string[] = [];
  if (/[•\n]|(?:^|\s)[-]\s/.test(raw)) {
    parts = raw
      .split(/\n+|(?:\s•\s)/)
      .flatMap((seg) => seg.split(/(?:^|\s)[-]\s+/))
      .map((s) => s.replace(/^\s*[-•]\s*/, "").trim())
      .filter(Boolean);
  } else {
    const sentences = raw.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length >= 2) parts = sentences.map((s) => s.trim());
  }
  if (parts.length <= 1) return <p style={{ fontSize, color: "#4a5358", lineHeight: 1.6 }}>{parts[0] || raw.replace(/^\s*[-•]\s*/, "")}</p>;
  return (
    <ul style={{ margin: 0, paddingLeft: 22, listStyleType: "disc", listStylePosition: "outside" }}>
      {parts.map((p, i) => <li key={i} style={{ fontSize, color: "#4a5358", lineHeight: 1.55, marginBottom: 6, display: "list-item" }}>{p}</li>)}
    </ul>
  );
}
const h3 = () => ({ fontSize: 13, textTransform: "uppercase" as const, letterSpacing: ".4px", color: "#1c6e7e", marginBottom: 6 });

