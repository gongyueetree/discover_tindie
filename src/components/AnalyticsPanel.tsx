"use client";
import { useMemo, useState } from "react";
import { TRACK_SECTIONS } from "@/lib/sections";

type Row = { day: string; section: string; kind: string; count: number };
type Gran = "day" | "week" | "month";
type Metric = "view" | "click";

// ---- date helpers (operate on 'YYYY-MM-DD', all UTC to match stored days) ----
const MS_DAY = 86400_000;
const toUTC = (s: string) => new Date(s + "T00:00:00Z");
const fmt = (d: Date) => d.toISOString().slice(0, 10);
function mondayOf(s: string): string {
  const d = toUTC(s);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return fmt(d);
}

type Bucket = { key: string; label: string };

// Ordered oldest -> newest list of buckets for the chosen granularity.
function buildBuckets(gran: Gran): Bucket[] {
  const now = new Date();
  const today = fmt(now);
  const out: Bucket[] = [];
  if (gran === "day") {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(toUTC(today).getTime() - i * MS_DAY);
      out.push({ key: fmt(d), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` });
    }
  } else if (gran === "week") {
    const thisMon = toUTC(mondayOf(today));
    for (let i = 11; i >= 0; i--) {
      const d = new Date(thisMon.getTime() - i * 7 * MS_DAY);
      out.push({ key: fmt(d), label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` });
    }
  } else {
    const y = now.getUTCFullYear(), m = now.getUTCMonth();
    const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - i, 1));
      out.push({ key: fmt(d).slice(0, 7), label: MON[d.getUTCMonth()] });
    }
  }
  return out;
}

function bucketKeyFor(day: string, gran: Gran): string {
  if (gran === "day") return day;
  if (gran === "week") return mondayOf(day);
  return day.slice(0, 7);
}

