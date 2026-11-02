"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ConnectedAccountsResponse,
  GithubConnection,
  ImportHistoryItem,
  ProjectImportResult,
  RepositorySummary,
} from "@/lib/project-import/types";

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

const HISTORY_KEY = "tindie_project_import_history_v2";
const TEAL = "#22b8c4";

const emptySeller: SellerConfig = {
  price: "",
  inventory: "",
  modelNumber: "",
  shipsFrom: "",
  shippingProfile: "",
  handlingDays: "2",
  weight: "",
  included: ["Assembled board"],
};

function Icon({ kind, className = "h-5 w-5" }: { kind: string; className?: string }) {
  const common = { className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8 };
  if (kind === "github") return <svg {...common} fill="currentColor" stroke="none"><path d="M12 2C6.48 2 2 6.58 2 12.23c0 4.52 2.87 8.35 6.84 9.7.5.1.68-.22.68-.49 0-.24-.01-.89-.01-1.75-2.78.62-3.37-1.37-3.37-1.37-.45-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .08 1.53 1.06 1.53 1.06.9 1.56 2.35 1.11 2.92.85.09-.66.35-1.11.64-1.36-2.22-.26-4.56-1.14-4.56-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 6.65a9.3 9.3 0 0 1 2.5.35c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.26 10.26 0 0 0 22 12.23C22 6.58 17.52 2 12 2Z"/></svg>;
  if (kind === "link") return <svg {...common}><path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15"/><path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.15-1.15"/></svg>;
  if (kind === "upload") return <svg {...common}><path d="M12 16V3"/><path d="m7 8 5-5 5 5"/><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>;
  if (kind === "search") return <svg {...common}><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>;
  if (kind === "sparkles") return <svg {...common}><path d="m12 3-1.1 3.1L8 7.2l2.9 1.1L12 11l1.1-2.7L16 7.2l-2.9-1.1L12 3Z"/><path d="m6 13-.8 2.2L3 16l2.2.8L6 19l.8-2.2L9 16l-2.2-.8L6 13Z"/></svg>;
  if (kind === "plug") return <svg {...common}><path d="M8 3v5M16 3v5M6 8h12v3a6 6 0 0 1-12 0V8Z"/><path d="M12 17v4"/></svg>;
  if (kind === "history") return <svg {...common}><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>;
  if (kind === "check") return <svg {...common}><path d="m5 12 4 4L19 6"/></svg>;
  if (kind === "trash") return <svg {...common}><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6"/></svg>;
  if (kind === "file") return <svg {...common}><path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5"/></svg>;
  return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>;
}

function SellerChrome({ children }: { children: ReactNode }) {
  const nav = ["Dashboard", "Products", "Shipping", "Orders", "Promotions", "Disbursement", "Seller Tools", "Store Settings"];
  return <div className="min-h-screen bg-white text-[#3a3f44]">
    <div className="border-b border-[#e4e7e8] bg-white"><div className="mx-auto flex h-14 max-w-[1450px] items-center justify-between px-6">
      <div className="flex items-center gap-2 font-semibold text-[#202428]"><div className="relative h-7 w-7"><div className="absolute left-2 top-0 h-4 w-4 rounded-full border-2 border-[#3a3f44]"/><div className="absolute left-0 top-3 h-2 w-2 rounded-full bg-[#ef4b4b]"/><div className="absolute right-0 top-3 h-2 w-2 rounded-full bg-[#22b8c4]"/></div><span className="text-[17px] lowercase tracking-tight">tindie</span></div>
      <div className="flex items-center gap-5 text-sm text-slate-700"><span>Discover</span><span className="grid h-8 w-8 place-items-center rounded bg-gradient-to-br from-fuchsia-700 to-orange-500 text-xs font-bold text-white">G</span><span className="font-medium">Gongyu ▾</span></div>
    </div></div>
    <div className="border-b border-[#edf0f1] bg-[#fafbfb]"><div className="mx-auto flex h-[52px] max-w-[1450px] items-stretch px-6"><div className="flex w-[390px] items-center text-[17px] font-medium tracking-wide text-slate-700">STEPFPGA</div><nav className="flex flex-1 items-stretch justify-end overflow-x-auto">{nav.map((item) => <div key={item} className={`flex items-center whitespace-nowrap px-5 text-[13px] font-medium ${item === "Products" ? "bg-[#22b8c4] text-white" : "text-slate-600"}`}>{item}</div>)}</nav></div></div>
    {children}
  </div>;
}

