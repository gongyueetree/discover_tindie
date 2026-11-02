"use client";
import { useMemo, useState } from "react";
import { taxName, taxCol } from "@/lib/taxonomy";
import { buildBuckets, bucketKeyFor, type Gran } from "@/lib/time-buckets";

type DayReads = { day: string; articles: number; reads: number };
type ArticleReads = { id: number; title: string; publishDate: string | null; views: number };
type ResourceClicks = { id: number; name: string; url: string | null; category: string; clicks: number };
type DailyReads = { day: string; reads: number };

const card: React.CSSProperties = { background: "#fff", border: "1px solid #e3e9eb", borderRadius: 8, padding: 18, marginBottom: 22 };
const h3: React.CSSProperties = { fontSize: 13, textTransform: "uppercase", letterSpacing: ".5px", color: "#1d5163", marginBottom: 14 };
const th: React.CSSProperties = { textAlign: "left", fontSize: 11, textTransform: "uppercase", letterSpacing: ".4px", color: "#8a9499", fontWeight: 600, padding: "8px 10px", borderBottom: "1px solid #eef2f3", position: "sticky", top: 0, background: "#fff" };
const td: React.CSSProperties = { fontSize: 13, color: "#3a4a4f", padding: "8px 10px", borderBottom: "1px solid #f4f7f7" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", fontWeight: 600, color: "#2f3438" };

export function ContentStatsPanel({ readsByDay, articles, resources, dailyReads }:
  { readsByDay: DayReads[]; articles: ArticleReads[]; resources: ResourceClicks[]; dailyReads?: DailyReads[] }) {
  return (
    <>
      <ReadsTrend rows={dailyReads || []} />
      <ReadsByDay rows={readsByDay} />
      <ArticleTable rows={articles} />
      <ResourceTable rows={resources} />
    </>
  );
}

/* ---------- 0. article reads over calendar time (event-time curve) ---------- */
function ReadsTrend({ rows }: { rows: DailyReads[] }) {
  const [gran, setGran] = useState<Gran>("day");

  const { buckets, values, total, maxY } = useMemo(() => {
    const buckets = buildBuckets(gran);
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    const values = new Array(buckets.length).fill(0) as number[];
    let total = 0;
    for (const r of rows) {
      const i = idx.get(bucketKeyFor(r.day, gran));
      if (i === undefined) continue;
      values[i] += r.reads; total += r.reads;
    }
    const maxY = Math.max(1, ...values);
    return { buckets, values, total, maxY };
  }, [rows, gran]);

  const W = 760, H = 220, padL = 36, padR = 12, padT = 14, padB = 24;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = buckets.length;
  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yMax = Math.max(4, Math.ceil(maxY / 4) * 4);
  const yAt = (v: number) => padT + plotH - (v / yMax) * plotH;
  const labelEvery = n > 16 ? Math.ceil(n / 8) : n > 8 ? 2 : 1;
  const linePts = values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
  const areaPts = `${padL},${yAt(0)} ${linePts} ${xAt(n - 1)},${yAt(0)}`;

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <h3 style={{ ...h3, marginBottom: 0 }}>Article reads over time</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 12.5, color: "#8a9499" }}>In range: <b style={{ color: "#2f3438" }}>{total.toLocaleString()}</b></span>
          <div style={{ display: "inline-flex", border: "1px solid #e3e9eb", borderRadius: 8, overflow: "hidden" }}>
            {([["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]] as [Gran, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setGran(k)} style={{
                fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, padding: "6px 12px", border: 0, cursor: "pointer",
                background: gran === k ? "#1c6e7e" : "#fff", color: gran === k ? "#fff" : "#5a6b72",
              }}>{label}</button>
            ))}
          </div>
        </div>
      </div>
      {total === 0 ? (
        <Empty msg="No reads recorded yet — this curve fills in day by day as visitors open articles." />
      ) : (
        <div style={{ width: "100%", overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520, display: "block" }} role="img" aria-label="Article reads over time">
            {[0, 0.5, 1].map((f, i) => (
              <g key={i}>
                <line x1={padL} y1={yAt(yMax * f)} x2={W - padR} y2={yAt(yMax * f)} stroke="#eef2f3" />
                <text x={padL - 5} y={yAt(yMax * f) + 3} textAnchor="end" fontSize={10} fill="#9aa4a8">{Math.round(yMax * f)}</text>
              </g>
            ))}
            <polygon points={areaPts} fill="#22b8c4" opacity={0.08} />
            <polyline points={linePts} fill="none" stroke="#22b8c4" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {values.map((v, i) => (
              <circle key={i} cx={xAt(i)} cy={yAt(v)} r={2.6} fill="#22b8c4"><title>{`${buckets[i].label}: ${v} reads`}</title></circle>
            ))}
            {buckets.map((b, i) => (i % labelEvery === 0 || i === n - 1) ? (
              <text key={b.key} x={xAt(i)} y={H - padB + 15} textAnchor="middle" fontSize={10} fill="#9aa4a8">{b.label}</text>
            ) : null)}
          </svg>
        </div>
      )}
    </div>
  );
}