export function AnalyticsPanel({ rows }: { rows: Row[] }) {
  const [gran, setGran] = useState<Gran>("day");
  const [metric, setMetric] = useState<Metric>("view");

  const { buckets, series, totals, grandTotal, maxY } = useMemo(() => {
    const buckets = buildBuckets(gran);
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    // series[sectionId] = number[] aligned to buckets
    const series: Record<string, number[]> = {};
    const totals: Record<string, number> = {};
    for (const s of TRACK_SECTIONS) { series[s.id] = new Array(buckets.length).fill(0); totals[s.id] = 0; }
    for (const r of rows) {
      if (r.kind !== metric) continue;
      const k = bucketKeyFor(r.day, gran);
      const i = idx.get(k);
      if (i === undefined || !series[r.section]) continue;
      series[r.section][i] += r.count;
      totals[r.section] += r.count;
    }
    let maxY = 0;
    for (const s of TRACK_SECTIONS) for (const v of series[s.id]) if (v > maxY) maxY = v;
    const grandTotal = Object.values(totals).reduce((a, b) => a + b, 0);
    return { buckets, series, totals, grandTotal, maxY };
  }, [rows, gran, metric]);

  // Overall totals for the summary row (both metrics, over the visible range).
  const summary = useMemo(() => {
    const buckets = buildBuckets(gran);
    const keys = new Set(buckets.map((b) => b.key));
    let views = 0, clicks = 0;
    for (const r of rows) {
      if (!keys.has(bucketKeyFor(r.day, gran))) continue;
      if (r.kind === "view") views += r.count;
      else if (r.kind === "click") clicks += r.count;
    }
    const ctr = views > 0 ? (clicks / views) * 100 : 0;
    return { views, clicks, ctr };
  }, [rows, gran]);

  // ---- SVG geometry ----
  const W = 760, H = 280, padL = 40, padR = 16, padT = 16, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const n = buckets.length;
  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yMax = Math.max(4, Math.ceil(maxY / 4) * 4); // round up to a nice top
  const yAt = (v: number) => padT + plotH - (v / yMax) * plotH;
  const yTicks = [0, yMax / 4, yMax / 2, (yMax * 3) / 4, yMax];
  // Thin x labels so they don't overlap.
  const labelEvery = n > 16 ? Math.ceil(n / 8) : n > 8 ? 2 : 1;

  const hasData = grandTotal > 0;

  return (
    <div style={{ background: "#fff", border: "1px solid #e3e9eb", borderRadius: 8, padding: 18, marginBottom: 22 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 14 }}>
        <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".5px", color: "#1d5163" }}>Section traffic — views &amp; clicks</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Toggle options={[["view", "Views"], ["click", "Clicks"]]} value={metric} onChange={(v) => setMetric(v as Metric)} />
          <Toggle options={[["day", "Daily"], ["week", "Weekly"], ["month", "Monthly"]]} value={gran} onChange={(v) => setGran(v as Gran)} />
        </div>
      </div>

      {/* summary stats */}
      <div style={{ display: "flex", gap: 26, flexWrap: "wrap", marginBottom: 14 }}>
        <MiniStat k="Total views" v={summary.views.toLocaleString()} c="#22b8c4" />
        <MiniStat k="Total clicks" v={summary.clicks.toLocaleString()} c="#f2762e" />
        <MiniStat k="CTR" v={`${summary.ctr.toFixed(1)}%`} c="#7a5cff" />
      </div>

      {!hasData ? (
        <div style={{ padding: "34px 0", textAlign: "center", color: "#8a9499", fontSize: 13.5 }}>
          No {metric === "view" ? "view" : "click"} data in this range yet. Analytics accumulate from the day tracking went live — check back as traffic comes in.
        </div>
      ) : (
        <>
          <div style={{ width: "100%", overflowX: "auto" }}>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 520, display: "block" }} role="img" aria-label="Section traffic line chart">
              {/* y gridlines + labels */}
              {yTicks.map((t, i) => (
                <g key={i}>
                  <line x1={padL} y1={yAt(t)} x2={W - padR} y2={yAt(t)} stroke="#eef2f3" strokeWidth={1} />
                  <text x={padL - 6} y={yAt(t) + 3} textAnchor="end" fontSize={10} fill="#9aa4a8">{Math.round(t)}</text>
                </g>
              ))}
              {/* x labels */}
              {buckets.map((b, i) => (i % labelEvery === 0 || i === n - 1) ? (
                <text key={b.key} x={xAt(i)} y={H - padB + 16} textAnchor="middle" fontSize={10} fill="#9aa4a8">{b.label}</text>
              ) : null)}
              {/* one line per section */}
              {TRACK_SECTIONS.map((s) => {
                const pts = series[s.id].map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ");
                return (
                  <g key={s.id}>
                    <polyline points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
                    {series[s.id].map((v, i) => (
                      <circle key={i} cx={xAt(i)} cy={yAt(v)} r={2.6} fill={s.color}>
                        <title>{`${s.label} · ${buckets[i].label}: ${v}`}</title>
                      </circle>
                    ))}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* legend with per-section totals for the selected metric */}
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 8 }}>
            {TRACK_SECTIONS.map((s) => (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "#5a6b72" }}>
                <span style={{ width: 12, height: 3, borderRadius: 2, background: s.color, display: "inline-block" }} />
                {s.label}
                <b style={{ color: "#2f3438" }}>{totals[s.id].toLocaleString()}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Toggle({ options, value, onChange }: { options: [string, string][]; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid #e3e9eb", borderRadius: 8, overflow: "hidden" }}>
      {options.map(([k, label]) => (
        <button key={k} onClick={() => onChange(k)} style={{
          fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, padding: "6px 12px", border: 0, cursor: "pointer",
          background: value === k ? "#1c6e7e" : "#fff", color: value === k ? "#fff" : "#5a6b72",
        }}>{label}</button>
      ))}
    </div>
  );
}

function MiniStat({ k, v, c }: { k: string; v: string; c: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "#8a9499", display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />{k}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#2f3438", marginTop: 3 }}>{v}</div>
    </div>
  );
}

