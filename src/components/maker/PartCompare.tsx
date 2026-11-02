"use client";
/**
 * Side-by-side comparison of a part with up to three similar parts, laid out like eelib's
 * alternates (AlternateCard + ScoreBars + VerdictBlock) and ParamCompareTable.
 * Scores come from src/lib/maker/compare.ts via /api/maker/compare.
 */
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, ShieldQuestion, X } from "lucide-react";
import { CODE_LABEL, type Code, type Comparison, type Grade, type Verdict } from "@/lib/maker/compare";

const GRADE: Record<Grade, string> = {
  A: "Drop-in replacement",
  B: "Minor changes needed",
  C: "Schematic or PCB changes",
  D: "Redesign required",
};
const STATUS: Record<string, string> = { NEEDS_VERIFICATION: "Needs verification", NOT_RECOMMENDED: "Not recommended" };
const REASON: Record<string, string> = {
  INSUFFICIENT_EVIDENCE: "Too few parameters are published to judge this candidate.",
  LOW_CONFIDENCE: "The evidence does not support recommending this.",
  CRITICAL_IDENTITY_MISMATCH: "A defining characteristic differs (core, package, channels…), so this is not the same kind of part.",
};
const BARS: { key: keyof Verdict["scores"]; label: string; tip: string }[] = [
  { key: "technical", label: "Technical", tip: "Weighted average over parameters we could compare." },
  { key: "evidenceCoverage", label: "Evidence coverage", tip: "Share of weighted parameters that are actually published." },
  { key: "sourceCredibility", label: "Source credibility", tip: "Where the data came from, and whether anyone verified it." },
  {
    key: "confidence",
    label: "Confidence",
    tip: "Technical score discounted by coverage and source credibility. Kept separate from the technical score so a thin match cannot look like a strong one.",
  },
];
const GOOD: Code[] = ["IDENTICAL", "BETTER_THAN_ORIGINAL", "RANGE_FULLY_COVERED", "COMPATIBLE_FAMILY", "WORSE_WITHIN_TOLERANCE"];
const BAD: Code[] = ["WORSE_SIGNIFICANTLY", "WORSE_UNACCEPTABLE", "RANGE_INSUFFICIENT", "INCOMPATIBLE", "RANGE_PARTIAL"];
const tone = (c?: Code) => (!c ? "" : GOOD.includes(c) ? "good" : BAD.includes(c) ? "bad" : c === "UNKNOWN_VALUE" || c === "NOT_COMPARABLE" ? "muted" : "warn");

