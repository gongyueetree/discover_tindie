"use client";
import { useEffect, useState } from "react";
import PartDetailsModal from "./PartDetailsModal";
import type { GraphNode } from "@/lib/maker/component-graph";
import type { Part } from "@/lib/maker/types";
import { partFamily } from "@/lib/maker/part-family";
const cache = new Map<string, { until: number; parts: Part[] }>();
export default function FamilyVariants({ node }: { node: GraphNode }) {
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
      setStatus("");
      return;
    }
    fetch("/api/maker/parts?q=" + encodeURIComponent(node.label), {
      signal: ac.signal,
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Catalog unavailable");
        const rows: Part[] = (d.items || []).filter((p: Part) => {
          const f = partFamily(p.mpn, p.manufacturer);
          return (
            f.family === node.label.toUpperCase() &&
            (!node.manufacturer ||
              f.manufacturer.toUpperCase() === node.manufacturer.toUpperCase())
          );
        });
        if (ac.signal.aborted) return;
        setParts(rows);
        const unavailable = (d.sources || []).filter(
          (s: { status: string }) => s.status !== "ready",
        );
        setStatus(
          unavailable.length
            ? "Some catalog sources are unavailable. Showing BOM records and available matches."
            : "",
        );
        if (!unavailable.length) {
          if (cache.size >= 32) cache.delete(cache.keys().next().value!);
          cache.set(node.id, { parts: rows, until: Date.now() + 600000 });
        }
      })
      .catch((e) => {
        if (!ac.signal.aborted)
          setStatus(e.message + " — BOM variants remain available.");
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
        {node.familyRule}. Variants found in loaded BOMs and returned catalog
        matches; not an exhaustive manufacturer list.
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
