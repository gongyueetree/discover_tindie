"use client";
import { useRef, useCallback } from "react";
import type { CircuitCanvasDocument } from "@/vendor/protopcb/design-core/document/types";
import type { BomRow } from "@/lib/maker/types";
import Bom from "./Bom";
export default function PlannerOutputs({
  doc,
  activeId,
  onSelect,
}: {
  doc: CircuitCanvasDocument;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const saved = useRef(new Map<string, BomRow>());
  const remember = useCallback((rows: BomRow[]) => {
    for (const r of rows) saved.current.set(r.id, r);
  }, []);
  const rows: BomRow[] = doc.components.map((c) => ({
    id: c.instanceId,
    reference: c.reference,
    quantity: 1,
    value: c.display?.description || c.footprint.name,
    mpn: c.mpn,
    manufacturer: c.manufacturer,
    package: c.footprint.name,
    original: {},
    status: c.mpn ? "confirmed" : "unmatched",
    ...(c.mpn
      ? {
          selected: {
            id: c.componentId,
            mpn: c.mpn,
            manufacturer: c.manufacturer,
            description: c.display?.description || "",
            package: c.footprint.name,
            source: c.source,
            parameters: {},
            cad: [],
            offers: [],
          },
        }
      : {}),
  }));
  const grouped = new Map<string, BomRow>();
  for (const row of rows) {
    const k = JSON.stringify([
      row.mpn,
      row.manufacturer,
      row.package,
      row.value,
    ]);
    const prior = grouped.get(k);
    if (prior) {
      prior.quantity++;
      prior.reference += ", " + row.reference;
    } else grouped.set(k, { ...row });
  }
  const bomRows = [...grouped.values()].map((r) => {
    const old = saved.current.get(r.id);
    return old
      ? {
          ...r,
          selected: old.selected,
          candidates: old.candidates,
          status: old.status,
          manualUnitPrice: old.manualUnitPrice,
        }
      : r;
  });
  const bomKey = JSON.stringify(
    rows.map((r) => [r.id, r.mpn, r.manufacturer, r.package]),
  );
  return (
    <section className="planner-outputs planner-bom-bottom">
      <h3>Placed components · {doc.components.length} — BOM & cost estimate</h3>
      {bomRows.length ? (
        <Bom
          key={bomKey}
          initialRows={bomRows}
          onRowsChange={remember}
          allowPlacement={false}
          compact
          activeReference={
            doc.components.find((c) => c.instanceId === activeId)?.reference
          }
          onSelectReference={(ref) => {
            const component = doc.components.find((c) => c.reference === ref);
            if (component) onSelect(component.instanceId);
          }}
        />
      ) : (
        <p className="muted">Add components to estimate your board cost.</p>
      )}
    </section>
  );
}
