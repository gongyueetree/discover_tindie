"use client";
import { useState, useRef, useEffect, useMemo } from "react";
import {
  Upload,
  Download,
  Layers3,
  FileText,
  ShieldCheck,
  ArrowRight,
  FolderOpen,
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
  SchematicViewer,
  PcbViewer,
  Board3DViewer,
  BomViewer,
} from "@/vendor/canon/components/EdaViewers";
import ProjectBom from "./ProjectBom";
import NativeSchematic from "./NativeSchematic";
import FullscreenViewer from "./FullscreenViewer";
import InteractiveBom from "./InteractiveBom";
import GithubImport from "./GithubImport";
import { download } from "@/lib/maker/download";
import { boundedBody } from "@/vendor/canon/lib/allegro-http";
export default function Viewer({
  initialSearch,
  initialFiles,
  focusGithub = false,
}: {
  initialSearch?: string;
  initialFiles?: File[];
  focusGithub?: boolean;
} = {}) {
  const [bundle, setBundle] = useState<CanonicalIrBundle | null>(null),
    [assets, setAssets] = useState<InputAsset[]>([]),
    [originals, setOriginals] = useState<InputAsset[]>([]),
    [origin, setOrigin] = useState<ProjectOrigin>("local"),
    [tab, setTab] = useState("Schematic"),
    [visited, setVisited] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [remote, setRemote] = useState(""),
    [viewId, setViewId] = useState(""),
    [modelNote, setModelNote] = useState(""),
    [pending, setPending] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function open(files: File[], source: ProjectOrigin = "local") {
    setBusy(true);
    setError("");
    try {
      const r = await filesToInputAssets(files);
      const b = await parseEdaProject(r.assets, r.diagnostics);
      if (!b.schematics.length && !b.pcbs.length)
        throw Error(
          "No supported schematic or PCB found. Use KiCad or Eagle 6+ XML files; binary Eagle files must be exported as XML.",
        );
      setBundle(b);
      setVisited([]);
      setRemote("");
      setPending("");
      setViewId("");
      setModelNote("");
      setAssets(r.assets);
      setOriginals(r.assets);
      setOrigin(source);
      setTab(b.schematics.length ? "Schematic" : "PCB");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function example(kind: string) {
    try {
      const r = await fetch(
        `/examples/${kind === "eagle" ? "eagle-led.zip" : "kicad-demo.zip"}`,
      );
      if (!r.ok) throw Error("Example file unavailable");
      await open([new File([await r.blob()], `${kind}.zip`)], "example");
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    if (initialFiles?.length) {
      void open(initialFiles);
      return;
    }
    const p = new URLSearchParams(initialSearch ?? location.search);
    if (p.get("example")) void example(p.get("example")!);
    else if (p.get("project")) {
      setBusy(true);
      const id = p.get("project")!;
      fetch(`/api/maker/circuits/${encodeURIComponent(id)}/view`)
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) {
            if (r.status === 409) setPending(id);
            throw Error(d.error || "Preview unavailable");
          }
          return d;
        })
        .then((d) => {
          setBundle(d.bundle);
          setVisited([]);
          setAssets([]);
          setOriginals([]);
          setOrigin("catalogue");
          setRemote(id);
          setViewId(d.view.id);
          setTab(d.bundle.schematics.length ? "Schematic" : "PCB");
        })
        .catch((e) => setError(e.message))
        .finally(() => setBusy(false));
    }
  }, []);
  const boardAssets = useMemo(() => {
    const merged = new Map([...originals, ...assets].map((a) => [a.path, a]));
    return [...merged.values()];
  }, [originals, assets]);
  const requestedModels = visited.includes("3D");
  useEffect(() => {
    if (!requestedModels || !remote || originals.length) return;
    const ac = new AbortController();
    fetch(`/api/maker/circuits/${encodeURIComponent(remote)}/download`, {
      signal: ac.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error("Source silkscreen unavailable");
        return filesToInputAssets([new File([await r.blob()], "project.zip")]);
      })
      .then((parsed) => {
        if (!ac.signal.aborted) setOriginals(parsed.assets);
      })
      .catch(() => {
        /* Existing board geometry remains usable if source files are unavailable. */
      });
    return () => ac.abort();
  }, [requestedModels, remote]);
  useEffect(() => {
    if (!requestedModels || !viewId) return;
    const abort = new AbortController();
    setModelNote("Loading project model manifest…");
    (async () => {
      try {
        const r = await fetch(`/api/maker/models/${viewId}`, {
          signal: abort.signal,
        });
        if (!r.ok) throw Error("Project models are unavailable.");
        const d = await r.json();
        const entries = Object.entries(d.models || {}) as [
          string,
          { sha256: string; name: string; bytes: number },
        ][];
        let total = 0;
        const accepted = entries.filter(([, m]) => {
          if (
            !Number.isFinite(m.bytes) ||
            m.bytes < 0 ||
            m.bytes > 25 * 1024 * 1024 ||
            total + m.bytes > 100 * 1024 * 1024
          )
            return false;
          total += m.bytes;
          return true;
        });
        const loaded: InputAsset[] = [];
        let cursor = 0;
        await Promise.all(
          Array.from({ length: Math.min(4, accepted.length) }, async () => {
            while (cursor < accepted.length && !abort.signal.aborted) {
              const [path, m] = accepted[cursor++];
              try {
                const resp = await fetch(
                  `/api/maker/models/${viewId}/${m.sha256}`,
                  {
                    signal: AbortSignal.any([
                      abort.signal,
                      AbortSignal.timeout(25000),
                    ]),
                  },
                );
                if (resp.ok)
                  loaded.push({
                    path,
                    bytes: await boundedBody(
                      resp.body,
                      Math.min(m.bytes, 25 * 1024 * 1024),
                    ),
                  });
              } catch {
                /* One missing or timed-out model must not discard the others. */
              }
            }
          }),
        );
        if (!abort.signal.aborted) {
          if (loaded.length) setAssets(loaded);
          setModelNote(
            entries.length
              ? `${loaded.length} of ${entries.length} project model files downloaded. Geometry rendering is checked separately.`
              : "No project-specific models are available; official library references are tried where present.",
          );
        }
      } catch (e) {
        if (!abort.signal.aborted) setModelNote(String(e));
      }
    })();
    return () => abort.abort();
  }, [requestedModels, viewId]);

  async function prepareRemote() {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/maker/circuits/${pending}/view`, {
        method: "POST",
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      if (d.view?.state === "ready") {
        const ready = await fetch(`/api/maker/circuits/${pending}/view`);
        const data = await ready.json();
        if (!ready.ok) throw Error(data.error);
        setBundle(data.bundle);
        setVisited([]);
        setAssets([]);
        setOriginals([]);
        setOrigin("catalogue");
        setRemote(pending);
        setViewId(d.view.id);
        setPending("");
        setTab(data.bundle.schematics.length ? "Schematic" : "PCB");
      } else
        setError(
          `Preview status: ${d.view?.state || "queued"}. The catalogue is preparing this project. Click again to refresh.`,
        );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function getOriginals() {
    if (originals.length) return originals;
    if (!remote) throw Error("Original project files are unavailable.");
    const r = await fetch(
      `/api/maker/circuits/${encodeURIComponent(remote)}/download`,
    );
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw Error(d.error || "Project download unavailable.");
    }
    const parsed = await filesToInputAssets([
      new File([await r.blob()], "project.zip"),
    ]);
    if (!parsed.assets.length)
      throw Error("The source archive contains no project files.");
    setOriginals(parsed.assets);
    return parsed.assets;
  }

  async function loadOriginals() {
    setBusy(true);
    setError("");
    try {
      await getOriginals();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function downloadProject() {
    if (!bundle || !canDownloadProject(origin)) return;
    setBusy(true);
    setError("");
    try {
      const source = await getOriginals();
      download(
        projectPackage(bundle, source, origin),
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
        eyebrow="PROJECT VIEWER"
        title={bundle?.project.name || "Look inside your next project."}
        description="Schematics, PCB layers and 3D. Local uploads stay in this browser. Catalogue previews load from eelib."
        actions={
          <>
            <button
              className="btn primary"
              onClick={() => input.current?.click()}
              disabled={busy}
            >
              <FolderOpen size={17} />
              Open files
            </button>
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
        accept=".zip,.kicad_sch,.kicad_pcb,.kicad_pro,.sch,.brd,.lbr,.step,.stp,.wrl,.SchDoc,.PcbDoc"
        onChange={(e) => {
          if (e.target.files) void open(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <GithubImport
        autoFocus={focusGithub}
        onImport={(files) => open(files, "github")}
        disabled={busy}
      />
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {pending && (
        <button
          className="btn primary"
          disabled={busy}
          onClick={() => void prepareRemote()}
        >
          Prepare / refresh project preview
        </button>
      )}
      {busy && <div className="notice">Loading engineering files…</div>}
      {!bundle ? (
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
              KiCad · Eagle 6+ XML · STEP / VRML models inside project ZIP
            </small>
            <div className="privacy-note">
              <ShieldCheck size={16} /> Parsed locally. Nothing uploaded.
            </div>
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
          <div className="workspace-summary">
            <span className="badge">{bundle.project.sourceFormat}</span>
            <span>{assets.length || bundle.inventory.length} files</span>
            <span>{bundle.parts.length} components</span>
            <span>{bundle.pcbs.length} boards</span>
            <span className="right">
              <ShieldCheck size={14} />
              {origin === "local"
                ? "Local session"
                : origin === "github"
                  ? "GitHub project"
                  : "Public project"}
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
            {tab === "3D" && modelNote && <p className="notice">{modelNote}</p>}
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
                  viewId={viewId}
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
                  {remote && !originals.length && (
                    <>
                      <p className="notice">
                        Load original files to download them individually, or
                        download the complete ZIP with the current BOM.
                      </p>
                      <button
                        className="btn"
                        disabled={busy}
                        onClick={() => void loadOriginals()}
                      >
                        Load original files
                      </button>
                      {bundle.inventory.map((f) => (
                        <div key={f.id}>
                          <FileText size={18} />
                          <span>{f.relativePath}</span>
                          <small>{f.entryRole}</small>
                        </div>
                      ))}
                    </>
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
