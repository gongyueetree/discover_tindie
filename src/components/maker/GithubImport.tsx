"use client";
import { useState } from "react";
import SupportedFormats from "./SupportedFormats";
import { Github, ArrowRight, FolderOpen } from "lucide-react";
import type { GithubProject } from "@/lib/maker/github-projects";
export default function GithubImport({
  onImport,
  disabled,
  autoFocus = false,
}: {
  onImport: (files: File[]) => Promise<void>;
  disabled: boolean;
  autoFocus?: boolean;
}) {
  const [url, setUrl] = useState(""),
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
  async function inspect() {
    setBusy(true);
    setError("");
    setScan(null);
    try {
      const r = await fetch("/api/maker/github/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setScan(d);
      setChoice(
        d.projects.find((p: GithubProject) => p.recommended)?.id ||
          d.projects[0]?.id ||
          "",
      );
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    if (!scan) return;
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
