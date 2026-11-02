"use client";
import { useEffect, useState } from "react";
import { Star } from "lucide-react";

type Info = {
  family: string;
  designs: { items: { id: string; name: string; kind: string; stars: number | null; partCount: number }[]; total: number };
  alternatives: {
    family: string;
    label: string;
    manufacturer: string;
    usage: number | null;
    similarity: number | null;
    sameBoard: number | null;
    checks: Record<string, string>;
  }[];
  functions: { id: string; name: string; designs: number }[];
};
const cache = new Map<string, Promise<Info>>();

/** Designs, circuit functions and alternative candidates for one knowledge-graph family. */
export default function FamilyInfo({ family }: { family: string }) {
  const [info, setInfo] = useState<Info | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setInfo(null);
    setError("");
    let p = cache.get(family);
    if (!p) {
      p = fetch("/api/maker/families/" + encodeURIComponent(family)).then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw Error(d.error || "Family details unavailable");
        return d as Info;
      });
      p.catch(() => cache.delete(family));
      if (cache.size > 40) cache.clear();
      cache.set(family, p);
    }
    p.then((d) => alive && setInfo(d)).catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [family]);
  if (error) return <p className="graph-hint">{error}</p>;
  if (!info) return <p className="graph-hint">Loading designs and alternatives…</p>;
  return (
    <>
      <h3>Designs using this family{info.designs.total ? ` · ${info.designs.total}` : ""}</h3>
      {info.designs.items.length ? (
        info.designs.items.map((d) => (
          <a className="graph-project" key={d.id} href={"/tools/circuits?design=" + encodeURIComponent(d.id)}>
            {d.name}
            {d.stars !== null && (
              <small>
                {" "}
                · <Star size={10} /> {d.stars}
              </small>
            )}
          </a>
        ))
      ) : (
        <p className="graph-hint">No published design yet.</p>
      )}
      {info.functions.length > 0 && (
        <>
          <h3>Used for</h3>
          <div className="chip-row">
            {info.functions.slice(0, 8).map((f) => (
              <span className="pill muted" key={f.id}>
                {f.name} · {f.designs}
              </span>
            ))}
          </div>
        </>
      )}
      {info.alternatives.length > 0 && (
        <>
          <h3>Alternative candidates</h3>
          <p className="graph-hint">
            Families used in similar circuits that rarely share a board. Pinout, package and electrical
            compatibility are <b>not verified</b> — do not substitute without checking datasheets.
          </p>
          {info.alternatives.map((a) => (
            <a
              className="graph-project"
              key={a.family}
              href={"/tools/components?q=" + encodeURIComponent(a.label || a.family)}
            >
              {a.label || a.family}
              <small>
                {a.manufacturer ? ` · ${a.manufacturer}` : ""}
                {a.similarity !== null ? ` · similarity ${(a.similarity * 100).toFixed(0)}%` : ""}
                {a.checks?.pin_count === "pass" ? " · same pin count" : a.checks?.pin_count === "fail" ? " · different pin count" : ""}
              </small>
            </a>
          ))}
        </>
      )}
    </>
  );
}
