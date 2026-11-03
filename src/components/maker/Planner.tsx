"use client";
import { effectiveMountingHoles } from "@/vendor/protopcb/design-core/board/mounting-holes";
import PlannerLibrary, { type LibraryChoice } from "./PlannerLibrary";
import PlannerPreview from "./PlannerPreview";
import BoardSizeInput from "./BoardSizeInput";
import PartDetailsModal from "./PartDetailsModal";
import PlannerOutputs from "./PlannerOutputs";
import { parseKicadMod } from "@/vendor/protopcb/design-core/geometry/kicad-file-parser";
import {
  registerFootprintOverride,
  syncProjectFootprints,
} from "@/vendor/protopcb/design-core/geometry/lib-file-registry";
import {
  placementIssue,
  placeFree,
  validateLayout,
  categoryLabels,
  fitBoard,
  shapeOf,
} from "@/lib/maker/planner-rules";
import { outlinePath, type BoardShape } from "@/vendor/eelib/protopcb/outline";
import { holeSettingsOf, cornerRadiusOf, HOLE_DIAMETER_RANGE } from "@/vendor/eelib/protopcb/holes";
import { plannerPcb } from "@/lib/maker/planner-export";
import { makeComponent } from "@/lib/maker/planner";
import { useEffect, useRef, useState } from "react";
import { Download, Redo2, RotateCw, Shuffle, Trash2, Undo2, Upload } from "lucide-react";
import { ToolHeading } from "./ToolShell";
import {
  createDocument,
  createBoard,
  deserializeDocument,
} from "@/vendor/protopcb/design-core/document/factory";
import type {
  CircuitCanvasDocument,
  PlacedComponent,
} from "@/vendor/protopcb/design-core/document/types";
import { padFootprintFor } from "@/vendor/protopcb/design-core/geometry/footprint-pads";
import {
  findOverlaps,
  componentExtentRect,
} from "@/vendor/protopcb/design-core/collision";
import { buildKicadPcb } from "@/vendor/protopcb/modules/board-editor/pcbExport";
import { download } from "@/lib/maker/download";
export default function Planner() {
  const [doc, setDoc] = useState<CircuitCanvasDocument>(() =>
      createDocument({
        name: "Untitled layout",
        source: "standalone",
        board: createBoard(80, 60),
      }),
    ),
    [active, setActive] = useState(""),
    [error, setError] = useState(""),
    [snap, setSnap] = useState(1),
    [view, setView] = useState("2d"),
    [gap, setGap] = useState(0.5);
  const [detailPart, setDetailPart] = useState<{
    mpn: string;
    manufacturer: string;
  } | null>(null);
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<{ id: string; dx: number; dy: number } | null>(null),
    input = useRef<HTMLInputElement>(null);
  /*
   * Undo / redo, as in eelib's board editor: every finished change is one step. A drag is one step
   * (recorded when the pointer is let go), however many moves it made.
   */
  const history = useRef<{ past: CircuitCanvasDocument[]; future: CircuitCanvasDocument[] }>({ past: [], future: [] });
  const stable = useRef(doc);
  const stepping = useRef(false);
  const dragging = useRef(false);
  const latest = useRef(doc);
  latest.current = doc;
  const [, setSteps] = useState(0);
  const record = () => {
    if (dragging.current || latest.current === stable.current) return;
    history.current.past.push(stable.current);
    if (history.current.past.length > 100) history.current.past.shift();
    history.current.future = [];
    stable.current = latest.current;
    setSteps((n) => n + 1);
  };
  useEffect(() => {
    if (stepping.current) {
      stepping.current = false;
      stable.current = doc;
      return;
    }
    record();
  }, [doc]); // eslint-disable-line react-hooks/exhaustive-deps
  function step(kind: "undo" | "redo") {
    const h = history.current;
    const from = kind === "undo" ? h.past : h.future;
    const to = kind === "undo" ? h.future : h.past;
    const target = from.pop();
    if (!target) return;
    to.push(stable.current);
    stepping.current = true;
    syncProjectFootprints(target.importedFootprints);
    setDoc(target);
    setActive("");
    setError("");
    setSteps((n) => n + 1);
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        step("undo");
      } else if (k === "y" || (k === "z" && e.shiftKey)) {
        e.preventDefault();
        step("redo");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** A board change: shape, size, corner radius or holes; holes are refitted (eelib's rules). */
  function changeBoard(patch: Partial<CircuitCanvasDocument["board"]>): string | null {
    const next = { ...doc, board: fitBoard({ ...doc.board, ...patch }) };
    const issue = validateLayout(next, gap);
    if (issue) {
      setError(issue);
      return issue;
    }
    setDoc(next);
    setError("");
    return null;
  }
  /** Place every unlocked part again, largest first, around the locked ones. */
  function rearrange() {
    commit((d) => {
      const locked = d.components.filter((c) => c.placement.locked);
      const free = d.components
        .filter((c) => !c.placement.locked)
        .sort((a, b) => b.footprint.geometry.courtyardWidthMm * b.footprint.geometry.courtyardHeightMm - a.footprint.geometry.courtyardWidthMm * a.footprint.geometry.courtyardHeightMm);
      const placed = [...locked];
      for (const c of free) {
        const p = placeFree({ ...c, placement: { ...c.placement, rotation: c.placement.rotation } }, placed, d.board, gap);
        if (!p) {
          setError(`No legal position for ${c.reference}. Enlarge the board or remove a component.`);
          return d;
        }
        placed.push(p);
      }
      const order = new Map(d.components.map((c, i) => [c.instanceId, i]));
      return { ...d, components: placed.sort((a, b) => order.get(a.instanceId)! - order.get(b.instanceId)!) };
    });
  }
  const shape = shapeOf(doc.board);
  const holeSet = holeSettingsOf({ ...doc.board, shape });
  const selected = doc.components.find((c) => c.instanceId === active),
    overlaps = findOverlaps(doc.components, 0, doc.board);
  function commit(
    update: (d: CircuitCanvasDocument) => CircuitCanvasDocument,
    silent = false,
  ) {
    setDoc((d) => {
      const next = update(d);
      const problem = validateLayout(next, gap);
      if (problem) {
        if (!silent) setError(problem);
        return d;
      }
      setError("");
      return next;
    });
  }
  function update(id: string, p: Partial<PlacedComponent["placement"]>) {
    commit(
      (d) => ({
        ...d,
        components: d.components.map((c) => {
          if (c.instanceId !== id) return c;
          if (c.placement.locked && p.locked === undefined) return c;
          return { ...c, placement: { ...c.placement, ...p } };
        }),
      }),
      true,
    );
  }
  function addSource(item: LibraryChoice) {
    const fp = parseKicadMod(item.text);
    if (!fp)
      throw Error(
        "The source footprint could not be parsed. No placeholder was added.",
      );
    const name = item.name;
    registerFootprintOverride(name, fp);
    setDoc((d) => {
      syncProjectFootprints(d.importedFootprints);
      const defs = { ...d.importedFootprints, [name]: fp };
      syncProjectFootprints(defs);
      let n = d.components.length + 1;
      while (d.components.some((c) => c.reference === `U${n}`)) n++;
      const c = makeComponent(name, `U${n}`, 0, 0);
      c.mpn = item.part?.mpn || "";
      c.manufacturer = item.part?.manufacturer || "";
      c.source = item.source;
      c.display = {
        description: item.part?.description || "",
        footprintFileUrl: item.url,
        attributes: { kicadSource: item.text },
        classification: item.part?.description || "",
      };
      c.trust = {
        level: "CANDIDATE",
        evidence:
          "Source footprint geometry loaded. Verify the part-to-package association before manufacture.",
      };
      const text = (name + " " + (item.part?.description || "")).toLowerCase();
      c.category = /resistor|capacitor|inductor/.test(text)
        ? "passive"
        : /connector|header|usb|socket/.test(text)
          ? "connector"
          : /mcu|microcontroller|stm32|esp32/.test(text)
            ? "mcu"
            : /regulator|power|ldo/.test(text)
              ? "power"
              : /sensor/.test(text)
                ? "sensor"
                : "ic";
      const placed = placeFree(c, d.components, d.board, gap);
      if (!placed) {
        syncProjectFootprints(d.importedFootprints);
        setError(
          "No legal position remains. Enlarge the board or remove a component.",
        );
        return d;
      }
      setActive(placed.instanceId);
      setError("");
      return {
        ...d,
        importedFootprints: defs,
        components: [...d.components, placed],
      };
    });
  }
  useEffect(() => {
    if (!new URLSearchParams(location.search).get("import")) return;
    let cancelled = false;
    (async () => {
      try {
        const parts = JSON.parse(
          sessionStorage.getItem("maker-planner-parts") || "[]",
        );
        if (!Array.isArray(parts) || parts.length > 100)
          throw Error("Import up to 100 parts.");
        const failed: string[] = [];
        for (const p of parts) {
          if (cancelled) return;
          if (!p.mpn) {
            failed.push("(no part number)");
            continue;
          }
          try {
            const r = await fetch(
              "/api/maker/library?" +
                new URLSearchParams({
                  kind: "ezplm",
                  mpn: p.mpn,
                  ...(String(p.id || "").startsWith("p_") ? { partId: p.id } : {}),
                }),
            );
            const d = await r.json();
            if (!r.ok) throw Error(d.error);
            if (!cancelled) addSource({ ...d, part: p });
          } catch (e) {
            failed.push(`${p.mpn}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (failed.length && !cancelled)
          setError(`Not placed (no footprint available): ${failed.join("; ")}`);
      } catch (e) {
        if (!cancelled) setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  function point(e: React.PointerEvent) {
    const p = svg.current!.createSVGPoint();
    p.x = e.clientX;
    p.y = e.clientY;
    return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  }
  return (
    <>
      <ToolHeading
        eyebrow="PCB PRE-LAYOUT"
        title="Make room for your idea."
        description="A manual placement workspace powered by protopcb geometry. Arrange footprints, check space and export to KiCad."
        actions={
          <>
            <button className="btn" onClick={() => input.current?.click()}>
              <Upload size={15} />
              Open layout
            </button>
            <button
              className="btn"
              onClick={() =>
                download(
                  new TextEncoder().encode(
                    JSON.stringify(
                      { ...doc, placementRules: { clearanceMm: gap } },
                      null,
                      2,
                    ),
                  ),
                  "layout.json",
                  "application/json",
                )
              }
            >
              <Download size={15} />
              Save layout
            </button>
            <button
              className="btn primary"
              onClick={() =>
                download(
                  new TextEncoder().encode(plannerPcb(doc)),
                  "prelayout.kicad_pcb",
                  "text/plain",
                )
              }
            >
              <Download size={15} />
              Export KiCad
            </button>
          </>
        }
      />
      <input
        hidden
        type="file"
        accept=".json"
        ref={input}
        onChange={async (e) => {
          try {
            if (e.target.files?.[0]) {
              const restored = deserializeDocument(
                await e.target.files[0].text(),
              );
              syncProjectFootprints(restored.importedFootprints);
              const restoredGap = restored.placementRules?.clearanceMm ?? 0.5;
              const issue = validateLayout(restored, restoredGap);
              if (issue) {
                syncProjectFootprints(doc.importedFootprints);
                throw Error(issue);
              }
              setDoc(restored);
              setGap(restoredGap);
              setActive("");
              setError("");
            }
          } catch (e) {
            setError(String(e));
          }
        }}
      />
      {error && <div className="notice error">{error}</div>}
      <div className="notice">
        Placement planning only. Generic footprints need verification; this
        export contains no routed copper or completed electrical design.
      </div>
      <div className="planner-grid">
        <aside className="planner-rail">
          <PlannerLibrary onAdd={addSource} />
        </aside>
        <div className="board-canvas-wrap">
          <div className="board-controls">
            {[
              ["2d", "2D"],
              ["split", "2D + 3D"],
              ["3d", "3D"],
            ].map(([v, l]) => (
              <button
                key={v}
                className={"btn small " + (view === v ? "primary" : "")}
                onClick={() => setView(v)}
              >
                {l}
              </button>
            ))}
            <label>
              Clearance (mm)
              <input
                aria-label="Placement clearance"
                type="number"
                min={0}
                max={10}
                step={0.1}
                value={gap}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(10, +e.target.value || 0));
                  const problem = validateLayout(doc, v);
                  if (problem) setError(problem);
                  else {
                    setGap(v);
                    setError("");
                  }
                }}
              />
            </label>
          </div>
          <div className="board-controls">
            {(
              [
                ["Width", "widthMm"],
                ["Height", "heightMm"],
              ] as const
            ).map(([label, axis]) => (
              <BoardSizeInput
                key={axis}
                label={label}
                value={doc.board[axis]}
                onCommit={(value) => changeBoard({ [axis]: value })}
              />
            ))}
            <label>
              Shape
              <select
                aria-label="Board shape"
                value={shape}
                onChange={(e) => changeBoard({ shape: e.target.value as BoardShape, cornerRadiusMm: undefined })}
              >
                <option value="rect">Rectangle</option>
                <option value="rounded">Rounded corners</option>
                <option value="circle">Circle</option>
                <option value="lshape">L-shape</option>
              </select>
            </label>
            {shape === "rounded" && (
              <BoardSizeInput
                label="Corner radius"
                ariaLabel="Corner radius"
                min={0.5}
                max={Math.floor(Math.min(doc.board.widthMm, doc.board.heightMm) / 2)}
                value={cornerRadiusOf({ ...doc.board, shape })}
                onCommit={(value) => changeBoard({ cornerRadiusMm: value })}
              />
            )}
            <label>
              Grid
              <select value={snap} onChange={(e) => setSnap(+e.target.value)}>
                <option value={1}>1 mm</option>
                <option value={0.5}>0.5 mm</option>
                <option value={0.1}>0.1 mm</option>
              </select>
            </label>
          </div>
          <div className="board-controls">
            <label className="check">
              <input
                type="checkbox"
                checked={!!doc.board.mountingHolesEnabled && shape !== "circle"}
                disabled={shape === "circle"}
                onChange={(e) => changeBoard({ mountingHolesEnabled: e.target.checked })}
              />
              Mounting holes{shape === "circle" ? " (not on a circle)" : ""}
            </label>
            {doc.board.mountingHolesEnabled && shape !== "circle" && (
              <>
                <BoardSizeInput
                  label="Hole to edge"
                  ariaLabel="Hole centre to board edge"
                  min={1}
                  max={50}
                  value={holeSet.marginMm}
                  onCommit={(value) => changeBoard({ holeMarginMm: value })}
                />
                <BoardSizeInput
                  label="Hole Ø"
                  ariaLabel="Mounting hole diameter"
                  min={HOLE_DIAMETER_RANGE.min}
                  max={HOLE_DIAMETER_RANGE.max}
                  value={holeSet.diameterMm}
                  onCommit={(value) => changeBoard({ holeDiameterMm: value })}
                />
              </>
            )}
            <span className="board-controls-spacer" />
            <button className="btn small" onClick={() => step("undo")} disabled={!history.current.past.length} title="Undo (Ctrl+Z)">
              <Undo2 size={14} /> Undo
            </button>
            <button className="btn small" onClick={() => step("redo")} disabled={!history.current.future.length} title="Redo (Ctrl+Shift+Z)">
              <Redo2 size={14} /> Redo
            </button>
            <button className="btn small" onClick={rearrange} disabled={!doc.components.some((c) => !c.placement.locked)}>
              <Shuffle size={14} /> Re-arrange unlocked
            </button>
            <button
              className="btn small"
              disabled={!doc.components.length}
              onClick={() => {
                setDoc((d) => ({ ...d, components: [] }));
                setActive("");
                setError("");
              }}
              title="Remove every part from the board (undo brings them back)"
            >
              <Trash2 size={14} /> Clear board
            </button>
          </div>
          <div>
            <div hidden={view === "3d"}>
              <svg
                ref={svg}
                className="board-canvas"
                viewBox={`-8 -8 ${doc.board.widthMm + 16} ${doc.board.heightMm + 16}`}
                aria-label="Interactive PCB placement canvas"
                onPointerMove={(e) => {
                  if (!drag.current) return;
                  const p = point(e);
                  update(drag.current.id, {
                    xMm: Math.round((p.x - drag.current.dx) / snap) * snap,
                    yMm: Math.round((p.y - drag.current.dy) / snap) * snap,
                  });
                }}
                onPointerUp={() => {
                  drag.current = null;
                  dragging.current = false;
                  record();
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  dragging.current = false;
                  record();
                }}
              >
                <defs>
                  <pattern
                    id="grid"
                    width={snap * 5}
                    height={snap * 5}
                    patternUnits="userSpaceOnUse"
                  >
                    <circle cx={0} cy={0} r={0.12} fill="#6ba997" />
                  </pattern>
                </defs>
                <path
                  d={outlinePath({ ...doc.board, shape })}
                  fill="#174d43"
                  stroke="#b0c6b4"
                  strokeWidth={0.3}
                />
                <path d={outlinePath({ ...doc.board, shape })} fill="url(#grid)" />
                {effectiveMountingHoles(doc.board).map((h, i) => (
                  <circle
                    key={i}
                    cx={h.position.x}
                    cy={h.position.y}
                    r={h.diameterMm / 2}
                    fill="#edf3f4"
                    stroke="#c6bc88"
                    strokeWidth={0.4}
                  />
                ))}
                {doc.components.map((c) => {
                  const p = padFootprintFor(c.footprint.name),
                    g = c.footprint.geometry;
                  return (
                    <g
                      key={c.instanceId}
                      transform={`translate(${c.placement.xMm} ${c.placement.yMm}) rotate(${c.placement.rotation})`}
                      style={{
                        cursor: c.placement.locked ? "default" : "grab",
                        opacity: c.placement.side === "BOTTOM" ? 0.65 : 1,
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={"Move " + c.reference}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") setActive(c.instanceId);
                        if (
                          !c.placement.locked &&
                          [
                            "ArrowUp",
                            "ArrowDown",
                            "ArrowLeft",
                            "ArrowRight",
                          ].includes(e.key)
                        ) {
                          e.preventDefault();
                          update(c.instanceId, {
                            xMm:
                              c.placement.xMm +
                              (e.key === "ArrowRight"
                                ? snap
                                : e.key === "ArrowLeft"
                                  ? -snap
                                  : 0),
                            yMm:
                              c.placement.yMm +
                              (e.key === "ArrowDown"
                                ? snap
                                : e.key === "ArrowUp"
                                  ? -snap
                                  : 0),
                          });
                        }
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setActive(c.instanceId);
                        if (c.placement.locked) return;
                        const pt = point(e);
                        dragging.current = true;
                        drag.current = {
                          id: c.instanceId,
                          dx: pt.x - c.placement.xMm,
                          dy: pt.y - c.placement.yMm,
                        };
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                    >
                      <rect
                        x={-g.courtyardWidthMm / 2}
                        y={-g.courtyardHeightMm / 2}
                        width={g.courtyardWidthMm}
                        height={g.courtyardHeightMm}
                        fill="transparent"
                        stroke={
                          overlaps.has(c.instanceId)
                            ? "#ff8f62"
                            : active === c.instanceId
                              ? "#7ee9f3"
                              : "#789f92"
                        }
                        strokeWidth={0.18}
                        strokeDasharray={
                          active === c.instanceId ? undefined : ".6 .4"
                        }
                      />
                      {p?.pads.map((pad, i) => (
                        <rect
                          key={i}
                          x={pad.x - pad.w / 2}
                          y={
                            (c.placement.side === "BOTTOM" ? -pad.y : pad.y) -
                            pad.h / 2
                          }
                          width={pad.w}
                          height={pad.h}
                          rx={pad.round ? pad.w / 2 : 0.05}
                          fill="#d6bd73"
                        />
                      ))}
                      <rect
                        x={(p?.bodyCx || 0) - g.bodyWidthMm / 2}
                        y={
                          (c.placement.side === "BOTTOM"
                            ? -(p?.bodyCy || 0)
                            : p?.bodyCy || 0) -
                          g.bodyHeightMm / 2
                        }
                        width={g.bodyWidthMm}
                        height={g.bodyHeightMm}
                        fill={view === "split" ? "#4b5053" : "none"}
                        stroke="#d6e4d5"
                        strokeWidth={0.1}
                      />
                      <text
                        textAnchor="middle"
                        y={-g.courtyardHeightMm / 2 - 1}
                        fill="#ecf5dd"
                        fontSize={1.6}
                      >
                        {c.reference}
                      </text>
                    </g>
                  );
                })}
                {!doc.components.length && (
                  <text
                    x={doc.board.widthMm / 2}
                    y={doc.board.heightMm / 2}
                    textAnchor="middle"
                    fill="#a0c1b7"
                    fontSize={2.3}
                  >
                    Add a footprint to begin
                  </text>
                )}
              </svg>
            </div>
            {view === "3d" && <PlannerPreview doc={doc} />}
          </div>
          <div className="board-controls">
            Drag to move · arrow keys for fine placement · coordinates in mm
          </div>
        </div>
        <aside className="planner-inspector">
          <h3>{selected ? "Component " + selected.reference : "Board BOM"}</h3>
          {selected && (
            <p className="muted">
              {selected.mpn ? (
                <button
                  className="mpn-detail-link"
                  onClick={() =>
                    setDetailPart({
                      mpn: selected.mpn.trim(),
                      manufacturer: selected.manufacturer,
                    })
                  }
                >
                  {selected.mpn} ↗
                </button>
              ) : (
                selected.footprint.name
              )}
              <span className="planner-part-manufacturer">
                {selected.manufacturer}
              </span>
              <span className="planner-category">
                {categoryLabels[selected.category]}
              </span>
              {!padFootprintFor(selected.footprint.name) && (
                <>
                  <br />
                  Unknown footprint: 5 × 5 mm placeholder. No verified pads.
                </>
              )}
            </p>
          )}
          {selected && (
            <>
              <label>
                X (mm)
                <input
                  type="number"
                  step={snap}
                  value={selected.placement.xMm}
                  onChange={(e) => update(active, { xMm: +e.target.value })}
                />
              </label>
              <label>
                Y (mm)
                <input
                  type="number"
                  step={snap}
                  value={selected.placement.yMm}
                  onChange={(e) => update(active, { yMm: +e.target.value })}
                />
              </label>
              <label>
                Side
                <select
                  value={selected.placement.side}
                  onChange={(e) =>
                    update(active, { side: e.target.value as "TOP" | "BOTTOM" })
                  }
                >
                  <option>TOP</option>
                  <option>BOTTOM</option>
                </select>
              </label>
              <label>
                Locked
                <input
                  type="checkbox"
                  checked={selected.placement.locked}
                  onChange={(e) => update(active, { locked: e.target.checked })}
                />
              </label>
              <div className="planner-actions">
                <button
                  className="btn small"
                  onClick={() =>
                    update(active, {
                      rotation: (selected.placement.rotation + 90) % 360,
                    })
                  }
                >
                  <RotateCw size={14} />
                  {selected.placement.rotation}°
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    setDoc((d) => ({
                      ...d,
                      components: d.components.filter(
                        (c) => c.instanceId !== active,
                      ),
                    }));
                    setActive("");
                  }}
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              </div>
              <hr style={{ margin: "20px 0" }} />
            </>
          )}
        </aside>
      </div>
      <PlannerOutputs doc={doc} activeId={active} onSelect={setActive} />
      {detailPart && (
        <PartDetailsModal
          key={detailPart.mpn}
          {...detailPart}
          onClose={() => setDetailPart(null)}
        />
      )}
    </>
  );
}
