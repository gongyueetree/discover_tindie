"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, ExternalLink, Box, ArrowRight, CircuitBoard, Star } from "lucide-react";
import GraphEmbed from "./GraphEmbed";
import DatasheetReader from "./DatasheetReader";
import CadPreview from "./CadPreview";
import { ToolHeading } from "./ToolShell";
import type { Part, ProviderStatus } from "@/lib/maker/types";

type DesignCard = {
  id: string;
  name: string;
  kind: "open_source" | "vendor";
  stars: number | null;
  license: string | null;
  partCount: number;
  sourceUrl: string;
};

const SOURCE_LABEL: Record<string, string> = {
  ezplm: "ezPLM",
  enriched: "reviewed",
  distributor: "distributor",
};
const EXAMPLES = ["STM32F103C8T6", "ESP32-S3", "AMS1117", "LM358"];

export default function Components() {
  const params = useSearchParams();
  const initialQuery = params.get("q") || "";
  const exact = params.get("exact") === "1";
  const targetManufacturer = params.get("manufacturer") || "";
  const targetPartId = params.get("partId") || "";
  const [q, setQ] = useState(""),
    [items, setItems] = useState<Part[]>([]),
    [sources, setSources] = useState<ProviderStatus[]>([]),
    [selected, setSelected] = useState<Part | null>(null),
    [detailState, setDetailState] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [searched, setSearched] = useState(false),
    [refs, setRefs] = useState<DesignCard[]>([]),
    [refsTotal, setRefsTotal] = useState(0),
    [refsState, setRefsState] = useState("");
  const details = useRef(new Map<string, Part>());

  async function search(v = q, requireExact = false) {
    const query = v.trim();
    if (query.length < 2) return;
    setBusy(true);
    setError("");
    setSelected(null);
    try {
      const r = await fetch("/api/maker/parts?q=" + encodeURIComponent(query));
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      const rows: Part[] = d.items || [];
      setItems(rows);
      const exactPart = rows.find(
        (p) =>
          p.mpn.toUpperCase() === query.toUpperCase() &&
          (!targetPartId || p.id === targetPartId) &&
          (!targetManufacturer || p.manufacturer.toUpperCase() === targetManufacturer.toUpperCase()),
      );
      setSelected(requireExact ? exactPart || null : exactPart || rows[0] || null);
      if (requireExact && !exactPart)
        setError(
          "That exact part number is not in the parts database. Related results are listed below; no substitute was selected.",
        );
      setSources(d.sources || []);
      setSearched(true);
      const url = new URL(location.href);
      url.searchParams.set("q", query);
      history.replaceState(null, "", url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSearched(true);
      setItems([]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (initialQuery) {
      setQ(initialQuery);
      void search(initialQuery, exact);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery, exact, targetManufacturer, targetPartId]);

  // Search rows are summaries; read the full record (symbol, footprint, parameters…) on selection.
  const selectedId = selected?.id || "";
  useEffect(() => {
    if (!selected || selected.detailed || !selectedId.startsWith("p_")) return;
    const cached = details.current.get(selectedId);
    if (cached) return setSelected(cached);
    const ac = new AbortController();
    setDetailState("Loading part details…");
    fetch("/api/maker/parts/" + selectedId, { signal: ac.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        details.current.set(selectedId, d.part);
        setItems((old) => old.map((p) => (p.id === selectedId ? d.part : p)));
        setSelected((cur) => (cur?.id === selectedId ? d.part : cur));
        setDetailState("");
      })
      .catch((e) => {
        if (!ac.signal.aborted) setDetailState(e.message);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    setRefs([]);
    setRefsTotal(0);
    if (!selectedId.startsWith("p_")) {
      setRefsState(selected ? "Open-hardware links are available for parts from the Tindie parts database." : "");
      return;
    }
    const ac = new AbortController();
    setRefsState("Loading open-hardware designs…");
    fetch("/api/maker/references/" + selectedId, { signal: ac.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setRefs(d.items || []);
        setRefsTotal(d.total || 0);
        setRefsState(d.items?.length ? "" : "No published open-hardware design uses this exact part yet.");
      })
      .catch((e) => {
        if (!ac.signal.aborted) setRefsState(e.message);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function sendToPlanner() {
    if (!selected) return;
    sessionStorage.setItem("maker-planner-parts", JSON.stringify([selected]));
    location.href = "/tools/planner?import=components";
  }

  const fs = selected?.fieldSources || {};
  return (
    <>
      <ToolHeading
        eyebrow="Component explorer"
        title="Find the right part"
        description="Search part numbers in the Tindie parts database: specifications, datasheets, KiCad symbols and footprints, and the open-source designs that use them."
      />
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <Search size={19} />
        <input
          aria-label="Search components"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Part number, e.g. STM32F103C8T6, AMS1117, LM358"
          minLength={2}
          required
        />
        <button className="btn primary" disabled={busy}>
          {busy ? "Searching…" : "Search"}
        </button>
      </form>
      {sources.length > 0 && (
        <div className="source-status">
          {sources
            .filter((s) => s.status !== "unconfigured")
            .map((s) => (
              <span key={s.source} className={s.status} title={s.message}>
                {s.source} · {s.status === "ready" ? "connected" : "unavailable"}
              </span>
            ))}
        </div>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!searched && !busy ? (
        <>
          <div className="dropzone">
            <Box size={42} color="#22b8c4" />
            <h2>From part number to project</h2>
            <p>Datasheets, footprints, 3D models and related open hardware in one place.</p>
            <div className="chip-row" style={{ justifyContent: "center", marginTop: 16 }}>
              {EXAMPLES.map((v) => (
                <button
                  className="chip"
                  key={v}
                  onClick={() => {
                    setQ(v);
                    void search(v, false);
                  }}
                >
                  {v}
                  <ArrowRight size={14} />
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 22 }}>
            <GraphEmbed compact />
          </div>
        </>
      ) : (
        <div className="part-layout">
          <section>
            <div className="section-top">
              <h2>{items.length ? `${items.length} ${items.length === 1 ? "result" : "results"}` : "No matches"}</h2>
              <span>Exact part number first</span>
            </div>
            {items.map((p) => (
              <button
                key={p.id + p.source}
                className={"part-card " + (selected?.id === p.id ? "selected" : "")}
                onClick={() => setSelected(details.current.get(p.id) || p)}
                aria-pressed={selected?.id === p.id}
              >
                <div className="part-icon">
                  <Box size={25} />
                </div>
                <div>
                  <h3>{p.mpn}</h3>
                  <small>{p.manufacturer || "Manufacturer not provided"}</small>
                  {p.description && <p>{p.description}</p>}
                  <div className="source-pills">
                    {p.category && <span>{p.category}</span>}
                    {p.package && <span>{p.package}</span>}
                    {p.lifecycle && <span>{p.lifecycle}</span>}
                    {p.source !== "Tindie parts database" && <span>{p.source}</span>}
                  </div>
                </div>
                <ArrowRight size={17} />
              </button>
            ))}
            {!items.length && !error && (
              <div className="notice">
                Nothing found. Try the full manufacturer part number, or the first few characters of it.
              </div>
            )}
          </section>
          <aside className="candidate-panel" aria-live="polite">
            {selected ? (
              <>
                <span className="eyebrow">Part details</span>
                <div className="part-title-actions">
                  <h3>{selected.mpn}</h3>
                  <GraphEmbed key={selected.mpn} mpn={selected.mpn} triggerOnly />
                </div>
                <p>
                  <b>{selected.manufacturer}</b>
                  {selected.category ? ` · ${selected.category}` : ""}
                  {selected.lifecycle ? ` · ${selected.lifecycle}` : ""}
                </p>
                {selected.description && <p>{selected.description}</p>}
                {detailState && <p className="muted">{detailState}</p>}
                {selected.id.startsWith("p_") && <CadPreview key={selected.id} partId={selected.id} mpn={selected.mpn} />}
                {selected.withheld?.length ? (
                  <p className="notice">
                    {selected.withheld.join(" and ")} withheld: the database has conflicting sources for this field
                    and does not publish it until reviewed.
                  </p>
                ) : null}
                <div className="source-pills">
                  {selected.datasheet && <DatasheetReader url={selected.datasheet} />}
                  {selected.productUrl && (
                    <a className="btn small" href={selected.productUrl} target="_blank" rel="noreferrer">
                      Manufacturer page <ExternalLink size={12} />
                    </a>
                  )}
                  {!selected.datasheet && selected.hasDatasheetInEzplm && (
                    <span className="pill muted">Datasheet on file (not public)</span>
                  )}
                </div>
                {(selected.symbolName || selected.footprintName) && (
                  <dl className="spec-list">
                    {selected.symbolName && (
                      <div>
                        <dt>Symbol</dt>
                        <dd>
                          {selected.symbolName}
                          {fs.symbol && <span className="field-source">{SOURCE_LABEL[fs.symbol] || fs.symbol}</span>}
                        </dd>
                      </div>
                    )}
                    {selected.footprintName && (
                      <div>
                        <dt>Footprint</dt>
                        <dd>
                          {selected.footprintName}
                          {fs.footprint && <span className="field-source">{SOURCE_LABEL[fs.footprint] || fs.footprint}</span>}
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
                {Object.keys(selected.parameters).length > 0 && (
                  <dl className="spec-list">
                    {Object.entries(selected.parameters).map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd>
                          {v}
                          {fs[k] && <span className="field-source">{SOURCE_LABEL[fs[k]] || fs[k]}</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div className="source-pills">
                  <button className="btn" onClick={sendToPlanner}>
                    Add to PCB planner
                    <ArrowRight size={14} />
                  </button>
                </div>
                <h4 style={{ marginTop: 22, fontWeight: 600 }}>
                  Open hardware using this part{refsTotal ? ` · ${refsTotal}` : ""}
                </h4>
                {refsState && <p className="muted">{refsState}</p>}
                {refs.map((r) => (
                  <a key={r.id} className="design-row" href={"/tools/circuits?design=" + encodeURIComponent(r.id)}>
                    <b>{r.name}</b>
                    <small>
                      {r.kind === "vendor" ? "Vendor reference design" : `Open source · ${r.license || "licence not stated"}`}
                      {r.stars !== null ? (
                        <>
                          {" · "}
                          <Star size={11} style={{ verticalAlign: -1 }} /> {r.stars.toLocaleString()}
                        </>
                      ) : null}
                      {" · "}
                      {r.partCount} identified parts
                    </small>
                  </a>
                ))}
                <a
                  className="btn primary"
                  style={{ marginTop: 14 }}
                  href={"/tools/circuits?mpn=" + encodeURIComponent(selected.mpn)}
                >
                  <CircuitBoard size={15} />
                  Browse designs with this part
                </a>
              </>
            ) : (
              <>
                <Box size={25} />
                <h3>Select a component</h3>
                <p>Inspect specifications, open a datasheet or view the KiCad symbol, footprint and 3D model.</p>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
