"use client";
import { useEffect, useState } from "react";
import type { PartIr } from "@/vendor/canon/lib/eda/types";
import type { Part } from "@/lib/maker/types";
import PartDetailsModal from "./PartDetailsModal";

/**
 * What the viewer knows about a component clicked in a schematic: the fields the designer wrote in
 * the source file, and — when it has a part number — the matching part in the Tindie parts database
 * (manufacturer, description, package, lifecycle). A database match is labelled as such: it is a
 * lookup, not something the designer stated.
 */

/** Source fields worth showing (KiCad / Eagle / Altium / EasyEDA names for the same things). */
const SHOWN = /^(description|desc|manufacturer|mfr|mfg|manufacturer[ _]?name|mpn|mfr[ _.]?(part|no|#)|manufacturer[ _]?part[ _]?(number|no)?|part[ _]?(number|no)|lcsc([ _]?part)?|jlcpcb([ _]?part)?|supplier[ _]?part|digikey|digi-?key[ _]?(pn|part)|mouser|datasheet)$/i;
const MPN_FIELD = /^(mpn|mfr[ _.]?(part|no|#)|manufacturer[ _]?part[ _]?(number|no)?|part[ _]?(number|no))$/i;

/** A value that is a part number (ATmega32U4, FUSB302BMPX) rather than a passive's value or a generic name. */
export function looksLikePartNumber(v: string) {
  const s = v.trim();
  if (s.length < 5 || s.length > 40 || /\s/.test(s)) return false;
  if (!/[a-z]/i.test(s) || !/\d/.test(s)) return false;
  if (/^\d+([.,]\d+)?\s*[pnuµmkKMGR]?\d*\s*(F|H|Ω|R|ohms?|V|A|W|Hz|%)?(\/.*)?$/i.test(s)) return false; // 0.1uF, 4K7, 22pF/50V
  if (/^(conn|connector|pin_?header|testpoint|mounting|hole|jumper|sw_|usb_|led_|crystal|xtal|fuse|ferrite|power_)/i.test(s)) return false;
  return true;
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
type Found = { part: Part; exact: boolean } | { unavailable: true } | null;
const lookups = new Map<string, Promise<Found>>();

function lookup(query: string) {
  let p = lookups.get(norm(query));
  if (!p) {
    p = fetch("/api/maker/parts?q=" + encodeURIComponent(query))
      .then((r) => (r.ok ? r.json() : null))
      .then((d): Found => {
        if (!d || d.sources?.some((x: { source: string; status: string }) => /parts database/i.test(x.source) && x.status === "error")) return { unavailable: true };
        const items: Part[] = d.items || [];
        const q = norm(query);
        const exact = items.find((x) => norm(x.mpn) === q);
        if (exact) return { part: exact, exact: true };
        // An ordering code that extends the schematic's name (ATMEGA32U4 → ATMEGA32U4-MU).
        const close = items.find((x) => norm(x.mpn).startsWith(q) || (q.startsWith(norm(x.mpn)) && norm(x.mpn).length >= 6));
        return close ? { part: close, exact: false } : null;
      })
      .catch((): Found => ({ unavailable: true }));
    if (lookups.size > 200) lookups.clear();
    lookups.set(norm(query), p);
  }
  return p;
}

export default function SchematicPartInfo({ reference, value, part, sheet }: { reference: string; value: string; part?: PartIr; sheet?: string }) {
  const fields = Object.entries(part?.fields || {}).filter(([k, v]) => SHOWN.test(k.trim()) && v && v.trim() !== "~" && v.trim() !== value);
  const fieldMpn = Object.entries(part?.fields || {}).find(([k, v]) => MPN_FIELD.test(k.trim()) && v && v !== "~")?.[1];
  const query = (part?.mpnRaw || fieldMpn || (looksLikePartNumber(value) ? value : "")).trim();
  const [result, setResult] = useState<Found>(null);
  const found = result && "part" in result ? result : null;
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [details, setDetails] = useState(false);
  useEffect(() => {
    setResult(null);
    if (!query) return setState("idle");
    let live = true;
    setState("loading");
    lookup(query).then((r) => {
      if (!live) return;
      if (r && "unavailable" in r) lookups.delete(norm(query)); // the database was down: ask again next time
      setResult(r);
      setState("done");
    });
    return () => {
      live = false;
    };
  }, [query]);
  const url = (v: string) => (/^https?:\/\//i.test(v) ? v : null);
  return (
    <section className="part-info">
      <h3>{reference}</h3>
      <p>{value}</p>
      {part?.manufacturerRaw && <p>{part.manufacturerRaw}</p>}
      {part?.mpnRaw && part.mpnRaw !== value && <p>{part.mpnRaw}</p>}
      {part?.footprint && <p>{part.footprint}</p>}
      {fields.length > 0 && (
        <dl className="part-info-fields">
          {fields.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>
                {url(v) ? (
                  <a href={url(v)!} target="_blank" rel="noopener noreferrer">
                    {/datasheet/i.test(k) ? "Open datasheet" : v}
                  </a>
                ) : (
                  v
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {state === "loading" && <p className="part-info-note">Looking up {query}…</p>}
      {found && (
        <div className="part-info-db">
          <small>{found.exact ? "Tindie parts database" : `Closest match for ${query} in the Tindie parts database — check before use`}</small>
          <strong>{found.part.mpn}</strong>
          {found.part.manufacturer && <p>{found.part.manufacturer}</p>}
          {found.part.description && <p>{found.part.description}</p>}
          {(found.part.package || found.part.lifecycle) && (
            <p>{[found.part.package, found.part.lifecycle].filter(Boolean).join(" · ")}</p>
          )}
          <button type="button" className="text-link" onClick={() => setDetails(true)}>
            Part details, datasheet and prices
          </button>
        </div>
      )}
      {state === "done" && result && "unavailable" in result && <p className="part-info-note">The Tindie parts database could not be reached — try again in a moment.</p>}
      {state === "done" && !result && <p className="part-info-note">{query} is not in the Tindie parts database.</p>}
      {sheet && <small>{sheet}</small>}
      {details && found && <PartDetailsModal mpn={found.part.mpn} manufacturer={found.part.manufacturer} onClose={() => setDetails(false)} />}
    </section>
  );
}