function loadHistory(): ImportHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveHistory(items: ImportHistoryItem[]) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 10))); } catch { /* ignore */ }
}

function relativeDate(value: string) {
  const diff = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.round(days / 30)}mo ago`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded border border-slate-200 bg-white p-3"><div className="flex items-center justify-between"><span className="text-[10px] text-slate-500">{label}</span><span className="text-xs font-semibold text-slate-800">{value}%</span></div><div className="mt-2 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-[#22b8c4]" style={{ width: `${value}%` }}/></div></div>;
}

function ConnectionCard({ connection, selected, onSelect, onDisconnect }: { connection: GithubConnection; selected: boolean; onSelect: () => void; onDisconnect: () => void }) {
  return <div className={`rounded-lg border p-4 ${selected ? "border-[#22b8c4] bg-cyan-50/40" : "border-slate-200 bg-white"}`}>
    <div className="flex items-start gap-3">
      {connection.avatarUrl ? <img src={connection.avatarUrl} alt="" className="h-10 w-10 rounded-full border border-slate-200"/> : <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-100"><Icon kind="github"/></div>}
      <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold text-slate-800">{connection.accountLogin}</span><span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">CONNECTED</span></div><div className="mt-1 text-[10px] text-slate-500">{connection.accountType} · {connection.repositorySelection === "selected" ? "Selected repositories" : connection.repositorySelection === "all" ? "All repositories" : "Repository access"}</div></div>
    </div>
    <div className="mt-3 flex gap-2"><button onClick={onSelect} className={`flex-1 rounded px-3 py-2 text-[10px] font-semibold ${selected ? "bg-[#22b8c4] text-white" : "border border-slate-200 bg-white text-slate-700"}`}>{selected ? "Browsing" : "Browse Projects"}</button><a href={`https://github.com/settings/installations/${connection.installationId}`} target="_blank" rel="noreferrer" className="rounded border border-slate-200 bg-white px-3 py-2 text-[10px] font-semibold text-slate-600">Manage</a><button onClick={onDisconnect} title="Disconnect from Tindie" className="rounded border border-slate-200 bg-white px-2 text-slate-400 hover:text-red-600"><Icon kind="trash" className="h-4 w-4"/></button></div>
  </div>;
}

