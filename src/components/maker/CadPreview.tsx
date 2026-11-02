"use client";
import { useEffect, useRef, useState } from "react";
import { AssemblyScene } from "@/vendor/canon/components/AssemblyScene";
import type { InputAsset } from "@/vendor/canon/lib/eda/types";
type Shape = {
  points: number[][];
  closed?: boolean;
  filled?: boolean;
  width?: number;
  layer?: string;
};
type Pin = {
  x: number;
  y: number;
  angle: number;
  length: number;
  name: string;
  number: string;
  type?: string;
  nameSize?: number;
  numberSize?: number;
  nameOffset?: number;
  showName?: boolean;
  showNumber?: boolean;
  hideName?: boolean;
  hideNumber?: boolean;
};
type Pad = {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  shape: string;
  number: string;
  through?: boolean;
};
type Preview = {
  kind: string;
  name: string;
  shapes?: Shape[];
  pins?: Pin[];
  pads?: Pad[];
  parts?: { unit: number; shapes: Shape[]; pins: Pin[] }[];
};
function Drawing({
  data,
  selectedPin,
  onPin,
}: {
  data: Preview;
  selectedPin: string;
  onPin: (pin: string) => void;
}) {
  const [unit, setUnit] = useState(0),
    [zoom, setZoom] = useState(1),
    [pan, setPan] = useState([0, 0]);
  const drag = useRef<number[] | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const index =
      data.parts?.findIndex((p) =>
        p.pins.some((pin) => pin.number === selectedPin),
      ) ?? -1;
    if (index >= 0) setUnit(index);
  }, [data, selectedPin]);
  const part = data.parts?.[unit] || data;
  const shapes = part.shapes || [],
    pins = part.pins || [],
    pads = data.pads || [];
  const pts = [
    ...shapes.flatMap((s) => s.points),
    ...pins.flatMap((p) => [
      [p.x, p.y],
      [
        p.x + Math.cos((p.angle * Math.PI) / 180) * p.length,
        p.y + Math.sin((p.angle * Math.PI) / 180) * p.length,
      ],
    ]),
    ...pads.flatMap((p) => [
      [p.x - Math.hypot(p.w, p.h) / 2, p.y - Math.hypot(p.w, p.h) / 2],
      [p.x + Math.hypot(p.w, p.h) / 2, p.y + Math.hypot(p.w, p.h) / 2],
    ]),
  ].filter((p) => p.every(Number.isFinite));
  if (!pts.length)
    return <p className="notice">No drawable geometry was returned.</p>;
  const minX = Math.min(...pts.map((p) => p[0])),
    minY = Math.min(...pts.map((p) => p[1])),
    maxX = Math.max(...pts.map((p) => p[0])),
    maxY = Math.max(...pts.map((p) => p[1])),
    size = Math.max(maxX - minX, maxY - minY, 1) * 1.25,
    w = size / zoom,
    x = (minX + maxX - w) / 2 + pan[0],
    y = (minY + maxY - w) / 2 + pan[1];
  return (
    <>
      <div className="cad-controls">
        {data.parts && data.parts.length > 1 && (
          <select
            aria-label="Symbol unit"
            value={unit}
            onChange={(e) => {
              setUnit(Number(e.target.value));
              setZoom(1);
              setPan([0, 0]);
            }}
          >
            {data.parts.map((p, i) => (
              <option key={p.unit} value={i}>
                Unit {p.unit}
              </option>
            ))}
          </select>
        )}
        <button
          className="btn small"
          aria-label="Zoom in CAD"
          onClick={() => setZoom((z) => Math.min(16, z * 1.3))}
        >
          +
        </button>
        <button
          className="btn small"
          aria-label="Zoom out CAD"
          onClick={() => setZoom((z) => Math.max(0.5, z / 1.3))}
        >
          −
        </button>
        <button
          className="btn small"
          onClick={() => {
            setZoom(1);
            setPan([0, 0]);
          }}
        >
          Fit
        </button>
      </div>
      <svg
        ref={svg}
        role="img"
        aria-label={data.name + " interactive preview"}
        viewBox={`${x} ${y} ${w} ${w}`}
        style={{
          width: "100%",
          height: 300,
          touchAction: "none",
          cursor: "grab",
        }}
        onPointerDown={(e) => {
          drag.current = [e.clientX, e.clientY, ...pan];
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const scale = w / Math.min(svg.current?.clientWidth || 300, 300);
          setPan([
            drag.current[2] - (e.clientX - drag.current[0]) * scale,
            drag.current[3] - (e.clientY - drag.current[1]) * scale,
          ]);
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {shapes.map((s, i) => (
          <path
            key={"s" + i}
            d={
              s.points
                .map((p, j) => `${j ? "L" : "M"}${p[0]},${p[1]}`)
                .join(" ") + (s.closed ? " Z" : "")
            }
            fill={s.filled ? "#edf8f7" : "none"}
            stroke={data.kind === "symbol" ? "#355361" : "#159aaf"}
            strokeWidth={s.width || (data.kind === "symbol" ? 0.1524 : size * 0.002)}
            
          />
        ))}
        {pads.map((p, i) => (
          <g
            key={"p" + i}
            role="button"
            className="cad-pin-hit"
            tabIndex={0}
            aria-label={`Pad ${p.number}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              if (p.number) onPin(p.number);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPin(p.number);
              }
            }}
            transform={`translate(${p.x} ${p.y}) rotate(${p.angle || 0})`}
          >
            <rect
              x={-p.w / 2}
              y={-p.h / 2}
              width={p.w}
              height={p.h}
              rx={
                /circle|oval/.test(p.shape)
                  ? Math.min(p.w, p.h) / 2
                  : /roundrect/.test(p.shape)
                    ? Math.min(p.w, p.h) * 0.2
                    : 0
              }
              fill={
                selectedPin && selectedPin === p.number ? "#f29538" : "#1679c7"
              }
            />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={
                Math.min(p.w / Math.max(p.number.length, 1), p.h) * 0.55
              }
              fill="white"
            >
              {p.number}
            </text>
          </g>
        ))}
        {pins.map((p, i) => {
          const r = (p.angle * Math.PI) / 180,
            ex = p.x + Math.cos(r) * p.length,
            ey = p.y + Math.sin(r) * p.length;
          const horizontal = Math.abs(Math.cos(r)) > 0.5;
          const forward = horizontal ? Math.cos(r) > 0 : Math.sin(r) < 0;
          const offset = p.nameOffset ?? 0.508;
          const mx = (p.x + ex) / 2, my = (p.y + ey) / 2;
          const nx = offset > 0 ? ex + Math.cos(r) * offset : mx - (horizontal ? 0 : 0.254);
          const ny = offset > 0 ? ey + Math.sin(r) * offset : my - (horizontal ? 0.254 : 0);
          const tx = mx - (horizontal ? 0 : 0.254), ty = my - (horizontal ? 0.254 : 0);
          return (
            <g
              key={"pin" + i}
              role="button"
              className="cad-pin-hit"
              tabIndex={0}
              aria-label={`Pin ${p.number}: ${p.name}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => {
                if (p.number) onPin(p.number);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPin(p.number);
                }
              }}
            >
              <line
                x1={p.x}
                y1={p.y}
                x2={ex}
                y2={ey}
                stroke="transparent"
                strokeWidth={size * 0.025}
              />
              <title>
                {p.number}: {p.name} ({p.type})
              </title>
              <line
                x1={p.x}
                y1={p.y}
                x2={ex}
                y2={ey}
                stroke={
                  selectedPin && selectedPin === p.number
                    ? "#f29538"
                    : "#4075df"
                }
                strokeWidth={0.1524}
              />
              {!p.hideNumber && p.showNumber !== false && <text x={tx} y={ty}
                transform={!horizontal ? `rotate(-90 ${tx} ${ty})` : undefined}
                textAnchor="middle" fontSize={p.numberSize ?? 1.27}
                fontFamily="Arial, sans-serif" fontWeight={400}
                fill={selectedPin === p.number ? "#f29538" : "#445f6b"}>
                {p.number}
              </text>}
              {!p.hideName && p.showName !== false && p.name !== "~" && <text x={nx} y={ny}
                transform={!horizontal ? `rotate(-90 ${nx} ${ny})` : undefined}
                textAnchor={offset > 0 ? (forward ? "start" : "end") : "middle"}
                dominantBaseline={offset > 0 ? "central" : undefined}
                fontSize={p.nameSize ?? 1.27} fontFamily="Arial, sans-serif" fontWeight={400}
                fill={selectedPin === p.number ? "#f29538" : "#183b47"}>
                {p.name}
              </text>}
            </g>
          );
        })}
      </svg>
      <small>{data.name} · drag to pan</small>
    </>
  );
}
export default function CadPreview({ mpn }: { mpn: string }) {
  const [selectedPin, setSelectedPin] = useState("");
  useEffect(() => setSelectedPin(""), [mpn]);
  const [data, setData] = useState<{
      symbol?: { preview?: Preview };
      footprint?: { preview?: Preview };
    } | null>(null),
    [error, setError] = useState(""),
    [model, setModel] = useState<InputAsset | null>(null),
    [modelNote, setModelNote] = useState(""),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setData(null);
    setError("");
    setModel(null);
    setModelNote("");
    setBusy(false);
    const ac = new AbortController();
    fetch("/api/maker/cad/" + encodeURIComponent(mpn), { signal: ac.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        if (!ac.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!ac.signal.aborted) setError(e.message);
      });
    return () => {
      ac.abort();
      controller.current?.abort();
    };
  }, [mpn]);
  async function loadModel() {
    const ac = new AbortController();
    controller.current = ac;
    setBusy(true);
    setModelNote("Loading source model…");
    try {
      const r = await fetch(
        "/api/maker/cad/" + encodeURIComponent(mpn) + "/model",
        { signal: ac.signal },
      );
      if (!r.ok) throw Error((await r.json()).error);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (!ac.signal.aborted) {
        setModel({
          path: mpn + "." + (r.headers.get("X-Model-Format") || "step"),
          bytes,
        });
        setModelNote("");
      }
    } catch (e) {
      if (!ac.signal.aborted) setModelNote(String(e));
    } finally {
      if (!ac.signal.aborted) setBusy(false);
    }
  }
  const symbol = data?.symbol?.preview,
    footprint = data?.footprint?.preview;
  const pins = symbol?.parts?.flatMap((p) => p.pins) || symbol?.pins || [],
    pads = footprint?.pads || [];
  const pinIds = new Set(pins.map((p) => p.number)),
    padIds = new Set(pads.map((p) => p.number).filter(Boolean));
  const mismatch =
    pinIds.size &&
    padIds.size &&
    ([...pinIds].some((p) => !padIds.has(p)) ||
      [...padIds].some((p) => !pinIds.has(p)));
  if (!symbol && !footprint) return null;
  return (
    <section id="component-cad" className="cad-preview">
      <div className="section-top">
        <h2>CAD preview · {mpn}</h2>
        {selectedPin && (
          <span role="status">Selected pin / pad: {selectedPin}</span>
        )}
        <span>
          {symbol ? "Symbol · " : ""}
          {footprint ? "Footprint · " : ""}3D
        </span>
      </div>
      {error && <p className="notice error">{error}</p>}
      <div
        className="cad-grid"
        style={{
          gridTemplateColumns: `repeat(${1 + Number(!!symbol) + Number(!!footprint)}, minmax(0,1fr))`,
        }}
      >
        {symbol && (
          <article>
            <h3>Schematic symbol</h3>
            <Drawing
              data={symbol}
              selectedPin={selectedPin}
              onPin={setSelectedPin}
            />
          </article>
        )}
        {footprint && (
          <article>
            <h3>PCB footprint</h3>
            <Drawing
              data={footprint}
              selectedPin={selectedPin}
              onPin={setSelectedPin}
            />
          </article>
        )}
        <article>
          <h3>3D model</h3>
          {model ? (
            <AssemblyScene asset={model} library />
          ) : (
            <div className="cad-model-empty">
              <p>Inspect the source STEP / VRML model.</p>
              <button
                className="btn"
                onClick={() => void loadModel()}
                disabled={busy}
              >
                {busy ? "Loading…" : "Load 3D preview"}
              </button>
              <p>{modelNote}</p>
            </div>
          )}
        </article>
      </div>
      {!!mismatch && (
        <p className="notice">
          Symbol pin numbers and footprint pad numbers differ. Verify the CAD
          variant before use.
        </p>
      )}
      <details>
        <summary>
          Pin and pad details · {pinIds.size} pins / {padIds.size} numbered pads
        </summary>
        <div className="cad-pin-tables">
          {symbol && (
            <table>
              <thead>
                <tr>
                  <th>Pin</th>
                  <th>Name</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {pins.map((p, i) => (
                  <tr key={i}>
                    <td>{p.number}</td>
                    <td>{p.name}</td>
                    <td>{p.type || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <table>
            <thead>
              <tr>
                <th>Pad</th>
                <th>Shape</th>
                <th>Size (mm)</th>
              </tr>
            </thead>
            <tbody>
              {pads
                .filter((p) => p.number)
                .map((p, i) => (
                  <tr key={i}>
                    <td>{p.number}</td>
                    <td>{p.shape}</td>
                    <td>
                      {p.w} × {p.h}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
