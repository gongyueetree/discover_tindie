"use client";
// Ported from gongyueetree/eelib eelib-web/components/ecad/PinLink.tsx.
import { createContext, useContext, useState, type ReactNode } from "react";

export type Pin = {
  x: number; y: number; angle: number; length: number; name: string; number: string;
  type?: string; showName?: boolean; showNumber?: boolean;
  nameSize?: number; numberSize?: number; hideName?: boolean; hideNumber?: boolean;
};
export type Shape = { points: number[][]; closed?: boolean; filled?: boolean; width?: number; layer?: string };
export type SymbolPreview = {
  kind: "symbol"; name: string; shapes: Shape[]; pins: Pin[]; units: number;
  parts?: { unit: number; name: string | null; shapes: Shape[]; pins: Pin[] }[];
  namesHiddenInFile?: boolean;
};
export type Pad = { number: string; shape: string; x: number; y: number; w: number; h: number; angle: number; through?: boolean; drill?: number };
export type FootprintPreview = { kind: "footprint"; name: string; pads: Pad[]; shapes: Shape[] };

type PinLinkValue = {
  unit: number;
  setUnit: (unit: number) => void;
  active: string | null;
  picked: string | null;
  point: (number: string | null) => void;
  pick: (number: string) => void;
};
const PinLinkContext = createContext<PinLinkValue | null>(null);
export const usePinLink = () => useContext(PinLinkContext);

export function unitOfPin(symbol: SymbolPreview | null, number: string): number | null {
  return symbol?.parts?.find((part) => part.pins.some((pin) => pin.number === number))?.unit ?? null;
}

/** Symbol and footprint linked by pin number: pointing at one lights up the other; a click keeps it. */
export function PinLinkProvider({ symbol, children }: { symbol: SymbolPreview | null; children: ReactNode }) {
  const [unit, setUnit] = useState(symbol?.parts?.[0]?.unit ?? 1);
  const [pointed, setPointed] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const pick = (number: string) => {
    const next = picked === number ? null : number;
    setPicked(next);
    const owner = next ? unitOfPin(symbol, next) : null;
    if (owner !== null && owner !== unit) setUnit(owner);
  };
  return (
    <PinLinkContext.Provider value={{ unit, setUnit, active: pointed ?? picked, picked, point: setPointed, pick }}>
      {children}
    </PinLinkContext.Provider>
  );
}

const unitName = (part: { unit: number; name: string | null }) =>
  part.name ?? String.fromCharCode(64 + Math.min(26, Math.max(1, part.unit)));

export function UnitPicker({ symbol }: { symbol: SymbolPreview }) {
  const link = usePinLink();
  const parts = symbol.parts ?? [];
  if (!link || parts.length < 2) return null;
  return (
    <div role="group" aria-label={`Units (${parts.length})`} className="ecad-units">
      <span>Units ({parts.length})</span>
      {parts.map((part) => (
        <button key={part.unit} type="button" aria-pressed={link.unit === part.unit} onClick={() => link.setUnit(part.unit)}>
          {unitName(part)}
        </button>
      ))}
    </div>
  );
}

export function PinStatus({ symbol, footprint }: { symbol: SymbolPreview | null; footprint: FootprintPreview | null }) {
  const link = usePinLink();
  if (!link || !symbol || !footprint) return null;
  const number = link.active;
  if (!number)
    return <p className="ecad-status">Point at a pin or a pad: its partner on the other drawing lights up. Click to keep it.</p>;
  const part = symbol.parts?.find((entry) => entry.pins.some((pin) => pin.number === number));
  const pin = (part ?? symbol).pins.find((entry) => entry.number === number);
  const hasPad = footprint.pads.some((pad) => pad.number === number);
  return (
    <p className="ecad-status" aria-live="polite">
      {pin ? `Pin ${number} (${pin.name && pin.name !== "~" ? pin.name : "—"})` : `No pin ${number} on the symbol`}
      {part && (symbol.parts?.length ?? 0) > 1 ? ` · unit ${unitName(part)}` : ""}
      {" · "}
      {hasPad ? `pad ${number}` : <span className="ecad-warn">no pad {number} on the footprint</span>}
    </p>
  );
}