export function ProjectImportAgentV2() {
  const [connections, setConnections] = useState<ConnectedAccountsResponse>({ githubAppConfigured: false, githubConnections: [], publicGithubFallback: true });
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [connectionNotice, setConnectionNotice] = useState("");
  const [selectedInstallationId, setSelectedInstallationId] = useState<number | null>(null);
  const selectedConnection = connections.githubConnections.find((item) => item.installationId === selectedInstallationId) || null;
  const [publicOwner, setPublicOwner] = useState("gongyueetree");
  const [publicMode, setPublicMode] = useState(false);
  const [search, setSearch] = useState("");
  const [repositories, setRepositories] = useState<RepositorySummary[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState("");
  const [source, setSource] = useState<SourceKey>("github");
  const [projectUrl, setProjectUrl] = useState("");
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<ProjectImportResult | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStage, setAnalysisStage] = useState(0);
  const [seller, setSeller] = useState<SellerConfig>(emptySeller);
  const [showDraft, setShowDraft] = useState(false);
  const [history, setHistory] = useState<ImportHistoryItem[]>([]);
  const configRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setHistory(loadHistory());
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected") === "github") setConnectionNotice("GitHub account connected. You can now browse the repositories granted to Tindie.");
    if (params.get("github") === "not-configured") setConnectionNotice("GitHub App is not configured on this deployment yet. Public repository import remains available.");
    if (params.get("github") === "state-error") setConnectionNotice("GitHub connection could not be verified. Please try connecting again.");
  }, []);

  const refreshConnections = async () => {
    setConnectionsLoading(true);
    try {
      const response = await fetch("/api/project-import/connections", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load connected accounts.");
      setConnections(payload);
      const list = payload.githubConnections as GithubConnection[];
      if (list.length && !list.some((item) => item.installationId === selectedInstallationId)) {
        setSelectedInstallationId(list[0].installationId);
        setPublicMode(false);
      }
      if (!list.length) setPublicMode(true);
    } catch (error) {
      setConnectionNotice(error instanceof Error ? error.message : "Unable to load connected accounts.");
      setPublicMode(true);
    } finally {
      setConnectionsLoading(false);
    }
  };

  useEffect(() => { void refreshConnections(); }, []);

  useEffect(() => {
    if (source !== "github") return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setReposLoading(true);
      setReposError("");
      try {
        const query = publicMode || !selectedInstallationId
          ? `owner=${encodeURIComponent(publicOwner)}&q=${encodeURIComponent(search)}`
          : `installationId=${encodeURIComponent(String(selectedInstallationId))}&q=${encodeURIComponent(search)}`;
        const response = await fetch(`/api/project-import/repos?${query}`, { signal: controller.signal, cache: "no-store" });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to load repositories.");
        setRepositories(payload.repositories || []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setReposError(error instanceof Error ? error.message : "Unable to load repositories.");
          setRepositories([]);
        }
      } finally { setReposLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [source, publicMode, publicOwner, search, selectedInstallationId]);

  const upsertHistory = (result: ProjectImportResult, status: ImportHistoryItem["status"], sellerState?: SellerConfig) => {
    const item: ImportHistoryItem = {
      id: result.id,
      sourceType: result.sourceType,
      sourceLabel: result.sourceLabel,
      sourceUrl: result.sourceUrl,
      projectName: result.projectName,
      status,
      updatedAt: new Date().toISOString(),
      result,
      seller: sellerState,
    };
    setHistory((current) => {
      const next = [item, ...current.filter((entry) => entry.id !== result.id)].slice(0, 10);
      saveHistory(next);
      return next;
    });
  };

  const runAnalysis = async (body: Record<string, unknown>) => {
    setAnalyzing(true); setAnalysisError(""); setAnalysis(null); setShowDraft(false); setAnalysisStage(0);
    const timer = window.setInterval(() => setAnalysisStage((value) => Math.min(5, value + 1)), 550);
    try {
      const response = await fetch("/api/project-import/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Project analysis failed.");
      const result = payload.result as ProjectImportResult;
      setAnalysis(result);
      const nextSeller = { ...emptySeller, modelNumber: result.listing.modelNumber.value || "" };
      setSeller(nextSeller);
      upsertHistory(result, "ANALYZED", nextSeller);
      setAnalysisStage(5);
    } catch (error) { setAnalysisError(error instanceof Error ? error.message : "Project analysis failed."); }
    finally { window.clearInterval(timer); setAnalyzing(false); }
  };

  const importRepository = (repo: RepositorySummary) => void runAnalysis({ sourceType: "github", owner: repo.owner, repo: repo.name, ...(publicMode || !selectedInstallationId ? {} : { installationId: selectedInstallationId }) });
  const importUrl = () => {
    if (!projectUrl.trim()) return setAnalysisError("Enter a project URL first.");
    const sourceType = source === "hackaday" || source === "hackster" || source === "ezplm" ? source : "url";
    void runAnalysis({ sourceType, url: projectUrl.trim() });
  };

  const disconnect = async (installationId: number) => {
    if (!window.confirm("Disconnect this GitHub account from Tindie? Existing imported listings will not be deleted.")) return;
    const response = await fetch("/api/project-import/connections/github/disconnect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ installationId }) });
    if (response.ok) {
      if (selectedInstallationId === installationId) setSelectedInstallationId(null);
      await refreshConnections();
    }
  };

  const restoreHistory = (item: ImportHistoryItem) => {
    setAnalysis(item.result);
    setSeller({ ...emptySeller, ...(item.seller || {}) });
    setShowDraft(item.status === "DRAFT" || item.status === "PUBLISHED");
    setTimeout(() => configRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  };

  const requiredComplete = Boolean(seller.price && seller.inventory && seller.shipsFrom && seller.shippingProfile && seller.handlingDays && seller.weight);
  const confirmation = useMemo(() => Math.round(([seller.price, seller.inventory, seller.shipsFrom, seller.shippingProfile, seller.handlingDays, seller.weight].filter(Boolean).length / 6) * 100), [seller]);
  const descriptionMarkdown = analysis ? `#### What is it?\n\n${analysis.listing.whatIsIt.value || ""}\n\n#### Why did you make it?\n\n${analysis.listing.whyMadeIt.value || ""}\n\n#### What makes it special?\n\n${analysis.listing.whatMakesSpecial.value || ""}\n\n#### Key Features\n\n${(analysis.listing.features.value || []).map((item) => `- ${item}`).join("\n")}` : "";

  return <SellerChrome><main className="mx-auto max-w-[1450px] px-6 pb-24 pt-10">
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5"><div><h1 className="text-[30px] font-semibold tracking-tight text-[#353a3e]">Import a Project</h1><p className="mt-1 text-sm text-slate-500">Connect your project accounts, import hardware work, and let Tindie AI turn it into a product listing.</p></div><div className="rounded-full border border-cyan-200 bg-cyan-50 px-4 py-2 text-[11px] font-semibold text-cyan-800">Project → Product Agent</div></div>

    {connectionNotice && <div className="mt-5 flex items-center justify-between rounded border border-cyan-200 bg-cyan-50 px-4 py-3 text-xs text-cyan-800"><span>{connectionNotice}</span><button onClick={() => setConnectionNotice("")} className="ml-4 text-cyan-600">×</button></div>}

    <section className="mt-7"><div className="mb-3 flex items-end justify-between"><div><h2 className="text-[18px] font-semibold text-slate-800">Connected Sources</h2><p className="text-xs text-slate-500">Tindie only requests read access. Connecting GitHub enables private repositories and selected-repository access.</p></div>{connections.githubAppConfigured && <button onClick={() => { window.location.href = "/api/project-import/connections/github/start"; }} className="rounded bg-[#202326] px-4 py-2 text-[11px] font-semibold text-white">+ Connect GitHub account</button>}</div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-[#fbfbfb] p-4 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Icon kind="github" className="h-6 w-6"/><div><div className="text-sm font-semibold text-slate-800">GitHub</div><div className="text-[10px] text-slate-500">Engineering files, README, BOM, firmware and releases</div></div></div>{connectionsLoading && <span className="text-[10px] text-slate-400">Checking…</span>}</div>
          {connections.githubConnections.length ? <div className="grid gap-2 md:grid-cols-2">{connections.githubConnections.map((connection) => <ConnectionCard key={connection.id} connection={connection} selected={!publicMode && selectedInstallationId === connection.installationId} onSelect={() => { setSource("github"); setSelectedInstallationId(connection.installationId); setPublicMode(false); }} onDisconnect={() => void disconnect(connection.installationId)}/>)}</div> : <div className="rounded border border-dashed border-slate-300 bg-white p-5 text-center"><div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-slate-100"><Icon kind="plug"/></div><div className="mt-2 text-sm font-semibold text-slate-700">No GitHub account connected</div><div className="mt-1 text-[10px] text-slate-500">Public repositories still work. Connect the Tindie GitHub App to access private or selected repositories.</div>{connections.githubAppConfigured ? <button onClick={() => { window.location.href = "/api/project-import/connections/github/start"; }} className="mt-3 rounded bg-[#202326] px-4 py-2 text-[10px] font-semibold text-white">Connect GitHub</button> : <div className="mt-3 rounded bg-amber-50 px-3 py-2 text-[10px] text-amber-700">GitHub App environment variables are not configured on this Vercel deployment yet.</div>}</div>}
        </div>
        <div className="grid gap-2">
          {[{name:"Hackaday.io",sub:"Project story & build logs",icon:"sparkles"},{name:"Hackster.io",sub:"Tutorial projects",icon:"file"},{name:"ezPLM",sub:"Project, BOM & version data",icon:"plug"}].map((provider) => <button key={provider.name} onClick={() => { setSource(provider.name.startsWith("Hackaday") ? "hackaday" : provider.name.startsWith("Hackster") ? "hackster" : "ezplm"); }} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-[#22b8c4]"><span className="grid h-9 w-9 place-items-center rounded bg-slate-50"><Icon kind={provider.icon}/></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold text-slate-700">{provider.name}</span><span className="block text-[9px] text-slate-400">{provider.sub}</span></span><span className="rounded bg-slate-100 px-2 py-1 text-[9px] text-slate-500">Use URL</span></button>)}
        </div>
      </div>
    </section>

    <section className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(350px,.8fr)]">
      <div className="rounded-lg border border-slate-200 bg-[#fbfbfb] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4"><div><h2 className="text-[18px] font-semibold text-slate-800">Choose a project</h2><p className="text-[10px] text-slate-500">Browse a connected account, import a public repository, or paste a project URL.</p></div><div className="flex rounded border border-slate-200 bg-white p-1 text-[10px]">{(["github","url","hackaday","hackster","ezplm","upload"] as SourceKey[]).map((item) => <button key={item} onClick={() => setSource(item)} className={`rounded px-2.5 py-1.5 ${source === item ? "bg-[#22b8c4] text-white" : "text-slate-500"}`}>{item === "github" ? "GitHub" : item === "url" ? "URL" : item === "upload" ? "Upload" : item}</button>)}</div></div>

        {source === "github" ? <div className="p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {connections.githubConnections.length > 0 && <select value={publicMode ? "public" : String(selectedInstallationId || "")} onChange={(e) => { if (e.target.value === "public") { setPublicMode(true); } else { setPublicMode(false); setSelectedInstallationId(Number(e.target.value)); } }} className="h-10 rounded border border-slate-300 bg-white px-3 text-xs outline-none"><option value="public">Public GitHub profile</option>{connections.githubConnections.map((item) => <option key={item.id} value={item.installationId}>{item.accountLogin} · connected</option>)}</select>}
            {(publicMode || !connections.githubConnections.length) && <input value={publicOwner} onChange={(e) => setPublicOwner(e.target.value)} className="h-10 w-[220px] rounded border border-slate-300 bg-white px-3 text-xs outline-none" placeholder="GitHub username"/>}
            <label className="flex h-10 min-w-[240px] flex-1 items-center gap-2 rounded border border-slate-300 bg-white px-3"><Icon kind="search" className="h-4 w-4 text-slate-400"/><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search repositories..." className="min-w-0 flex-1 bg-transparent text-xs outline-none"/></label>
          </div>
          <div className="mb-3 flex items-center justify-between text-[10px] text-slate-500"><span>{publicMode ? `Public repositories from ${publicOwner}` : selectedConnection ? `Read-only access via ${selectedConnection.accountLogin}` : "Select an account"}</span>{!publicMode && selectedConnection && <span className="text-emerald-600">● private repositories supported</span>}</div>
          <div className="overflow-hidden rounded border border-slate-200 bg-white">{reposLoading && <div className="p-8 text-center text-xs text-slate-400">Loading repositories…</div>}{!reposLoading && reposError && <div className="p-5 text-xs text-red-600">{reposError}</div>}{!reposLoading && !reposError && !repositories.length && <div className="p-8 text-center text-xs text-slate-400">No repositories found.</div>}{!reposLoading && !reposError && repositories.slice(0, 12).map((repo) => <div key={repo.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 last:border-b-0 hover:bg-slate-50"><div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-50"><Icon kind="github"/></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className="truncate text-[13px] font-semibold text-slate-800">{repo.name}</span>{repo.private && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">PRIVATE</span>}</div><div className="mt-0.5 truncate text-[10px] text-slate-500">{repo.description || "No repository description"}</div><div className="mt-1 flex gap-2 text-[9px] text-slate-400">{repo.language && <span>{repo.language}</span>}<span>{relativeDate(repo.updatedAt)}</span>{repo.stars > 0 && <span>★ {repo.stars}</span>}</div></div><button disabled={analyzing} onClick={() => importRepository(repo)} className="rounded bg-[#202326] px-4 py-2 text-[10px] font-semibold text-white disabled:opacity-50">Import</button></div>)}</div>
        </div> : source === "upload" ? <div className="p-5"><label className="grid min-h-[210px] cursor-pointer place-items-center rounded-lg border-2 border-dashed border-slate-300 bg-white p-8 text-center"><div><div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-cyan-50 text-cyan-700"><Icon kind="upload"/></div><div className="mt-3 text-sm font-semibold text-slate-800">Upload ZIP / design files</div><div className="mt-1 text-[10px] text-slate-500">KiCad, BOM, Gerber, STEP, PDF, images and firmware</div><input type="file" multiple className="hidden" onChange={(event) => setUploadedNames(Array.from(event.target.files || []).map((file) => file.name))}/></div></label>{uploadedNames.length > 0 && <div className="mt-3 rounded border border-slate-200 bg-white p-3"><div className="flex flex-wrap gap-1">{uploadedNames.map((name) => <span key={name} className="rounded bg-slate-100 px-2 py-1 text-[9px] text-slate-600">{name}</span>)}</div><div className="mt-2 text-[10px] text-amber-700">Files are selected in the prototype. Sandboxed server-side CAD/ZIP parsing is the next processing connector.</div></div>}</div> : <div className="p-5"><div className="rounded border border-slate-200 bg-white p-5"><label className="text-xs font-semibold text-slate-700">Project URL</label><div className="mt-2 flex gap-2"><div className="flex h-11 flex-1 items-center gap-2 rounded border border-slate-300 px-3"><Icon kind="link" className="h-4 w-4 text-slate-400"/><input value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} placeholder={source === "hackaday" ? "https://hackaday.io/project/..." : source === "hackster" ? "https://www.hackster.io/..." : source === "ezplm" ? "https://ezplm.com/project/..." : "https://..."} className="min-w-0 flex-1 text-xs outline-none"/></div><button disabled={analyzing} onClick={importUrl} className="rounded bg-[#202326] px-5 text-[10px] font-semibold text-white">Import</button></div><div className="mt-3 text-[10px] text-slate-500">Public URL import is useful for project stories and tutorials. Connect GitHub as an additional engineering source for stronger evidence.</div></div></div>}

        {(analyzing || analysisError) && <div className="border-t border-slate-200 bg-white p-5">{analyzing && <div><div className="flex items-center justify-between text-xs font-semibold text-slate-700"><span>Tindie Project Import Agent</span><span className="text-[9px] font-normal text-slate-400">Analyzing project evidence…</span></div><div className="mt-3 grid gap-2 sm:grid-cols-3">{["Read source","Map files","Detect hardware","Extract evidence","Generate listing","Check missing fields"].map((label,index) => <div key={label} className={`rounded border px-3 py-2 text-[10px] ${index <= analysisStage ? "border-cyan-100 bg-cyan-50 text-cyan-800" : "border-slate-100 bg-slate-50 text-slate-400"}`}>{index < analysisStage ? "✓" : index === analysisStage ? "●" : "○"} {label}</div>)}</div></div>}{analysisError && <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">{analysisError}</div>}</div>}
      </div>

      <aside className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-center gap-2"><Icon kind="history" className="h-5 w-5 text-slate-600"/><h3 className="text-sm font-semibold text-slate-800">Recent Imports</h3></div>{history.length ? <div className="mt-3 divide-y divide-slate-100">{history.slice(0,5).map((item) => <div key={item.id} className="py-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-[11px] font-semibold text-slate-700">{item.projectName}</div><div className="mt-0.5 truncate text-[9px] text-slate-400">{item.sourceLabel} · {relativeDate(item.updatedAt)}</div></div><span className={`rounded px-1.5 py-0.5 text-[8px] font-bold ${item.status === "DRAFT" ? "bg-cyan-50 text-cyan-700" : item.status === "PUBLISHED" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{item.status}</span></div><button onClick={() => restoreHistory(item)} className="mt-2 text-[9px] font-semibold text-cyan-700">Continue →</button></div>)}</div> : <div className="mt-3 rounded bg-slate-50 p-4 text-center text-[10px] text-slate-400">Your analyzed projects and drafts will appear here.</div>}</div>

        {analysis ? <div className="rounded-lg border border-slate-200 bg-[#fbfbfb] p-4 shadow-sm"><div className="flex items-center justify-between"><div><div className="text-sm font-semibold text-slate-800">Project imported</div><div className="mt-0.5 text-[9px] text-slate-500">{analysis.sourceLabel}</div></div><span className="rounded bg-emerald-100 px-2 py-1 text-[8px] font-bold text-emerald-700">READY TO REVIEW</span></div><div className="mt-3 grid gap-2"><Stat label="Listing completeness" value={analysis.readiness.completeness}/><Stat label="Evidence coverage" value={analysis.readiness.evidenceCoverage}/><Stat label="Seller confirmation" value={confirmation}/></div><div className="mt-3 flex flex-wrap gap-1 text-[8px]">{analysis.manifest.readme && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">✓ README</span>}{analysis.manifest.schematic > 0 && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">✓ Schematic</span>}{analysis.manifest.pcb > 0 && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">✓ PCB</span>}{analysis.manifest.bom > 0 && <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">✓ BOM</span>}{analysis.hardware.processors.map((item) => <span key={item} className="rounded bg-violet-50 px-2 py-1 text-violet-700">{item}</span>)}</div><button onClick={() => configRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })} className="mt-4 w-full rounded bg-[#22b8c4] py-2.5 text-[10px] font-semibold text-white">Configure for Sale →</button></div> : <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"><h3 className="text-sm font-semibold text-slate-800">What the Agent does</h3><div className="mt-3 space-y-2">{["Reads project metadata and engineering files","Detects hardware, interfaces and evidence","Generates Tindie title, description and category","Keeps price, stock and shipping for seller confirmation"].map((item) => <div key={item} className="flex gap-2 text-[10px] text-slate-600"><span className="text-emerald-500">✓</span><span>{item}</span></div>)}</div></div>}
      </aside>
    </section>

    {analysis && <section ref={configRef} className="mt-9 scroll-mt-6 border-t border-slate-200 pt-8"><div className="mb-4"><h2 className="text-[24px] font-semibold text-slate-800">Configure for Sale</h2><p className="mt-1 text-xs text-slate-500">AI created the project information. Confirm the commercial fields Tindie must never guess.</p></div><div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(350px,.85fr)]">
      <div className="space-y-5"><div className="rounded-lg border border-slate-200 bg-[#f8f9f9] p-5"><h3 className="border-b border-slate-200 pb-2 text-sm font-semibold text-slate-800">Selling</h3><div className="mt-4 grid gap-4 md:grid-cols-3"><label className="text-xs text-slate-700">Price *<div className="mt-2 flex h-10 rounded border border-slate-300 bg-white"><span className="grid w-10 place-items-center border-r border-slate-200">$</span><input value={seller.price} onChange={(e) => setSeller({...seller,price:e.target.value})} className="min-w-0 flex-1 px-3 outline-none" placeholder="39.00"/></div></label><label className="text-xs text-slate-700">Num in stock *<input value={seller.inventory} onChange={(e) => setSeller({...seller,inventory:e.target.value})} className="mt-2 h-10 w-full rounded border border-slate-300 bg-white px-3 outline-none" placeholder="50"/></label><label className="text-xs text-slate-700">Model Number<input value={seller.modelNumber} onChange={(e) => setSeller({...seller,modelNumber:e.target.value})} className="mt-2 h-10 w-full rounded border border-slate-300 bg-white px-3 outline-none"/></label></div><div className="mt-4"><div className="text-xs text-slate-700">What's included?</div><div className="mt-2 flex flex-wrap gap-2">{["Assembled board","Bare PCB","Enclosure","USB cable","Headers / accessories"].map((option) => { const checked=seller.included.includes(option); return <button key={option} onClick={() => setSeller({...seller,included:checked?seller.included.filter((item)=>item!==option):[...seller.included,option]})} className={`rounded border px-3 py-2 text-[9px] ${checked?"border-cyan-400 bg-cyan-50 text-cyan-800":"border-slate-200 bg-white text-slate-500"}`}>{checked?"✓ ":"+ "}{option}</button>; })}</div></div></div>
        <div className="rounded-lg border border-slate-200 bg-[#f8f9f9] p-5"><h3 className="border-b border-slate-200 pb-2 text-sm font-semibold text-slate-800">Shipping</h3><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"><label className="text-xs text-slate-700">Ships from *<select value={seller.shipsFrom} onChange={(e)=>setSeller({...seller,shipsFrom:e.target.value})} className="mt-2 h-10 w-full rounded border border-slate-300 bg-white px-3"><option value="">Select…</option><option>China</option><option>United States</option><option>Canada</option><option>United Kingdom</option><option>European Union</option></select></label><label className="text-xs text-slate-700">Shipping profile *<select value={seller.shippingProfile} onChange={(e)=>setSeller({...seller,shippingProfile:e.target.value})} className="mt-2 h-10 w-full rounded border border-slate-300 bg-white px-3"><option value="">Select…</option><option>International Standard</option><option>Tracked International</option><option>Domestic Only</option></select></label><label className="text-xs text-slate-700">Handling *<select value={seller.handlingDays} onChange={(e)=>setSeller({...seller,handlingDays:e.target.value})} className="mt-2 h-10 w-full rounded border border-slate-300 bg-white px-3"><option value="1">1 business day</option><option value="2">2 business days</option><option value="3">3 business days</option><option value="5">5 business days</option></select></label><label className="text-xs text-slate-700">Weight *<div className="mt-2 flex h-10 rounded border border-slate-300 bg-white"><input value={seller.weight} onChange={(e)=>setSeller({...seller,weight:e.target.value})} className="min-w-0 flex-1 px-3 outline-none" placeholder="0.12"/><span className="grid w-10 place-items-center bg-slate-600 text-[9px] text-white">kg</span></div></label></div></div>
        <button disabled={!requiredComplete} onClick={() => { setShowDraft(true); upsertHistory(analysis,"DRAFT",seller); }} className="w-full rounded bg-[#22b8c4] py-3 text-sm font-semibold text-white disabled:bg-slate-300">Generate Tindie Listing Draft</button></div>
      <aside className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold text-slate-800">Listing Preview</h3><span className="rounded bg-cyan-50 px-2 py-1 text-[8px] font-bold text-cyan-700">{analysis.readiness.completeness}% READY</span></div><div className="mt-4 rounded border border-slate-200 bg-slate-50 p-4"><div className="text-[16px] font-semibold text-slate-800">{analysis.listing.title.value}</div><div className="mt-1 text-[10px] text-slate-500">{analysis.listing.shortDescription.value}</div><div className="mt-3 flex flex-wrap gap-1">{analysis.hardware.processors.map((item)=><span key={item} className="rounded bg-violet-50 px-2 py-1 text-[8px] text-violet-700">{item}</span>)}</div><div className="mt-4 text-2xl font-semibold text-slate-900">{seller.price ? `$${seller.price}` : "$—"}</div></div><div className="mt-3 text-[10px] text-slate-500">Source: <a href={analysis.sourceUrl} target="_blank" rel="noreferrer" className="text-cyan-700">{analysis.sourceLabel}</a></div></aside>
    </div></section>}

    {analysis && showDraft && <section className="mt-8 rounded-lg border border-cyan-200 bg-cyan-50/20 p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold text-slate-800">Generated Tindie Product Draft</h2><p className="mt-1 text-[10px] text-slate-500">This mirrors the current Seller listing structure and is ready for the Legacy Adapter.</p></div><span className="rounded bg-emerald-100 px-3 py-1 text-[9px] font-bold text-emerald-700">DRAFT GENERATED</span></div><div className="mt-5 grid gap-5 lg:grid-cols-2"><div className="rounded border border-slate-200 bg-white p-5"><h3 className="text-sm font-semibold text-slate-800">Product Basics</h3><div className="mt-4 space-y-3 text-xs"><div><div className="text-[9px] text-slate-400">Product Title</div><div className="mt-1 rounded border border-slate-200 bg-slate-50 p-2">{analysis.listing.title.value}</div></div><div><div className="text-[9px] text-slate-400">Category</div><div className="mt-1 rounded border border-slate-200 bg-slate-50 p-2">{analysis.listing.category.value}</div></div><div className="grid grid-cols-3 gap-2"><div><div className="text-[9px] text-slate-400">Price</div><div className="mt-1 rounded border border-slate-200 p-2">${seller.price}</div></div><div><div className="text-[9px] text-slate-400">Stock</div><div className="mt-1 rounded border border-slate-200 p-2">{seller.inventory}</div></div><div><div className="text-[9px] text-slate-400">Model</div><div className="mt-1 rounded border border-slate-200 p-2">{seller.modelNumber || "—"}</div></div></div></div></div><div className="rounded border border-slate-200 bg-white p-5"><h3 className="text-sm font-semibold text-slate-800">Media & Documentation</h3><div className="mt-4 space-y-2 text-[10px]"><div className="flex justify-between border-b border-slate-100 py-2"><span>Source Code</span><a href={analysis.listing.sourceCodeUrl.value || analysis.sourceUrl} target="_blank" rel="noreferrer" className="text-cyan-700">Linked</a></div><div className="flex justify-between border-b border-slate-100 py-2"><span>Design Files</span><a href={analysis.listing.designFilesUrl.value || analysis.sourceUrl} target="_blank" rel="noreferrer" className="text-cyan-700">Linked</a></div><div className="flex justify-between py-2"><span>Documentation</span><a href={analysis.listing.documentationUrl.value || analysis.sourceUrl} target="_blank" rel="noreferrer" className="text-cyan-700">Linked</a></div></div></div></div><div className="mt-5 rounded border border-slate-200 bg-white p-5"><h3 className="text-sm font-semibold text-slate-800">Product Description</h3><pre className="mt-3 whitespace-pre-wrap font-sans text-[11px] leading-6 text-slate-600">{descriptionMarkdown}</pre></div><div className="mt-5 flex justify-end gap-2"><button className="rounded border border-slate-300 bg-white px-5 py-2 text-xs font-semibold text-slate-600">Edit Draft</button><button onClick={() => alert("Prototype complete: the next step is mapping this Listing IR into Tindie's existing Django Save as Draft endpoint.")} className="rounded bg-[#22b8c4] px-5 py-2 text-xs font-semibold text-white">Save as Tindie Draft</button></div></section>}
  </main></SellerChrome>;
}

