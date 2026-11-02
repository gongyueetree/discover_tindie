"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search, ExternalLink, Box, ArrowRight } from "lucide-react";
import GraphEmbed from "./GraphEmbed";
import DatasheetReader from "./DatasheetReader";
import CadPreview from "./CadPreview";
import { ToolHeading } from "./ToolShell";
import type { Part, ProviderStatus } from "@/lib/maker/types";
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
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [searched, setSearched] = useState(false),
    [refs, setRefs] = useState<
      {
        id: string;
        projectName: string;
        designators?: string[];
        matchedMpn?: string;
      }[]
    >([]),
    [refsState, setRefsState] = useState("");
  async function search(v = q, requireExact = false) {
    setBusy(true);
    setError("");
    setSelected(null);

    try {
      const r = await fetch("/api/maker/parts?q=" + encodeURIComponent(v));
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setItems(d.items);
      const exactPart = (d.items as Part[]).find(
        (p) =>
          p.mpn.toUpperCase() === v.toUpperCase() &&
          (!targetPartId || p.id === targetPartId) &&
          (!targetManufacturer ||
            p.manufacturer.toUpperCase() === targetManufacturer.toUpperCase() ||
            (/^ST(?:MICROELECTRONICS)?$/i.test(p.manufacturer) &&
              /^ST(?:MICROELECTRONICS)?$/i.test(targetManufacturer))),
      );
      setSelected(requireExact ? exactPart || null : d.items[0] || null);
      if (requireExact && !exactPart)
        setError(
          "The exact MPN is not available from the connected catalog. Related results are listed below; no substitute was selected.",
        );
      setSources(d.sources);
      setSearched(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const v = initialQuery;
    if (v) {
      setQ(v);
      void search(v, exact);
    }
  }, [initialQuery, exact, targetManufacturer, targetPartId]);
  useEffect(() => {
    setRefs([]);
    if (!selected) return;
    const ac = new AbortController();
    setRefsState("Loading open engineering projects…");
    fetch("/api/maker/references/" + encodeURIComponent(selected.mpn), {
      signal: ac.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setRefs(d.items || []);
        setRefsState(
          d.items?.length
            ? ""
            : "No indexed open engineering project contains this exact part number.",
        );
      })
      .catch((e) => {
        if (!ac.signal.aborted) setRefsState(e.message);
      });
    return () => ac.abort();
  }, [selected?.mpn]);
  function sendToPlanner() {
    if (!selected) return;
    sessionStorage.setItem("maker-planner-parts", JSON.stringify([selected]));
    location.href = "/tools/planner?import=components";
  }

  return (
    <>
      <ToolHeading
        eyebrow="COMPONENT EXPLORER"
        title="Find the right part. See the whole picture."
        description="Search part numbers, specifications and CAD assets from the connected eelib catalogue."
      />
      <GraphEmbed compact mpn={selected?.mpn || ""} />
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
          placeholder="Try AD9102, STM32F103 or a component specification"
          minLength={2}
          required
        />
        <button className="btn primary" disabled={busy}>
          {busy ? "Searching…" : "Search components"}
        </button>
      </form>
      <div className="source-status">
        {sources.map((s) => (
          <span key={s.source} className={s.status} title={s.message}>
            {s.source} ·{" "}
            {s.status === "unconfigured"
              ? "direct API not configured"
              : s.status}
          </span>
        ))}
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!searched && !busy ? (
        <div className="dropzone">
          <Box size={42} />
          <h2>From part number to project.</h2>
          <p>
            Datasheets, footprints, 3D models and related open hardware in one
            place.
          </p>
          <div className="source-pills">
            {["AD9102", "ESP32", "STM32F103"].map((v) => (
              <button
                className="btn"
                key={v}
                onClick={() => {
                  setQ(v);
                  void search(v, exact);
                }}
              >
                {v}
                <ArrowRight size={14} />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="part-layout">
          <section>
            <div className="section-top">
              <h2>{items.length ? `${items.length} results` : "No matches"}</h2>
              <span>Live catalogue · exact variants shown separately</span>
            </div>
            {items.map((p) => (
              <button
                key={p.id + p.source}
                className={
                  "part-card " + (selected?.id === p.id ? "selected" : "")
                }
                onClick={() => setSelected(p)}
              >
                <div className="part-icon">
                  <Box size={25} />
                </div>
                <div>
                  <h3>{p.mpn}</h3>
                  <small>{p.manufacturer}</small>
                  <p>{p.description}</p>
                  <div className="source-pills">
                    <span>{p.package || "Package not provided"}</span>
                    <span>{p.source}</span>
                    {p.cad.length > 0 && <span>{p.cad.length} CAD assets</span>}
                  </div>
                </div>
                <ArrowRight size={17} />
              </button>
            ))}
            {!items.length && (
              <div className="notice">
                No parts returned. Check provider status or try a full
                manufacturer part number.
              </div>
            )}
          </section>
          <aside className="candidate-panel">
            {selected ? (
              <>
                <span className="eyebrow">PART DETAILS</span>
                <div className="part-title-actions">
                  <h3>{selected.mpn}</h3>
                  <GraphEmbed
                    key={selected.mpn}
                    mpn={selected.mpn}
                    triggerOnly
                  />
                </div>
                <p>{selected.manufacturer}</p>
                <p>{selected.description}</p>
                <CadPreview key={selected.id} mpn={selected.mpn} />
                <div className="source-pills">
                  {selected.datasheet && (
                    <DatasheetReader url={selected.datasheet} />
                  )}
                  {selected.cad.map((c) => (
                    <a
                      className="btn small"
                      key={c.kind}
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.name}
                      <ExternalLink size={12} />
                    </a>
                  ))}
                </div>
                <dl className="spec-list">
                  {Object.entries(selected.parameters).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <button className="btn" onClick={sendToPlanner}>
                  Add to PCB layout
                  <ArrowRight size={14} />
                </button>
                <h4 style={{ marginTop: 22, fontWeight: 600 }}>
                  Open engineering projects
                </h4>
                <p>{refsState}</p>
                {refs.map((r, i) => (
                  <a
                    className="text-link"
                    style={{ display: "block", margin: "10px 0" }}
                    key={i}
                    href={"/tools/circuits?project=" + encodeURIComponent(r.id)}
                  >
                    {r.projectName}
                    <small style={{ display: "block" }}>
                      {r.matchedMpn} · {r.designators?.join(", ")}
                    </small>
                  </a>
                ))}
                <a
                  className="btn primary"
                  href={
                    "/tools/circuits?mpn=" + encodeURIComponent(selected.mpn)
                  }
                >
                  Explore this part and family in Circuit Explorer
                  <ArrowRight size={14} />
                </a>
              </>
            ) : (
              <>
                <Box size={25} />
                <h3>Select a component</h3>
                <p>
                  Inspect specifications, open a datasheet or download available
                  CAD files.
                </p>
              </>
            )}
          </aside>
        </div>
      )}
    </>
  );
}
