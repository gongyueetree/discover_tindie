"use client";
import { lockModalScroll } from "@/lib/maker/modal-scroll";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Part } from "@/lib/maker/types";
import DatasheetReader from "./DatasheetReader";
import GraphEmbed from "./GraphEmbed";
import CadPreview from "./CadPreview";
export default function PartDetailsModal({
  mpn,
  manufacturer,
  search = false,
  onClose,
}: {
  mpn: string;
  manufacturer?: string;
  search?: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(mpn),
    [submitted, setSubmitted] = useState(mpn),
    [results, setResults] = useState<Part[]>([]),
    [loading, setLoading] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);
  const [part, setPart] = useState<Part | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    modal?.showModal();
    const release = lockModalScroll();
    return () => {
      release();
      modal?.close();
      prior?.focus();
    };
  }, []);
  useEffect(() => {
    const ac = new AbortController();
    setPart(null);
    setLoading(true);
    setResults([]);
    setError("");
    fetch("/api/maker/parts?q=" + encodeURIComponent(submitted), {
      signal: ac.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Component lookup failed");
        const normalize = (s: string) =>
          s
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")
            .replace(/^STMICROELECTRONICS$/, "ST");
        const p = (d.items || []).find(
          (p: Part) =>
            p.mpn.toUpperCase() === submitted.toUpperCase() &&
            (!manufacturer ||
              normalize(p.manufacturer) === normalize(manufacturer)),
        );
        if (!ac.signal.aborted) {
          setResults(d.items || []);
          if (!search && p) setPart(p);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!ac.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => ac.abort();
  }, [mpn, manufacturer, submitted, search]);
  return createPortal(
    <dialog
      ref={dialog}
      className="maker part-details-modal"
      onCancel={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }}
      onClose={(e) => e.stopPropagation()}
      aria-label={"Component details: " + mpn}
    >
      <header>
        <div>
          <small>PART DETAILS</small>
          <div className="part-title-actions">
            <h2>{part?.mpn || mpn}</h2>
            {part && <GraphEmbed key={part.mpn} mpn={part.mpn} triggerOnly />}
          </div>
        </div>
        <button className="btn" autoFocus onClick={onClose}>
          Close ×
        </button>
      </header>
      {!part && (
        <form
          className="search-row"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(query);
          }}
        >
          <input
            aria-label="Search components"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn primary">Search components</button>
        </form>
      )}
      {error ? (
        <p role="alert">{error}</p>
      ) : loading ? (
        <p role="status">Loading components…</p>
      ) : !part ? (
        <div className="part-search-results">
          {results.length ? (
            results.map((p) => (
              <button className="btn" key={p.id} onClick={() => setPart(p)}>
                <b>{p.mpn}</b> · {p.manufacturer}
                <small>{p.description}</small>
              </button>
            ))
          ) : (
            <p>No components found for this search.</p>
          )}
        </div>
      ) : (
        <>
          <p>{part.manufacturer}</p>
          <p>{part.description}</p>
          <CadPreview mpn={part.mpn} />
          <div className="part-modal-downloads">
            {part.datasheet && <DatasheetReader url={part.datasheet} />}
            {part.cad.map((c) => (
              <a
                className="btn"
                key={c.url}
                href={c.url}
                target="_blank"
                rel="noreferrer"
              >
                {c.name} ↓
              </a>
            ))}
          </div>
          <h3>Specifications</h3>
          <table>
            <tbody>
              {part.package && (
                <tr>
                  <th>Package</th>
                  <td>{part.package}</td>
                </tr>
              )}
              {Object.entries(part.parameters || {}).map(([k, v]) => (
                <tr key={k}>
                  <th>{k}</th>
                  <td>{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </dialog>,
    document.body,
  );
}
