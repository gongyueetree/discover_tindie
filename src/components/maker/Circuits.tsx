"use client";
/**
 * Open hardware, laid out like eelib's CircuitAtlas (eelib-web/app/tools/circuit-atlas):
 * one search box, Designs | Modules tabs, top-level circuit-module chips with a sub-module
 * select, a card grid, and the module tree as cards. Data: partdata designs filtered by
 * circuit module (ezplm_partdata module classification), Tindie's rules applied server-side
 * (full KiCad / EAGLE / Altium / EasyEDA / JLCEDA files, at least one GitHub star).
 */
import Linkify from "./Linkify";
import { checkUsable } from "@/lib/maker/usable-client";
import GraphEmbed from "./GraphEmbed";
import { useEffect, useMemo, useRef, useState } from "react";
import SupportedFormats, { CAD_ACCEPT } from "./SupportedFormats";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, BadgeCheck, Boxes, CircuitBoard, ExternalLink, FileSpreadsheet, Github, ImageOff, Search, Star, Upload } from "lucide-react";
import ProjectViewerModal, { type ProjectRequest } from "./ProjectViewerModal";
import { ToolHeading } from "./ToolShell";

type Design = {
  id: string;
  name: string;
  kind: "open_source" | "vendor";
  vendor?: string | null;
  sourceUrl: string;
  license: string | null;
  stars: number | null;
  edaTool: string | null;
  partCount: number;
  summary: string | null;
  coverImageUrl?: string | null;
  boardPreview?: boolean;
};
type ModuleNode = { id: string; parent: string | null; name: string; depth: number; minor: boolean; children: ModuleNode[] };
type Listing = { items: Design[]; total: number; family?: string; widened?: boolean; approximate?: boolean };

const DEFAULT_MODULE = "mcu";

