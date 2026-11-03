"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Download, Check, ArrowRight, CircleCheck, CircleHelp, CircleAlert } from "lucide-react";
import { hasChinese, terminology } from "@/lib/maker/english";
import { ToolHeading } from "./ToolShell";
import {
  autoMapColumn,
  readCsv,
  normalizeTable,
  estimate,
  priceOffer,
  rowPrice,
  type StdField,
} from "@/lib/maker/bom";
import type { BomRow, Part } from "@/lib/maker/types";
import { matchRequestRows } from "@/lib/maker/bom-request";
import { download, csvCell } from "@/lib/maker/download";
const sample =
  "Reference,Quantity,Value,MPN,Manufacturer,Package\nU1,1,DAC,AD9102BCPZ,Analog Devices,LFCSP-32\nU2,1,MCU,STM32F103C8T6,STMicroelectronics,LQFP-48\nR1 R2,2,10k,,,0603\nC1,1,100nF,,,0603";
export default function Bom({
  initialRows,
  onApply,
  allowPlacement = true,
  compact = false,
  onRowsChange,
  activeReference,
  onSelectReference,
}: {
  initialRows?: BomRow[];
  onApply?: (rows: BomRow[]) => void;
  allowPlacement?: boolean;
  compact?: boolean;
  onRowsChange?: (rows: BomRow[]) => void;
  activeReference?: string;
  onSelectReference?: (reference: string) => void;
} = {}) {
  const [matchProgress, setMatchProgress] = useState("");
  const reviewPanel = useRef<HTMLElement>(null);
  const [manualQuery, setManualQuery] = useState("");
  const [rows, setRows] = useState<BomRow[]>(initialRows || []),
    [headers, setHeaders] = useState<string[]>([]),
    [raw, setRaw] = useState<string[][]>([]),
    [mapping, setMapping] = useState<StdField[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [active, setActive] = useState(""),
    [build, setBuild] = useState(1);
  useEffect(() => {
    onRowsChange?.(rows);
  }, [rows, onRowsChange]);
  useEffect(() => {
    if (reviewPanel.current) reviewPanel.current.scrollTop = 0;
  }, [active]);
  const [english, setEnglish] = useState<Record<string, string>>({});
  const prose = JSON.stringify(
    [
      ...new Set(
        rows
          .flatMap((r) => [
            r.value,
            r.selected?.description || "",
            ...(r.candidates || []).map((p) => p.description),
          ])
          .filter((s) => hasChinese(terminology(s))),
      ),
    ].sort(),
  );
  useEffect(() => {
    const pending: string[] = JSON.parse(prose);
    if (!pending.length) return;
    const ac = new AbortController();
    async function translate() {
      for (let i = 0; i < pending.length; i += 40) {
        const texts = pending.slice(i, i + 40);
        const r = await fetch("/api/maker/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts }),
          signal: ac.signal,
        });
        if (!r.ok) throw Error("Translation service unavailable");
        const data = await r.json();
        if (!ac.signal.aborted)
          setEnglish((old) => ({
            ...old,
            ...Object.fromEntries(
              texts.map((t, j) => [t, data.texts[j] || terminology(t)]),
            ),
          }));
      }
    }
    void translate().catch(() => {
      /* Keep source text and the visible translation notice. */
    });
    return () => ac.abort();
  }, [prose]);
  const displayText = (s: string) => english[s] || terminology(s);
  const untranslated = rows.some(
    (r) =>
      hasChinese(displayText(r.value)) ||
      (r.selected && hasChinese(displayText(r.selected.description))),
  );
  const input = useRef<HTMLInputElement>(null);
  const selected = rows.find((r) => r.id === active),
    sum = estimate(rows, build);
  const bestCandidate = selected?.selected || selected?.candidates?.[0];
  const otherCandidates = (selected?.candidates || []).filter(
    (p) => p.id !== bestCandidate?.id || p.source !== bestCandidate?.source,
  );
  function candidateCard(p: Part) {
    return (
      <div className="candidate-card" key={p.id + p.source}>
        <strong>{p.mpn}</strong>
        <p>
          {p.manufacturer} · {p.package || "Package unavailable"}
        </p>
        <p>{displayText(p.description)}</p>
        <button className="btn small" onClick={() => choose(p)}>
          <Check size={13} />
          {selected?.selected?.id === p.id ? "Selected" : "Confirm variant"}
        </button>
      </div>
    );
  }
  function load(text: string) {
    try {
      const d = readCsv(text);
      setHeaders(d.headers);
      setRaw(d.rows);
      setMapping(d.headers.map((h) => autoMapColumn(h)));
      setRows([]);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (!initialRows && new URLSearchParams(location.search).get("import")) {
      try {
        const r = JSON.parse(
          sessionStorage.getItem("maker-import-bom") || "[]",
        );
        setRows(r);
        setActive(r[0]?.id || "");
      } catch {}
    }
  }, []);
  async function match() {
    setBusy(true);
    setError("");
    try {
      // The parts database bills BOM matching per 10 rows, so send rows in batches of 10.
      const batches: BomRow[][] = [];
      for (let i = 0; i < rows.length; i += 10) batches.push(rows.slice(i, i + 10));
      let cursor = 0,
        done = 0;
      setMatchProgress(`Checking 0 / ${rows.length}`);
      if (!active && rows[0]) setActive(rows[0].id);
      await Promise.all(
        Array.from({ length: Math.min(2, batches.length) }, async () => {
          while (cursor < batches.length) {
            const batch = batches[cursor++];
            try {
              const response = await fetch("/api/maker/match", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ rows: matchRequestRows(batch) }),
                signal: AbortSignal.timeout(90000),
              });
              const data = await response.json();
              if (!response.ok)
                throw Error(data.error || `HTTP ${response.status}`);
              const updated = new Map<string, BomRow>(
                (data.rows || []).map((r: BomRow) => [r.id, r]),
              );
              setRows((old) =>
                old.map((x) => {
                  const u = updated.get(x.id);
                  return u
                    ? {
                        ...u,
                        original: x.original,
                        manualUnitPrice: x.manualUnitPrice,
                      }
                    : x;
                }),
              );
            } catch (e) {
              const ids = new Set(batch.map((r) => r.id));
              setRows((old) =>
                old.map((x) =>
                  ids.has(x.id)
                    ? {
                        ...x,
                        reason: `Lookup failed: ${e instanceof Error ? e.message : String(e)}`,
                      }
                    : x,
                ),
              );
            }
            done += batch.length;
            setMatchProgress(`Checked ${done} / ${rows.length}`);
          }
        }),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const [priceNote, setPriceNote] = useState("");
  // Which distributor APIs this site has; with neither, refreshing prices cannot find anything.
  const [suppliers, setSuppliers] = useState<{ digikey: boolean; mouser: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/maker/suppliers")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSuppliers({ digikey: !!d.digikey, mouser: !!d.mouser }))
      .catch(() => undefined);
  }, []);
  const noSuppliers = suppliers !== null && !suppliers.digikey && !suppliers.mouser;
  async function pricing() {
    setBusy(true);
    setError("");
    const targets = rows.filter((r) => r.selected);
    let done = 0,
      priced = 0;
    const problems = new Map<string, string>();
    setPriceNote(`Checking supplier prices… 0 / ${targets.length}`);
    async function one(row: BomRow) {
      try {
        const p = row.selected!;
        const r = await fetch(
          "/api/maker/pricing/" +
            encodeURIComponent(p.mpn) +
            "?" +
            new URLSearchParams({
              manufacturer: p.manufacturer,
              qty: String(row.quantity * build),
            }),
        );
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Price lookup failed");
        for (const s of (d.partialSources || []) as { source: string; status: string; message?: string }[])
          if (s.status !== "ready")
            problems.set(
              s.source,
              s.status === "unconfigured" ? s.source.replace(/ direct$/, "") + " is not connected on this site" : s.message || s.source + " failed",
            );
        if (d.offers.length) priced++;
        setRows((old) =>
          old.map((x) =>
            x.id === row.id
              ? {
                  ...x,
                  priceError: d.offers.length ? undefined : "No live price found.",
                  selected: {
                    ...p,
                    offers: [
                      ...p.offers.filter(
                        (o) => !d.offers.some((n: any) => n.supplier === o.supplier && n.sku === o.sku),
                      ),
                      ...d.offers,
                    ],
                  },
                }
              : x,
          ),
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setRows((old) => old.map((x) => (x.id === row.id ? { ...x, priceError: message } : x)));
      } finally {
        done++;
        setPriceNote(`Checking supplier prices… ${done} / ${targets.length}`);
      }
    }
    try {
      const queue = [...targets];
      await Promise.all(
        Array.from({ length: Math.min(4, queue.length) }, async () => {
          for (let row = queue.shift(); row; row = queue.shift()) await one(row);
        }),
      );
      setPriceNote(
        `Live prices found for ${priced} of ${targets.length} matched lines.` +
          (problems.size ? " " + [...problems.values()].join(" · ") + "." : "") +
          (priced < targets.length ? " You can type a unit price for any line." : ""),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function lookupRow() {
    if (!active || manualQuery.trim().length < 2) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        "/api/maker/parts?q=" + encodeURIComponent(manualQuery.trim()),
      );
      const data = await response.json();
      if (!response.ok) throw Error(data.error || "Search failed");
      setRows((old) =>
        old.map((r) =>
          r.id === active
            ? {
                ...r,
                candidates: data.items,
                reason: "Select and confirm a catalog MPN.",
              }
            : r,
        ),
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  function choose(p: Part) {
    setRows((old) =>
      old.map((r) =>
        r.id === active
          ? {
              ...r,
              selected: p,
              status: "confirmed",
              reason: "Candidate explicitly confirmed by you.",
            }
          : r,
      ),
    );
  }
  function exportCsv() {
    const data = [
      [
        "Reference",
        "Quantity",
        "Value",
        "Original MPN",
        "Matched MPN",
        "Manufacturer",
        "Package",
        "Match status",
        "Build quantity",
        "Required quantity",
        "Order quantity",
        "Estimated unit price",
        "Estimated line total",
        "Currency",
        "Supplier",
        "Price retrieved at",
      ],
      ...rows.map((r) => {
        const best = rowPrice(r, build);
        return [
          r.reference,
          r.quantity,
          displayText(r.value),
          r.mpn,
          r.selected?.mpn || "",
          r.selected?.manufacturer || r.manufacturer,
          r.package,
          r.status,
          build,
          r.quantity * build,
          best?.quantity ?? "",
          best?.unit ?? "",
          best?.total ?? "",
          best?.currency ?? "",
          best?.supplier ?? "",
          best?.retrievedAt ?? "",
        ];
      }),
    ];
    download(
      new TextEncoder().encode(
        data.map((r) => r.map(csvCell).join(",")).join("\r\n"),
      ),
      "normalized-bom.csv",
      "text/csv",
    );
  }
  return (
    <>
      {matchProgress && <p role="status">{matchProgress}</p>}
      {untranslated && (
        <p className="notice">
          English translation is pending for some source descriptions. Automatic
          full-text translation requires the configured translation service;
          original text is retained.
        </p>
      )}
      {compact ? (
        <button className="btn small" onClick={exportCsv}>
          Export BOM
        </button>
      ) : (
        <ToolHeading
          eyebrow="BOM WORKBENCH"
          title="Turn a parts list into a build plan."
          description="Normalize columns, match exact part numbers and estimate available supply."
          actions={
            <>
              {onApply && (
                <button
                  className="btn primary"
                  disabled={
                    !rows.some(
                      (r) =>
                        r.selected && ["exact", "confirmed"].includes(r.status),
                    )
                  }
                  onClick={() => onApply(rows)}
                >
                  Apply matches to project
                </button>
              )}
              <button className="btn" onClick={() => input.current?.click()}>
                <Upload size={16} />
                Import CSV
              </button>
              {rows.length > 0 && (
                <button className="btn" onClick={exportCsv}>
                  <Download size={16} />
                  Export BOM
                </button>
              )}
            </>
          }
        />
      )}
      <input
        hidden
        type="file"
        accept=".csv,.tsv,.txt"
        ref={input}
        onChange={async (e) => {
          if (e.target.files?.[0]) load(await e.target.files[0].text());
          e.target.value = "";
        }}
      />
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {!rows.length && !headers.length && (
        <>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={async (e) => {
              e.preventDefault();
              if (e.dataTransfer.files[0])
                load(await e.dataTransfer.files[0].text());
            }}
          >
            <Upload size={40} />
            <h2>Every good build starts with a BOM.</h2>
            <p>
              Import a CSV or tab-delimited parts list. Map your columns, then
              check the exact variants.
            </p>
            <button
              className="btn primary"
              onClick={() => input.current?.click()}
            >
              Choose BOM file
            </button>
            <small>
              Up to 2,000 rows · original fields preserved · CSV export
            </small>
          </div>
          <div className="example-row">
            <div>
              <b>Try a small example</b>
              <p>Four rows, including ambiguous passive components.</p>
            </div>
            <button className="btn" onClick={() => load(sample)}>
              Load sample
              <ArrowRight size={14} />
            </button>
          </div>
        </>
      )}
      {headers.length > 0 && (
        <>
          <h3>Confirm column mapping</h3>
          <div className="mapping-grid">
            {headers.map((h, i) => (
              <label key={i}>
                {h}
                <select
                  value={mapping[i]}
                  onChange={(e) =>
                    setMapping((m) =>
                      m.map((v, j) =>
                        j === i ? (e.target.value as StdField) : v,
                      ),
                    )
                  }
                >
                  {[
                    "ignore",
                    "designator",
                    "quantity",
                    "value",
                    "mpn",
                    "manufacturer",
                    "package",
                    "description",
                    "notes",
                    "customerPartNumber",
                    "supplierPartNumber",
                  ].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <button
            className="btn primary"
            onClick={() => {
              try {
                const r = normalizeTable(headers, raw, mapping);
                setRows(r);
                setActive(r[0]?.id || "");
                setHeaders([]);
              } catch (e) {
                setError(String(e));
              }
            }}
          >
            Normalize {raw.length} rows
          </button>
        </>
      )}
      {rows.length > 0 && (
        <>
          <p className="muted">
            Matching sends part numbers and specifications to the Tindie parts
            database (and distributor APIs when configured). Your original BOM
            file stays in this browser.
          </p>
          <div className="bom-controls">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => void match()}
            >
              {busy ? "Working…" : "Match components"}
            </button>
            <button
              className="btn"
              disabled={busy || noSuppliers || !rows.some((r) => r.selected)}
              title={
                noSuppliers
                  ? "DigiKey and Mouser are not connected on this site, so there are no live prices to fetch."
                  : !rows.some((r) => r.selected)
                    ? "Match components first; prices are looked up for matched lines."
                    : undefined
              }
              onClick={() => void pricing()}
            >
              {priceNote.startsWith("Checking") ? priceNote.replace("Checking supplier prices… ", "Checking prices ") : "Refresh supplier prices"}
            </button>
            {allowPlacement && (
              <button
                className="btn"
                onClick={() => {
                  if (rows.reduce((n, r) => n + r.quantity, 0) > 300) {
                    setError(
                      "PCB planner supports up to 300 placed components. Reduce the BOM before transferring.",
                    );
                    return;
                  }
                  const parts = rows.flatMap((r) =>
                    Array.from({ length: r.quantity }, (_, i) => ({
                      mpn: r.selected?.mpn || r.mpn,
                      manufacturer: r.selected?.manufacturer || r.manufacturer,
                      package: r.selected?.package || r.package,
                      reference:
                        r.quantity === 1
                          ? r.reference
                          : `${r.reference}.${i + 1}`,
                    })),
                  );
                  sessionStorage.setItem(
                    "maker-planner-parts",
                    JSON.stringify(parts),
                  );
                  location.href = "/tools/planner?import=bom";
                }}
              >
                Plan placement
                <ArrowRight size={14} />
              </button>
            )}
            <label>
              Build quantity
              <input
                type="number"
                min={1}
                max={10000}
                value={build}
                onChange={(e) =>
                  setBuild(
                    Math.max(
                      1,
                      Math.min(10000, Math.floor(+e.target.value) || 1),
                    ),
                  )
                }
              />
            </label>
            <span className="badge">{rows.length} BOM lines</span>
          </div>
          {noSuppliers && (
            <p role="status" className="notice price-note">
              Live supplier prices are not available on this site yet: DigiKey and Mouser are not connected. You can type a unit
              price for any line.
            </p>
          )}
          {!noSuppliers && priceNote && !priceNote.startsWith("Checking") && (
            <p role="status" className="notice price-note">{priceNote}</p>
          )}
          <div className="estimate-box">
            <div>
              <small>PRICED SUBTOTAL · USD</small>
              <b>{sum.priced ? "$" + sum.total.toFixed(2) : "—"}</b>
            </div>
            <div>
              <small>PRICED LINES</small>
              <b>
                {sum.priced} / {rows.length}
              </b>
            </div>
            <div>
              <small>UNPRICED LINES</small>
              <b>{sum.unpriced}</b>
            </div>
          </div>
          <p className="muted">
            Supplier estimates use in-stock offers, order multiples and minimum
            quantities. Manual prices override supplier prices and use required
            quantities. Unpriced lines, tax and shipping are excluded.
          </p>
          <div className="bom-layout">
            <div className="table-panel data-table">
              <table className="bom-table">
                <thead>
                  <tr>
                    {[
                      "Reference",
                      "Qty",
                      "Value / package",
                      "MPN / manufacturer",
                      "Match",
                      "Unit price · USD",
                      "Line total · USD",
                    ].map((v) => (
                      <th key={v}>{v}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.id}
                      className={
                        (
                          activeReference
                            ? r.reference
                                .split(/[,\s]+/)
                                .includes(activeReference)
                            : active === r.id
                        )
                          ? "selected"
                          : ""
                      }
                      onClick={() => setActive(r.id)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setActive(r.id);
                      }}
                    >
                      <td>
                        {onSelectReference
                          ? r.reference
                              .split(/[,\s]+/)
                              .filter(Boolean)
                              .map((ref) => (
                                <button
                                  key={ref}
                                  className="mpn-detail-link"
                                  onClick={() => onSelectReference(ref)}
                                >
                                  {ref}{" "}
                                </button>
                              ))
                          : r.reference}
                      </td>
                      <td>{r.quantity * build}</td>
                      <td>
                        {displayText(r.value)}
                        <br />
                        <small>{r.package}</small>
                      </td>
                      <td>
                        <strong>
                          {r.selected?.mpn || r.mpn || "Not specified"}
                        </strong>
                        <br />
                        <small>
                          {r.selected?.manufacturer || r.manufacturer}
                        </small>
                      </td>
                      <td>
                        <MatchMark status={r.status} />
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input
                          key={`${r.id}:${r.manualUnitPrice ?? rowPrice(r, build)?.unit ?? "empty"}`}
                          aria-label={`Unit price for ${r.reference}`}
                          type="number"
                          min="0"
                          step="any"
                          defaultValue={
                            r.manualUnitPrice ?? rowPrice(r, build)?.unit ?? ""
                          }
                          placeholder="—"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          onBlur={(e) => {
                            const value = e.target.value;
                            if (
                              value ===
                              String(
                                r.manualUnitPrice ??
                                  rowPrice(r, build)?.unit ??
                                  "",
                              )
                            )
                              return;
                            setRows((old) =>
                              old.map((x) =>
                                x.id === r.id
                                  ? {
                                      ...x,
                                      manualUnitPrice:
                                        value === ""
                                          ? undefined
                                          : Math.max(0, Number(value)),
                                    }
                                  : x,
                              ),
                            );
                          }}
                          style={{ width: 100 }}
                        />
                        <small>
                          {r.manualUnitPrice !== undefined
                            ? "Manual override"
                            : rowPrice(r, build)?.supplier || "Unpriced"}
                        </small>
                        {r.manualUnitPrice !== undefined && (
                          <button
                            className="btn small"
                            onClick={() =>
                              setRows((old) =>
                                old.map((x) =>
                                  x.id === r.id
                                    ? { ...x, manualUnitPrice: undefined }
                                    : x,
                                ),
                              )
                            }
                          >
                            Use API price
                          </button>
                        )}
                        {r.priceError && (
                          <small role="status">{r.priceError}</small>
                        )}
                      </td>
                      <td>{rowPrice(r, build)?.total.toFixed(2) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <aside
              ref={reviewPanel}
              className="candidate-panel bom-match-review"
            >
              <span className="eyebrow">MATCH REVIEW</span>
              <h3>{selected?.reference || "Select a row"}</h3>
              <p>
                {selected?.reason ||
                  "Run matching to find candidates. Specifications alone always need your confirmation."}
              </p>
              {selected?.sources?.map((source) => (
                <p key={source.source} className="muted">
                  {source.source}: {source.status}
                  {source.message ? ` — ${source.message}` : ""}
                </p>
              ))}
              {selected && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void lookupRow();
                  }}
                >
                  <input
                    aria-label="Search MPN or specifications"
                    placeholder="MPN or specifications"
                    value={manualQuery}
                    onChange={(e) => setManualQuery(e.target.value)}
                  />
                  <button
                    className="btn"
                    disabled={busy || manualQuery.trim().length < 2}
                  >
                    Search catalog
                  </button>
                </form>
              )}
              {bestCandidate && (
                <>
                  <span className="badge">
                    {selected?.selected ? "Chosen match" : "Closest candidate"}
                  </span>
                  {candidateCard(bestCandidate)}
                </>
              )}
              {otherCandidates.length > 0 && (
                <section className="other-candidates">
                  <h4>Other candidates ({otherCandidates.length})</h4>
                  {otherCandidates.map(candidateCard)}
                </section>
              )}
              {selected?.selected?.offers.map((o, i) => (
                <div className="candidate-card" key={i}>
                  <strong>{o.supplier}</strong>
                  <p>
                    Stock: {o.stock ?? "unknown"} · MOQ {o.moq}
                  </p>
                  <p>
                    {o.breaks
                      .map((b) => `${b.quantity}+: ${o.currency} ${b.price}`)
                      .join(" · ")}
                  </p>
                  <small>
                    {o.retrievedAt
                      ? new Date(o.retrievedAt).toLocaleString()
                      : ""}
                  </small>
                </div>
              ))}
            </aside>
          </div>
        </>
      )}
    </>
  );
}

const MATCH_MARK = {
  exact: { Icon: CircleCheck, label: "MPN matched exactly" },
  confirmed: { Icon: CircleCheck, label: "Match confirmed by you" },
  review: { Icon: CircleAlert, label: "Candidates found, needs review" },
  unmatched: { Icon: CircleHelp, label: "No MPN match" },
} as const;
/** Icon instead of a word: ✓ matched, ! needs review, ? not matched. */
function MatchMark({ status }: { status: BomRow["status"] }) {
  const { Icon, label } = MATCH_MARK[status] || MATCH_MARK.unmatched;
  return (
    <span className={"match-mark " + status} title={label} role="img" aria-label={label}>
      <Icon size={22} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}
