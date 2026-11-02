/**
 * Alternate-part comparison, ported from eelib's scoring engine (eelib-bff/src/scoring/*,
 * docs/07 parameter normalisation, docs/08 matching and scoring) for Tindie's parts database.
 *
 * Rules kept from eelib:
 * - Parameters are matched on canonical keys only, never on display names; unknown names are shown
 *   but not scored ("not compared (no rule for it)").
 * - Each side is parsed independently; different dimensions or text values are "not comparable".
 * - A missing value is UNKNOWN_VALUE (score null): it lowers evidence coverage, not the technical score.
 * - Four metrics are reported separately and never summed: technical, evidence coverage, source
 *   credibility, confidence (technical discounted by coverage and credibility).
 * - Grade A ("Drop-in replacement") needs a verified datasheet pinout. Tindie has none on file, so
 *   pins are always "Not verified" and the best possible grade is B. A matching package is not proof
 *   of a matching pinout.
 * Pure functions: no network, no randomness (scripts/compare-checks.ts).
 */

export type Semantics = "exact" | "range_cover" | "higher_better" | "lower_better" | "nearest" | "compatible_set" | "text";
export type Code =
  | "IDENTICAL" | "BETTER_THAN_ORIGINAL" | "WORSE_WITHIN_TOLERANCE" | "WORSE_AT_TOLERANCE_EDGE" | "WORSE_SIGNIFICANTLY"
  | "WORSE_UNACCEPTABLE" | "RANGE_FULLY_COVERED" | "RANGE_MOSTLY_COVERED" | "RANGE_PARTIAL" | "RANGE_INSUFFICIENT"
  | "COMPATIBLE_FAMILY" | "INCOMPATIBLE" | "NOT_COMPARABLE" | "UNKNOWN_VALUE";
export type Grade = "A" | "B" | "C" | "D";
export type Status = "OK" | "NEEDS_VERIFICATION" | "NOT_RECOMMENDED";
export type Reason = "NONE" | "INSUFFICIENT_EVIDENCE" | "LOW_CONFIDENCE" | "CRITICAL_IDENTITY_MISMATCH";

export const CODE_LABEL: Record<Code, string> = {
  IDENTICAL: "Same",
  BETTER_THAN_ORIGINAL: "Better",
  WORSE_WITHIN_TOLERANCE: "Slightly worse",
  WORSE_AT_TOLERANCE_EDGE: "Worse, at the limit",
  WORSE_SIGNIFICANTLY: "Significantly worse",
  WORSE_UNACCEPTABLE: "Unacceptably worse",
  RANGE_FULLY_COVERED: "Range fully covered",
  RANGE_MOSTLY_COVERED: "Range mostly covered",
  RANGE_PARTIAL: "Range partly covered",
  RANGE_INSUFFICIENT: "Range not covered",
  COMPATIBLE_FAMILY: "Same family",
  INCOMPATIBLE: "Incompatible",
  NOT_COMPARABLE: "Not comparable",
  UNKNOWN_VALUE: "Not published",
};

/* ------------------------------------------------------------------ canonical keys */

