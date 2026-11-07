"use client";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * Admin → Discover traffic: views and unique visitors of the four Discover tabs over time, and what
 * people searched for (lib/maker-analytics.ts). Colours: the validated categorical order (slots 1–4);
 * two of them are below 3:1 on white, so every line is labelled at its end and a table view exists.
 */
type PageId = "resources" | "components" | "open-hardware" | "pcb-planner";
type Data = {
  days: number;
  daily: { day: string; page: PageId; views: number; visitors: number }[];
  totals: { page: PageId; views: number; visitors: number }[];
  terms: { scope: string; term: string; count: number; empty: number }[];
};
const PAGES: { id: PageId; label: string; color: string }[] = [
  { id: "resources", label: "Resources", color: "#2a78d6" },
  { id: "components", label: "Components", color: "#eb6834" },
  { id: "open-hardware", label: "Open hardware", color: "#1baf7a" },
  { id: "pcb-planner", label: "PCB planner", color: "#eda100" },
];
const SCOPES: [string, string][] = [
  ["components", "Components search"],
  ["open-hardware", "Open hardware search"],
  ["pcb-planner", "PCB planner parts"],
  ["github-import", "Imported from GitHub"],
  ["open:design", "Designs opened"],
  ["open:part", "Parts opened"],
];
const INK = "#2f3438", INK2 = "#5a6b72", MUTED = "#8a9499", LINE = "#e3e9eb", GRID = "#eef2f3";
const fmt = (n: number) => n.toLocaleString("en-US");

