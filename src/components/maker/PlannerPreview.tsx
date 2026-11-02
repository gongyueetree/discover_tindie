"use client";
import { useEffect, useMemo, useState } from "react";
import type { CircuitCanvasDocument } from "@/vendor/protopcb/design-core/document/types";
import { plannerPcb } from "@/lib/maker/planner-export";
import { parseEdaProject } from "@/vendor/canon/lib/eda/parse";
import type { CanonicalIrBundle } from "@/vendor/canon/lib/eda/types";
import { BoardScene } from "@/vendor/canon/components/BoardScene";
export default function PlannerPreview({
  doc,
}: {
  doc: CircuitCanvasDocument;
}) {
  const [bundle, setBundle] = useState<CanonicalIrBundle | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let cancel = false;
    const timer = setTimeout(() => {
      let text: string;
      try {
        text = plannerPcb(doc);
      } catch (e) {
        if (!cancel) setError(String(e));
        return;
      }
      parseEdaProject(
        [
          {
            path: "prelayout.kicad_pcb",
            bytes: new TextEncoder().encode(text),
          },
        ],
        [],
      )
        .then((b) => {
          if (!cancel) {
            setBundle(b);
            setError("");
          }
        })
        .catch((e) => {
          if (!cancel) setError(String(e));
        });
    }, 200);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [doc]);
  const bodies = useMemo(
    () =>
      doc.components.map((c) => ({
        reference: c.reference,
        x: c.placement.xMm,
        y: c.placement.yMm,
        w: c.footprint.geometry.bodyWidthMm,
        h: c.footprint.geometry.bodyHeightMm,
        height: c.footprint.geometry.assemblyHeightMm || 1,
        rotation: c.placement.rotation,
        bottom: c.placement.side === "BOTTOM",
      })),
    [doc],
  );
  return (
    <div className="planner-3d">
      <p className="notice">
        Source 3D models load where available. Grey body envelopes use
        approximate heights; they are not verified mechanical models.
      </p>
      {error ? (
        <p className="notice error">{error}</p>
      ) : bundle?.pcbs[0] ? (
        <BoardScene pcb={bundle.pcbs[0]} fallbackBodies={bodies} />
      ) : (
        <p>Preparing layout preview…</p>
      )}
    </div>
  );
}
