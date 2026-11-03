"use client";
import Linkify from "./Linkify";
import { useState, useRef, useEffect, useMemo } from "react";
import SupportedFormats, { CAD_ACCEPT } from "./SupportedFormats";
import {
  Upload,
  Download,
  Layers3,
  FileText,
  ShieldCheck,
  ArrowRight,
  FolderOpen,
  ExternalLink,
  Star,
} from "lucide-react";
import {
  canDownloadProject,
  projectPackage,
  type ProjectOrigin,
} from "@/lib/maker/project-package";
import { ToolHeading } from "./ToolShell";
import { filesToInputAssets } from "@/vendor/canon/lib/eda/archive";
import { parseEdaProject } from "@/vendor/canon/lib/eda/parse";
import type {
  CanonicalIrBundle,
  InputAsset,
} from "@/vendor/canon/lib/eda/types";
import {
  PcbViewer,
  Board3DViewer,
} from "@/vendor/canon/components/EdaViewers";
import ProjectBom from "./ProjectBom";
import NativeSchematic from "./NativeSchematic";
import FullscreenViewer from "./FullscreenViewer";
import InteractiveBom from "./InteractiveBom";
import GithubImport from "./GithubImport";
import type { GithubProject } from "@/lib/maker/github-projects";
import { download } from "@/lib/maker/download";
type DesignInfo = {
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
  bom:
    | { designators: string; quantity: number; value: string; mpn: string; manufacturer: string; footprint: string; partId: string | null }[]
    | null;
  bomWithheldReason: string | null;
};
type GithubRef = { repo: string; commit: string | null; subdir: string } | null;

