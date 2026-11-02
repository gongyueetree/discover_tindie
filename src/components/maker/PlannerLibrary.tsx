"use client";
import { useEffect, useState } from "react";
import type { Part } from "@/lib/maker/types";
export type LibraryChoice = {
  text: string;
  name: string;
  source: "KICAD" | "EZPLM";
  url: string;
  part?: Part;
  model?: boolean;
};
export default function PlannerLibrary({
  onAdd,
}: {
  onAdd: (item: LibraryChoice) => void;
}) {
  const [source, setSource] = useState("ezplm"),
    [q, setQ] = useState(""),
    [libraries, setLibraries] = useState<string[]>([]),
    [lib, setLib] = useState(""),
    [names, setNames] = useState<string[]>([]),
    [parts, setParts] = useState<Part[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function read(url: string) {
    const r = await fetch(url);
    const d = await r.json();
    if (!r.ok) throw Error(d.error || "Library unavailable");
    return d;
  }
  useEffect(() => {
    if (source !== "kicad" || libraries.length) return;
    setBusy(true);
    read("/api/maker/library")
      .then((d) => {
        setLibraries(d.names);
        setLib(d.names.includes("Package_SO") ? "Package_SO" : d.names[0]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  }, [source, libraries.length]);
  useEffect(() => {
    if (source !== "kicad" || !lib) return;
    const ac = new AbortController();
    setBusy(true);
    setNames([]);
    setError("");
    fetch("/api/maker/library?" + new URLSearchParams({ library: lib }), {
      signal: ac.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        return d;
      })
      .then((d) => {
        if (!ac.signal.aborted) setNames(d.names);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!ac.signal.aborted) setBusy(false);
      });
    return () => ac.abort();
  }, [source, lib]);
  const filteredNames = names.filter((n) =>
    q
      .toLowerCase()
      .trim()
      .split(/\s+/)
      .every((term) => n.toLowerCase().includes(term)),
  );
  async function search() {
    setBusy(true);
    setError("");
    try {
      if (source === "ezplm") {
        const d = await read("/api/maker/parts?" + new URLSearchParams({ q }));
        setParts(d.items);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function add(name: string, part?: Part) {
    setBusy(true);
    setError("");
    try {
      const d = await read(
        "/api/maker/library?" +
          new URLSearchParams(
            part
              ? { kind: "ezplm", mpn: part.mpn }
              : { kind: "file", library: lib, name },
          ),
      );
      onAdd({ ...d, part });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>Component library</h3>
      <select
        aria-label="Component source"
        value={source}
        onChange={(e) => {
          setSource(e.target.value);
          setQ("");
          setError("");
        }}
      >
        <option value="ezplm">ezPLM catalogue</option>
        <option value="kicad">KiCad official · GitLab</option>
      </select>
      {source === "kicad" && (
        <label>
          Footprint category
          <select
            aria-label="KiCad footprint category"
            value={lib}
            onChange={(e) => {
              setLib(e.target.value);
              setQ("");
              setNames([]);
            }}
          >
            {libraries.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <input
          aria-label="Search planner library"
          placeholder={
            source === "ezplm"
              ? "MPN, e.g. STM32F103C8T6"
              : "Footprint name, e.g. SOIC-8"
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          className="btn"
          disabled={
            busy ||
            (source === "kicad" && !lib) ||
            (source === "ezplm" && q.length < 2)
          }
        >
          {busy
            ? "Loading…"
            : source === "kicad"
              ? "Filter footprints"
              : "Search library"}
        </button>
      </form>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {source === "kicad" && (
        <p aria-live="polite">
          {busy
            ? "Loading category…"
            : `${filteredNames.length} of ${names.length} footprints`}
        </p>
      )}
      <div className="planner-library-results">
        {source === "kicad"
          ? filteredNames.map((n) => (
              <button
                key={n}
                className="planner-part"
                disabled={busy}
                onClick={() => void add(n)}
              >
                {n}
                <small>Add source footprint</small>
              </button>
            ))
          : parts.map((p) => (
              <button
                key={p.id}
                className="planner-part"
                disabled={busy}
                onClick={() => void add(p.package || p.mpn, p)}
              >
                <b>{p.mpn}</b>
                <small>
                  {p.manufacturer} · {p.package}
                </small>
              </button>
            ))}
      </div>
      <small>
        KiCad 10.0.0 library · CC BY-SA 4.0 with library exception. Source links
        are retained in saved layouts.
      </small>
    </section>
  );
}
