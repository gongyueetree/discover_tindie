"use client";
/**
 * A part's symbol, footprint and 3D model side by side — the layout of eelib's EcadPanel
 * (eelib-web/components/ecad/EcadPanel.tsx): three cells, each with its drawing (or a dashed
 * box saying why there is none), the file name and a download link; symbol and footprint
 * linked by pin number. Drawings come from the official KiCad library entry the parts
 * database names, drawn by eelib's preview engine on the server.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Download } from "lucide-react";
import { FootprintDrawing, SymbolDrawing } from "./ecad/Drawings";
import { PinLinkProvider, PinStatus, UnitPicker, type FootprintPreview, type SymbolPreview } from "./ecad/PinLink";
import { StepViewer } from "./ecad/StepViewer";

type Side<T> = { preview?: T | null; reason?: string; source?: string; library?: string };
type Cad = {
  symbol?: Side<SymbolPreview>;
  footprint?: Side<FootprintPreview>;
  model?: { path: string; revision: string } | null;
  revision?: string;
};
const REASON: Record<string, string> = {
  no_symbol_in_database: "No symbol is recorded for this part.",
  no_footprint_in_database: "No footprint is recorded for this part.",
  not_in_official_kicad_library: "Not in the official KiCad library.",
  not_previewable: "This file could not be drawn.",
  no_model: "The footprint references no 3D model.",
};

export default function CadPreview({ partId, mpn }: { partId: string; mpn: string }) {
  const [data, setData] = useState<Cad | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    setData(null);
    setError("");
    const ac = new AbortController();
    fetch("/api/maker/cad/" + encodeURIComponent(partId), { signal: ac.signal })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error);
        setData(d);
      })
      .catch((e) => !ac.signal.aborted && setError(e.message));
    return () => ac.abort();
  }, [partId]);

  const modelPath = data?.model?.path || "";
  const loadModel = useCallback(async () => {
    const r = await fetch("/api/models/kicad?" + new URLSearchParams({ path: modelPath, revision: data?.model?.revision || "master" }));
    if (!r.ok) throw Error("model");
    return r.arrayBuffer();
  }, [modelPath]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <p className="notice">CAD preview unavailable: {error}</p>;
  if (!data) return <p className="muted">Loading symbol and footprint…</p>;
  const symbol = data.symbol?.preview ?? null;
  const footprint = data.footprint?.preview ?? null;
  const modelName = modelPath.split("/").pop() || "";

  const cell = (title: string, name: string | undefined, download: string | undefined, body: ReactNode) => (
    <section className="ecad-cell">
      <h3>{title}</h3>
      {body}
      {name ? <p className="ecad-name" title={name}>{name}</p> : null}
      {download ? (
        <a className="ecad-download" href={download} target="_blank" rel="noreferrer">
          <Download size={13} aria-hidden /> Download
        </a>
      ) : null}
    </section>
  );
  const empty = (reason?: string) => <div className="ecad-empty">{REASON[reason || ""] || "None in this part's files."}</div>;

  return (
    <PinLinkProvider symbol={symbol}>
      <div className="ecad-panel" id="component-cad">
        <div className="ecad-grid">
          {cell(
            "Symbol",
            data.symbol?.library,
            data.symbol?.source,
            symbol ? (
              <>
                <SymbolDrawing symbol={symbol} label={`Symbol ${symbol.name}`} />
                {symbol.namesHiddenInFile ? (
                  <p className="ecad-status ecad-warn">This symbol file hides its pin names; they are shown here so the pins can be checked.</p>
                ) : null}
                <UnitPicker symbol={symbol} />
              </>
            ) : (
              empty(data.symbol?.reason)
            ),
          )}
          {cell(
            "Footprint",
            data.footprint?.library,
            data.footprint?.source,
            footprint ? <FootprintDrawing footprint={footprint} label={`Footprint ${footprint.name}`} /> : empty(data.footprint?.reason),
          )}
          {cell(
            "3D model",
            modelName,
            undefined,
            data.model ? <StepViewer key={modelPath} load={loadModel} label={`3D model ${modelName}`} /> : empty(footprint ? "no_model" : data.footprint?.reason),
          )}
        </div>
        <PinStatus symbol={symbol} footprint={footprint} />
        <p className="ecad-source">
          Official KiCad {data.revision} libraries · scroll to zoom, drag to pan · {mpn}
        </p>
      </div>
    </PinLinkProvider>
  );
}