export default function Viewer({
  initialSearch,
  initialFiles,
  focusGithub = false,
  githubUrl,
}: {
  initialSearch?: string;
  initialFiles?: File[];
  focusGithub?: boolean;
  githubUrl?: string;
} = {}) {
  const [bundle, setBundle] = useState<CanonicalIrBundle | null>(null),
    [assets, setAssets] = useState<InputAsset[]>([]),
    [originals, setOriginals] = useState<InputAsset[]>([]),
    [origin, setOrigin] = useState<ProjectOrigin>("local"),
    [tab, setTab] = useState("Schematic"),
    [visited, setVisited] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [design, setDesign] = useState<DesignInfo | null>(null),
    [github, setGithub] = useState<GithubRef>(null);
  const input = useRef<HTMLInputElement>(null);
  async function open(files: File[], source: ProjectOrigin = "local"): Promise<boolean> {
    setBusy(true);
    setError("");
    try {
      const r = await filesToInputAssets(files);
      const b = await parseEdaProject(r.assets, r.diagnostics);
      if (!b.schematics.length && !b.pcbs.length)
        throw Error(
          "No supported schematic or PCB found. Supported: KiCad 5–9, EAGLE 6+ XML, Altium Designer, EasyEDA Standard and JLCEDA / EasyEDA Pro. Binary EAGLE files must be saved as XML first.",
        );
      setBundle(b);
      setVisited([]);
      setAssets(r.assets);
      setOriginals(r.assets);
      setOrigin(source);
      setTab(b.schematics.length ? "Schematic" : "PCB");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function example(kind: string) {
    try {
      const r = await fetch(`/examples/${kind === "eagle" ? "eagle-led.zip" : "kicad-demo.zip"}`);
      if (!r.ok) throw Error("Example file unavailable");
      await open([new File([await r.blob()], `${kind}.zip`)], "example");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  /**
   * A design from the Tindie parts database: metadata + BOM from partdata, engineering
   * files from GitHub at the pinned commit, parsed here with the eelib / canon engines.
   */
  async function loadDesign(id: string) {
    setBusy(true);
    setError("");
    setStatus("Reading the design record…");
    try {
      const r = await fetch(`/api/maker/circuits/${encodeURIComponent(id)}`);
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Design unavailable");
      setDesign(d.design);
      setGithub(d.github);
      if (!d.github) {
        setStatus("");
        return;
      }
      setStatus(`Fetching ${d.github.repo} at ${String(d.github.commit || "default branch").slice(0, 10)} from GitHub…`);
      const scanRes = await fetch("/api/maker/github/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: d.design.sourceUrl }),
      });
      const scan = await scanRes.json();
      if (!scanRes.ok) throw Error(scan.error || "GitHub scan failed");
      const sub = String(d.github.subdir || "").replace(/\/$/, "");
      const projects: GithubProject[] = scan.projects || [];
      const choice =
        projects.find((p) => p.directory === sub) ||
        projects.find((p) => sub && p.directory.startsWith(sub + "/")) ||
        projects.find((p) => p.recommended) ||
        projects[0];
      if (!choice) throw Error("No KiCad, EAGLE, Altium or EasyEDA / JLCEDA project found at the pinned source.");
      setStatus(`Importing ${choice.name} (${choice.fileCount} files)…`);
      const imp = await fetch("/api/maker/github/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: scan.token, project: choice.id }),
      });
      if (!imp.ok) throw Error((await imp.json().catch(() => ({}))).error || "GitHub import failed");
      setStatus("Parsing schematic and PCB…");
      const ok = await open([new File([await imp.blob()], choice.name + ".zip")], "catalogue");
      setStatus("");
      if (!ok) setError((old) => old + " The design's BOM from the parts database is shown below.");
    } catch (e) {
      setStatus("");
      setError(
        `${e instanceof Error ? e.message : String(e)} The design's BOM from the parts database is shown below; the files remain available at the source link.`,
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initialFiles?.length) {
      void open(initialFiles);
      return;
    }
    const p = new URLSearchParams(initialSearch ?? location.search);
    if (p.get("example")) void example(p.get("example")!);
    else if (p.get("design")) void loadDesign(p.get("design")!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const boardAssets = useMemo(() => {
    const merged = new Map([...originals, ...assets].map((a) => [a.path, a]));
    return [...merged.values()];
  }, [originals, assets]);

  async function downloadProject() {
    if (!bundle || !canDownloadProject(origin)) return;
    setBusy(true);
    setError("");
    try {
      if (!originals.length) throw Error("Original project files are unavailable.");
      download(
        projectPackage(bundle, originals, origin),
        `${bundle.project.name.replace(/[\\/:*?"<>|]/g, "_")}-with-bom.zip`,
        "application/zip",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const sendBom = () => {
    setTab("BOM");
    setVisited((old) => (old.includes("BOM") ? old : [...old, "BOM"]));
  };

  return (
    <>
      <ToolHeading
        eyebrow={
          design
            ? design.kind === "vendor"
              ? `Reference design${design.vendor ? " · " + design.vendor : ""}`
              : design.vendor
                ? `Open-source design · ${design.vendor}`
                : "Open-source design"
            : "Project viewer"
        }
        title={design?.name || bundle?.project.name || "Look inside a project"}
        description={
          design
            ? (design.summary && <Linkify text={design.summary} />) ||
              (design.kind === "vendor"
                ? "Published by the manufacturer. Open the vendor page for its files and terms."
                : "Schematic, PCB, 3D and BOM, opened from the design's source files.")
            : "Schematics, PCB layers, 3D and BOM. Uploaded files are parsed in your browser and never leave it."
        }
        actions={
          <>
            {!design && (
              <button className="btn primary" onClick={() => input.current?.click()} disabled={busy}>
                <FolderOpen size={17} />
                Open files
              </button>
            )}
            {bundle && canDownloadProject(origin) && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => void downloadProject()}
              >
                <Download size={16} />
                Download ZIP + BOM
              </button>
            )}
          </>
        }
      />
      <input
        hidden
        ref={input}
        type="file"
        multiple
        accept={CAD_ACCEPT}
        onChange={(e) => {
          if (e.target.files) void open(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      {design && (
        <DesignPanel
          design={design}
          github={github}
          loaded={bundle ? { files: assets.length || bundle.inventory.length, components: bundle.parts.length, boards: bundle.pcbs.length } : null}
        />
      )}
      {!bundle && !design && (
        <GithubImport
          autoFocus={focusGithub && !githubUrl}
          initialUrl={githubUrl}
          onImport={async (files) => void (await open(files, "github"))}
          disabled={busy}
        />
      )}
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {busy && <div className="notice info" role="status">{status || "Loading engineering files…"}</div>}
      {design && !bundle && !busy ? (
        design.bom ? <DesignBom design={design} /> : null
      ) : !bundle ? (
        <>
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void open(Array.from(e.dataTransfer.files));
            }}
          >
            <span className="drop-icon">
              <Layers3 size={44} />
            </span>
            <h2>A whole project. One clear view.</h2>
            <p>Drop a ZIP or select your schematic and PCB files together.</p>
            <button
              className="btn primary"
              onClick={() => input.current?.click()}
            >
              <Upload size={17} />
              Choose project files
            </button>
            <small>
              KiCad · EAGLE · Altium · EasyEDA · JLCEDA Pro — a project ZIP or its schematic and PCB files
            </small>
            <div className="privacy-note">
              <ShieldCheck size={16} /> Parsed locally. Nothing uploaded.
            </div>
            <SupportedFormats />
          </div>
          <div className="example-row">
            <div>
              <b>Just looking around?</b>
              <p>Open a small, working parser example.</p>
            </div>
            <button className="btn" onClick={() => void example("kicad")}>
              KiCad example <ArrowRight size={15} />
            </button>
            <button className="btn" onClick={() => void example("eagle")}>
              Eagle example <ArrowRight size={15} />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="workspace-summary" hidden={!!design}>
            <span className="badge">{bundle.project.sourceFormat}</span>
            <span>{assets.length || bundle.inventory.length} files</span>
            <span>{bundle.parts.length} components</span>
            <span>{bundle.pcbs.length} boards</span>
            <span className="right">
              <ShieldCheck size={14} />
              {origin === "local"
                ? "Parsed in your browser"
                : origin === "github"
                  ? "GitHub project"
                  : origin === "example"
                    ? "Example project"
                    : "Open-source design"}
            </span>
          </div>
          <FullscreenViewer label={tab}>
            <div className="tabs">
              {[
                "Schematic",
                "PCB",
                "3D",
                "BOM",
                "iBOM",
                "Files",
              ].map((t) => (
                <button
                  className={tab === t ? "active" : ""}
                  key={t}
                  onClick={() => {
                    setTab(t);
                    setVisited((old) => (old.includes(t) ? old : [...old, t]));
                  }}
                >
                  {t}
                </button>
              ))}
              <button className="tab-action" onClick={sendBom}>
                Match this BOM <ArrowRight size={15} />
              </button>
            </div>
            <div className="viewer-workspace">
              {visited.includes("3D") && (
                <div hidden={tab !== "3D"} key={`3d-${bundle.bundleId}`}>
                  <Board3DViewer
                    bundle={bundle}
                    assets={boardAssets}
                    active={tab === "3D"}
                  />
                </div>
              )}
              {visited.includes("BOM") && (
                <div hidden={tab !== "BOM"} key={`bom-${bundle.bundleId}`}>
                  <ProjectBom bundle={bundle} onUpdate={setBundle} />
                </div>
              )}

              <div
                hidden={tab !== "Schematic"}
                key={`schematic-${bundle.bundleId}`}
              >
                <NativeSchematic
                  key={bundle.bundleId}
                  bundle={bundle}
                  assets={assets}
                  viewId=""
                />
              </div>
              {visited.includes("iBOM") && (
                <div hidden={tab !== "iBOM"} key={`ibom-${bundle.bundleId}`}>
                  <InteractiveBom bundle={bundle} active={tab === "iBOM"} />
                </div>
              )}
              {tab === "PCB" ? (
                <PcbViewer bundle={bundle} assets={assets} />
              ) : tab !== "Files" ? null : (
                <div className="file-list">
                  {canDownloadProject(origin) && (
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() => void downloadProject()}
                    >
                      <Download size={16} />
                      {busy
                        ? "Preparing download…"
                        : "Download project ZIP + BOM"}
                    </button>
                  )}
                  <p className="notice">
                    {canDownloadProject(origin)
                      ? "ZIP includes original project files and BOM CSV/JSON with applied MPN and manufacturer updates. Apply verified matches in the BOM tab before exporting."
                      : "Local project files stay in your browser."}
                  </p>
                  {originals.map((a) => (
                    <div key={a.path}>
                      <FileText size={18} />
                      <span>{a.path}</span>
                      <small>{(a.bytes.length / 1024).toFixed(1)} KB</small>
                      {canDownloadProject(origin) && (
                        <button
                          className="btn small"
                          onClick={() =>
                            download(a.bytes, a.path.split("/").pop()!)
                          }
                        >
                          Download
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FullscreenViewer>
          {bundle.diagnostics.some(
            (d) => d.severity === "error" || d.severity === "warning",
          ) && (
            <details className="parse-notes">
              <summary>
                File compatibility notes (
                {
                  bundle.diagnostics.filter(
                    (d) => d.severity === "error" || d.severity === "warning",
                  ).length
                }
                )
              </summary>
              {bundle.diagnostics
                .filter(
                  (d) => d.severity === "error" || d.severity === "warning",
                )
                .map((d) => (
                  <p key={d.id}>{d.message}</p>
                ))}
            </details>
          )}
        </>
      )}
    </>
  );
}

function DesignAbout({ design }: { design: DesignInfo }) {
  const [about, setAbout] = useState<{ intro: string | null; readmeUrl: string | null } | null>(null);
  useEffect(() => {
    if (design.kind !== "open_source") return;
    const ac = new AbortController();
    fetch(`/api/maker/circuits/${encodeURIComponent(design.id)}/about`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => x && setAbout(x))
      .catch(() => {});
    return () => ac.abort();
  }, [design.id, design.kind]);
  const intro = about?.intro;
  if (!intro || intro === design.summary) return null;
  return (
    <section className="design-about">
      <h3>About this project</h3>
      {intro.split("\n\n").map((p, i) => (
        <p key={i}>
          <Linkify text={p} />
        </p>
      ))}
      {about?.readmeUrl && (
        <a className="inline-link readme-link" href={about.readmeUrl} target="_blank" rel="noopener noreferrer">
          Full README on GitHub <ExternalLink size={11} aria-hidden />
        </a>
      )}
    </section>
  );
}

function DesignPanel({
  design,
  github,
  loaded,
}: {
  design: DesignInfo;
  github: GithubRef;
  /** Once the project files are open: one row with what they hold, instead of a second summary row. */
  loaded: { files: number; components: number; boards: number } | null;
}) {
  return (
    <>
    <DesignAbout design={design} />
    <div className="design-meta">
      {design.kind === "vendor" ? (
        <span className="vendor-badge">Reference design{design.vendor ? ` · ${design.vendor}` : ""}</span>
      ) : (
        <>
          {design.vendor && <span className="vendor-badge">Manufacturer design · {design.vendor}</span>}
          <span className="pill">Open source</span>
        </>
      )}
      {design.license && (
        <span className="pill muted">{design.kind === "vendor" ? "Vendor terms apply" : `Licence: ${design.license}`}</span>
      )}
      {design.stars !== null && (
        <span className="pill muted">
          <Star size={11} /> {design.stars.toLocaleString()}
        </span>
      )}
      {design.edaTool && <span className="pill muted">{design.edaTool}</span>}
      {loaded ? (
        <span className="pill muted">
          {loaded.files} files · {loaded.components} components · {loaded.boards} {loaded.boards === 1 ? "board" : "boards"}
        </span>
      ) : (
        <span className="pill muted">{design.partCount} identified parts</span>
      )}
      {github?.commit && <span className="pill muted">commit {github.commit.slice(0, 10)}</span>}
      {design.sourceUrl && (
        <a className="btn small outline" href={design.sourceUrl} target="_blank" rel="noreferrer">
          {design.kind === "vendor" ? `${design.vendor || "Vendor"} page` : "Source on GitHub"} <ExternalLink size={12} />
        </a>
      )}
      {design.bomWithheldReason && <p className="notice" style={{ width: "100%" }}>{design.bomWithheldReason}</p>}
    </div>
    </>
  );
}

function DesignBom({ design }: { design: DesignInfo }) {
  if (!design.bom?.length) return null;
  return (
    <section className="design-bom">
      <div className="section-top">
        <h2>Bill of materials</h2>
        <span>From the Tindie parts database · {design.bom.length} lines</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>References</th>
              <th>Qty</th>
              <th>Part number</th>
              <th>Manufacturer</th>
              <th>Value / footprint</th>
            </tr>
          </thead>
          <tbody>
            {design.bom.map((b, i) => (
              <tr key={i}>
                <td>{b.designators}</td>
                <td>{b.quantity || ""}</td>
                <td>
                  {b.partId ? (
                    <a className="text-link" href={"/tools/components?" + new URLSearchParams({ q: b.mpn, partId: b.partId, exact: "1" })}>
                      {b.mpn}
                    </a>
                  ) : (
                    b.mpn || "—"
                  )}
                </td>
                <td>{b.manufacturer || "—"}</td>
                <td>{[b.value, b.footprint].filter(Boolean).join(" · ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
