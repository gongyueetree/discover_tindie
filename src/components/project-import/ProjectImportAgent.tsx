"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ProjectImportResult, RepositorySummary } from "@/lib/project-import/types";

type SourceKey = "github" | "hackaday" | "hackster" | "url" | "upload" | "ezplm";

type SellerConfig = {
  price: string;
  inventory: string;
  modelNumber: string;
  shipsFrom: string;
  shippingProfile: string;
  handlingDays: string;
  weight: string;
  included: string[];
};

const TEAL = "#22b8c4";

function SimpleIcon({ kind, className = "h-5 w-5" }: { kind: string; className?: string }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  if (kind === "github") {
    return (
      <svg {...common} fill="currentColor" stroke="none">
        <path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-.89-.01-1.75-2.78.62-3.37-1.37-3.37-1.37-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.66.35-1.11.64-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.65a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z" />
      </svg>
    );
  }
  if (kind === "link") {
    return <svg {...common}><path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.15-1.15"/></svg>;
  }
  if (kind === "upload") {
    return <svg {...common}><path d="M12 16V3"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>;
  }
  if (kind === "sparkles") {
    return <svg {...common}><path d="m12 3-1.1 3.1L8 7.2l2.9 1.1L12 11l1.1-2.7L16 7.2l-2.9-1.1L12 3Z"/><path d="m6 13-.8 2.2L3 16l2.2.8L6 19l.8-2.2L9 16l-2.2-.8L6 13Z"/><path d="m18 12-.7 1.8-1.8.7 1.8.7L18 17l.7-1.8 1.8-.7-1.8-.7L18 12Z"/></svg>;
  }
  if (kind === "file") {
    return <svg {...common}><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/><path d="M9 12h6M9 16h6"/></svg>;
  }
  if (kind === "search") {
    return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
  }
  if (kind === "check") {
    return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  }
  if (kind === "box") {
    return <svg {...common}><path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 7.5 8 4.5 8-4.5M4 7.5V17l8 4 8-4V7.5M12 12v9"/></svg>;
  }
  if (kind === "truck") {
    return <svg {...common}><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/></svg>;
  }
  return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>;
}

const SOURCES: Array<{ key: SourceKey; title: string; subtitle: string; icon: string; badge?: string }> = [
  { key: "github", title: "GitHub", subtitle: "Repositories & engineering files", icon: "github", badge: "LIVE" },
  { key: "hackaday", title: "Hackaday.io", subtitle: "Project story & build logs", icon: "sparkles" },
  { key: "hackster", title: "Hackster.io", subtitle: "Tutorial projects", icon: "box" },
  { key: "url", title: "Paste Project URL", subtitle: "GitHub, blog, project page", icon: "link" },
  { key: "upload", title: "Upload ZIP / Files", subtitle: "Design package from your computer", icon: "upload" },
  { key: "ezplm", title: "Import from ezPLM", subtitle: "Project, BOM & versions", icon: "file" },
];

const ANALYSIS_STAGES = [
  "Reading project source",
  "Mapping engineering files",
  "Detecting hardware and interfaces",
  "Extracting technical evidence",
  "Generating Tindie listing content",
  "Checking missing seller information",
];

function relativeDate(value: string) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const day = Math.max(1, Math.round(diff / 86_400_000));
  if (day < 2) return "Updated today";
  if (day < 30) return `Updated ${day} days ago`;
  return `Updated ${Math.round(day / 30)} mo ago`;
}