/* ---------- 1. total reads by publish date ---------- */
function ReadsByDay({ rows }: { rows: DayReads[] }) {
  // rows come newest-first; chart the most recent 30 days oldest->newest.
  const recent = useMemo(() => [...rows].slice(0, 30).reverse(), [rows]);
  const totalReads = rows.reduce((a, r) => a + r.reads, 0);
  const maxReads = Math.max(1, ...recent.map((r) => r.reads));

  const W = 760, H = 180, padL = 34, padR = 10, padT = 10, padB = 22;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = recent.length;
  const bw = n > 0 ? Math.min(22, (plotW / n) * 0.7) : 0;
  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => padT + plotH - (v / maxReads) * plotH;

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <h3 style={h3}>Reads by publish date</h3>
        <div style={{ fontSize: 12.5, color: "#8a9499" }}>Total reads all-time: <b style={{ color: "#2f3438" }}>{totalReads.toLocaleString()}</b></div>
      </div>
      {totalReads === 0 ? (
        <Empty msg="No reads yet — counts start from launch and grow as visitors open articles." />
      ) : (
        <div style={{ width: "100%", overflowX: "auto" }}>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520, display: "block" }} role="img" aria-label="Reads by publish date">
            {[0, 0.5, 1].map((f, i) => (
              <g key={i}>
                <line x1={padL} y1={yAt(maxReads * f)} x2={W - padR} y2={yAt(maxReads * f)} stroke="#eef2f3" />
                <text x={padL - 5} y={yAt(maxReads * f) + 3} textAnchor="end" fontSize={10} fill="#9aa4a8">{Math.round(maxReads * f)}</text>
              </g>
            ))}
            {recent.map((r, i) => {
              const label = r.day.slice(5); // MM-DD
              return (
                <g key={r.day}>
                  <rect x={xAt(i) - bw / 2} y={yAt(r.reads)} width={bw} height={padT + plotH - yAt(r.reads)} rx={2} fill="#22b8c4">
                    <title>{`${r.day}: ${r.reads} reads · ${r.articles} articles`}</title>
                  </rect>
                  {(i % Math.ceil(n / 10 || 1) === 0 || i === n - 1) && (
                    <text x={xAt(i)} y={H - padB + 14} textAnchor="middle" fontSize={9.5} fill="#9aa4a8">{label}</text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
      {/* full breakdown table */}
      <div style={{ maxHeight: 240, overflowY: "auto", marginTop: 12, border: "1px solid #eef2f3", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={th}>Publish date</th><th style={{ ...th, textAlign: "right" }}>Articles</th><th style={{ ...th, textAlign: "right" }}>Total reads</th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td style={td} colSpan={3}>No published editions yet.</td></tr> :
              rows.map((r) => (
                <tr key={r.day}><td style={td}>{r.day}</td><td style={num}>{r.articles}</td><td style={num}>{r.reads.toLocaleString()}</td></tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ---------- 2. per-article reads ---------- */
function ArticleTable({ rows }: { rows: ArticleReads[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => r.title.toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  const CAP = 200;
  const shown = filtered.slice(0, CAP);

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <h3 style={{ ...h3, marginBottom: 0 }}>Article reads · {rows.length.toLocaleString()} published</h3>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title…"
          style={{ fontSize: 13, padding: "7px 11px", border: "1px solid #e3e9eb", borderRadius: 7, outline: "none", minWidth: 200, fontFamily: "inherit" }} />
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid #eef2f3", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ ...th, width: 34, textAlign: "right" }}>#</th><th style={th}>Title</th><th style={th}>Published</th><th style={{ ...th, textAlign: "right" }}>Reads</th></tr></thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={r.id}>
                <td style={{ ...td, textAlign: "right", color: "#9aa4a8" }}>{i + 1}</td>
                <td style={td}>{r.title}</td>
                <td style={{ ...td, color: "#8a9499", whiteSpace: "nowrap" }}>{r.publishDate || "—"}</td>
                <td style={num}>{r.views.toLocaleString()}</td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td style={td} colSpan={4}>No articles match “{q}”.</td></tr>}
          </tbody>
        </table>
      </div>
      {filtered.length > CAP && (
        <div style={{ fontSize: 12, color: "#8a9499", marginTop: 8 }}>Showing top {CAP} of {filtered.length.toLocaleString()} by reads — refine with search to find a specific article.</div>
      )}
    </div>
  );
}

/* ---------- 3. per-resource clicks (the 39 links) ---------- */
function ResourceTable({ rows }: { rows: ResourceClicks[] }) {
  const total = rows.reduce((a, r) => a + r.clicks, 0);
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <h3 style={h3}>Resource link clicks · {rows.length} links</h3>
        <div style={{ fontSize: 12.5, color: "#8a9499" }}>Total clicks: <b style={{ color: "#2f3438" }}>{total.toLocaleString()}</b></div>
      </div>
      <div style={{ maxHeight: 420, overflowY: "auto", border: "1px solid #eef2f3", borderRadius: 6 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ ...th, width: 34, textAlign: "right" }}>#</th><th style={th}>Resource</th><th style={th}>Category</th><th style={{ ...th, textAlign: "right" }}>Clicks</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id}>
                <td style={{ ...td, textAlign: "right", color: "#9aa4a8" }}>{i + 1}</td>
                <td style={td}>{r.url ? <a href={r.url} target="_blank" rel="noreferrer" style={{ color: "#1c8693", fontWeight: 600, textDecoration: "none" }}>{r.name}</a> : r.name}</td>
                <td style={td}><span style={{ fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: 5, background: `${taxCol(r.category)}18`, color: taxCol(r.category) }}>{taxName(r.category)}</span></td>
                <td style={num}>{r.clicks.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div style={{ padding: "28px 0", textAlign: "center", color: "#8a9499", fontSize: 13.5 }}>{msg}</div>;
}

