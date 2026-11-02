"use client";
import { useEffect, useRef, useState } from "react";
import { Search, ArrowRight, CircuitBoard, Star, ExternalLink, Upload, Github } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import ProjectViewerModal, { type ProjectRequest } from "./ProjectViewerModal";
import { ToolHeading } from "./ToolShell";

type Design = {
  id: string;
  name: string;
  kind: "open_source" | "vendor";
  sourceUrl: string;
  license: string | null;
  stars: number | null;
  edaTool: string | null;
  partCount: number;
  summary: string | null;
  coverImageUrl?: string | null;
};
type Family = { family: string; label: string; manufacturer: string; kind: string; designs: number };
type Filter = { family?: string; mpn?: string; label?: string };

const KINDS = [
  { id: "ic", label: "ICs" },
  { id: "discrete", label: "Discretes" },
  { id: "electromech", label: "Connectors & switches" },
  { id: "", label: "All" },
];

/**
 * Open hardware. The parts database has no "list every design" endpoint by design (anti-scraping),
 * so designs are reached through component families — the knowledge graph's most-used families
 * are the browse entry points — or by part number.
 */
export default function Circuits() {
  const params = useSearchParams(),
    router = useRouter();
  const queryString = params.toString();
  const [viewer, setViewer] = useState<ProjectRequest | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState("ic");
  const [families, setFamilies] = useState<Family[]>([]);
  const [denominator, setDenominator] = useState(0);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Design[]>([]);
  const [total, setTotal] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(queryString);
    if (p.has("design") || p.has("example") || p.has("open"))
      setViewer({ search: queryString, mode: p.get("open") || "" });
  }, [queryString]);

  function closeViewer() {
    setViewer(null);
    const p = new URLSearchParams(queryString);
    for (const k of ["design", "project", "example", "open"]) p.delete(k);
    if (p.toString() !== queryString) router.replace("/tools/circuits" + (p.size ? "?" + p : ""), { scroll: false });
  }
  function openDesign(id: string) {
    const p = new URLSearchParams(queryString);
    p.set("design", id);
    router.replace("/tools/circuits?" + p, { scroll: false });
  }

  async function load(f: Filter, offset = 0) {
    setBusy(true);
    setError("");
    if (!offset) setNote("");
    try {
      const p = new URLSearchParams({ offset: String(offset) });
      if (f.family) p.set("family", f.family);
      if (f.mpn) p.set("mpn", f.mpn);
      const r = await fetch("/api/maker/circuits?" + p);
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setItems((old) => (offset ? [...old, ...d.items] : d.items));
      setTotal(d.total || 0);
      if (d.widened)
        setNote(`No design uses ${f.mpn} exactly; showing designs with the ${d.family} family.`);
      const url = new URL(location.href);
      for (const k of ["family", "mpn"]) url.searchParams.delete(k);
      if (f.family) url.searchParams.set("family", f.family);
      if (f.mpn) url.searchParams.set("mpn", f.mpn);
      history.replaceState(null, "", url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (!offset) {
        setItems([]);
        setTotal(0);
      }
    } finally {
      setBusy(false);
    }
  }
  function choose(f: Filter) {
    setFilter(f);
    void load(f);
  }

  async function loadFamilies(k: string) {
    try {
      const r = await fetch("/api/maker/families?" + new URLSearchParams({ kind: k }));
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setFamilies(d.items || []);
      setDenominator(d.denominator || 0);
      return (d.items || []) as Family[];
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return [];
    }
  }

  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const mpn = p.get("mpn") || "";
    const family = p.get("family") || "";
    void loadFamilies(kind).then((list) => {
      if (mpn) {
        setQ(mpn);
        choose({ mpn, label: mpn });
      } else if (family) choose({ family, label: list.find((f) => f.family === family)?.label || family });
      else if (list[0]) choose({ family: list[0].family, label: list[0].label });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const heading = filter?.mpn
    ? `Designs using ${filter.mpn}`
    : filter?.family
      ? `Designs using ${filter.label || filter.family}`
      : "Designs";

  return (
    <>
      <ToolHeading
        eyebrow="Open hardware"
        title="Learn from real designs"
        description="Open-source boards and vendor reference designs that use real parts. Open one to explore its schematic, PCB, 3D view and BOM — or open your own files."
        actions={
          <>
            <button className="btn primary" onClick={() => upload.current?.click()}>
              <Upload size={15} />
              Open your files
            </button>
            <button className="btn" onClick={() => setViewer({ search: "", mode: "github" })}>
              <Github size={15} />
              Import from GitHub
            </button>
          </>
        }
      />
      <input
        type="file"
        ref={upload}
        hidden
        multiple
        accept=".zip,.kicad_sch,.kicad_pcb,.kicad_pro,.sch,.brd,.lbr,.step,.stp,.wrl,.SchDoc,.PcbDoc"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) setViewer({ search: "", files });
          e.target.value = "";
        }}
      />
      {viewer && <ProjectViewerModal request={viewer} onClose={closeViewer} />}
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          const v = q.trim();
          if (v.length >= 3) choose({ mpn: v, label: v });
        }}
      >
        <Search size={19} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find designs by part number, e.g. STM32F103C8T6 or ESP32-S3"
          aria-label="Find designs by part number"
          minLength={3}
        />
        <button className="btn primary" disabled={busy}>
          Find designs
        </button>
      </form>

      <div className="family-browser">
        <div className="family-head">
          <b>Popular component families</b>
          <span className="muted">
            {denominator ? `Ranked by how many of ${denominator.toLocaleString()} open designs use them` : ""}
          </span>
          <div className="kind-switch" role="group" aria-label="Family type">
            {KINDS.map((k) => (
              <button
                key={k.id || "all"}
                className={"chip " + (kind === k.id ? "active" : "")}
                aria-pressed={kind === k.id}
                onClick={() => {
                  setKind(k.id);
                  void loadFamilies(k.id);
                }}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <div className="chip-row">
          {families.map((f) => (
            <button
              key={f.family}
              className={"chip " + (filter?.family === f.family ? "active" : "")}
              aria-pressed={filter?.family === f.family}
              title={f.manufacturer ? `${f.label} · ${f.manufacturer}` : f.label}
              onClick={() => {
                setQ("");
                choose({ family: f.family, label: f.label });
              }}
            >
              {f.label}
              <small>{f.designs}</small>
            </button>
          ))}
          {!families.length && !error && <span className="muted">Loading families…</span>}
        </div>
      </div>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {note && <div className="notice info">{note}</div>}
      <div className="section-top">
        <h2>{heading}</h2>
        <span>
          {total ? `${total.toLocaleString()} ${total === 1 ? "design" : "designs"}` : ""}
          {(() => {
            const counted = families.find((f) => f.family === filter?.family)?.designs || 0;
            return counted > total && total
              ? ` published (of ${counted} that use it; the rest are not yet reviewed for publishing)`
              : "";
          })()}{" "}
          · open source first, then by GitHub stars
        </span>
      </div>
      <div className="catalog-grid">
        {items.map((p) => (
          <article className="project-card" key={p.id}>
            <a
              className="project-thumbnail"
              href={"/tools/circuits?design=" + p.id}
              onClick={(e) => {
                e.preventDefault();
                openDesign(p.id);
              }}
              aria-label={"Open " + p.name}
            >
              {p.coverImageUrl ? (
                <img src={p.coverImageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
              ) : (
                <div className="thumb-placeholder">
                  <CircuitBoard size={38} />
                  <b>{p.edaTool || (p.kind === "vendor" ? "Reference design" : "Open hardware")}</b>
                </div>
              )}
            </a>
            <div className="project-info">
              <small>{p.kind === "vendor" ? "Vendor reference design" : "Open source"}</small>
              <h3>{p.name}</h3>
              {p.summary && <p>{p.summary}</p>}
              <div className="source-pills" style={{ margin: "4px 0" }}>
                <span>{p.partCount} identified parts</span>
                {p.stars !== null && (
                  <span>
                    <Star size={11} /> {p.stars.toLocaleString()}
                  </span>
                )}
                {p.license && <span>{p.kind === "vendor" ? "Vendor terms" : p.license}</span>}
              </div>
              <div className="project-actions">
                <button className="text-link" onClick={() => openDesign(p.id)}>
                  {p.kind === "vendor" ? "View details" : "Open design"}
                  <ArrowRight size={14} />
                </button>
                {p.sourceUrl && (
                  <a className="btn small" href={p.sourceUrl} target="_blank" rel="noreferrer" aria-label={"Source of " + p.name}>
                    Source <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>
      {busy && <p className="notice">Loading designs…</p>}
      {!busy && !error && filter && !items.length && (
        <p className="notice">No published design uses this part yet. Try its family name, e.g. the first part of the number.</p>
      )}
      {items.length < Math.min(total, 100) && filter && (
        <div style={{ textAlign: "center", margin: 24 }}>
          <button disabled={busy} className="btn" onClick={() => void load(filter, items.length)}>
            Load more designs
          </button>
        </div>
      )}
      {total > 100 && items.length >= 100 && (
        <p className="muted" style={{ textAlign: "center" }}>
          Showing the first 100. Narrow the search with a full part number.
        </p>
      )}
    </>
  );
}