function daysBack(n: number) {
  const out: string[] = [];
  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  for (let i = n - 1; i >= 0; i--) out.push(new Date(today - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export function MakerTrafficPanel() {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState<"views" | "visitors">("views");
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [scope, setScope] = useState("components");
  const [table, setTable] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    setError("");
    fetch(`/api/admin/maker-traffic?days=${days}`, { signal: ac.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || `HTTP ${r.status}`);
        setData(d);
      })
      .catch((e) => !ac.signal.aborted && setError(e.message));
    return () => ac.abort();
  }, [days]);

  const view = useMemo(() => {
    const keys = daysBack(days);
    const idx = new Map(keys.map((k, i) => [k, i]));
    const series = Object.fromEntries(PAGES.map((p) => [p.id, new Array(keys.length).fill(0) as number[]])) as Record<PageId, number[]>;
    for (const r of data?.daily || []) {
      const i = idx.get(r.day);
      if (i !== undefined && series[r.page]) series[r.page][i] = Number(r[metric]) || 0;
    }
    const totals = Object.fromEntries(PAGES.map((p) => [p.id, { views: 0, visitors: 0 }])) as Record<PageId, { views: number; visitors: number }>;
    for (const t of data?.totals || []) if (totals[t.page]) totals[t.page] = { views: Number(t.views) || 0, visitors: Number(t.visitors) || 0 };
    return { keys, series, totals };
  }, [data, days, metric]);

  const all = PAGES.reduce((a, p) => ({ views: a.views + view.totals[p.id].views, visitors: a.visitors + view.totals[p.id].visitors }), { views: 0, visitors: 0 });
  const terms = (data?.terms || []).filter((t) => t.scope === scope);
  const emptyTerms = (data?.terms || []).filter((t) => t.empty > 0 && !t.scope.startsWith("open:")).sort((a, b) => b.empty - a.empty).slice(0, 15);

  return (
    <div style={{ background: "#fff", border: `1px solid ${LINE}`, borderRadius: 8, padding: 18, marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".5px", color: "#1d5163" }}>Discover traffic — tabs &amp; searches</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Toggle options={[["views", "Page views"], ["visitors", "Unique visitors"]]} value={metric} onChange={(v) => setMetric(v as "views" | "visitors")} />
          <Toggle options={[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"]]} value={String(days)} onChange={(v) => setDays(Number(v))} />
        </div>
      </div>

      {error && <p style={{ color: "#b3412e", fontSize: 13 }}>Traffic data unavailable: {error}</p>}
      {!data && !error && <p style={{ color: MUTED, fontSize: 13 }}>Loading…</p>}

      {data && (
        <>
          {/* stat tiles: all tabs, then each tab */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginBottom: 16 }}>
            <Tile label="All tabs" views={all.views} visitors={all.visitors} />
            {PAGES.map((p) => (
              <Tile key={p.id} label={p.label} color={p.color} views={view.totals[p.id].views} visitors={view.totals[p.id].visitors} />
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: MUTED, margin: "-6px 0 12px" }}>
            Unique visitors are counted per day and tab (an anonymous daily ID), so a range total adds up each day&apos;s visitors.
          </p>

          {all.views === 0 ? (
            <div style={{ padding: "30px 0", textAlign: "center", color: MUTED, fontSize: 13.5 }}>
              No visits in this range yet. Counting started when this dashboard went live.
            </div>
          ) : (
            <>
              <LineChart keys={view.keys} series={view.series} metric={metric} />
              <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
                {PAGES.map((p) => (
                  <span key={p.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: INK2 }}>
                    <span style={{ width: 14, height: 2, borderRadius: 2, background: p.color, display: "inline-block" }} />
                    {p.label}
                  </span>
                ))}
                <button onClick={() => setTable(!table)} style={{ marginLeft: "auto", fontSize: 12, color: "#1c6e7e", background: "none", border: 0, cursor: "pointer", textDecoration: "underline" }}>
                  {table ? "Hide table" : "Show as table"}
                </button>
              </div>
              {table && <DailyTable keys={view.keys} series={view.series} />}
            </>
          )}

          {/* search terms */}
          <h4 style={{ fontSize: 12.5, color: INK, margin: "24px 0 8px" }}>What people searched and opened</h4>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {SCOPES.map(([k, label]) => (
              <button key={k} onClick={() => setScope(k)} style={{
                fontSize: 12, padding: "5px 10px", borderRadius: 14, cursor: "pointer", fontFamily: "inherit",
                border: `1px solid ${scope === k ? "#1c6e7e" : LINE}`, background: scope === k ? "#1c6e7e" : "#fff", color: scope === k ? "#fff" : INK2,
              }}>{label}</button>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 16 }}>
            <TermTable rows={terms} showEmpty={!scope.startsWith("open:")} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: INK, marginBottom: 6 }}>Searches that found nothing</div>
              {emptyTerms.length ? (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                  <tbody>
                    {emptyTerms.map((t) => (
                      <tr key={t.scope + t.term} style={{ borderBottom: `1px solid ${GRID}` }}>
                        <td style={{ padding: "5px 4px", color: INK, overflowWrap: "anywhere" }}>{t.term}<div style={{ fontSize: 11, color: MUTED }}>{SCOPES.find(([k]) => k === t.scope)?.[1]}</div></td>
                        <td style={{ padding: "5px 4px", textAlign: "right", color: INK, fontVariantNumeric: "tabular-nums" }}>{fmt(t.empty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p style={{ fontSize: 12.5, color: MUTED }}>None in this range.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LineChart({ keys, series, metric }: { keys: string[]; series: Record<PageId, number[]>; metric: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const W = 840, H = 280, padL = 44, padR = 150, padT = 14, padB = 28;
  const plotW = W - padL - padR, plotH = H - padT - padB, n = keys.length;
  const max = Math.max(4, ...PAGES.flatMap((p) => series[p.id]));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / top) * plotH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const every = Math.max(1, Math.ceil(n / 8));
  const label = (k: string) => `${Number(k.slice(5, 7))}/${Number(k.slice(8))}`;
  // End labels, nudged apart so they never overlap (12px minimum gap).
  const ends = PAGES.map((p) => ({ p, v: series[p.id][n - 1], y: y(series[p.id][n - 1]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 12) ends[i].y = ends[i - 1].y + 12;
  const move = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - padL) / plotW) * (n - 1)))));
  };
  return (
    <div style={{ position: "relative", width: "100%", overflowX: "auto" }}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 560, display: "block" }} role="img"
        aria-label={`Daily ${metric} per Discover tab`} onPointerMove={move} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={padL + plotW} y1={y(t)} y2={y(t)} stroke={GRID} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill={MUTED}>{fmt(t)}</text>
          </g>
        ))}
        {keys.map((k, i) => (i % every === 0 || i === n - 1 ? (
          <text key={k} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill={MUTED}>{label(k)}</text>
        ) : null))}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + plotH} stroke="#b8c3c7" strokeDasharray="3 3" />}
        {PAGES.map((p) => (
          <polyline key={p.id} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            points={series[p.id].map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
        ))}
        {hover !== null && PAGES.map((p) => (
          <circle key={p.id} cx={x(hover)} cy={y(series[p.id][hover])} r={4} fill={p.color} stroke="#fff" strokeWidth={2} />
        ))}
        {ends.map(({ p, v, y: ly }) => (
          <text key={p.id} x={padL + plotW + 8} y={ly + 3} fontSize={10.5} fill={INK2}>
            <tspan fill={p.color}>●</tspan> {p.label} {fmt(v)}
          </text>
        ))}
      </svg>
      {hover !== null && (
        <div style={{
          position: "absolute", top: 8, left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
          background: "#fff", border: `1px solid ${LINE}`, borderRadius: 6, padding: "8px 10px", fontSize: 12, color: INK, boxShadow: "0 2px 8px rgba(0,0,0,.08)", pointerEvents: "none", whiteSpace: "nowrap",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{keys[hover]}</div>
          {PAGES.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ width: 10, height: 2, background: p.color, display: "inline-block" }} />
              <span style={{ color: INK2 }}>{p.label}</span>
              <b style={{ marginLeft: "auto", paddingLeft: 12, fontVariantNumeric: "tabular-nums" }}>{fmt(series[p.id][hover])}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function niceStep(raw: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(raw, 1))));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function DailyTable({ keys, series }: { keys: string[]; series: Record<PageId, number[]> }) {
  return (
    <div style={{ maxHeight: 260, overflow: "auto", marginTop: 10, border: `1px solid ${GRID}` }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#f6f8f8", position: "sticky", top: 0 }}>
            <th style={th}>Day</th>
            {PAGES.map((p) => <th key={p.id} style={{ ...th, textAlign: "right" }}>{p.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...keys].reverse().map((k) => {
            const i = keys.indexOf(k);
            return (
              <tr key={k} style={{ borderTop: `1px solid ${GRID}` }}>
                <td style={td}>{k}</td>
                {PAGES.map((p) => <td key={p.id} style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(series[p.id][i])}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TermTable({ rows, showEmpty }: { rows: { term: string; count: number; empty: number }[]; showEmpty: boolean }) {
  if (!rows.length) return <p style={{ fontSize: 12.5, color: MUTED }}>Nothing recorded in this range.</p>;
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
      <thead>
        <tr><th style={th}>#</th><th style={th}>Term</th><th style={{ ...th, textAlign: "right" }}>Count</th>{showEmpty && <th style={{ ...th, textAlign: "right" }}>No results</th>}</tr>
      </thead>
      <tbody>
        {rows.slice(0, 30).map((r, i) => (
          <tr key={r.term} style={{ borderTop: `1px solid ${GRID}` }}>
            <td style={{ ...td, color: MUTED, width: 28 }}>{i + 1}</td>
            <td style={{ ...td, overflowWrap: "anywhere" }}>
              {r.term}
              <div style={{ height: 3, marginTop: 3, borderRadius: 2, background: "#cfe3e7", width: `${Math.max(4, (r.count / max) * 100)}%` }} />
            </td>
            <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(r.count)}</td>
            {showEmpty && <td style={{ ...td, textAlign: "right", color: r.empty ? INK : MUTED, fontVariantNumeric: "tabular-nums" }}>{r.empty ? fmt(r.empty) : "—"}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const th: React.CSSProperties = { textAlign: "left", padding: "6px 6px", fontSize: 11.5, color: MUTED, fontWeight: 600 };
const td: React.CSSProperties = { padding: "5px 6px", color: INK };

function Tile({ label, color, views, visitors }: { label: string; color?: string; views: number; visitors: number }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 11.5, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
        {color && <span style={{ width: 10, height: 2, background: color, display: "inline-block" }} />}{label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: INK, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>{fmt(views)}</div>
      <div style={{ fontSize: 11.5, color: INK2 }}>{fmt(visitors)} {visitors === 1 ? "visitor" : "visitors"}</div>
    </div>
  );
}

function Toggle({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "inline-flex", border: `1px solid ${LINE}`, borderRadius: 8, overflow: "hidden" }}>
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} style={{
          fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, padding: "6px 12px", border: 0, cursor: "pointer",
          background: value === k ? "#1c6e7e" : "#fff", color: value === k ? "#fff" : INK2,
        }}>{label}</button>
      ))}
    </div>
  );
}
