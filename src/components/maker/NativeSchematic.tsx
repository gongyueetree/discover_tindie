"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  drawSchematic,
  type SheetDrawing,
  type Ink,
} from "@/vendor/eelib/kicad-schematic";
import type {
  CanonicalIrBundle,
  InputAsset,
} from "@/vendor/canon/lib/eda/types";
import { SchematicViewer } from "@/vendor/canon/components/EdaViewers";
import { drawSchematics } from "@/vendor/eelib/view";
const colors: Record<Ink, string> = {
  wire: "#008000",
  bus: "#0000cc",
  junction: "#008000",
  body: "#840000",
  pin: "#840000",
  pinName: "#008080",
  pinNumber: "#840000",
  field: "#008080",
  fieldOther: "#008080",
  label: "#000",
  global: "#840000",
  hier: "#808000",
  noConnect: "#0000cc",
  note: "#0000cc",
  sheet: "#840000",
  sheetName: "#008080",
  sheetFile: "#808000",
  frame: "#b04040",
};
export default function NativeSchematic({
  bundle,
  assets,
  viewId,
}: {
  bundle: CanonicalIrBundle;
  assets: InputAsset[];
  viewId: string;
}) {
  const [history, setHistory] = useState<number[]>([]);
  const [sheetNote, setSheetNote] = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<{
    reference: string;
    value: string;
  } | null>(null);
  const [remote, setRemote] = useState<SheetDrawing[]>([]),
    [loading, setLoading] = useState(!!viewId),
    [error, setError] = useState(""),
    [index, setIndex] = useState(0),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [net, setNet] = useState(""),
    [query, setQuery] = useState("");
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    setRemote([]);
    setError("");
    if (!viewId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const a = new AbortController();
    fetch(`/api/maker/drawings/${viewId}`, { signal: a.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Source drawings unavailable");
        setRemote(d.schematics || []);
      })
      .catch((e) => {
        if (!a.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!a.signal.aborted) setLoading(false);
      });
    return () => a.abort();
  }, [viewId]);
  // eelib's view (vendor/eelib/view.ts): every placement of a KiCad sheet in hierarchy order
  // (KiCad 5 converted first), each Altium SchDoc with its nets, each EAGLE sheet — drawn
  // from the source files. Other formats have none and fall back to the parsed geometry.
  const local = useMemo(() => {
    try {
      return drawSchematics(bundle, assets);
    } catch {
      return [];
    }
  }, [bundle, assets]);
  const drawings = remote.length ? remote : local,
    d = drawings[index] || drawings[0];
  useEffect(() => {
    const canvas = svg.current;
    if (!canvas) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const matrix = canvas.getScreenCTM();
      if (!matrix) return;
      const anchor = new DOMPoint(e.clientX, e.clientY).matrixTransform(
        matrix.inverse(),
      );
      const next = Math.max(
        0.2,
        Math.min(
          20,
          zoom * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.04 : 0.001)),
        ),
      );
      const ratio = zoom / next;
      setPan((p) => ({
        x: (anchor.x + p.x) * ratio - anchor.x,
        y: (anchor.y + p.y) * ratio - anchor.y,
      }));
      setZoom(next);
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [d, loading, zoom]);
  if (viewId && loading)
    return (
      <p className="notice" role="status">
        Loading source schematic…
      </p>
    );
  if (!d)
    return (
      <>
        {error && (
          <p className="notice">
            Source appearance unavailable; showing parsed geometry. {error}
          </p>
        )}
        <SchematicViewer bundle={bundle} assets={assets} />
      </>
    );
  const sourceParts = bundle.parts.filter(
    (p) => p.reference === selectedSymbol?.reference,
  );
  const selectedPart =
    sourceParts.length === 1
      ? sourceParts[0]
      : sourceParts.find((p) => p.sourceRefs.some((r) => r.path === d.file));
  const matchingNets = bundle.nets.filter(
    (n) =>
      (n.canonicalName === net || n.displayNames.includes(net)) &&
      n.domain === "schematic_logical",
  );
  const scopedNets = matchingNets.filter((n) =>
    n.sourceRefs.some((r) => r.path === d.file),
  );
  const selectedNets = scopedNets.length
    ? scopedNets
    : matchingNets.length === 1
      ? matchingNets
      : [];
  const endpoints =
    d.netPins?.[net] ||
    selectedNets.flatMap((n) =>
      n.endpoints
        .filter((e) => e.type === "symbol_pin")
        .map((e) => ({
          reference: e.identifier.reference,
          number: e.identifier.pin || e.identifier.number,
          value: "",
        })),
    );
  const netTree = new Map<string, Set<string>>();
  for (const pin of endpoints) {
    if (!pin.reference || !pin.number) continue;
    const pins = netTree.get(pin.reference) || new Set<string>();
    pins.add(pin.number);
    netTree.set(pin.reference, pins);
  }
  function openSheet(sheet: SheetDrawing["sheets"][number]) {
    const normalize = (path: string) => {
      const parts: string[] = [];
      for (const p of path.replace(/\\/g, "/").split("/")) {
        if (p === "..") parts.pop();
        else if (p && p !== ".") parts.push(p);
      }
      return parts.join("/");
    };
    const target = normalize(
      d.file.split("/").slice(0, -1).concat(sheet.file).join("/"),
    );
    let next = sheet.page;
    if (next === undefined || !drawings[next]) {
      next = drawings.findIndex((item) => normalize(item.file) === target);
      if (next < 0) {
        const matches = drawings
          .map((item, i) => ({ item, i }))
          .filter(
            ({ item }) =>
              item.file.split("/").pop() === sheet.file.split("/").pop(),
          );
        next = matches.length === 1 ? matches[0].i : -1;
      }
    }
    if (next < 0 || !drawings[next]) {
      setSheetNote(`Source sheet unavailable: ${sheet.file}`);
      return;
    }
    setHistory((h) => [...h, index]);
    setIndex(next);
    setNet("");
    setSelectedSymbol(null);
    setSheetNote("");
    reset();
  }
  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  return (
    <article className="panel native-schematic">
      <div className="viewer-toolbar">
        {history.length > 0 && (
          <button
            onClick={() => {
              setIndex(history[history.length - 1]);
              setHistory((h) => h.slice(0, -1));
              setNet("");
              setSelectedSymbol(null);
              reset();
            }}
          >
            ← Back
          </button>
        )}
        <strong>Source schematic · {d.name}</strong>
        <select
          aria-label="Schematic sheet"
          value={index}
          onChange={(e) => {
            setIndex(+e.target.value);
            setHistory([]);
            setSheetNote("");
            setNet("");
            setSelectedSymbol(null);
            reset();
          }}
        >
          {drawings.map((s, i) => (
            <option key={i} value={i}>
              {s.name}
            </option>
          ))}
        </select>
        <button onClick={() => setZoom((z) => Math.max(0.2, z / 1.3))}>
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(20, z * 1.3))}>+</button>
        <button onClick={reset}>Fit view</button>
      </div>
      {sheetNote && <p role="status">{sheetNote}</p>}
      <div className="native-sheet-body">
        <svg
          ref={svg}
          role="img"
          aria-label="Source schematic drawing"
          viewBox={`${-pan.x} ${-pan.y} ${d.paper.width / zoom} ${d.paper.height / zoom}`}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const scale =
              d.paper.width /
              zoom /
              (svg.current?.getBoundingClientRect().width || 1);
            setPan((p) => ({
              x: p.x + (e.clientX - drag.current!.x) * scale,
              y: p.y + (e.clientY - drag.current!.y) * scale,
            }));
            drag.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {d.frame !== false && (
            <rect
              x={10}
              y={10}
              width={d.paper.width - 20}
              height={d.paper.height - 20}
              fill="none"
              stroke={colors.frame}
              strokeWidth={0.15}
            />
          )}
          {d.paths.map((p, i) => (
            <polyline
              key={i}
              points={
                Array.from(
                  { length: p.d.length / 2 },
                  (_, j) => `${p.d[j * 2]},${p.d[j * 2 + 1]}`,
                ).join(" ") + (p.closed ? ` ${p.d[0]},${p.d[1]}` : "")
              }
              fill={
                p.fill === "body"
                  ? "#ffffc2"
                  : p.fill === "ink"
                    ? colors[p.ink]
                    : "none"
              }
              stroke={colors[p.ink]}
              strokeWidth={p.w}
              strokeDasharray={p.dash ? "2 1" : undefined}
              opacity={net && p.net && net !== p.net ? 0.2 : 1}
            />
          ))}
          {d.paths
            .filter((p) => p.net)
            .map((p, i) => (
              <polyline
                key={"net-hit" + i}
                points={Array.from(
                  { length: p.d.length / 2 },
                  (_, j) => `${p.d[j * 2]},${p.d[j * 2 + 1]}`,
                ).join(" ")}
                fill="none"
                stroke="transparent"
                strokeWidth={1.2}
                style={{ cursor: "pointer" }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setNet(p.net!);
                  setSelectedSymbol(null);
                }}
              />
            ))}
          {d.circles.map((c, i) => (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={c.r}
              stroke={colors[c.ink]}
              strokeWidth={c.w}
              fill={
                c.fill === "body"
                  ? "#ffffc2"
                  : c.fill === "ink"
                    ? colors[c.ink]
                    : "none"
              }
            />
          ))}
          {d.texts.map((t, i) => (
            <text
              key={i}
              x={t.x}
              y={t.y}
              textAnchor={t.h}
              dominantBaseline={
                t.v === "top"
                  ? "hanging"
                  : t.v === "middle"
                    ? "central"
                    : "alphabetic"
              }
              transform={t.angle ? `rotate(-90 ${t.x} ${t.y})` : undefined}
              style={{
                fontSize: t.size,
                fill: colors[t.ink],
                fontFamily: "Arial,sans-serif",
                fontWeight: t.bold ? 700 : 400,
              }}
            >
              {t.t.split("\n").map((s, j) => (
                <tspan key={j} x={t.x} dy={j ? t.size * 1.7 : 0}>
                  {s}
                </tspan>
              ))}
            </text>
          ))}
          {d.symbols.map((s, i) => (
            <rect
              key={"hit" + i}
              x={s.box[0]}
              y={s.box[1]}
              width={s.box[2] - s.box[0]}
              height={s.box[3] - s.box[1]}
              fill={
                selectedSymbol?.reference === s.reference
                  ? "#18a3b21a"
                  : "transparent"
              }
              stroke={
                selectedSymbol?.reference === s.reference ? "#18a3b2" : "none"
              }
              strokeWidth={0.2}
              style={{ cursor: "pointer" }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                setSelectedSymbol(s);
                setNet("");
              }}
            />
          ))}
          {d.sheets.map((sheet, i) => (
            <rect
              key={"sheet-hit" + i}
              x={sheet.box[0]}
              y={sheet.box[1]}
              width={sheet.box[2] - sheet.box[0]}
              height={sheet.box[3] - sheet.box[1]}
              fill="transparent"
              className="schematic-sheet-link"
              role="button"
              tabIndex={0}
              aria-label={"Open sheet " + sheet.name}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => openSheet(sheet)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openSheet(sheet);
                }
              }}
            >
              <title>Open {sheet.name}</title>
            </rect>
          ))}
        </svg>
        <aside className="viewer-inspector">
          {selectedSymbol && (
            <section>
              <h3>{selectedSymbol.reference}</h3>
              <p>{selectedSymbol.value}</p>
              {selectedPart?.mpnRaw && <p>{selectedPart.mpnRaw}</p>}
              {selectedPart?.manufacturerRaw && (
                <p>{selectedPart.manufacturerRaw}</p>
              )}
              {selectedPart?.footprint && <p>{selectedPart.footprint}</p>}
              <small>{d.name}</small>
            </section>
          )}
          {net && (
            <section>
              <h3>Net · {net}</h3>
              <p>{d.paths.filter((p) => p.net === net).length} wire segments</p>
              {netTree.size ? (
                <ul className="net-pin-tree">
                  {[...netTree]
                    .sort(([a], [b]) =>
                      a.localeCompare(b, undefined, { numeric: true }),
                    )
                    .map(([ref, pins]) => (
                      <li key={ref}>
                        <details open>
                          <summary>{ref}</summary>
                          <ul>
                            {[...pins]
                              .sort((a, b) =>
                                a.localeCompare(b, undefined, {
                                  numeric: true,
                                }),
                              )
                              .map((pin) => (
                                <li key={pin}>Pin {pin}</li>
                              ))}
                          </ul>
                        </details>
                      </li>
                    ))}
                </ul>
              ) : (
                <p>Pin connectivity is not available in this source preview.</p>
              )}
            </section>
          )}
          <input
            aria-label="Filter schematic nets"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter nets"
          />
          <button onClick={() => setNet("")}>All nets</button>
          {d.nets
            .filter((n) => n.toLowerCase().includes(query.toLowerCase()))
            .map((n) => (
              <button
                key={n}
                onClick={() => {
                  setNet(n);
                  setSelectedSymbol(null);
                }}
              >
                {n}
              </button>
            ))}
        </aside>
      </div>
    </article>
  );
}