type Rule = { key: string; label: string; semantics: Semantics; tol?: number; critical?: boolean; match: RegExp };
/** Order = weight order (first = most important), like eelib's category template. */
const RULES: Rule[] = [
  { key: "core", label: "Core", semantics: "exact", critical: true, match: /^(core processor|core|cpu core|processor core)$/i },
  { key: "package", label: "Package", semantics: "compatible_set", critical: true, match: /^(package( \/ case)?|package \/ case|supplier device package|case\/package|footprint)$/i },
  { key: "channels", label: "Channels", semantics: "exact", critical: true, match: /^(number of channels|channels|number of circuits|number of drivers\/receivers|drivers\/receivers)$/i },
  { key: "resolution", label: "Resolution", semantics: "exact", critical: true, match: /^(resolution|number of bits|resolution \(bits\))$/i },
  { key: "interface", label: "Interface", semantics: "compatible_set", match: /^(interface|interface type|protocol|connectivity|data bus)$/i },
  { key: "vsupply", label: "Supply voltage", semantics: "range_cover", match: /^(voltage - supply.*|supply voltage.*|operating supply voltage.*|voltage - input.*|input voltage.*|vcc|vdd)$/i },
  { key: "temp", label: "Operating temperature", semantics: "range_cover", match: /^(operating temperature.*|temperature range.*)$/i },
  { key: "flash", label: "Flash / program memory", semantics: "higher_better", tol: 0, match: /^(program memory size|flash|flash size|flash memory size)$/i },
  { key: "ram", label: "RAM", semantics: "higher_better", tol: 0, match: /^(ram size|ram|data ram size|sram)$/i },
  { key: "psram", label: "PSRAM", semantics: "higher_better", tol: 0, match: /^psram$/i },
  { key: "freq", label: "Max frequency", semantics: "higher_better", tol: 0.15, match: /^(speed|max frequency|maximum clock frequency|max clock frequency|core speed|clock frequency)$/i },
  { key: "gpio", label: "I/O count", semantics: "higher_better", tol: 0, match: /^(number of i\/o|i\/o count|number of i\/os|gpio)$/i },
  { key: "vout", label: "Output voltage", semantics: "exact", match: /^(voltage - output.*|output voltage.*)$/i },
  { key: "iout", label: "Output current", semantics: "higher_better", tol: 0.05, match: /^(current - output.*|output current.*|current limit)$/i },
  { key: "dropout", label: "Dropout voltage", semantics: "lower_better", tol: 0.2, match: /^(voltage dropout.*|dropout voltage.*)$/i },
  { key: "iq", label: "Quiescent current", semantics: "lower_better", tol: 0.3, match: /^(current - quiescent.*|quiescent current.*|current - supply)$/i },
  { key: "gbw", label: "Gain bandwidth", semantics: "higher_better", tol: 0.15, match: /^(gain bandwidth product|gbw|gain bandwidth)$/i },
  { key: "slew_rate", label: "Slew rate", semantics: "higher_better", tol: 0.2, match: /^slew rate$/i },
  { key: "vos", label: "Input offset voltage", semantics: "lower_better", tol: 0.5, match: /^(voltage - input offset|input offset voltage|offset voltage)$/i },
  { key: "rds_on", label: "On-resistance", semantics: "lower_better", tol: 0.2, match: /^(rds on.*|on-resistance.*|on resistance.*)$/i },
  { key: "data_rate", label: "Data rate", semantics: "higher_better", tol: 0.15, match: /^(data rate|baud rate.*)$/i },
  { key: "mounting", label: "Mounting type", semantics: "exact", match: /^mounting type$/i },
];

export function canonical(name: string): Rule | null {
  const n = name.trim();
  return RULES.find((r) => r.match.test(n)) ?? null;
}

/* ------------------------------------------------------------------ quantities */

