"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import Bom from "./Bom";
import type { CanonicalIrBundle } from "@/vendor/canon/lib/eda/types";
import type { BomRow } from "@/lib/maker/types";
export default function ProjectBom({
  bundle,
  onUpdate,
}: {
  bundle: CanonicalIrBundle;
  onUpdate: (b: CanonicalIrBundle) => void;
}) {
  const latest = useRef(bundle);
  latest.current = bundle;
  const [applied, setApplied] = useState<number | null>(null);
  const groups = useMemo(() => {
    const g = new Map<string, { row: BomRow; ids: string[] }>();
    for (const p of bundle.parts) {
      if (p.reference.startsWith("#")) continue;
      const key = JSON.stringify([
        p.value,
        p.mpnRaw,
        p.manufacturerRaw,
        p.footprint,
        p.variantStatus,
      ]);
      const old = g.get(key);
      if (old) {
        old.ids.push(p.id);
        old.row.quantity++;
        old.row.reference += ", " + p.reference;
      } else
        g.set(key, {
          ids: [p.id],
          row: {
            id: p.id,
            reference: p.reference,
            quantity: 1,
            value: p.value,
            mpn: p.mpnRaw || "",
            manufacturer: p.manufacturerRaw || "",
            package: p.footprint || "",
            original: {
              Reference: p.reference,
              Value: p.value,
              MPN: p.mpnRaw || "",
              Manufacturer: p.manufacturerRaw || "",
              Footprint: p.footprint || "",
            },
            status: "unmatched",
          },
        });
    }
    return [...g.values()];
  }, [bundle.bundleId]);
  const apply = useCallback(
    (rows: BomRow[]) => {
      const matches = new Map(
        rows
          .filter(
            (r) => r.selected && ["exact", "confirmed"].includes(r.status),
          )
          .flatMap((r) =>
            (groups.find((g) => g.row.id === r.id)?.ids || []).map(
              (id) => [id, { ...r.selected!, matchStatus: r.status }] as const,
            ),
          ),
      );
      const current = latest.current;
      const changed = current.parts.some((p) => {
        const m = matches.get(p.id);
        return (
          m && (p.mpnRaw !== m.mpn || p.manufacturerRaw !== m.manufacturer)
        );
      });
      if (!changed) return;
      setApplied(matches.size);
      onUpdate({
        ...current,
        parts: current.parts.map((p) => {
          const m = matches.get(p.id);
          return m
            ? {
                ...p,
                mpnRaw: m.mpn,
                manufacturerRaw: m.manufacturer,
                fields: {
                  ...p.fields,
                  TindieMatchedSource: m.source,
                  TindieMatchStatus: m.matchStatus,
                },
              }
            : p;
        }),
      });
    },
    [groups, onUpdate],
  );
  return (
    <>
      <p className="notice">
        Checks the Tindie parts database first, then configured distributor APIs. Only exact or
        manually confirmed matches are automatically synchronized to this
        project and its iBOM. Applied identities are included in the project ZIP
        as BOM CSV/JSON. Original source files remain unchanged.
      </p>
      {applied !== null && (
        <p role="status" className="notice">
          Applied verified identities to {applied} project components. Open iBOM
          to use the updated fields.
        </p>
      )}
      <Bom
        allowPlacement={false}
        initialRows={groups.map((g) => g.row)}
        onApply={apply}
        onRowsChange={apply}
      />
    </>
  );
}
