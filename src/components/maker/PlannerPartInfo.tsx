"use client";
import { useEffect, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import type { PlacedComponent } from "@/vendor/protopcb/design-core/document/types";
import type { Part } from "@/lib/maker/types";
import CadPreview from "./CadPreview";

/**
 * PCB planner → a component clicked on the board: what the part is (description, manufacturer, part
 * number, datasheet) and its schematic symbol, footprint and 3D model, each downloadable (CadPreview).
 * The part comes from the parts database: by the id recorded when it was placed, or — for a board
 * made before ids were recorded — by its exact part number. A footprint picked from the KiCad library
 * alone has no part record: its footprint file is still offered.
 */
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const lookups = new Map<string, Promise<Part | null>>();

function findPart(mpn: string, manufacturer: string): Promise<Part | null> {
  const key = norm(mpn) + "|" + norm(manufacturer);
  let p = lookups.get(key);
  if (!p) {
    p = fetch("/api/maker/parts?q=" + encodeURIComponent(mpn))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const exact = ((d?.items || []) as Part[]).filter((x) => x.id?.startsWith("p_") && norm(x.mpn) === norm(mpn));
        return exact.find((x) => manufacturer && norm(x.manufacturer) === norm(manufacturer)) || exact[0] || null;
      })
      .catch(() => null);
    lookups.set(key, p);
    p.then((v) => v || lookups.delete(key));
  }
  return p;
}

export default function PlannerPartInfo({ component, onDetails }: { component: PlacedComponent; onDetails?: () => void }) {
  const attrs = component.display?.attributes || {};
  const recorded = attrs.partId?.startsWith("p_") ? attrs.partId : "";
  const [found, setFound] = useState<Part | null>(null);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    setFound(null);
    if (recorded || !component.mpn.trim()) return;
    let live = true;
    setLooking(true);
    findPart(component.mpn.trim(), component.manufacturer).then((p) => {
      if (!live) return;
      setFound(p);
      setLooking(false);
    });
    return () => {
      live = false;
    };
  }, [recorded, component.mpn, component.manufacturer]);

  const partId = recorded || found?.id || "";
  const description = component.display?.description || found?.description || "";
  const manufacturer = component.manufacturer || found?.manufacturer || "";
  const datasheet = component.display?.datasheetUrl || found?.datasheet || "";
  const source = attrs.kicadSource || "";
  const downloadFootprint = () => {
    const url = URL.createObjectURL(new Blob([source], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${component.footprint.name.split(":").pop()!.replace(/[^\w.+-]/g, "_")}.kicad_mod`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="planner-part-info">
      <dl>
        {component.mpn && (
          <div>
            <dt>Part number</dt>
            <dd>
              {onDetails ? (
                <button className="mpn-detail-link" onClick={onDetails} title="Part details, prices and alternatives">
                  {component.mpn} ↗
                </button>
              ) : (
                component.mpn
              )}
            </dd>
          </div>
        )}
        {manufacturer && (
          <div>
            <dt>Manufacturer</dt>
            <dd>{manufacturer}</dd>
          </div>
        )}
        {description && (
          <div>
            <dt>Description</dt>
            <dd>{description}</dd>
          </div>
        )}
        <div>
          <dt>Footprint</dt>
          <dd>{component.footprint.name}</dd>
        </div>
        {datasheet && /^https?:\/\//i.test(datasheet) && (
          <div>
            <dt>Datasheet</dt>
            <dd>
              <a href={datasheet} target="_blank" rel="noopener noreferrer">
                Open datasheet <ExternalLink size={11} aria-hidden />
              </a>
            </dd>
          </div>
        )}
      </dl>
      {partId ? (
        <CadPreview key={partId} partId={partId} mpn={component.mpn || found?.mpn || ""} />
      ) : (
        <>
          <p className="muted">
            {looking
              ? `Looking up ${component.mpn} in the Tindie parts database…`
              : component.mpn
                ? `${component.mpn} is not in the Tindie parts database, so no symbol or 3D model is available.`
                : "This footprint was picked from the KiCad library without a part, so no symbol or 3D model is linked."}
          </p>
          {source && (
            <button className="btn" onClick={downloadFootprint}>
              <Download size={13} aria-hidden /> Download footprint (.kicad_mod)
            </button>
          )}
        </>
      )}
    </div>
  );
}
