"use client";
import { useEffect, useRef, useState } from "react";
import SupportedFormats from "./SupportedFormats";
import { Github, ArrowRight, FolderOpen } from "lucide-react";
import type { GithubProject } from "@/lib/maker/github-projects";
export default function GithubImport({
  onImport,
  disabled,
  autoFocus = false,
  initialUrl,
}: {
  onImport: (files: File[]) => Promise<void>;
  disabled: boolean;
  autoFocus?: boolean;
  /** Scan this repository on open and load its recommended project (used by "View design files"). */
  initialUrl?: string;
}) {
  const [url, setUrl] = useState(initialUrl || ""),
    [scan, setScan] = useState<{
      token: string;
      repo: string;
      commit: string;
      ref: string;
      scope: string;
      projects: GithubProject[];
      ignoredCount: number;
    } | null>(null),
    [choice, setChoice] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function inspect(target = url) {
    setBusy(true);
    setError("");
    setScan(null);
    try {
      const r = await fetch("/api/maker/github/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      const pick =
        d.projects.find((p: GithubProject) => p.recommended)?.id ||
        d.projects[0]?.id ||
        "";
      setScan(d);
      setChoice(pick);
      return { scan: d, pick };
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  // Opened for a known repository: scan it and load the recommended project without extra clicks.
  const started = useRef(false);
  useEffect(() => {
    if (!initialUrl || started.current) return;
    started.current = true;
    void inspect(initialUrl).then((found) => found?.pick && load(found.scan, found.pick));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);
  async function load(s = scan, chosen = choice) {
    if (!s) return;
    const scan = s,
      choice = chosen;
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/maker/github/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: scan.token, project: choice }),
      });
      if (!r.ok) throw Error((await r.json()).error);
      const file = new File(
        [await r.blob()],
        scan.projects.find((p) => p.id === choice)!.name + ".zip",
      );
      await onImport([file]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="github-import">
      <h3>
        <Github size={20} /> Open a public GitHub project
      </h3>
      <p>
        Paste a repository or folder link. We list the PCB projects in it; pick one and only
        that project&apos;s design files are fetched — nothing else from the repository.
      </p>
      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          void inspect();
        }}
      >
        <input
          autoFocus={autoFocus}
          aria-label="GitHub repository URL"
          placeholder="https://github.com/owner/repository/tree/main/hardware"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setScan(null);
          }}
          required
          type="url"
        />
        <button className="btn" disabled={busy || disabled}>
          {busy ? "Working…" : "Find projects"}
          <ArrowRight size={14} />
        </button>
      </form>
      <SupportedFormats github />
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {scan && (
        <>
          <div className="notice">
            {scan.repo} · {scan.ref} · commit {scan.commit.slice(0, 10)}
            <br />
            {scan.projects.length} project choices · {scan.ignoredCount} backup
            / unrelated files excluded. Git history is never imported.
          </div>
          <div className="github-projects">
            {scan.projects.map((p) => (
              <label
                key={p.id}
                className={
                  "github-project " + (choice === p.id ? "selected" : "")
                }
              >
                <input
                  type="radio"
                  name="github-project"
                  checked={choice === p.id}
                  onChange={() => setChoice(p.id)}
                />
                <span>
                  <b>{p.name}</b>
                  <small>
                    {p.directory || "/"} · {p.format}
                    {p.recommended ? " · Latest numbered revision" : ""}
                  </small>
                  <small>{p.roots.join(" · ")}</small>
                </span>
              </label>
            ))}
          </div>
          <p className="muted">
            Different designs can coexist in one repository. Only the highest
            explicit revision number is listed where recognizable; confirm the
            folder before import.
          </p>
          <button
            className="btn primary"
            disabled={busy || disabled || !choice}
            onClick={() => void load()}
          >
            <FolderOpen size={15} />
            Import selected project
          </button>
        </>
      )}
    </section>
  );
}
