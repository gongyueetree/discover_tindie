"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { partFamily } from "@/lib/maker/part-family";
import PartDetailsModal from "./PartDetailsModal";
import FamilyVariants from "./FamilyVariants";
import PartCompare from "./PartCompare";
import { ToolHeading } from "./ToolShell";

import type { GraphData } from "@/lib/maker/component-graph";
import FamilyInfo from "./FamilyInfo";
export function graphPositions(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const angle = i * 2.399963;
    const r = 65 + Math.sqrt(i) * 48;
    return {
      x: 450 + Math.cos(angle) * r * 1.35,
      y: 330 + Math.sin(angle) * r,
    };
  });
}
import { KIND_COLORS as colors } from "./GraphEmbed";
const REL = { co_occurrence: "Used together", alternative: "Alternative candidate", series: "Same-series candidate" } as const;
const REL_COLOR: Record<string, string> = { [REL.co_occurrence]: "#159eae", [REL.alternative]: "#f2762e", [REL.series]: "#7b8fd6" };
export default function ComponentGraph({ data, moduleName = "" }: { data: GraphData; moduleName?: string }) {
  const mod = data.scope.module || null;
  const parts = data.nodes.map((n) => [n.label, n.identity, n.count] as const);
  const edges = data.edges.map((e) => ({
    ...e,
    type: (REL[(e.type ?? "co_occurrence") as keyof typeof REL] ?? REL.co_occurrence) as string,
  }));
  const initial = graphPositions(parts.length);
  // matchedPart is the knowledge graph's family key (e.g. STM32F103); labels are member part numbers.
  const focusIndex = data.nodes.findIndex(
    (n) =>
      n.id === data.scope.matchedPart ||
      n.label.toUpperCase() === data.scope.matchedPart.toUpperCase() ||
      n.label === partFamily(data.scope.matchedPart).family,
  );
  if (focusIndex >= 0) initial[focusIndex] = { x: 450, y: 330 };
  const [lookup, setLookup] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ reference: string; candidates: string[]; family: string } | null>(null);
  const compareRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (compare) compareRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [compare]);
  const [tour, setTour] = useState(false);
  const [selected, setSelected] = useState(Math.max(0, focusIndex));
  const [positions, setPositions] = useState(initial);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  useEffect(() => {
    if (!tour || !data.nodes.length) return;
    const timer = setInterval(
      () => setSelected((i) => (i + 1) % data.nodes.length),
      3500,
    );
    return () => clearInterval(timer);
  }, [tour, data.nodes.length]);
  useEffect(() => {
    if (tour) {
      const p = positions[selected];
      setView({ x: 450 - p.x, y: 330 - p.y, z: 1 });
    }
  }, [tour, selected, positions]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All relationships");
  const svg = useRef<SVGSVGElement>(null);
  const gesture = useRef<{
    id: number;
    node: number | null;
    x: number;
    y: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const visible = edges.filter(
    (e) => filter === "All relationships" || e.type === filter,
  );
  const connected = visible
    .filter((e) => e.a === selected || e.b === selected)
    .sort((a, b) => b.weight - a.weight);
  const neighbors = new Set(connected.flatMap((e) => [e.a, e.b]));
  const found = parts
    .map((p, i) => ({ p, i }))
    .filter(
      ({ p, i }) =>
        p[0].toLowerCase().includes(query.toLowerCase()) ||
        data.nodes[i].variants.some((v) =>
          v.mpn.toLowerCase().includes(query.toLowerCase()),
        ),
    );
  const part = parts[selected];
  function point(e: React.PointerEvent) {
    const m = svg.current?.getScreenCTM();
    return m
      ? new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
      : { x: 0, y: 0 };
  }
  function start(e: React.PointerEvent, node: number | null) {
    if (e.button !== 0 || gesture.current) return;
    setTour(false);
    e.preventDefault();
    const p = point(e);
    gesture.current = {
      id: e.pointerId,
      node,
      x: p.x,
      y: p.y,
      lastX: p.x,
      lastY: p.y,
      moved: false,
    };
    svg.current?.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const p = point(e);
    if (!g.moved && Math.hypot(p.x - g.x, p.y - g.y) < 6) return;
    g.moved = true;
    const dx = p.x - g.lastX,
      dy = p.y - g.lastY;
    g.lastX = p.x;
    g.lastY = p.y;
    if (g.node === null) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    else
      setPositions((old) =>
        old.map((pos, i) =>
          i === g.node
            ? { x: pos.x + dx / view.z, y: pos.y + dy / view.z }
            : pos,
        ),
      );
  }
  function finish(e: React.PointerEvent, cancel = false) {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (!cancel && !g.moved && g.node !== null) setSelected(g.node);
    gesture.current = null;
    if (svg.current?.hasPointerCapture(e.pointerId))
      svg.current.releasePointerCapture(e.pointerId);
  }
  function zoom(delta: number) {
    setView((v) => {
      const z = Math.max(0.5, Math.min(2.5, v.z + delta));
      const ratio = z / v.z;
      return { z, x: 450 - (450 - v.x) * ratio, y: 330 - (330 - v.y) * ratio };
    });
  }
  return (
    <>
      {mod ? (
        <ToolHeading
          eyebrow="Circuit module · common parts"
          title={`Most used parts in ${moduleName || mod.id}`}
          description={`ICs found most often in the ${mod.designs.toLocaleString()} open-source designs classified into this circuit module (sub-modules included), and which of them appear on the same boards. Resistors, capacitors and other passives are left out.`}
        />
      ) : (
        <ToolHeading
          eyebrow="Component knowledge graph"
          title="Which parts go together — and which could replace them"
          description="Component families that appear on the same boards across open-source designs. Dashed lines mark replacement candidates (e.g. RP2040 → RP2350). Select a family to see its designs, related families and candidate alternatives."
        />
      )}
      {mod && mod.items.length > 0 && (
        <ol className="module-common-parts" aria-label="Most used parts">
          {mod.items.slice(0, 12).map((it, i) => {
            const at = data.nodes.findIndex((n) => n.id === it.family);
            return (
              <li key={it.family}>
                <button type="button" className={at === selected ? "active" : ""} onClick={() => at >= 0 && setSelected(at)}>
                  <span className="rank">{i + 1}</span>
                  <span className="name">
                    <b>{it.label}</b>
                    {it.manufacturer && <small>{it.manufacturer}</small>}
                    {it.description && <small className="desc" title={it.description}>{it.description}</small>}
                  </span>
                  <span className="share" title={`${it.count} of ${mod.designs} designs`}>
                    {mod.designs ? Math.round((100 * it.count) / mod.designs) : 0}%
                    <small>{it.count} designs</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {!mod && data.scope.matchedPart && focusIndex < 0 && (
        <p className="notice">
          {data.scope.matchedPart} is not in the graph yet (too few designs use it). Showing the most common families instead.
        </p>
      )}
      <div className="graph-source-note">
        <b>Tindie parts database · knowledge graph snapshot</b>
        <span>
          {data.scope.projects.toLocaleString()} representative open-source designs · showing {parts.length} of{" "}
          {data.scope.eligibleNodes.toLocaleString()} families. A family is a part number without package, packing
          and temperature suffixes (STM32F103C8T6 → STM32F103).
        </span>
        <span>
          Snapshot {data.scope.sourceDate ? new Date(data.scope.sourceDate).toLocaleDateString() : "date unknown"}.
          Appearing on the same board is not proof of an electrical connection or compatibility, and a replacement candidate is not a verified drop-in: check pinout, package and firmware first.
        </span>
      </div>
      <div className="graph-toolbar">
        <label>
          Find a node{" "}
          <input
            aria-label="Find a graph node"
            placeholder="Search family or MPN…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Show{" "}
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option>All relationships</option>
            <option>{REL.co_occurrence}</option>
            <option>{REL.alternative}</option>
            <option>{REL.series}</option>
          </select>
        </label>
        <div className="graph-controls">
          <button className="btn" aria-pressed={tour} onClick={() => setTour((v) => !v)}>
            {tour ? "Pause tour" : "Auto tour"}
          </button>
          <button
            className="btn"
            aria-label="Zoom out"
            onClick={() => zoom(-0.2)}
          >
            −
          </button>
          <span>{Math.round(view.z * 100)}%</span>
          <button
            className="btn"
            aria-label="Zoom in"
            onClick={() => zoom(0.2)}
          >
            +
          </button>
          <button
            className="btn"
            onClick={() => {
              setView({ x: 0, y: 0, z: 1 });
              setPositions(initial);
            }}
          >
            Reset view
          </button>
        </div>
      </div>
      {query && (
        <div className="graph-search-results">
          {found.length ? (
            found.map(({ p, i }) => (
              <button
                className="btn"
                key={data.nodes[i].id}
                onClick={() => {
                  setSelected(i);
                  setQuery("");
                }}
              >
                {p[0]}
              </button>
            ))
          ) : (
            <span>
              No matching node in the loaded BOMs.{" "}
              <Link href={"/tools/components?q=" + encodeURIComponent(query)}>
                Search the component catalog →
              </Link>
            </span>
          )}
        </div>
      )}
      <div className="graph-layout graph-family-layout">
        <section
          className="graph-canvas"
          aria-label="Component relationship network"
        >
          <div className="graph-caption">
            <b>
              {parts.length} families · {visible.length} relationships
            </b>
            <span>
              Node size = designs using the family · Line width = designs using both
            </span>
          </div>
          <svg
            ref={svg}
            viewBox="0 0 900 660"
            aria-label="Interactive component graph. Tab to a node and press Enter to select."
            onPointerDown={(e) => start(e, null)}
            onPointerMove={move}
            onPointerUp={(e) => finish(e)}
            onPointerCancel={(e) => finish(e, true)}
            onLostPointerCapture={() => {
              gesture.current = null;
            }}
          >
            <g
              style={{
                transition: tour ? "transform 1s ease-in-out" : undefined,
              }}
              transform={`translate(${view.x} ${view.y}) scale(${view.z})`}
            >
              {visible.map((e) => (
                <line
                  key={`${e.a}-${e.b}`}
                  x1={positions[e.a].x}
                  y1={positions[e.a].y}
                  x2={positions[e.b].x}
                  y2={positions[e.b].y}
                  stroke={REL_COLOR[e.type]}
                  strokeWidth={
                    e.type === REL.co_occurrence
                      ? 1 + (5 * e.weight) / Math.max(1, ...edges.map((x) => x.weight))
                      : 2.5
                  }
                  strokeDasharray={e.type === REL.co_occurrence ? undefined : e.type === REL.alternative ? "7 6" : "2 5"}
                  strokeLinecap="round"
                  opacity={e.a === selected || e.b === selected ? 0.8 : 0.12}
                />
              ))}
              {parts.map((p, i) => {
                const r =
                  13 +
                  22 * Math.sqrt(p[2] / Math.max(1, ...parts.map((x) => x[2])));
                const active = i === selected;
                return (
                  <g
                    key={data.nodes[i].id}
                    transform={`translate(${positions[i].x} ${positions[i].y})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Select ${p[0]}, used in ${p[2]} designs`}
                    aria-pressed={active}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected(i);
                      }
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      start(e, i);
                    }}
                    style={{
                      cursor: "grab",
                      opacity: active || neighbors.has(i) ? 1 : 0.38,
                    }}
                  >
                    <title>
                      {p[0]} · {p[1]} · {p[2]} designs
                    </title>
                    {active && (
                      <circle
                        r={r + 9}
                        fill="none"
                        stroke="#129eae"
                        strokeWidth="2"
                      />
                    )}
                    <circle
                      r={r}
                      fill={colors[p[1]]}
                      stroke="white"
                      strokeWidth="3"
                    />
                    <text
                      textAnchor="middle"
                      y="5"
                      fill="white"
                      fontSize="13"
                      fontWeight="600"
                    >
                      {p[2]}
                    </text>
                    <text
                      textAnchor="middle"
                      y={r + 23}
                      fill="#28383f"
                      fontSize="12"
                      fontWeight="600"
                    >
                      {p[0]}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="graph-legend">
            {Object.entries(colors).map(([name, color]) => (
              <span key={name}>
                <i style={{ background: color }} />
                {name}
              </span>
            ))}
          </div>
          <div className="graph-legend graph-line-legend">
            {Object.values(REL).map((name) => (
              <span key={name}>
                <svg width="26" height="8" aria-hidden="true">
                  <line x1="1" y1="4" x2="25" y2="4" stroke={REL_COLOR[name]} strokeWidth="2.5" strokeLinecap="round"
                    strokeDasharray={name === REL.co_occurrence ? undefined : name === REL.alternative ? "7 6" : "2 5"} />
                </svg>
                {name}
              </span>
            ))}
          </div>
          <p className="graph-hint">
            Click to highlight · Drag a node to arrange · Drag empty space to
            pan · Use + / − to zoom
          </p>
        </section>
        <aside className="graph-details" aria-live="polite">
          <div className="eyebrow">FAMILY CONNECTIONS</div>
          <h2>{part[0]}</h2>
          <span className="graph-category" style={{ color: colors[part[1]] }}>
            {part[1]} · family {data.nodes[selected].id}
            {data.nodes[selected].manufacturer ? ` · ${data.nodes[selected].manufacturer}` : ""}
          </span>
          <div className="graph-stats">
            <div>
              <strong>{part[2]}</strong>
              <span>Designs</span>
            </div>
            <div>
              <strong>{connected.length}</strong>
              <span>Visible connections</span>
            </div>
          </div>
          <Link
            className="btn primary"
            href={"/tools/components?q=" + encodeURIComponent(part[0])}
          >
            Find component & CAD →
          </Link>
          <Link
            className="btn"
            href={"/tools/circuits?family=" + encodeURIComponent(data.nodes[selected].id)}
          >
            Open designs with this family →
          </Link>
          <button
            className="btn"
            onClick={() => {
              const swaps = connected.filter((e) => e.type !== REL.co_occurrence).map((e) => data.nodes[e.a === selected ? e.b : e.a].label);
              setCompare({ reference: data.nodes[selected].label, candidates: swaps.slice(0, 3), family: data.nodes[selected].id });
            }}
          >
            Compare with similar parts →
          </button>
          <FamilyVariants
            key={data.nodes[selected].id}
            node={data.nodes[selected]}
            onCompare={(mpn) => setCompare({ reference: data.nodes[selected].label, candidates: [mpn], family: "" })}
          />
          <FamilyInfo key={"info-" + data.nodes[selected].id} family={data.nodes[selected].id} />
          {(() => {
            const swaps = connected.filter((e) => e.type !== REL.co_occurrence);
            const together = connected.filter((e) => e.type === REL.co_occurrence);
            const row = (e: (typeof connected)[number]) => {
              const id = e.a === selected ? e.b : e.a;
              const x = e as any;
              return (
                <button
                  className="graph-relation"
                  key={id + e.type}
                  onClick={() => {
                    setTour(false);
                    setLookup(data.nodes[id].label);
                  }}
                >
                  <b>
                    {parts[id][0]} <span>↗</span>
                  </b>
                  <small>
                    {e.type === REL.co_occurrence ? (
                      <>
                        {e.weight} designs use both
                        {x.lift ? ` · ${x.lift.toFixed(1)}× more often than chance` : ""}
                        {x.strong ? " · strong" : ""}
                      </>
                    ) : e.type === REL.alternative ? (
                      <>
                        Used in similar circuits, rarely on the same board
                        {typeof x.similarity === "number" ? ` · similarity ${(x.similarity * 100).toFixed(0)}%` : ""}
                        {x.checks?.pin_count === "pass" ? " · same pin count" : x.checks?.pin_count === "fail" ? " · different pin count" : ""}
                      </>
                    ) : (
                      <>Same manufacturer and product series · shares a circuit role</>
                    )}
                  </small>
                  <div className="graph-meter">
                    <i
                      style={{
                        width: `${e.type === REL.co_occurrence ? e.jaccard * 100 : e.type === REL.alternative ? (x.similarity ?? 0.5) * 100 : 60}%`,
                        background: REL_COLOR[e.type],
                      }}
                    />
                  </div>
                </button>
              );
            };
            return (
              <>
                <h3>Could replace it · candidates</h3>
                {swaps.length ? swaps.map(row) : <p className="graph-hint">No replacement candidates for this family yet.</p>}
                {swaps.length > 0 && (
                  <p className="graph-hint">
                    Candidates only: pinout, package, electrical and software compatibility are <b>not verified</b>. Check
                    both datasheets before substituting.
                  </p>
                )}
                <h3>Used together</h3>
                {together.length ? together.map(row) : <p>No relationships for this filter.</p>}
              </>
            );
          })()}
          <p className="graph-hint">
            Co-occurrence is not electrical connectivity or proof of
            compatibility.
          </p>
        </aside>
      </div>
      {compare && (
        <div ref={compareRef}>
          <PartCompare key={JSON.stringify(compare)} {...compare} onClose={() => setCompare(null)} />
        </div>
      )}
      {lookup && (
        <PartDetailsModal
          key={lookup}
          mpn={lookup}
          onClose={() => setLookup(null)}
        />
      )}
    </>
  );
}
