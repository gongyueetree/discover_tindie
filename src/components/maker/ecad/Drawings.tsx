"use client";
/**
 * KiCad symbol and footprint drawings, ported from gongyueetree/eelib
 * eelib-web/components/ecad/Drawings.tsx (KiCad's own schematic / board colours,
 * pins and pads linked by number). Added for Tindie: wheel zoom about the cursor and
 * drag to pan, the way eelib's schematic viewer does it (usePanZoom).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { usePinLink, type FootprintPreview, type Pin, type SymbolPreview } from "./PinLink";

type XY = [number, number];
type Box = { minX: number; minY: number; maxX: number; maxY: number };
type VB = [number, number, number, number];

const K = {
  bg: "#f5f4ef", body: "#840000", bodyFill: "#ffffc2", pin: "#840000", pinName: "#006464", pinNumber: "#a90000", hi: "#e8590c",
  pcbBg: "#10241f", silk: "#f2eeb0", fab: "#a6aeb8", court: "#e84fd8", other: "#7d8d84", front: "#d94d45", pad: "#d9a933",
  drill: "#07120f", text: "#e8eee9", select: "#68e493",
};

function bounds(points: readonly XY[]): Box {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    b.minX = Math.min(b.minX, x); b.minY = Math.min(b.minY, y);
    b.maxX = Math.max(b.maxX, x); b.maxY = Math.max(b.maxY, y);
  }
  return Number.isFinite(b.minX) ? b : { minX: -5, minY: -5, maxX: 5, maxY: 5 };
}
const fit = (b: Box, pad: number): VB => [b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2];
const path = (points: readonly number[][], closed?: boolean) =>
  points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(3)} ${y.toFixed(3)}`).join(" ") + (closed ? " Z" : "");

/** Wheel zoom about the cursor (non-passive, so the page does not scroll) and drag to pan. */
function usePanZoom(home: VB) {
  const svg = useRef<SVGSVGElement>(null);
  const [vb, setVb] = useState<VB>(home);
  const homeKey = home.join(",");
  useEffect(() => setVb(home), [homeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoomAt = useCallback(
    (factor: number, at?: { x: number; y: number }) =>
      setVb(([x, y, w, h]) => {
        const nw = Math.min(home[2] * 4, Math.max(home[2] / 25, w * factor));
        const f = nw / w;
        const cx = at?.x ?? x + w / 2, cy = at?.y ?? y + h / 2;
        return [cx - (cx - x) * f, cy - (cy - y) * f, w * f, h * f];
      }),
    [homeKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const m = el.getScreenCTM();
      if (!m) return;
      const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
      zoomAt(Math.exp(e.deltaY * 0.0015), { x: p.x, y: p.y });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [zoomAt]);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const handlers = {
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => {
      if (e.button !== 0 || (e.target as Element).closest("[data-hit]")) return;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const scale = vb[2] / (e.currentTarget.clientWidth || 1);
      const [dx, dy] = [(e.clientX - d.x) * scale, (e.clientY - d.y) * scale];
      d.x = e.clientX; d.y = e.clientY;
      setVb(([x, y, w, h]) => [x - dx, y - dy, w, h]);
    },
    onPointerUp: () => (drag.current = null),
    onPointerCancel: () => (drag.current = null),
  };
  return { svg, vb, handlers, zoomIn: () => zoomAt(0.8), zoomOut: () => zoomAt(1.25), reset: () => setVb(home), zoomed: vb.join(",") !== homeKey };
}

function Controls({ z }: { z: ReturnType<typeof usePanZoom> }) {
  return (
    <div className="ecad-zoom">
      <button type="button" aria-label="Zoom in" onClick={z.zoomIn}><Plus size={14} /></button>
      <button type="button" aria-label="Zoom out" onClick={z.zoomOut}><Minus size={14} /></button>
      <button type="button" aria-label="Fit" onClick={z.reset} disabled={!z.zoomed}><Maximize2 size={13} /></button>
    </div>
  );
}

function useTarget(number: string, label: string) {
  const link = usePinLink();
  if (!link || !number) return { on: false, props: {} };
  return {
    on: link.active === number,
    props: {
      role: "button", tabIndex: 0, "aria-label": label, "aria-pressed": link.picked === number, "data-hit": "",
      style: { cursor: "pointer", outline: "none" },
      onPointerEnter: () => link.point(number), onPointerLeave: () => link.point(null),
      onFocus: () => link.point(number), onBlur: () => link.point(null),
      onClick: () => link.pick(number),
      onKeyDown: (e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); link.pick(number); }
      },
    },
  };
}

function SymbolPin({ pin, end, dir }: { pin: Pin; end: XY; dir: XY }) {
  const { on, props } = useTarget(pin.number, `Pin ${pin.number} (${pin.name && pin.name !== "~" ? pin.name : "—"})`);
  const showNumber = pin.showNumber ?? !pin.hideNumber;
  const showName = (pin.showName ?? !pin.hideName) && pin.name && pin.name !== "~";
  const numberSize = pin.numberSize ?? 1, nameSize = pin.nameSize ?? 1.1;
  const vertical = Math.abs(dir[1]) > 0.5;
  return (
    <g {...props}>
      {on ? <line x1={pin.x} y1={pin.y} x2={end[0]} y2={end[1]} stroke={K.hi} strokeWidth={0.9} strokeLinecap="round" opacity={0.35} /> : null}
      <line x1={pin.x} y1={pin.y} x2={end[0]} y2={end[1]} stroke={on ? K.hi : K.pin} strokeWidth={on ? 0.3 : 0.15} />
      <circle cx={pin.x} cy={pin.y} r={0.25} fill="none" stroke={on ? K.hi : K.pin} strokeWidth={0.1} />
      {showNumber ? (
        vertical ? (
          // Vertical pin: number beside the line, reading bottom-to-top as in KiCad.
          <text transform={`translate(${(pin.x + end[0]) / 2} ${(pin.y + end[1]) / 2}) rotate(-90)`} y={-0.4} fontSize={numberSize} textAnchor="middle" fill={on ? K.hi : K.pinNumber} fontWeight={on ? 700 : 400}>
            {pin.number}
          </text>
        ) : (
          <text x={(pin.x + end[0]) / 2} y={(pin.y + end[1]) / 2 - 0.4} fontSize={numberSize} textAnchor="middle" fill={on ? K.hi : K.pinNumber} fontWeight={on ? 700 : 400}>
            {pin.number}
          </text>
        )
      ) : null}
      {showName ? (
        vertical ? (
          // Vertical pin: name inside the body, rotated with the pin (pointing down → text ends at the pin end).
          <text transform={`translate(${end[0] + dir[0] * 0.6} ${end[1] + dir[1] * 0.6}) rotate(-90)`} y={0.4} fontSize={nameSize} textAnchor={dir[1] > 0 ? "end" : "start"} fill={on ? K.hi : K.pinName} fontWeight={on ? 700 : 400}>
            {pin.name}
          </text>
        ) : (
          <text x={end[0] + dir[0] * 0.6} y={end[1] + dir[1] * 0.6 + 0.4} fontSize={nameSize} textAnchor={dir[0] > 0.5 ? "start" : dir[0] < -0.5 ? "end" : "middle"} fill={on ? K.hi : K.pinName} fontWeight={on ? 700 : 400}>
            {pin.name}
          </text>
        )
      ) : null}
    </g>
  );
}

export function SymbolDrawing({ symbol: whole, label }: { symbol: SymbolPreview; label: string }) {
  const link = usePinLink();
  const symbol = whole.parts?.find((part) => part.unit === link?.unit) ?? whole.parts?.[0] ?? whole;
  const ends = symbol.pins.map((pin) => {
    const rad = (pin.angle * Math.PI) / 180;
    return { pin, end: [pin.x + pin.length * Math.cos(rad), pin.y + pin.length * Math.sin(rad)] as XY, dir: [Math.cos(rad), Math.sin(rad)] as XY };
  });
  const home = useMemo(
    () => fit(bounds([...symbol.shapes.flatMap((s) => s.points as XY[]), ...ends.flatMap(({ pin, end }) => [[pin.x, pin.y] as XY, end])]), 3),
    [symbol], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const z = usePanZoom(home);
  return (
    <div className="ecad-canvas">
      <svg ref={z.svg} role={link ? "group" : "img"} aria-label={label} viewBox={z.vb.join(" ")} style={{ background: K.bg }} {...z.handlers}>
        {symbol.shapes.map((shape, i) => (
          <path key={i} d={path(shape.points, shape.closed)} fill={shape.filled ? K.bodyFill : "none"} stroke={K.body} strokeWidth={Math.max(0.15, shape.width ?? 0.25)} strokeLinejoin="round" />
        ))}
        {ends.map(({ pin, end, dir }, i) => <SymbolPin key={i} pin={pin} end={end} dir={dir} />)}
      </svg>
      <Controls z={z} />
    </div>
  );
}

const LAYER: Record<string, string> = { "F.SilkS": K.silk, "F.Fab": K.fab, "F.CrtYd": K.court };

export function FootprintDrawing({ footprint, label }: { footprint: FootprintPreview; label: string }) {
  const link = usePinLink();
  const home = useMemo(() => {
    const corners = footprint.pads.flatMap((pad) => {
      const r = Math.hypot(pad.w, pad.h) / 2;
      return [[pad.x - r, pad.y - r], [pad.x + r, pad.y + r]] as XY[];
    });
    const b = bounds([...footprint.shapes.flatMap((s) => s.points as XY[]), ...corners]);
    return fit(b, Math.max(b.maxX - b.minX, b.maxY - b.minY) * 0.08 + 0.3);
  }, [footprint]);
  const z = usePanZoom(home);
  return (
    <div className="ecad-canvas">
      <svg ref={z.svg} role={link ? "group" : "img"} aria-label={label} viewBox={z.vb.join(" ")} style={{ background: K.pcbBg }} {...z.handlers}>
        {footprint.shapes.map((shape, i) => (
          <path key={i} d={path(shape.points, shape.closed)} fill="none" stroke={LAYER[shape.layer ?? ""] ?? K.other} strokeWidth={Math.max(0.05, shape.width ?? 0.1)} strokeLinecap="round" />
        ))}
        {footprint.pads.map((pad, i) => <FootprintPad key={i} pad={pad} />)}
      </svg>
      <Controls z={z} />
    </div>
  );
}

function FootprintPad({ pad }: { pad: FootprintPreview["pads"][number] }) {
  const { on, props } = useTarget(pad.number, `Pad ${pad.number || "—"}`);
  const round = pad.shape === "circle";
  const rx = pad.shape === "oval" ? Math.min(pad.w, pad.h) / 2 : pad.shape === "roundrect" ? Math.min(pad.w, pad.h) * 0.25 : 0;
  const fill = on ? K.select : pad.through ? K.pad : K.front;
  return (
    <g transform={`translate(${pad.x} ${pad.y}) rotate(${-pad.angle})`} {...props}>
      {round ? <circle r={pad.w / 2} fill={fill} /> : <rect x={-pad.w / 2} y={-pad.h / 2} width={pad.w} height={pad.h} rx={rx} fill={fill} />}
      {pad.drill ? <circle r={pad.drill / 2} fill={K.drill} /> : null}
      <text y={Math.min(pad.w, pad.h) * 0.18} fontSize={Math.max(0.2, Math.min(pad.w, pad.h) * 0.5)} textAnchor="middle" transform={`rotate(${pad.angle})`} fill={on ? K.drill : K.text} fontWeight={on ? 700 : 400}>
        {pad.number}
      </text>
    </g>
  );
}