export default function Circuits() {
  const params = useSearchParams(),
    router = useRouter();
  const queryString = params.toString();
  const [viewer, setViewer] = useState<ProjectRequest | null>(null);
  const upload = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"designs" | "modules">(params.get("tab") === "modules" ? "modules" : "designs");
  const [tree, setTree] = useState<ModuleNode[]>([]);
  const [showMinor, setShowMinor] = useState(false);
  const [module, setModule] = useState(params.get("module") || (params.get("mpn") ? "" : DEFAULT_MODULE));
  const [mpn, setMpn] = useState(params.get("mpn") || "");
  const [q, setQ] = useState(params.get("mpn") || "");
  const [list, setList] = useState<Listing | null>(null);
  // Designs whose repository turned out to hold no openable engineering files (checked per card).
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const hiddenHere = (list?.items || []).filter((d) => hidden.has(d.id)).length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(queryString);
    if (p.has("design") || p.has("example") || p.has("open")) setViewer({ search: queryString, mode: p.get("open") || "" });
  }, [queryString]);

  useEffect(() => {
    fetch("/api/maker/modules")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setTree(d.items || []);
      })
      .catch((e) => setError(e.message));
  }, []);

  const byId = useMemo(() => {
    const m = new Map<string, ModuleNode>();
    const walk = (ns: ModuleNode[]) => ns.forEach((n) => (m.set(n.id, n), walk(n.children)));
    walk(tree);
    return m;
  }, [tree]);
  const top = module ? module.split(".")[0] : "";
  const topNode = byId.get(top);
  const moduleName = (id: string) => byId.get(id)?.name || id;

  async function load(next: { module?: string; mpn?: string }, offset = 0) {
    setBusy(true);
    setError("");
    try {
      const p = new URLSearchParams({ offset: String(offset) });
      if (next.mpn) p.set("mpn", next.mpn);
      else if (next.module) p.set("module", next.module);
      else return;
      const r = await fetch("/api/maker/circuits?" + p);
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setList((old) => (offset && old ? { ...d, items: [...old.items, ...d.items] } : d));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (!offset) setList(null);
    } finally {
      setBusy(false);
    }
  }

  function syncUrl(next: Record<string, string>) {
    const p = new URLSearchParams(queryString);
    for (const k of ["module", "mpn", "tab"]) p.delete(k);
    for (const [k, v] of Object.entries(next)) if (v) p.set(k, v);
    router.replace("/tools/circuits" + (p.size ? "?" + p : ""), { scroll: false });
  }
  function chooseModule(id: string) {
    setTab("designs");
    setModule(id);
    setMpn("");
    setQ("");
    syncUrl({ module: id });
  }
  function searchPart(v: string) {
    if (v.trim().length < 3) return;
    setTab("designs");
    setMpn(v.trim());
    setModule("");
    syncUrl({ mpn: v.trim() });
  }
  useEffect(() => {
    if (tab !== "designs") return;
    void load(mpn ? { mpn } : { module });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mpn, module, tab]);

  function openDesign(id: string) {
    const p = new URLSearchParams(queryString);
    p.set("design", id);
    router.replace("/tools/circuits?" + p, { scroll: false });
  }
  function closeViewer() {
    setViewer(null);
    const p = new URLSearchParams(queryString);
    for (const k of ["design", "project", "example", "open"]) p.delete(k);
    router.replace("/tools/circuits" + (p.size ? "?" + p : ""), { scroll: false });
  }

  const tops = tree.filter((n) => showMinor || !n.minor);
  const subOptions: { id: string; name: string; depth: number }[] = [];
  const addSub = (n: ModuleNode, depth: number) => {
    if (!showMinor && n.minor) return;
    subOptions.push({ id: n.id, name: n.name, depth });
    n.children.forEach((c) => addSub(c, depth + 1));
  };
  topNode?.children.forEach((c) => addSub(c, 0));

  const heading = mpn
    ? list?.widened
      ? `Designs with the ${list.family} family`
      : `Designs using ${mpn}`
    : module
      ? moduleName(module)
      : "Designs";

  return (
    <>
      <ToolHeading
        eyebrow="Open hardware"
        title="Learn from real designs"
        description="Manufacturers' reference designs and open-source boards with full KiCad, EAGLE, Altium or EasyEDA / JLCEDA files, organised by circuit module. Open one to explore its schematic, PCB, 3D view and BOM — or open your own files."
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
        accept={CAD_ACCEPT}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) setViewer({ search: "", files });
          e.target.value = "";
        }}
      />
      {viewer && <ProjectViewerModal request={viewer} onClose={closeViewer} />}
      <SupportedFormats />

      <form
        className="search-bar"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          searchPart(q);
        }}
      >
        <Search size={19} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find designs by part number, e.g. STM32F103C8T6 or ESP32-S3"
          aria-label="Find designs by part number"
          minLength={3}
          maxLength={120}
        />
        <button className="btn primary" disabled={busy}>
          Find designs
        </button>
      </form>

      <nav className="atlas-tabs" aria-label="Open hardware views">
        {(["designs", "modules"] as const).map((id) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              syncUrl(id === "modules" ? { tab: "modules" } : mpn ? { mpn } : { module });
            }}
          >
            {id === "designs" ? "Designs" : "Circuit modules"}
          </button>
        ))}
      </nav>

      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      {tab === "modules" ? (
        <section className="atlas-modules">
          <p className="muted">
            Circuit modules are recognised from each design&apos;s BOM. Pick one to see the designs that contain it.
          </p>
          <button className="text-link" onClick={() => setShowMinor((v) => !v)}>
            {showMinor ? "Hide helper circuits" : "Show helper circuits (buttons, crystals, connectors…)"}
          </button>
          <ul className="atlas-module-grid">
            {tops.map((t) => (
              <li key={t.id} className="atlas-module-card">
                <button className="atlas-module-top" onClick={() => chooseModule(t.id)}>
                  <Boxes size={16} aria-hidden />
                  {t.name}
                </button>
                <ul>
                  {t.children
                    .filter((c) => showMinor || !c.minor)
                    .map((c) => (
                      <li key={c.id}>
                        <button onClick={() => chooseModule(c.id)}>
                          {c.name}
                          {c.minor ? <small> · helper</small> : null}
                        </button>
                        {c.children.length ? (
                          <ul className="atlas-module-leaves">
                            {c.children.map((l) => (
                              <li key={l.id}>
                                <button onClick={() => chooseModule(l.id)}>{l.name}</button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="atlas-designs">
          <div className="atlas-chips" role="group" aria-label="Circuit modules">
            {tops.map((t) => (
              <button key={t.id} className={"chip " + (top === t.id && !mpn ? "active" : "")} aria-pressed={top === t.id && !mpn} onClick={() => chooseModule(t.id)}>
                {t.name}
              </button>
            ))}
            {!tree.length && !error && <span className="muted">Loading circuit modules…</span>}
          </div>
          {topNode && !mpn && (
            <div className="atlas-sub-row">
              {subOptions.length > 0 ? (
            <label className="atlas-sub">
              Sub-module
              <select value={module} onChange={(e) => chooseModule(e.target.value)}>
                <option value={topNode.id}>All {topNode.name.toLowerCase()}</option>
                {subOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {"  ".repeat(o.depth)}
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
              ) : (
                <span />
              )}
              <GraphEmbed key={"module:" + module} module={module} moduleName={moduleName(module)} triggerOnly label="Common parts" />
            </div>
          )}
          {list?.approximate && (
            <div className="notice info">
              The parts database does not filter by circuit module yet; these are designs using this module&apos;s most common components.
            </div>
          )}
          {list?.widened && <div className="notice info">No published design uses {mpn} exactly; showing designs with the {list.family} family.</div>}
          <div className="section-top">
            <h2>{heading}</h2>
            <span>
              {list ? `${list.total.toLocaleString()} ${list.total === 1 ? "design" : "designs"}` : ""} · vendor reference designs · open source with full CAD files and 1★ or more
            </span>
          </div>
          <ul className="atlas-grid">
            {(list?.items || []).map((d) => (
              <DesignCard key={d.id} d={d} onOpen={() => openDesign(d.id)} onUnusable={() => setHidden((h) => new Set(h).add(d.id))} />
            ))}
          </ul>
          {hiddenHere > 0 && (
            <p className="muted atlas-hidden-note">
              {hiddenHere} {hiddenHere === 1 ? "design is" : "designs are"} hidden here: {hiddenHere === 1 ? "its repository has" : "their repositories have"} no
              engineering files this viewer can open (for example, files stored with Git LFS).
            </p>
          )}
          {busy && <p className="notice">Loading designs…</p>}
          {!busy && list && !list.items.length && !error && (
            <div className="atlas-empty">
              <CircuitBoard size={28} aria-hidden />
              <b>No published designs here yet</b>
              <span>Try a broader circuit module, or search by part number.</span>
            </div>
          )}
          {list && list.items.length < list.total && (
            <div style={{ textAlign: "center", margin: 24 }}>
              <button disabled={busy} className="btn" onClick={() => void load(mpn ? { mpn } : { module }, list.items.length)}>
                Load more designs
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

/** owner/repo and folder of a GitHub design kept in a folder of a repository (null otherwise). */
function repoFolder(url: string | undefined) {
  const m = (url || "").match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)\/tree\/[^/]+\/(.+?)\/?$/);
  return m ? { repo: m[1], folder: decodeURIComponent(m[2]) } : null;
}

/** eelib CircuitAtlas DesignCard: picture (or "no preview"), name, facts, licence at the bottom. */
function DesignCard({ d, onOpen, onUnusable }: { d: Design; onOpen: () => void; onUnusable: () => void }) {
  const [gone, setGone] = useState(false);
  const host = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (d.kind !== "open_source" || !host.current) return;
    const el = host.current;
    let alive = true;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void checkUsable(d.id).then((ok) => {
          if (alive && ok === false) {
            setGone(true);
            onUnusable();
          }
        });
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [d.id, d.kind]); // eslint-disable-line react-hooks/exhaustive-deps
  if (gone) return null;
  return (
    <li className="atlas-card" ref={host}>
      <button className="atlas-card-pic" onClick={onOpen} tabIndex={-1} aria-hidden>
        {d.kind === "open_source" ? (
          <CardPicture d={d} />
        ) : d.kind === "vendor" ? (
          <CardPicture d={d} vendor />
        ) : (
          <span className="atlas-card-nopic">
            <ImageOff size={20} aria-hidden />
            No preview
          </span>
        )}
      </button>
      <div className="atlas-card-body">
        {(d.kind === "vendor" || d.vendor) && (
          <span className="vendor-badge" title={d.kind === "vendor" ? "Published by the manufacturer" : `Published by ${d.vendor} on its own GitHub organisation`}>
            <BadgeCheck size={13} aria-hidden /> {d.kind === "vendor" ? "Reference design" : "Manufacturer design"}
            {d.vendor ? ` · ${d.vendor}` : ""}
          </span>
        )}
        <div>
          <button className="atlas-card-name" onClick={onOpen}>
            {d.name}
          </button>
          {d.summary && (
            <p className="atlas-card-summary">
              <Linkify text={d.summary} />
            </p>
          )}
          {(() => {
            const where = d.kind === "open_source" ? repoFolder(d.sourceUrl) : null;
            return where ? (
              <p className="atlas-card-where" title={`One board of the ${where.repo} repository, in ${where.folder}`}>
                In {where.repo} · {where.folder}
              </p>
            ) : null;
          })()}
        </div>
        <div className="atlas-card-facts">
          <span>
            <FileSpreadsheet size={12} aria-hidden /> {d.partCount} identified parts
          </span>
          {d.edaTool && (
            <span>
              <CircuitBoard size={12} aria-hidden /> {d.edaTool}
            </span>
          )}
          {d.stars !== null && (
            <span>
              <Star size={12} aria-hidden /> {d.stars.toLocaleString()}
            </span>
          )}
        </div>
        <div className="atlas-card-foot">
          <span>{d.kind === "vendor" ? "Manufacturer's terms" : d.license ? `Licence: ${d.license}` : "Licence not stated"}</span>
          <span className="atlas-card-actions">
            {d.sourceUrl && (
              <a href={d.sourceUrl} target="_blank" rel="noreferrer" aria-label={"Source of " + d.name}>
                Source <ExternalLink size={11} />
              </a>
            )}
            <button className="text-link" onClick={onOpen}>
              Open <ArrowRight size={13} />
            </button>
          </span>
        </div>
      </div>
    </li>
  );
}

/**
 * A design's picture: its title image (the repository's social image or README image), else the
 * PCB preview the parts database drew from the design's board, else "No preview". When the
 * design list does not carry pictures (older parts database), the card asks once it is visible.
 */
function CardPicture({ d, vendor = false }: { d: Design; vendor?: boolean }) {
  const board = d.boardPreview ? `/api/maker/circuits/${d.id}/board.svg` : null;
  // Last resort for a GitHub design: the repository's social card (its own image if set, else GitHub's).
  const repo = vendor ? null : d.sourceUrl?.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?(?:\/|$)/)?.[1];
  const card = repo ? `https://opengraph.githubassets.com/1/${repo}` : null;
  // Vendor designs: the picture their own page publishes (looked up on the server).
  // A board in a folder of a larger repository: the list's picture is the repository's, so ask the
  // server for one named after the board first (it falls back to the repository's).
  const inFolder = !vendor && !!repoFolder(d.sourceUrl);
  const [sources, setSources] = useState<string[] | null>(
    // No picture in the list → ask the server (README picture, then the PCB preview).
    vendor || inFolder || !d.coverImageUrl ? null : [d.coverImageUrl, board].filter((v): v is string => !!v),
  );
  const [index, setIndex] = useState(0);
  // Whether the server has been asked yet; asked again when every picture from the list fails to load.
  const asked = useRef(false);
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const exhausted = sources !== null && index >= sources.length;
    if ((sources !== null && !exhausted) || !host.current) return;
    if (exhausted && asked.current) return;
    const el = host.current;
    const tried = sources || [];
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      asked.current = true;
      fetch(`/api/maker/circuits/${d.id}/cover`)
        .then((r) => (r.ok ? r.json() : { url: null }))
        .catch(() => ({ url: null }))
        .then((x) => {
          const next = [x.url, vendor ? null : board, card].filter((v): v is string => !!v && !tried.includes(v));
          setSources([...new Set([...tried, ...next])]);
        });
    });
    io.observe(el);
    return () => io.disconnect();
  }, [sources, index, d.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const src = sources?.[index];
  if (src)
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        className={src.endsWith("/board.svg") ? "atlas-card-board" : undefined}
        onError={() => setIndex((i) => i + 1)}
      />
    );
  if (vendor)
    return (
      <span className="atlas-card-nopic atlas-card-vendorpic" ref={host}>
        <BadgeCheck size={22} aria-hidden />
        {d.vendor || "Manufacturer"}
      </span>
    );
  return (
    <span className="atlas-card-nopic" ref={host}>
      <ImageOff size={20} aria-hidden />
      {sources === null ? "Loading preview…" : "No preview"}
    </span>
  );
}
