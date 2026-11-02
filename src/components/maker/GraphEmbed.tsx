"use client";
import { lockModalScroll } from "@/lib/maker/modal-scroll";
import { useEffect, useRef, useState } from "react";

import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import type { GraphData } from "@/lib/maker/component-graph";
export const KIND_COLORS: Record<string, string> = {
  IC: "#22b8c4",
  Discrete: "#f2762e",
  Passive: "#8bc34a",
  Electromechanical: "#7b8fd6",
  "Crystal / oscillator": "#c27ad6",
  Other: "#9aa6ab",
};
const FullGraph = dynamic(() => import("./ComponentGraph"), {
  ssr: false,
  loading: () => <p>Opening graph…</p>,
});
// Reuse results between home, modal and Components without refetching BOMs.
const requests = new Map<
  string,
  { until: number; promise: Promise<GraphData> }
>();
function getGraph(mpn: string, module = "") {
  const key = module ? "module:" + module : mpn.toUpperCase();
  let hit = requests.get(key);
  if (!hit || hit.until < Date.now()) {
    const promise = fetch(
      "/api/maker/graph?" + new URLSearchParams(module ? { module } : { mpn }),
    ).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw Error(d.error || "Graph unavailable");
      return d as GraphData;
    });
    if (requests.size >= 32) requests.delete(requests.keys().next().value!);
    hit = { until: Date.now() + 600000, promise };
    requests.set(key, hit);
    promise.catch(() => {
      if (requests.get(key)?.promise === promise) requests.delete(key);
    });
  }
  return hit.promise;
}
export default function GraphEmbed({
  mpn = "",
  compact = false,
  triggerOnly = false,
  module = "",
  moduleName = "",
  label = "View related components",
}: {
  mpn?: string;
  compact?: boolean;
  triggerOnly?: boolean;
  /** Circuit-module graph: that module's most used parts instead of one part's neighbours. */
  module?: string;
  moduleName?: string;
  label?: string;
}) {
  const [data, setData] = useState<GraphData | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0),
    [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(0);
  useEffect(() => {
    if (
      triggerOnly ||
      open ||
      !data?.nodes.length ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const timer = setInterval(() => {
      if (!document.hidden) setFocus((i) => (i + 1) % data.nodes.length);
    }, 3500);
    return () => clearInterval(timer);
  }, [data, open, triggerOnly]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (triggerOnly && !open) return;
    let alive = true;
    setData(null);
    setError("");
    const timer = setTimeout(() => {
      getGraph(mpn, module)
        .then((d) => {
          if (alive) setData(d);
        })
        .catch((e) => {
          if (alive) setError(String(e.message));
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [mpn, module, attempt, triggerOnly, open]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = dialog.current;
    modal?.showModal();
    const release = lockModalScroll();
    return () => {
      release();
      modal?.close();
      previous?.focus();
    };
  }, [open]);
  const points =
    data?.nodes.map((_, i) => {
      const angle = i * 2.399963,
        r = 30 + Math.sqrt(i) * 22;
      return {
        x: 250 + Math.cos(angle) * r * 1.45,
        y: 165 + Math.sin(angle) * r,
      };
    }) || [];
  return (
    <div
      className={
        triggerOnly
          ? "graph-trigger"
          : "graph-embed" + (compact ? " graph-embed-compact" : "")
      }
    >
      {triggerOnly ? (
        <button
          className="btn small"
          onClick={() => setOpen(true)}
          title={label}
        >
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const a = (i * Math.PI) / 3;
              return (
                <g key={i}>
                  <line
                    x1="16"
                    y1="16"
                    x2={16 + 12 * Math.cos(a)}
                    y2={16 + 12 * Math.sin(a)}
                    stroke="#77aab3"
                  />
                  <circle
                    cx={16 + 12 * Math.cos(a)}
                    cy={16 + 12 * Math.sin(a)}
                    r="3"
                    fill={["#13a2b2", "#ef9c54", "#758bda"][i % 3]}
                  />
                </g>
              );
            })}
            <circle cx="16" cy="16" r="4" fill="#13a2b2" />
          </svg>
          {label}
        </button>
      ) : (
        <>
          <div className="graph-embed-title">
            <b>Discover how component families connect</b>
            <span>
              From open-source designs in the Tindie parts database{mpn ? " · " + mpn : ""}
            </span>
          </div>
          {!data ? (
            <div className="graph-embed-state" role="status">
              {error ? (
                <>
                  <p>{error}</p>
                  <button
                    className="btn"
                    onClick={() => setAttempt((a) => a + 1)}
                  >
                    Retry
                  </button>
                </>
              ) : (
                <p>Loading component relationships…</p>
              )}
            </div>
          ) : !data.nodes.length ? (
            <div className="graph-embed-state">
              No relationship data for this part yet.
            </div>
          ) : (
            <button
              className="graph-preview"
              onClick={() => setOpen(true)}
              aria-label="Open full component relationship graph"
            >
              <svg
                className="graph-orbit"
                viewBox="0 0 500 330"
                aria-hidden="true"
              >
                {data.edges.map((e) => (
                  <line
                    key={`${e.a}-${e.b}`}
                    x1={points[e.a].x}
                    y1={points[e.a].y}
                    x2={points[e.b].x}
                    y2={points[e.b].y}
                    stroke="#129eae"
                    opacity=".2"
                    strokeWidth={1 + 3 * e.jaccard}
                  />
                ))}
                {data.nodes.map((n, i) => (
                  <g
                    key={n.id}
                    transform={`translate(${points[i].x} ${points[i].y})`}
                  >
                    <circle
                      r={
                        6 +
                        13 *
                          Math.sqrt(
                            n.count /
                              Math.max(...data.nodes.map((n) => n.count)),
                          )
                      }
                      fill={KIND_COLORS[n.identity] || "#9aa6ab"}
                      stroke={i === focus ? "#f2b04f" : "white"}
                      strokeWidth={i === focus ? 5 : 2}
                    />
                    {i < 10 && (
                      <text
                        textAnchor="middle"
                        y="-24"
                        fontSize="9"
                        fill="#28383f"
                      >
                        {n.label.length > 24
                          ? n.label.slice(0, 22) + "…"
                          : n.label}
                      </text>
                    )}
                  </g>
                ))}
              </svg>
              <span className="graph-open-label">
                {data.nodes[focus % data.nodes.length]?.label} · Explore the
                full graph ↗
              </span>
            </button>
          )}
          {data && (
            <p className="graph-embed-scope">
              {data.scope.projects.toLocaleString()} designs analysed ·{" "}
              {data.nodes.length} families shown · same-board co-occurrence
              {data.scope.sourceDate ? " · " + data.scope.sourceDate.slice(0, 10) : ""}
            </p>
          )}
        </>
      )}
      {open &&
        createPortal(
          <dialog
            className="graph-dialog maker"
            ref={dialog}
            onCancel={(e) => {
              e.stopPropagation();
              if (e.target === e.currentTarget) setOpen(false);
            }}
            onClose={(e) => e.stopPropagation()}
            aria-label={module ? `Common parts · ${moduleName || module}` : "Component relationships"}
          >
            <div className="graph-dialog-bar">
              <b>{module ? `Common parts · ${moduleName || module}` : "Component relationships"}</b>
              <button className="btn" autoFocus onClick={() => setOpen(false)}>
                Close ×
              </button>
            </div>
            {data?.nodes.length ? (
              <FullGraph key={data.scope.generatedAt + mpn + module} data={data} moduleName={moduleName} />
            ) : (
              <p role="status">
                {error ||
                  (data
                    ? module
                      ? "No designs are classified into this circuit module yet."
                      : "No related components found."
                    : "Loading related components…")}
              </p>
            )}
            {error && (
              <button className="btn" onClick={() => setAttempt((a) => a + 1)}>
                Retry
              </button>
            )}
          </dialog>,
          document.body,
        )}
    </div>
  );
}
