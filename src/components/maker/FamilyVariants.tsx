"use client";
import { useEffect, useState } from "react";
import PartDetailsModal from "./PartDetailsModal";
import type { GraphNode } from "@/lib/maker/component-graph";
import type { Part } from "@/lib/maker/types";
const cache = new Map<string, { until: number; parts: Part[] }>();
/** What the parts database says the node's part is: its own record first, else the family's first. */
function summaryOf(node: GraphNode, parts: Part[]) {
  const own = parts.find((p) => p.mpn.toUpperCase() === node.label.toUpperCase());
  const p = own?.description ? own : parts.find((x) => x.description);
  return p?.description ? { text: p.description, mpn: p.mpn, exact: p === own } : null;
}
export type NodeSummary = ReturnType<typeof summaryOf>;

export default function FamilyVariants({
  node,
  onCompare,
  onSummary,
}: {
  node: GraphNode;
  onCompare?: (mpn: string) => void;
  /** Called with the part's description once the family's parts are loaded (null when none is published). */
  onSummary?: (summary: NodeSummary) => void;
}) {
  const [lookup, setLookup] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[]>([]),
    [status, setStatus] = useState("Loading catalog variants…");
  useEffect(() => {
    const ac = new AbortController();
    setParts([]);
    setStatus("Loading catalog variants…");
    const old = cache.get(node.id);
    if (old && old.until > Date.now()) {
      setParts(old.parts);
      onSummary?.(summaryOf(node, old.parts));
      setStatus("");
      return;
    }
    // node.id is the knowledge graph's family key: a normalised part-number prefix (AMS1117-3.3 → AMS111733).
    fetch("/api/maker/parts?q=" + encodeURIComponent(node.id), {
      signal: ac.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Catalog unavailable");
        const key = node.id.toUpperCase();
        const rows: Part[] = (d.items || []).filter((p: Part) =>
          p.mpn.toUpperCase().replace(/[^A-Z0-9]/g, "").startsWith(key),
        );
        if (ac.signal.aborted) return;
        setParts(rows);
        onSummary?.(summaryOf(node, rows));
        // Only the parts database itself counts; DigiKey / Mouser not being set up is not an outage.
        const unavailable = (d.sources || []).filter(
          (s: { source: string; status: string }) => s.source === "Tindie parts database" && s.status !== "ready",
        );
        setStatus(
          unavailable.length
            ? "The parts database is unavailable right now."
            : "",
        );
        if (!unavailable.length) {
          if (cache.size >= 32) cache.delete(cache.keys().next().value!);
          cache.set(node.id, { parts: rows, until: Date.now() + 600000 });
        }
      })
      .catch((e) => {
        if (ac.signal.aborted) return;
        setStatus(e.message);
        onSummary?.(null);
      });
    return () => ac.abort();
  }, [node.id, node.label, node.manufacturer]);
  const rows = node.variants.map((v) => ({
    v,
    p: parts.find((p) => p.mpn.toUpperCase() === v.mpn.toUpperCase()),
  }));
  for (const p of parts)
    if (!rows.some((r) => r.v.mpn.toUpperCase() === p.mpn.toUpperCase()))
      rows.push({
        p,
        v: {
          mpn: p.mpn,
          manufacturer: p.manufacturer,
          identity: "Catalog MPN",
          footprints: [],
          packages: [],
          projects: [],
        },
      });
  const fields = [
    ...new Set(parts.flatMap((p) => Object.keys(p.parameters || {}))),
  ].filter((k) => !/description|描述/i.test(k));
  const differences = fields.filter(
    (k) => new Set(parts.map((p) => p.parameters[k] || "—")).size > 1,
  );
  const shown = [
    ...new Set([
      ...differences,
      ...fields.filter((k) =>
        /flash|ram|memory|pin|temperature|voltage|speed|频率|引脚|温度|存储/i.test(
          k,
        ),
      ),
    ]),
  ].slice(0, 8);
  return (
    <section className="family-variants">
      <h3>
        MPN variants <span>({rows.length})</span>
      </h3>
      <p className="graph-hint">
        {node.familyRule}. Part numbers in the Tindie parts database that belong
        to this family; not an exhaustive manufacturer list.
      </p>
      {status && (
        <p className="graph-hint" role="status">
          {status}
        </p>
      )}
      <div className="family-table-scroll">
        <table>
          <thead>
            <tr>
              <th>MPN / source</th>
              <th>Package / BOM footprint</th>
              {shown.map((k) => (
                <th key={k}>{k}</th>
              ))}
              <th>Projects</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ v, p }) => (
              <tr key={v.mpn}>
                <td>
                  <button
                    className="mpn-detail-link"
                    onClick={() => setLookup(v.mpn)}
                  >
                    {v.mpn} ↗
                  </button>
                  <small>
                    {p ? "Catalog match · " + p.source : v.identity}
                  </small>
                  {onCompare && p && v.mpn.toUpperCase() !== node.label.toUpperCase() && (
                    <button className="text-link compare-link" onClick={() => onCompare(v.mpn)}>
                      Compare with {node.label}
                    </button>
                  )}
                </td>
                <td>
                  {p?.package || v.packages.join(", ") || "Not available"}
                  {v.footprints.length > 0 && (
                    <small>BOM footprint: {v.footprints.join(", ")}</small>
                  )}
                </td>
                {shown.map((k) => (
                  <td key={k}>{p?.parameters[k] || "Not available"}</td>
                ))}
                <td>{v.projects.length || "Not in loaded BOMs"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="graph-hint">
        Only source-supplied specifications are compared. Missing values are not
        inferred from suffixes. Same family does not imply pin compatibility.
      </p>
      {lookup && (
        <PartDetailsModal
          key={lookup}
          mpn={lookup}
          onClose={() => setLookup(null)}
        />
      )}
    </section>
  );
}
