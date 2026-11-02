"use client";
import { useEffect, useState, useRef } from "react";
import { Search, Download, ArrowRight, CircuitBoard } from "lucide-react";
import { useSearchParams, useRouter } from "next/navigation";
import ProjectViewerModal, { type ProjectRequest } from "./ProjectViewerModal";
import { byStars } from "@/lib/maker/circuit-metadata";
import { ToolHeading } from "./ToolShell";
import { download } from "@/lib/maker/download";
export default function Circuits() {
  const params = useSearchParams(),
    router = useRouter();
  const queryString = params.toString();
  const [viewer, setViewer] = useState<ProjectRequest | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const p = new URLSearchParams(queryString);
    if (p.has("project") || p.has("example") || p.has("open"))
      setViewer({ search: queryString, mode: p.get("open") || "" });
  }, [queryString]);
  function closeViewer() {
    setViewer(null);
    const p = new URLSearchParams(queryString);
    for (const k of ["project", "example", "open"]) p.delete(k);
    if (p.toString() !== queryString)
      router.replace("/tools/circuits" + (p.size ? "?" + p : ""), {
        scroll: false,
      });
  }

  const [ordering, setOrdering] = useState("catalogue");
  const [q, setQ] = useState(""),
    [items, setItems] = useState<any[]>([]),
    [total, setTotal] = useState(0),
    [cursor, setCursor] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [mpn, setMpn] = useState(""),
    [module, setModule] = useState(""),
    [facets, setFacets] = useState<{ id: string; designFiles: number }[]>([]);
  async function search(query = q, next = "", part = mpn, mod = module) {
    setBusy(true);
    setError("");
    try {
      const p = new URLSearchParams({ q: query });
      if (next) p.set("cursor", next);
      if (part) p.set("mpn", part);
      if (mod) p.set("module", mod);
      const r = await fetch("/api/maker/circuits?" + p);
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setOrdering(d.ordering || "catalogue");
      setItems((old) => {
        const rows = next ? [...old, ...d.items] : d.items;
        return d.ordering === "stars_desc"
          ? rows
          : rows.some(
                (p: any) =>
                  p.githubStars !== null && p.githubStars !== undefined,
              )
            ? [...rows].sort(byStars)
            : rows;
      });
      setTotal(d.total);
      setFacets(d.facets?.modules || []);
      setCursor(d.nextCursor || "");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const p = new URLSearchParams(location.search);
    const m = p.get("mpn") || "";
    setMpn(m);
    void search("", "", m);
  }, []);
  async function zip(id: string) {
    setError("");
    try {
      const r = await fetch(`/api/maker/circuits/${id}/download`);
      if (!r.ok) throw Error((await r.json()).error);
      download(new Uint8Array(await r.arrayBuffer()), id + ".zip");
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <>
      <ToolHeading
        actions={
          <>
            <button
              className="btn primary"
              onClick={() => upload.current?.click()}
            >
              Upload project
            </button>
            <button
              className="btn"
              onClick={() => setViewer({ search: "", mode: "github" })}
            >
              Import GitHub URL
            </button>
          </>
        }
        eyebrow="CIRCUIT EXPLORER"
        title="A head start for your next build."
        description="Browse real open hardware projects from CircuitAtlas. Inspect the design before making it your own."
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
          void search();
        }}
      >
        <Search size={19} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search project names, modules or boards"
          aria-label="Search projects"
        />
        <button className="btn primary" disabled={busy}>
          Search projects
        </button>
      </form>
      <div className="source-pills">
        <button
          className={"btn small " + (!module ? "primary" : "")}
          onClick={() => {
            setModule("");
            void search(q, "", mpn, "");
          }}
        >
          All modules
        </button>
        {facets.map((f) => (
          <button
            className={"btn small " + (module === f.id ? "primary" : "")}
            key={f.id}
            onClick={() => {
              setModule(f.id);
              void search(q, "", mpn, f.id);
            }}
          >
            {(
              {
                pwr: "Power",
                mcu: "MCU",
                hmi: "Interface",
                wire: "Wired",
                clk: "Clock",
                prot: "Protection",
                ana: "Analog",
                sense: "Sensors",
                wl: "Wireless",
                audio: "Audio",
                rf: "RF",
                motor: "Motor",
                mem: "Memory",
                logic: "Logic",
              } as Record<string, string>
            )[f.id] || f.id}{" "}
            · {f.designFiles}
          </button>
        ))}
      </div>
      {mpn && (
        <div className="notice">
          Projects associated with {mpn}{" "}
          <button
            className="btn small"
            onClick={() => {
              setMpn("");
              void search(q, "", "");
            }}
          >
            Clear filter
          </button>
        </div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <div className="section-top">
        <h2>
          {error && !items.length
            ? "Catalogue unavailable"
            : `${total.toLocaleString()} open projects`}
        </h2>
        <span>
          {ordering === "stars_desc"
            ? "GitHub stars · highest first"
            : "GitHub Star ranking unavailable"}{" "}
          · source licences apply
        </span>
      </div>
      <div className="catalog-grid">
        {items.map((p) => (
          <article className="project-card" key={p.id}>
            <a
              className="project-thumbnail"
              href={"/tools/circuits?project=" + p.id}
              onClick={(e) => {
                e.preventDefault();
                setViewer({
                  search: new URLSearchParams({ project: p.id }).toString(),
                });
              }}
            >
              <CircuitThumbnail project={p} />
              <span className="badge">{p.edaTool || "EDA project"}</span>
            </a>
            <div className="project-info">
              <small>{p.category?.name || "OPEN HARDWARE"}</small>
              <h3>{p.projectName}</h3>
              <p>{p.itemCount ?? "—"} BOM items</p>
              <div className="project-metadata">
                <span>
                  ★{" "}
                  {p.githubStars === null || p.githubStars === undefined
                    ? "Stars unavailable"
                    : p.githubStars.toLocaleString()}
                </span>
                <span>License: {p.license?.declared || "Not declared"}</span>
              </div>
              <div className="source-pills">
                {(p.modules || []).slice(0, 3).map((m: string) => (
                  <span key={m}>{m}</span>
                ))}
              </div>
              <div className="project-actions">
                <a
                  className="text-link"
                  href={"/tools/circuits?project=" + p.id}
                  onClick={(e) => {
                    e.preventDefault();
                    setViewer({
                      search: new URLSearchParams({ project: p.id }).toString(),
                    });
                  }}
                >
                  View project
                  <ArrowRight size={14} />
                </a>
                <button
                  className="btn small"
                  onClick={() => void zip(p.id)}
                  aria-label={"Download " + p.projectName}
                >
                  <Download size={14} />
                  ZIP
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {busy && <p className="notice">Loading catalogue…</p>}
      {!busy && !error && !items.length && (
        <p className="notice">No matching projects found.</p>
      )}
      {cursor && (
        <div style={{ textAlign: "center", margin: 24 }}>
          <button
            disabled={busy}
            className="btn"
            onClick={() => void search(q, cursor)}
          >
            Load more projects
          </button>
        </div>
      )}
    </>
  );
}

function CircuitThumbnail({project}: {project:any}) {
  const sources = [project.thumbnail?.pcb, project.thumbnail?.schematic]
    .map(image => image?.sha256).filter((hash): hash is string => typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash));
  const sourceKey=sources.join(",");
  const [index,setIndex] = useState(0);
  useEffect(()=>setIndex(0),[sourceKey]);
  return sources[index] ? <img src={"/api/maker/thumbnail/" + sources[index] + ".svg"}
    alt={"Design preview of " + project.projectName} loading="lazy" onError={()=>setIndex(i=>i+1)} />
    : <div className="thumbnail-unavailable"><CircuitBoard size={40}/><small>Preview not available</small></div>;
}