export default function PartCompare({
  reference,
  candidates = [],
  family = "",
  onClose,
}: {
  reference: string;
  candidates?: string[];
  family?: string;
  onClose?: () => void;
}) {
  const [data, setData] = useState<(Comparison & { unresolved: string[] }) | null>(null);
  const [error, setError] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);
  const query = new URLSearchParams({ ref: reference, ...(candidates.length ? { with: candidates.slice(0, 3).join(",") } : {}), ...(family ? { family } : {}) }).toString();
  useEffect(() => {
    const ac = new AbortController();
    setData(null);
    setError("");
    fetch("/api/maker/compare?" + query, { signal: ac.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Comparison unavailable");
        setData(d);
      })
      .catch((e) => !ac.signal.aborted && setError(e.message));
    return () => ac.abort();
  }, [query]);

  const head = (
    <div className="compare-head">
      <div>
        <div className="eyebrow">COMPARE SIMILAR PARTS</div>
        <h3>{reference} and similar parts</h3>
      </div>
      {onClose && (
        <button className="btn small" onClick={onClose} aria-label="Close comparison">
          <X size={14} /> Close
        </button>
      )}
    </div>
  );
  if (error) return <section className="part-compare">{head}<p className="notice">{error}</p></section>;
  if (!data) return <section className="part-compare">{head}<p className="graph-hint">Comparing parameters…</p></section>;
  const cands = data.columns.slice(1);
  if (!cands.length)
    return (
      <section className="part-compare">
        {head}
        <p className="graph-hint">No similar part with published parameters was found in the Tindie parts database.</p>
      </section>
    );
  const rows = onlyDiff ? data.rows.filter((r) => new Set(r.values.map((v) => v.display)).size > 1) : data.rows;
  const hidden = data.rows.length - rows.length;

  return (
    <section className="part-compare" aria-label="Part comparison">
      {head}
      <p className="graph-hint">
        Each candidate is scored against <b>{data.columns[0].mpn}</b> parameter by parameter, using published values only. Missing values are
        never treated as a match.
      </p>
      <div className="compare-cards">
        {cands.map((c, i) => {
          const v = data.verdicts[i + 1]!;
          const ok = v.status === "OK" && v.grade;
          return (
            <article className="compare-card" key={c.id}>
              <header>
                <a href={c.href} className="mpn">{c.mpn}</a>
                <span className="mfr">{c.manufacturer}</span>
                {ok ? (
                  <span className={"grade grade-" + v.grade}>
                    <b>{v.grade}</b> {GRADE[v.grade!]}
                  </span>
                ) : (
                  <span className="grade grade-x">
                    <AlertTriangle size={12} aria-hidden /> {STATUS[v.status]}
                  </span>
                )}
              </header>
              {v.reason !== "NONE" && <p className="compare-reason">{REASON[v.reason]}</p>}
              <div className="score-bars">
                {BARS.map((b) => (
                  <div key={b.key} title={b.tip}>
                    <span>{b.label}</span>
                    <b>{v.scores[b.key]}</b>
                    <i><em style={{ width: `${v.scores[b.key]}%` }} /></i>
                  </div>
                ))}
              </div>
              <footer>
                <span className="pins" title="No verified datasheet pinout on file. A matching package outline is not proof of a matching pinout, so we do not claim one.">
                  <ShieldQuestion size={13} aria-hidden /> Pins: not verified
                </span>
                <span>{v.met} parameters met</span>
                <span>{v.short} short</span>
                {c.lifecycle && <span>Lifecycle: {c.lifecycle}</span>}
              </footer>
              <details>
                <summary>What stays · what changes · still to check</summary>
                <div className="verdict-cols">
                  <div>
                    <h4>What stays</h4>
                    {v.keep.length ? <ul>{v.keep.map((x) => <li key={x}>{x}</li>)}</ul> : <p>—</p>}
                  </div>
                  <div>
                    <h4>What changes</h4>
                    {v.change.length ? <ul>{v.change.map((x) => <li key={x}>{x}</li>)}</ul> : <p>—</p>}
                  </div>
                  <div>
                    <h4>Still to check</h4>
                    <ul>{v.check.map((x) => <li key={x}>{x}</li>)}</ul>
                  </div>
                </div>
              </details>
            </article>
          );
        })}
      </div>

      <div className="compare-table-bar">
        <button className="text-link" onClick={() => setOnlyDiff((x) => !x)}>
          {onlyDiff ? "Show every row" : "Only rows that differ"}
        </button>
        {onlyDiff && hidden > 0 && <span className="graph-hint">Rows where every part reads the same are hidden: {hidden}.</span>}
      </div>
      <div className="compare-table-scroll">
        <table className="compare-table">
          <caption className="sr-only">Parameter comparison across candidate parts</caption>
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              {data.columns.map((c, i) => (
                <th scope="col" key={c.id}>
                  {c.mpn}
                  <small>{i === 0 ? "Reference" : c.manufacturer}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  {r.label}
                  {!r.scored && <small title="No comparison rule for this parameter, so it is shown but not scored.">not scored</small>}
                  {r.scored && !r.comparable && r.better !== "none" && (
                    <small title="Values are text or in different units, so ranking them would be meaningless.">not comparable</small>
                  )}
                </th>
                {r.values.map((v, i) => (
                  <td key={i} className={r.best === i ? "best" : undefined}>
                    {v.known ? (
                      <span className="val">
                        {v.display}
                        {r.best === i && (r.better === "higher" ? <ChevronUp size={12} aria-label="Best in this row" /> : <ChevronDown size={12} aria-label="Best in this row" />)}
                      </span>
                    ) : (
                      <span className="unknown" title={`${data.columns[i].mpn} does not publish this parameter. Blank would read as zero.`}>
                        —
                      </span>
                    )}
                    {i > 0 && v.code && v.code !== "UNKNOWN_VALUE" && <span className={"code " + tone(v.code)}>{CODE_LABEL[v.code]}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.unresolved.length > 0 && (
        <p className="graph-hint">Not in the Tindie parts database, so not compared: {data.unresolved.join(", ")}.</p>
      )}
      <p className="graph-hint">
        Grades describe parameter compatibility only. Without a verified datasheet pinout no candidate is graded “Drop-in replacement”;
        check both datasheets (pinout, package, firmware) before substituting.
      </p>
    </section>
  );
}