function statusBadge(status: string) {
  if (status === "SOURCE_EXTRACTED") return { text: "Source", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (status === "AI_INFERRED") return { text: "AI inferred", cls: "bg-violet-50 text-violet-700 border-violet-200" };
  if (status === "AI_GENERATED") return { text: "AI generated", cls: "bg-sky-50 text-sky-700 border-sky-200" };
  if (status === "USER_CONFIRMED") return { text: "Confirmed", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (status === "CONFLICT") return { text: "Conflict", cls: "bg-red-50 text-red-700 border-red-200" };
  return { text: "Required", cls: "bg-amber-50 text-amber-700 border-amber-200" };
}

function FieldStatusBadge({ status }: { status: string }) {
  const badge = statusBadge(status);
  return <span className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>{badge.text}</span>;
}

function StatRing({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div
        className="grid h-11 w-11 place-items-center rounded-full text-xs font-semibold text-slate-700"
        style={{ background: `conic-gradient(${TEAL} ${value * 3.6}deg,#e9eef0 0)` }}
      >
        <div className="grid h-8 w-8 place-items-center rounded-full bg-white">{value}</div>
      </div>
      <div>
        <div className="text-[11px] leading-tight text-slate-500">{label}</div>
        <div className="text-xs font-semibold text-slate-700">{value}%</div>
      </div>
    </div>
  );
}

function SellerChrome({ children }: { children: ReactNode }) {
  const nav = ["Dashboard", "Products", "Shipping", "Orders", "Promotions", "Disbursement", "Seller Tools", "Store Settings"];
  return (
    <div className="min-h-screen bg-white text-[#3a3f44]">
      <div className="border-b border-[#e4e7e8] bg-white">
        <div className="mx-auto flex h-14 max-w-[1450px] items-center justify-between px-6">
          <div className="flex items-center gap-2 font-semibold text-[#202428]">
            <div className="relative h-7 w-7">
              <div className="absolute left-2 top-0 h-4 w-4 rounded-full border-2 border-[#3a3f44]" />
              <div className="absolute left-0 top-3 h-2 w-2 rounded-full bg-[#ef4b4b]" />
              <div className="absolute right-0 top-3 h-2 w-2 rounded-full bg-[#22b8c4]" />
            </div>
            <span className="text-[17px] lowercase tracking-tight">tindie</span>
          </div>
          <div className="flex items-center gap-5 text-sm text-slate-700">
            <span>Discover</span>
            <span className="grid h-8 w-8 place-items-center rounded bg-gradient-to-br from-fuchsia-700 to-orange-500 text-xs font-bold text-white">G</span>
            <span className="font-medium">Gongyu ▾</span>
          </div>
        </div>
      </div>
      <div className="border-b border-[#edf0f1] bg-[#fafbfb]">
        <div className="mx-auto flex h-[52px] max-w-[1450px] items-stretch px-6">
          <div className="flex w-[390px] items-center text-[17px] font-medium tracking-wide text-slate-700">STEPFPGA</div>
          <nav className="flex flex-1 items-stretch justify-end overflow-x-auto">
            {nav.map((item) => (
              <div
                key={item}
                className={`flex items-center whitespace-nowrap px-5 text-[13px] font-medium ${item === "Products" ? "bg-[#22b8c4] text-white" : "text-slate-600"}`}
              >
                {item}
              </div>
            ))}
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}

export function ProjectImportAgent() {
  const [source, setSource] = useState<SourceKey>("github");
  const [owner, setOwner] = useState("gongyueetree");
  const [search, setSearch] = useState("");
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [reposError, setReposError] = useState("");
  const [githubAuthenticated, setGithubAuthenticated] = useState(false);
  const [projectUrl, setProjectUrl] = useState("");
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<ProjectImportResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState(0);
  const [analysisError, setAnalysisError] = useState("");
  const [showDraft, setShowDraft] = useState(false);
  const [seller, setSeller] = useState<SellerConfig>({
    price: "",
    inventory: "",
    modelNumber: "",
    shipsFrom: "",
    shippingProfile: "",
    handlingDays: "2",
    weight: "",
    included: ["Assembled board"],
  });
  const configRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (source !== "github") return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setReposLoading(true);
      setReposError("");
      try {
        const response = await fetch(`/api/project-import/repos?owner=${encodeURIComponent(owner)}&q=${encodeURIComponent(search)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load repositories.");
        setRepositories(payload.repositories || []);
        setGithubAuthenticated(Boolean(payload.authenticated));
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setReposError(error instanceof Error ? error.message : "Unable to load repositories.");
          setRepositories([]);
        }
      } finally {
        setReposLoading(false);
      }
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [owner, search, source]);

  const runAnalysis = async (body: Record<string, string>) => {
    setAnalyzing(true);
    setAnalysisError("");
    setAnalysis(null);
    setShowDraft(false);
    setAnalysisStep(0);
    const interval = window.setInterval(() => {
      setAnalysisStep((current) => Math.min(ANALYSIS_STAGES.length - 1, current + 1));
    }, 650);
    try {
      const response = await fetch("/api/project-import/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Project analysis failed.");
      const result = payload.result as ProjectImportResult;
      setAnalysis(result);
      setSeller((current) => ({
        ...current,
        modelNumber: result.listing.modelNumber.value || current.modelNumber,
      }));
      setAnalysisStep(ANALYSIS_STAGES.length - 1);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Project analysis failed.");
    } finally {
      window.clearInterval(interval);
      setAnalyzing(false);
    }
  };

  const importRepository = (repo: RepositorySummary) => {
    void runAnalysis({ sourceType: "github", owner: repo.owner, repo: repo.name });
  };

  const importUrl = () => {
    if (!projectUrl.trim()) {
      setAnalysisError("Enter a project URL first.");
      return;
    }
    const sourceType = source === "hackaday" || source === "hackster" || source === "ezplm" ? source : "url";
    void runAnalysis({ sourceType, url: projectUrl.trim() });
  };

  const sourceTitle = SOURCES.find((item) => item.key === source)?.title ?? "Project";
  const requiredComplete = Boolean(
    seller.price && seller.inventory && seller.shipsFrom && seller.shippingProfile && seller.handlingDays && seller.weight
  );

  const confirmation = useMemo(() => {
    const values = [seller.price, seller.inventory, seller.shipsFrom, seller.shippingProfile, seller.handlingDays, seller.weight];
    return Math.round((values.filter(Boolean).length / values.length) * 100);
  }, [seller]);

  const descriptionMarkdown = analysis
    ? `#### What is it?\n\n${analysis.listing.whatIsIt.value ?? ""}\n\n#### Why did you make it?\n\n${analysis.listing.whyMadeIt.value ?? ""}\n\n#### What makes it special?\n\n${analysis.listing.whatMakesSpecial.value ?? ""}\n\n#### Key Features\n\n${(analysis.listing.features.value ?? []).map((item) => `- ${item}`).join("\n")}`
    : "";

  return (
    <SellerChrome>
      <main className="mx-auto max-w-[1450px] px-6 pb-24 pt-10">
        <div className="flex items-start justify-between gap-6 border-b border-slate-200 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[30px] font-semibold tracking-tight text-[#353a3e]">Import a Project</h1>
              <span className="grid h-4 w-4 place-items-center rounded-full border border-[#22b8c4] text-[10px] font-bold text-[#22b8c4]">?</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">Turn an existing hardware project into a Tindie product listing with AI.</p>
          </div>
          <button className="rounded border border-slate-300 bg-[#858d96] px-4 py-2 text-xs font-medium text-white">About Importing Projects</button>
        </div>

        <section className="mt-6 grid gap-3 lg:grid-cols-3">
          <button className="rounded-md border-2 border-[#22b8c4] bg-gradient-to-r from-cyan-50/70 to-white p-5 text-left shadow-sm">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 text-slate-900"><SimpleIcon kind="github" className="h-7 w-7" /></div>
              <div>
                <div className="flex items-center gap-2 text-[16px] font-semibold text-slate-800">Import a Project <span className="rounded bg-cyan-100 px-2 py-0.5 text-[9px] font-bold text-cyan-700">RECOMMENDED</span></div>
                <p className="mt-1 text-xs leading-5 text-slate-500">Import from GitHub, Hackaday, or another source and create a listing automatically.</p>
              </div>
            </div>
          </button>
          <button className="rounded-md border border-slate-200 bg-white p-5 text-left hover:border-slate-300">
            <div className="flex items-start gap-3"><SimpleIcon kind="sparkles" className="h-7 w-7 text-slate-700"/><div><div className="text-[16px] font-semibold text-slate-800">Create with AI</div><p className="mt-1 text-xs leading-5 text-slate-500">Describe your product and let AI build a listing from your notes and files.</p></div></div>
          </button>
          <button className="rounded-md border border-slate-200 bg-white p-5 text-left hover:border-slate-300">
            <div className="flex items-start gap-3"><SimpleIcon kind="file" className="h-7 w-7 text-slate-700"/><div><div className="text-[16px] font-semibold text-slate-800">Start from Scratch</div><p className="mt-1 text-xs leading-5 text-slate-500">Use Tindie's existing product form and enter every field manually.</p></div></div>
          </button>
        </section>

        <section className="mt-7">
          <div className="mb-3">
            <h2 className="text-[18px] font-semibold text-slate-800">Choose a source</h2>
            <p className="text-xs text-slate-500">Select where your project lives. GitHub import is fully interactive in this prototype.</p>
          </div>
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
            {SOURCES.map((item) => (
              <button
                key={item.key}
                onClick={() => { setSource(item.key); setAnalysisError(""); }}
                className={`relative min-h-[82px] rounded-md border p-3 text-left transition ${source === item.key ? "border-2 border-[#22b8c4] bg-cyan-50/40 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}
              >
                {item.badge && <span className="absolute right-2 top-2 rounded bg-emerald-100 px-1.5 py-0.5 text-[8px] font-bold text-emerald-700">{item.badge}</span>}
                <div className="flex items-center gap-2">
                  <span className="text-slate-800"><SimpleIcon kind={item.icon} className="h-6 w-6" /></span>
                  <div className="text-[13px] font-semibold text-slate-800">{item.title}</div>
                </div>
                <div className="mt-1 pl-8 text-[10px] leading-4 text-slate-500">{item.subtitle}</div>
              </button>
            ))}
          </div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,.85fr)]">
          <section className="rounded-md border border-slate-200 bg-[#fbfbfb] shadow-sm">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-[18px] font-semibold text-slate-800">{source === "github" ? "Import Git Repository" : `Import from ${sourceTitle}`}</h2>
              <p className="mt-0.5 text-xs text-slate-500">We'll analyze the project and generate a Tindie listing draft without inventing price, stock, shipping, or certifications.</p>
            </div>

            {source === "github" ? (
              <div className="p-5">
                <div className="grid gap-2 sm:grid-cols-[280px_1fr]">
                  <label className="flex h-10 items-center gap-2 rounded border border-slate-200 bg-white px-3">
                    <SimpleIcon kind="github" className="h-4 w-4 text-slate-700" />
                    <input value={owner} onChange={(e) => setOwner(e.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label="GitHub owner" />
                    <span className={`h-2.5 w-2.5 rounded-full ${githubAuthenticated ? "bg-emerald-500" : "bg-slate-300"}`} title={githubAuthenticated ? "Server GitHub token configured" : "Public repositories only"} />
                  </label>
                  <label className="flex h-10 items-center gap-2 rounded border border-slate-200 bg-white px-3">
                    <SimpleIcon kind="search" className="h-4 w-4 text-slate-400" />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search repositories..." className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400" />
                  </label>
                </div>
                {!githubAuthenticated && (
                  <div className="mt-2 text-[10px] text-slate-400">Showing public repositories. Add a read-only GITHUB_TOKEN in Vercel to include private repositories.</div>
                )}

                <div className="mt-4 overflow-hidden rounded border border-slate-200 bg-white">
                  {reposLoading && <div className="p-8 text-center text-sm text-slate-400">Loading repositories…</div>}
                  {!reposLoading && reposError && <div className="p-6 text-sm text-red-600">{reposError}</div>}
                  {!reposLoading && !reposError && repositories.length === 0 && <div className="p-8 text-center text-sm text-slate-400">No repositories found.</div>}
                  {!reposLoading && !reposError && repositories.slice(0, 9).map((repo) => (
                    <div key={repo.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50/80">
                      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-50 text-slate-800"><SimpleIcon kind="github" className="h-5 w-5"/></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-slate-800">{repo.name}</span>
                          {repo.private && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">PRIVATE</span>}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-500">{repo.description || "No repository description"}</div>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[9px] text-slate-500">
                          {repo.language && <span className="rounded bg-slate-100 px-1.5 py-0.5">{repo.language}</span>}
                          {repo.stars > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5">★ {repo.stars}</span>}
                          <span className="rounded bg-slate-100 px-1.5 py-0.5">{relativeDate(repo.updatedAt)}</span>
                        </div>
                      </div>
                      <button
                        disabled={analyzing}
                        onClick={() => importRepository(repo)}
                        className="rounded bg-[#202326] px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-black disabled:cursor-wait disabled:opacity-50"
                      >
                        Import
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : source === "upload" ? (
              <div className="p-5">
                <label className="grid min-h-[220px] cursor-pointer place-items-center rounded-lg border-2 border-dashed border-slate-300 bg-white p-8 text-center hover:border-[#22b8c4]">
                  <div>
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-cyan-50 text-[#1aa0ab]"><SimpleIcon kind="upload" className="h-6 w-6"/></div>
                    <div className="mt-3 text-sm font-semibold text-slate-800">Drop a project ZIP or select design files</div>
                    <div className="mt-1 text-xs text-slate-500">KiCad, BOM, Gerber, STEP, PDF, images, firmware</div>
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => setUploadedNames(Array.from(event.target.files ?? []).map((file) => file.name))}
                    />
                  </div>
                </label>
                {uploadedNames.length > 0 && (
                  <div className="mt-4 rounded border border-slate-200 bg-white p-4">
                    <div className="text-xs font-semibold text-slate-700">Selected files</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">{uploadedNames.map((name) => <span key={name} className="rounded bg-slate-100 px-2 py-1 text-[10px] text-slate-600">{name}</span>)}</div>
                    <div className="mt-3 rounded bg-amber-50 px-3 py-2 text-[11px] text-amber-700">UI is ready. Server-side ZIP/CAD sandbox parsing is the next connector; GitHub and URL import are active now.</div>
                  </div>
                )}
              </div>
            ) : (
              <div className="p-5">
                <div className="rounded-md border border-slate-200 bg-white p-5">
                  <label className="text-xs font-semibold text-slate-700">Project URL</label>
                  <div className="mt-2 flex gap-2">
                    <div className="flex h-11 flex-1 items-center gap-2 rounded border border-slate-300 px-3">
                      <SimpleIcon kind="link" className="h-4 w-4 text-slate-400" />
                      <input
                        type="url"
                        value={projectUrl}
                        onChange={(e) => setProjectUrl(e.target.value)}
                        placeholder={source === "hackaday" ? "https://hackaday.io/project/..." : source === "hackster" ? "https://www.hackster.io/..." : source === "ezplm" ? "https://ezplm.com/project/..." : "https://..."}
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
                      />
                    </div>
                    <button disabled={analyzing} onClick={importUrl} className="rounded bg-[#202326] px-5 text-xs font-semibold text-white disabled:opacity-50">Import</button>
                  </div>
                  <div className="mt-3 text-[11px] leading-5 text-slate-500">
                    URL import extracts public project metadata and hardware clues. Connecting the project's repository later gives much stronger evidence coverage.
                  </div>
                </div>
              </div>
            )}

            {(analyzing || analysisError) && (
              <div className="border-t border-slate-200 bg-white px-5 py-4">
                {analyzing && (
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-xs font-semibold text-slate-800">Tindie Project Import Agent</div>
                      <div className="text-[10px] text-slate-400">Analyzing source evidence…</div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {ANALYSIS_STAGES.map((stage, index) => (
                        <div key={stage} className={`flex items-center gap-2 rounded border px-3 py-2 text-[11px] ${index <= analysisStep ? "border-cyan-100 bg-cyan-50/60 text-slate-700" : "border-slate-100 bg-slate-50 text-slate-400"}`}>
                          <span className={`grid h-5 w-5 place-items-center rounded-full ${index < analysisStep ? "bg-emerald-500 text-white" : index === analysisStep ? "bg-[#22b8c4] text-white" : "bg-slate-200 text-slate-500"}`}>{index < analysisStep ? "✓" : index + 1}</span>
                          {stage}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {analysisError && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{analysisError}</div>}
              </div>
            )}
          </section>

          <aside className="space-y-4">
            <div className="rounded-md border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-[16px] font-semibold text-slate-800">What Tindie will generate</h3>
                <p className="mt-0.5 text-[10px] text-slate-500">AI and deterministic parsers fill what the source can support.</p>
              </div>
              <div className="divide-y divide-slate-100 px-4">
                {[
                  ["Product Title", "Generate a clear title from the project"],
                  ["Description", "Preserve the maker story and key details"],
                  ["Category", "Suggest the best Tindie category"],
                  ["Technical Specs", "Extract MCU, interfaces and dimensions"],
                  ["Photos", "Find project images and identify gaps"],
                  ["Documentation", "Link README, docs, source and design files"],
                ].map(([title, subtitle]) => (
                  <div key={title} className="flex items-center gap-3 py-2.5">
                    <span className="grid h-7 w-7 place-items-center rounded bg-slate-50 text-slate-700"><SimpleIcon kind="check" className="h-4 w-4"/></span>
                    <div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-slate-700">{title}</div><div className="text-[9px] text-slate-400">{subtitle}</div></div>
                    <span className="grid h-4 w-4 place-items-center rounded-full bg-emerald-500 text-[9px] text-white">✓</span>
                  </div>
                ))}
              </div>
              <div className="m-4 rounded border border-amber-200 bg-amber-50 p-3">
                <div className="flex gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-amber-400 text-xs font-bold text-white">!</span><div><div className="text-[11px] font-semibold text-amber-900">Seller must confirm</div><div className="mt-0.5 text-[9px] text-amber-700">Price, inventory, shipping, package weight and commercial claims are never invented.</div></div></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[9px] text-amber-900"><div>＄ Price</div><div>▣ Inventory</div><div>▤ Shipping</div></div>
              </div>
            </div>

            {analysis ? (
              <div className="rounded-md border border-slate-200 bg-[#fbfbfb] p-4 shadow-sm">
                <div className="flex items-center justify-between"><div><div className="text-[14px] font-semibold text-slate-800">Project imported</div><div className="mt-0.5 text-[10px] text-slate-500">{analysis.sourceLabel}</div></div><span className="rounded bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-700">READY TO REVIEW</span></div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
                  <StatRing value={analysis.readiness.completeness} label="Completeness" />
                  <StatRing value={analysis.readiness.evidenceCoverage} label="Evidence" />
                  <StatRing value={confirmation} label="Seller confirm" />
                </div>
                <div className="mt-4 rounded border border-slate-200 bg-white p-3">
                  <div className="text-[11px] font-semibold text-slate-700">Detected project assets</div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[9px]">
                    {analysis.manifest.readme && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">✓ README</span>}
                    {analysis.manifest.schematic > 0 && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">✓ Schematic ×{analysis.manifest.schematic}</span>}
                    {analysis.manifest.pcb > 0 && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">✓ PCB ×{analysis.manifest.pcb}</span>}
                    {analysis.manifest.bom > 0 && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">✓ BOM ×{analysis.manifest.bom}</span>}
                    {analysis.manifest.images > 0 && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">✓ Images ×{analysis.manifest.images}</span>}
                    {analysis.manifest.firmware > 0 && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">✓ Firmware</span>}
                    {analysis.hardware.processors.map((item) => <span key={item} className="rounded bg-violet-50 px-2 py-1 text-violet-700">{item}</span>)}
                  </div>
                </div>
                {analysis.aiEnhanced && <div className="mt-3 flex items-center gap-2 rounded bg-violet-50 px-3 py-2 text-[10px] text-violet-700"><SimpleIcon kind="sparkles" className="h-4 w-4"/> Listing copy refined with the configured OpenAI model.</div>}
                <button onClick={() => configRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="mt-4 w-full rounded bg-[#22b8c4] py-2.5 text-xs font-semibold text-white hover:bg-[#1aa0ab]">Continue to Seller Configuration →</button>
              </div>
            ) : (
              <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-[12px] font-semibold text-slate-700">AI Import Workflow</div>
                <div className="mt-4 flex items-start justify-between">
                  {["Analyze", "Extract", "Generate", "Review"].map((step, index) => (
                    <div key={step} className="flex flex-1 items-center last:flex-none">
                      <div className="flex flex-col items-center gap-1"><span className={`grid h-7 w-7 place-items-center rounded-full text-[10px] font-bold ${index === 0 ? "bg-[#22b8c4] text-white" : "bg-slate-200 text-slate-500"}`}>{index + 1}</span><span className="text-[9px] text-slate-500">{step}</span></div>
                      {index < 3 && <div className="mx-2 mt-[-14px] h-px flex-1 bg-slate-200" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>

        {analysis && (
          <section ref={configRef} id="configure-sale" className="scroll-mt-6 mt-8 border-t border-slate-200 pt-8">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="text-[24px] font-semibold text-slate-800">Configure for Sale</h2><p className="mt-1 text-xs text-slate-500">The Agent found the project. You only need to confirm commercial information before creating the Tindie draft.</p></div>
              <div className="rounded border border-cyan-100 bg-cyan-50 px-3 py-2 text-[10px] text-cyan-800">Import session <span className="font-semibold">{analysis.id}</span></div>
            </div>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(360px,.9fr)]">
              <div className="space-y-5">
                <div className="rounded-md border border-slate-200 bg-[#f8f9f9] p-5">
                  <h3 className="border-b border-slate-200 pb-2 text-[16px] font-semibold text-slate-800">Selling</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <label className="text-xs text-slate-700"><span className="font-medium">Price <span className="text-red-500">*</span></span><div className="mt-2 flex h-10 overflow-hidden rounded border border-slate-300 bg-white"><span className="grid w-10 place-items-center border-r border-slate-200 text-slate-500">$</span><input value={seller.price} onChange={(e) => setSeller({ ...seller, price: e.target.value })} inputMode="decimal" className="min-w-0 flex-1 px-3 outline-none" placeholder="39.00" /></div></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Num in stock <span className="text-red-500">*</span></span><input value={seller.inventory} onChange={(e) => setSeller({ ...seller, inventory: e.target.value })} inputMode="numeric" className="mt-2 h-10 w-full rounded border border-slate-300 bg-white px-3 outline-none" placeholder="50" /></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Model Number</span><input value={seller.modelNumber} onChange={(e) => setSeller({ ...seller, modelNumber: e.target.value })} className="mt-2 h-10 w-full rounded border border-slate-300 bg-white px-3 outline-none" /></label>
                  </div>
                  <div className="mt-5"><div className="text-xs font-medium text-slate-700">What's included?</div><div className="mt-2 flex flex-wrap gap-2">{["Assembled board", "Bare PCB", "Enclosure", "USB cable", "Headers / accessories"].map((option) => { const checked = seller.included.includes(option); return <button key={option} onClick={() => setSeller({ ...seller, included: checked ? seller.included.filter((item) => item !== option) : [...seller.included, option] })} className={`rounded border px-3 py-2 text-[10px] ${checked ? "border-[#22b8c4] bg-cyan-50 text-cyan-800" : "border-slate-200 bg-white text-slate-600"}`}>{checked ? "✓ " : "+ "}{option}</button>; })}</div></div>
                </div>

                <div className="rounded-md border border-slate-200 bg-[#f8f9f9] p-5">
                  <h3 className="border-b border-slate-200 pb-2 text-[16px] font-semibold text-slate-800">Shipping</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <label className="text-xs text-slate-700"><span className="font-medium">Ships from <span className="text-red-500">*</span></span><select value={seller.shipsFrom} onChange={(e) => setSeller({ ...seller, shipsFrom: e.target.value })} className="mt-2 h-10 w-full rounded border border-slate-300 bg-white px-3 outline-none"><option value="">Select…</option><option>China</option><option>United States</option><option>Canada</option><option>United Kingdom</option><option>European Union</option></select></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Shipping profile <span className="text-red-500">*</span></span><select value={seller.shippingProfile} onChange={(e) => setSeller({ ...seller, shippingProfile: e.target.value })} className="mt-2 h-10 w-full rounded border border-slate-300 bg-white px-3 outline-none"><option value="">Select…</option><option>International Standard</option><option>Tracked International</option><option>Domestic Only</option></select></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Handling time <span className="text-red-500">*</span></span><select value={seller.handlingDays} onChange={(e) => setSeller({ ...seller, handlingDays: e.target.value })} className="mt-2 h-10 w-full rounded border border-slate-300 bg-white px-3 outline-none"><option value="1">1 business day</option><option value="2">2 business days</option><option value="3">3 business days</option><option value="5">5 business days</option><option value="7">7 business days</option></select></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Package weight <span className="text-red-500">*</span></span><div className="mt-2 flex h-10 overflow-hidden rounded border border-slate-300 bg-white"><input value={seller.weight} onChange={(e) => setSeller({ ...seller, weight: e.target.value })} inputMode="decimal" className="min-w-0 flex-1 px-3 outline-none" placeholder="0.12" /><span className="grid w-10 place-items-center bg-[#858d96] text-[10px] text-white">kg</span></div></label>
                  </div>
                </div>

                <button onClick={() => setShowDraft(true)} disabled={!requiredComplete} className="w-full rounded bg-[#22b8c4] py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1aa0ab] disabled:cursor-not-allowed disabled:bg-slate-300">Generate Tindie Listing Draft</button>
                {!requiredComplete && <div className="text-center text-[10px] text-amber-700">Complete all required selling and shipping fields to generate the draft.</div>}
              </div>

              <aside className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between"><h3 className="text-[16px] font-semibold text-slate-800">AI Listing Preview</h3><span className="rounded bg-cyan-50 px-2 py-1 text-[9px] font-bold text-cyan-700">{analysis.readiness.completeness}% SOURCE READY</span></div>
                <div className="mt-4 rounded border border-slate-200 bg-[#f8f9f9] p-4">
                  <div className="text-[16px] font-semibold text-slate-800">{analysis.listing.title.value}</div>
                  <div className="mt-1 text-[11px] text-slate-500">{analysis.listing.shortDescription.value}</div>
                  <div className="mt-3 flex items-center gap-2"><span className="rounded bg-slate-200 px-2 py-1 text-[9px] font-semibold text-slate-600">{analysis.listing.category.value}</span>{analysis.hardware.processors.slice(0, 2).map((item) => <span key={item} className="rounded bg-violet-50 px-2 py-1 text-[9px] font-semibold text-violet-700">{item}</span>)}</div>
                  <div className="mt-4 text-2xl font-semibold text-slate-900">{seller.price ? `$${seller.price}` : "$—"}</div>
                </div>
                <div className="mt-4 space-y-2 text-[10px]">
                  <div className="flex items-center justify-between border-b border-slate-100 py-2"><span className="text-slate-500">Product title</span><FieldStatusBadge status={analysis.listing.title.status}/></div>
                  <div className="flex items-center justify-between border-b border-slate-100 py-2"><span className="text-slate-500">Category</span><FieldStatusBadge status={analysis.listing.category.status}/></div>
                  <div className="flex items-center justify-between border-b border-slate-100 py-2"><span className="text-slate-500">Technical evidence</span><span className="font-semibold text-slate-700">{analysis.readiness.evidenceCoverage}%</span></div>
                  <div className="flex items-center justify-between border-b border-slate-100 py-2"><span className="text-slate-500">Commercial fields</span><span className={`font-semibold ${requiredComplete ? "text-emerald-600" : "text-amber-600"}`}>{requiredComplete ? "Confirmed" : `${confirmation}% complete`}</span></div>
                </div>
                {analysis.warnings.length > 0 && <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3"><div className="text-[10px] font-semibold text-amber-900">Agent suggestions</div><ul className="mt-2 space-y-1 text-[9px] leading-4 text-amber-800">{analysis.warnings.slice(0, 3).map((warning) => <li key={warning}>• {warning}</li>)}</ul></div>}
              </aside>
            </div>
          </section>
        )}

        {analysis && showDraft && (
          <section className="mt-10 border-t-4 border-[#22b8c4] pt-8">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-[26px] font-semibold text-slate-800">Tindie Listing Draft</h2><span className="rounded bg-emerald-100 px-2 py-1 text-[9px] font-bold text-emerald-700">PREFILLED</span></div><p className="mt-1 text-xs text-slate-500">This mirrors the current Tindie List a Product form. In production the Legacy Adapter will prefill these fields and the seller will use the existing Save as Draft / Publish flow.</p></div><button className="rounded bg-[#858d96] px-4 py-2 text-xs font-semibold text-white">About Selling on Tindie</button></div>

            <div className="grid gap-6 lg:grid-cols-[270px_1fr]">
              <aside className="text-[12px] leading-6 text-slate-600"><p>AI has filled project-derived fields and preserved source/evidence status.</p><p className="mt-6">Commercial values below came from your seller confirmation, not from AI.</p></aside>
              <div className="space-y-6">
                <div className="rounded border border-slate-200 bg-[#f7f8f8] p-6">
                  <h3 className="border-b border-slate-200 pb-2 text-[16px] font-semibold text-slate-800">Product Basics</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <label className="md:col-span-2 text-xs text-slate-700"><span className="font-medium">Product Title <span className="text-red-500">*</span></span><FieldStatusBadge status={analysis.listing.title.status}/><input defaultValue={analysis.listing.title.value || ""} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-sm outline-none" /></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Category <span className="text-red-500">*</span></span><FieldStatusBadge status={analysis.listing.category.status}/><select defaultValue={analysis.listing.category.value || "Other"} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3"><option>{analysis.listing.category.value || "Other"}</option><option>Development Boards</option><option>Test Equipment</option><option>Sensors</option><option>Other</option></select></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Who designed this? <span className="text-red-500">*</span></span><select defaultValue="Yourself" className="mt-2 h-11 w-full border border-slate-300 bg-white px-3"><option>Yourself</option><option>Someone else</option></select></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Status <span className="text-red-500">*</span></span><select defaultValue="Save as Draft" className="mt-2 h-11 w-full border border-slate-300 bg-white px-3"><option>Save as Draft</option></select></label>
                  </div>
                </div>

                <div className="rounded border border-slate-200 bg-[#f7f8f8] p-6">
                  <h3 className="border-b border-slate-200 pb-2 text-[16px] font-semibold text-slate-800">Product Details</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <label className="text-xs text-slate-700"><span className="font-medium">Price <span className="text-red-500">*</span></span><FieldStatusBadge status="USER_CONFIRMED"/><input defaultValue={seller.price} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3" /></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Num in stock <span className="text-red-500">*</span></span><FieldStatusBadge status="USER_CONFIRMED"/><input defaultValue={seller.inventory} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3" /></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Model Number</span><FieldStatusBadge status={analysis.listing.modelNumber.status}/><input defaultValue={seller.modelNumber} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3" /></label>
                    <label className="md:col-span-3 text-xs text-slate-700"><span className="font-medium">140 Character Description <span className="text-red-500">*</span></span><FieldStatusBadge status={analysis.listing.shortDescription.status}/><input defaultValue={analysis.listing.shortDescription.value || ""} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3" /></label>
                  </div>
                </div>

                <div className="rounded border border-slate-200 bg-[#f7f8f8] p-6">
                  <div className="mb-2 flex items-center justify-between"><h3 className="text-[16px] font-semibold text-slate-800">Product Description <span className="text-red-500">*</span></h3><FieldStatusBadge status="AI_GENERATED"/></div>
                  <div className="flex gap-1 border border-slate-300 bg-white p-2 text-xs text-slate-600"><span className="rounded border px-2 py-1 font-bold">B</span><span className="rounded border px-2 py-1 italic">I</span><span className="rounded border px-2 py-1">🔗</span><span className="rounded border px-2 py-1">▧</span><span className="ml-auto rounded bg-[#22b8c4] px-3 py-1 text-white">Preview</span></div>
                  <textarea defaultValue={descriptionMarkdown} className="min-h-[300px] w-full border-x border-b border-slate-300 bg-[#f2f2f2] p-4 font-mono text-[12px] leading-7 text-slate-700 outline-none" />
                </div>

                <div className="rounded border border-slate-200 bg-[#f7f8f8] p-6">
                  <h3 className="border-b border-slate-200 pb-2 text-[16px] font-semibold text-slate-800">Media and Documentation</h3>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <label className="text-xs text-slate-700"><span className="font-medium">Link to Documentation</span><input defaultValue={analysis.listing.documentationUrl.value || ""} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-[11px]" /></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Link to Source Code</span><input defaultValue={analysis.listing.sourceCodeUrl.value || ""} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-[11px]" /></label>
                    <label className="text-xs text-slate-700"><span className="font-medium">Link to Design Files</span><input defaultValue={analysis.listing.designFilesUrl.value || ""} className="mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-[11px]" /></label>
                  </div>
                </div>

                <div className="flex justify-end gap-3"><button className="rounded border border-slate-300 bg-white px-5 py-2.5 text-xs font-semibold text-slate-600">Back to Import</button><button onClick={() => alert("Prototype only: production will hand this TLIR payload to the existing Tindie Save as Draft flow.")} className="rounded bg-[#22b8c4] px-6 py-2.5 text-xs font-semibold text-white">Save as Draft (Prototype)</button></div>
              </div>
            </div>
          </section>
        )}
      </main>
    </SellerChrome>
  );
}