type Dim = "V" | "A" | "Hz" | "B" | "Ω" | "°C" | "bps" | "W" | "F" | "count";
type Qty = { v: number; dim: Dim };
const SI: Record<string, number> = { p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3, "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9 };
const BIN: Record<string, number> = { "": 1, k: 1024, K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
const QTY = /(-?\d+(?:\.\d+)?)\s*([pnuµμmkKMG]?)\s*(V|A|Hz|bps|B|byte|bytes|bit|bits|Ω|ohm|ohms|°C|℃|C\b|W|F)?/g;

function quantities(text: string): Qty[] {
  const out: Qty[] = [];
  for (const m of text.replace(/,/g, "").matchAll(QTY)) {
    const [, num, prefix, unitRaw] = m;
    if (!unitRaw) continue;
    const unit = unitRaw === "℃" || unitRaw === "C" ? "°C" : /^ohm/i.test(unitRaw) ? "Ω" : /^byte/i.test(unitRaw) ? "B" : unitRaw;
    if (unit === "bit" || unit === "bits") continue;
    const v = Number(num);
    if (unit === "B") out.push({ v: v * (BIN[prefix] ?? 1), dim: "B" });
    else if (unit === "°C") out.push({ v, dim: "°C" });
    else if (prefix === "m" && unit === "B") continue;
    else out.push({ v: v * (SI[prefix] ?? 1), dim: unit as Dim });
  }
  return out;
}
function quantity(text: string, plainCount = false): Qty | null {
  const q = quantities(text)[0];
  if (q) return q;
  if (plainCount) {
    const n = text.match(/^\s*(\d+(?:\.\d+)?)\b/);
    if (n) return { v: Number(n[1]), dim: "count" };
  }
  return null;
}
function range(text: string): [number, number, Dim] | null {
  const qs = quantities(text);
  if (qs.length >= 2 && qs[0].dim === qs[1].dim) return [Math.min(qs[0].v, qs[1].v), Math.max(qs[0].v, qs[1].v), qs[0].dim];
  if (qs.length === 1) return [qs[0].v, qs[0].v, qs[0].dim];
  return null;
}

/* ------------------------------------------------------------------ packages */

const PACKAGE_FAMILIES: RegExp[] = [
  /^(SOIC|SOP|SO)-?(\d+)/i,
  /^T?SOT-?23-?(\d+)?/i,
  /^(TSSOP|VSSOP|MSOP)-?(\d+)/i,
  /^V?QFN-?(\d+)/i,
  /^[LT]QFP-?(\d+)/i,
];
function packageKey(p: string) {
  return p.split(":").pop()!.toUpperCase().replace(/\s+/g, "").replace(/_/g, "-");
}
function packageFamily(p: string) {
  const k = packageKey(p);
  for (const [i, re] of PACKAGE_FAMILIES.entries()) {
    const m = k.match(re);
    if (m) return `${i}:${m[m.length - 1] ?? ""}`;
  }
  return null;
}
const tokens = (s: string) => new Set(s.toUpperCase().split(/[^A-Z0-9.]+/).filter((t) => t.length > 1));

/* ------------------------------------------------------------------ one parameter */

export type ParamResult = { code: Code; score: number | null; critical?: boolean };

function degradation(o: number, c: number, better: "higher" | "lower", tol: number): ParamResult {
  if (o === c) return { code: "IDENTICAL", score: 100 };
  if ((better === "higher" && c > o) || (better === "lower" && c < o)) return { code: "BETTER_THAN_ORIGINAL", score: 100 };
  if (tol === 0) return { code: "WORSE_UNACCEPTABLE", score: 15 };
  const r = Math.abs(c - o) / Math.abs(o || 1);
  if (r <= tol * 0.5) return { code: "WORSE_WITHIN_TOLERANCE", score: 88 };
  if (r <= tol) return { code: "WORSE_AT_TOLERANCE_EDGE", score: 72 };
  if (r <= tol * 2.5) return { code: "WORSE_SIGNIFICANTLY", score: 45 };
  return { code: "WORSE_UNACCEPTABLE", score: 15 };
}

export function compareParam(rule: Rule, original: string | undefined, candidate: string | undefined): ParamResult {
  if (!original || !candidate) return { code: "UNKNOWN_VALUE", score: null };
  const o = original.trim(), c = candidate.trim();
  let r: ParamResult;
  switch (rule.semantics) {
    case "higher_better":
    case "lower_better": {
      const count = rule.key === "gpio" || rule.key === "channels";
      const qo = quantity(o, count), qc = quantity(c, count);
      if (!qo || !qc || qo.dim !== qc.dim) r = { code: "NOT_COMPARABLE", score: null };
      else r = degradation(qo.v, qc.v, rule.semantics === "higher_better" ? "higher" : "lower", rule.tol ?? 0.1);
      break;
    }
    case "range_cover": {
      const ro = range(o), rc = range(c);
      if (!ro || !rc || ro[2] !== rc[2]) r = { code: "NOT_COMPARABLE", score: null };
      else {
        const span = Math.max(ro[1] - ro[0], Math.abs(ro[1]) * 0.01, 1e-9);
        const gap = Math.max(0, rc[0] - ro[0]) + Math.max(0, ro[1] - rc[1]);
        const share = gap / span;
        r = share === 0 ? { code: "RANGE_FULLY_COVERED", score: 100 }
          : share <= 0.05 ? { code: "RANGE_MOSTLY_COVERED", score: 88 }
            : share <= 0.25 ? { code: "RANGE_PARTIAL", score: 55 }
              : { code: "RANGE_INSUFFICIENT", score: 15 };
      }
      break;
    }
    case "compatible_set": {
      if (rule.key === "package") {
        if (packageKey(o) === packageKey(c)) r = { code: "IDENTICAL", score: 100 };
        else {
          const fo = packageFamily(o), fc = packageFamily(c);
          r = fo && fo === fc ? { code: "COMPATIBLE_FAMILY", score: 80 } : { code: "INCOMPATIBLE", score: 10 };
        }
      } else {
        const to = tokens(o), tc = tokens(c);
        const covered = [...to].filter((t) => tc.has(t)).length / Math.max(1, to.size);
        r = covered === 1 ? { code: to.size === tc.size ? "IDENTICAL" : "BETTER_THAN_ORIGINAL", score: 100 }
          : covered >= 0.5 ? { code: "RANGE_MOSTLY_COVERED", score: 80 } : { code: "INCOMPATIBLE", score: 10 };
      }
      break;
    }
    case "exact": {
      const qo = quantity(o, true), qc = quantity(c, true);
      const same = qo && qc ? qo.dim === qc.dim && Math.abs(qo.v - qc.v) <= Math.abs(qo.v) * 1e-6 : o.toUpperCase() === c.toUpperCase();
      r = same ? { code: "IDENTICAL", score: 100 } : { code: "INCOMPATIBLE", score: 10 };
      break;
    }
    default:
      r = o.toUpperCase() === c.toUpperCase() ? { code: "IDENTICAL", score: 100 } : { code: "NOT_COMPARABLE", score: null };
  }
  if (rule.critical && r.score !== null && r.score < 40) r.critical = true;
  return r;
}

/* ------------------------------------------------------------------ whole parts */

export type CompareSource = "ezplm" | "enriched" | "distributor" | "unknown";
/** eelib: source confidence by type × verification factor. */
const CREDIBILITY: Record<CompareSource, number> = {
  ezplm: 1.0 * 0.9, // ezPLM's published value (internal DB, auto-checked)
  enriched: 0.95 * 0.9, // reviewed or high-confidence enrichment
  distributor: 0.85 * 0.9, // DigiKey / Mouser value with MPN and manufacturer matched
  unknown: 0.6 * 0.75,
};

export type ComparePart = {
  id: string;
  mpn: string;
  manufacturer: string;
  package?: string | null;
  lifecycle?: string | null;
  href?: string;
  parameters: Record<string, { value: string; source?: string }>;
};

export type Scores = { technical: number; evidenceCoverage: number; sourceCredibility: number; confidence: number };
export type Verdict = {
  grade: Grade | null;
  status: Status;
  reason: Reason;
  scores: Scores;
  pins: "not_verified";
  met: number;
  short: number;
  keep: string[];
  change: string[];
  check: string[];
};
export type Row = {
  key: string;
  label: string;
  values: { display: string; known: boolean; code?: Code }[];
  best?: number;
  better: "higher" | "lower" | "none";
  comparable: boolean;
  scored: boolean;
};
export type Comparison = { columns: { id: string; mpn: string; manufacturer: string; href?: string; lifecycle?: string | null }[]; rows: Row[]; verdicts: (Verdict | null)[] };

type Field = { rule: Rule | null; name: string; value: string; source: CompareSource };
function fields(p: ComparePart): Map<string, Field> {
  const out = new Map<string, Field>();
  const add = (name: string, value: string, source: CompareSource) => {
    const rule = canonical(name);
    const key = rule?.key ?? "raw:" + name.trim().toLowerCase();
    if (!value || out.has(key)) return;
    out.set(key, { rule, name: name.trim(), value: String(value).trim(), source });
  };
  if (p.package) add("Package", p.package, "ezplm");
  for (const [name, v] of Object.entries(p.parameters || {})) add(name, v.value, (["ezplm", "enriched", "distributor"].includes(v.source || "") ? v.source : "unknown") as CompareSource);
  return out;
}

/** Original first, then up to three candidates. */
export function compareParts(original: ComparePart, candidates: ComparePart[]): Comparison {
  const parts = [original, ...candidates.slice(0, 3)];
  const fs = parts.map(fields);
  // Union of keys: canonical keys in template order (weights n - i), then unmapped names.
  const keys = [...new Set(fs.flatMap((f) => [...f.keys()]))];
  const ruled = RULES.map((r) => r.key).filter((k) => keys.includes(k));
  const raw = keys.filter((k) => k.startsWith("raw:")).sort();
  const n = ruled.length;
  const weight = new Map(ruled.map((k, i) => [k, n - i]));

  const results = candidates.slice(0, 3).map((_, ci) =>
    new Map(ruled.map((k) => [k, compareParam(RULES.find((r) => r.key === k)!, fs[0].get(k)?.value, fs[ci + 1].get(k)?.value)])),
  );

  const rows: Row[] = [...ruled, ...raw].map((k) => {
    const rule = RULES.find((r) => r.key === k) ?? null;
    const values = fs.map((f, i) => {
      const v = f.get(k);
      return { display: v?.value ?? "—", known: !!v, code: i > 0 && rule ? results[i - 1].get(k)?.code : undefined };
    });
    const better: Row["better"] = rule?.semantics === "higher_better" ? "higher" : rule?.semantics === "lower_better" ? "lower" : "none";
    let best: number | undefined;
    let comparable = true;
    if (better !== "none") {
      const count = k === "gpio";
      const qs = fs.map((f) => (f.get(k) ? quantity(f.get(k)!.value, count) : null));
      const known = qs.filter((q): q is Qty => !!q);
      // "Not comparable" only for values in different units or text (eelib); one published value is just insufficient data.
      const published = fs.filter((f) => f.has(k)).length;
      comparable = !(published >= 2 && (known.length < published || !known.every((q) => q.dim === known[0].dim)));
      if (known.length >= 2 && known.every((q) => q.dim === known[0].dim)) {
        const vals = qs.map((q) => (q ? q.v : NaN));
        const target = better === "higher" ? Math.max(...vals.filter((v) => !Number.isNaN(v))) : Math.min(...vals.filter((v) => !Number.isNaN(v)));
        if (vals.filter((v) => v === target).length < known.length) best = vals.indexOf(target);
      }
    }
    return { key: k, label: rule?.label ?? fs.map((f) => f.get(k)?.name).find(Boolean) ?? k, values, best, better, comparable, scored: !!rule };
  });

  const verdicts = results.map((res, ci): Verdict => {
    let wAll = 0, wKnown = 0, sum = 0, cred = 0, critical = false, met = 0, short = 0;
    const keep: string[] = [], change: string[] = [], check: string[] = [];
    for (const k of ruled) {
      const w = weight.get(k)!;
      const r = res.get(k)!;
      const label = RULES.find((x) => x.key === k)!.label;
      const o = fs[0].get(k), c = fs[ci + 1].get(k);
      // A key only one side publishes still counts toward coverage (a missing value never passes silently).
      wAll += w;
      if (r.score === null) {
        check.push(r.code === "UNKNOWN_VALUE" ? `${label} — not published by ${o ? "the candidate" : "the original"}` : `${label} — not comparable`);
        continue;
      }
      wKnown += w;
      sum += r.score * w;
      cred += Math.min(CREDIBILITY[o!.source], CREDIBILITY[c!.source]) * w;
      if (r.critical) critical = true;
      if (r.score >= 70) met++;
      else short++;
      if (["IDENTICAL", "BETTER_THAN_ORIGINAL", "RANGE_FULLY_COVERED", "COMPATIBLE_FAMILY", "WORSE_WITHIN_TOLERANCE"].includes(r.code))
        keep.push(`${label} · ${CODE_LABEL[r.code]}`);
      else change.push(`${label}: ${o!.value} → ${c!.value} (${CODE_LABEL[r.code]})`);
    }
    for (const k of raw) if (fs[0].has(k) || fs[ci + 1].has(k)) check.push(`${(fs[0].get(k) ?? fs[ci + 1].get(k))!.name} — not compared (no rule for it)`);
    check.unshift("Pinout — no verified datasheet pinout on file");

    const technical = wKnown ? sum / wKnown : 0;
    const evidenceCoverage = wAll ? (100 * wKnown) / wAll : 0;
    const sourceRatio = wKnown ? cred / wKnown : 0;
    let confidence = technical * (evidenceCoverage / 100) * (0.4 + 0.6 * sourceRatio);
    if (evidenceCoverage < 50) confidence = Math.min(confidence, 60);
    if (sourceRatio < 0.5) confidence = Math.min(confidence, 70);
    if (critical) confidence = Math.min(confidence, 55);
    const scores: Scores = {
      technical: Math.round(technical),
      evidenceCoverage: Math.round(evidenceCoverage),
      sourceCredibility: Math.round(sourceRatio * 100),
      confidence: Math.round(confidence),
    };
    let grade: Grade | null = null, status: Status = "OK", reason: Reason = "NONE";
    if (evidenceCoverage < 40) { status = "NEEDS_VERIFICATION"; reason = "INSUFFICIENT_EVIDENCE"; }
    else if (confidence < 40) { status = "NOT_RECOMMENDED"; reason = "LOW_CONFIDENCE"; }
    else if (critical) { grade = confidence >= 55 ? "C" : "D"; reason = "CRITICAL_IDENTITY_MISMATCH"; }
    else {
      grade = confidence >= 85 && evidenceCoverage >= 70 ? "A" : confidence >= 70 ? "B" : confidence >= 55 ? "C" : "D";
      // Pin evidence gate: no verified datasheet pinout → never "Drop-in replacement".
      if (grade === "A") grade = "B";
    }
    return { grade, status, reason, scores, pins: "not_verified", met, short, keep, change, check };
  });

  return {
    columns: parts.map((p) => ({ id: p.id, mpn: p.mpn, manufacturer: p.manufacturer, href: p.href, lifecycle: p.lifecycle ?? null })),
    rows,
    verdicts: [null, ...verdicts],
  };
}
