import "server-only";
import { sharedFetchSignal } from "@/lib/maker/request-context";
import index from "@/data/kicad-index.json";
import { previewFootprint, previewSymbol } from "@/vendor/eelib/ecad/preview";
import { applySymbolTypography } from "@/lib/maker/symbol-typography";
import { boundedBody } from "@/vendor/canon/lib/allegro-http";
import { pdGetRaw } from "./client";

/**
 * Resolves the bare symbol / footprint names partdata returns ("STM32H503KBUx",
 * "QFN-32-1EP_5x5mm_P0.5mm_EP3.45x3.45mm", or "Lib:Name") to files in the official
 * KiCad libraries (pinned tag, src/data/kicad-index.json) and draws them with eelib's
 * preview engine (src/vendor/eelib/ecad).
 */
const TAG: string = (index as any).tag;
const RAW = "https://gitlab.com/kicad/libraries";
type Lookup = Map<string, string[]>; // lower-case name → libraries

function build(group: Record<string, string[]>) {
  const exact = new Map<string, string[]>();
  const lower: Lookup = new Map();
  for (const [lib, names] of Object.entries(group))
    for (const n of names) {
      (exact.get(n) ?? exact.set(n, []).get(n)!).push(lib);
      const k = n.toLowerCase();
      (lower.get(k) ?? lower.set(k, []).get(k)!).push(lib);
    }
  return { exact, lower, libs: new Set(Object.keys(group)) };
}
const SYM = build((index as any).symbols);
const FP = build((index as any).footprints);

export function resolveName(kind: "symbol" | "footprint", raw: string | null | undefined) {
  const t = kind === "symbol" ? SYM : FP;
  const v = String(raw || "").trim();
  if (!v || v.length > 200 || /[\\/]/.test(v)) return null;
  const [lib, name] = v.includes(":") ? [v.split(":")[0], v.split(":").slice(1).join(":")] : ["", v];
  if (lib && t.libs.has(lib) && t.exact.get(name)?.includes(lib)) return { library: lib, name };
  const exact = t.exact.get(name);
  if (exact?.length) return { library: exact[0], name };
  const loose = t.lower.get(name.toLowerCase());
  if (loose?.length) {
    const lib0 = loose[0];
    const real = ((index as any)[kind === "symbol" ? "symbols" : "footprints"][lib0] as string[]).find(
      (n) => n.toLowerCase() === name.toLowerCase(),
    )!;
    return { library: lib0, name: real };
  }
  return null;
}

/**
 * A KiCad symbol for a part number when the database records none. KiCad names many symbols with a
 * lowercase "x" for the variant characters (STM32F103CBTx covers STM32F103CBT6 / CBT7); match those,
 * or an exact name, against the MPN. Up to three trailing packing characters are allowed
 * (STM32F103CBT6TR). The most specific name wins (fewest wildcards). Reported as inferred.
 */
let wildcard: { lib: string; name: string; re: RegExp; literal: number }[] | null = null;
export function symbolForMpn(mpn: string | null | undefined) {
  const m = String(mpn || "").trim().toUpperCase();
  if (m.length < 4 || m.length > 60) return null;
  const exact = resolveName("symbol", m);
  if (exact) return exact;
  if (!wildcard) {
    wildcard = [];
    for (const [lib, names] of Object.entries((index as any).symbols as Record<string, string[]>))
      for (const name of names) {
        // Wildcards are the lowercase x after the first digit (STM32F103CBTx, not "xx" brand prefixes).
        const head = name.match(/^[^0-9]*/)![0];
        const tail = name.slice(head.length);
        if (!/x/.test(tail) || !/^[A-Za-z0-9_.+-]+$/.test(name)) continue;
        const esc = (v: string) => v.toUpperCase().replace(/[.+]/g, "\\$&");
        const body = esc(head) + tail.split("x").map(esc).join("[A-Z0-9]");
        wildcard.push({ lib, name, re: new RegExp("^" + body + "[A-Z0-9]{0,3}$"), literal: name.replace(/x/g, "").length });
      }
  }
  const hits = wildcard.filter((w) => w.re.test(m.replace(/[^A-Z0-9.+_-]/g, "")));
  if (!hits.length) return null;
  hits.sort((a, b) => b.literal - a.literal);
  return { library: hits[0].lib, name: hits[0].name };
}

const files = new Map<string, { until: number; text: Promise<string> }>();
function fetchText(url: string) {
  const hit = files.get(url);
  if (hit && hit.until > Date.now()) return hit.text;
  if (files.size > 500) files.clear();
  const text = (async () => {
    const r = await fetch(url, { redirect: "error", signal: sharedFetchSignal(15000), next: { revalidate: 86400 } });
    if (!r.ok) throw Error(`KiCad library returned HTTP ${r.status}`);
    return new TextDecoder().decode(await boundedBody(r.body, 4 * 1024 * 1024));
  })();
  files.set(url, { until: Date.now() + 86400000, text });
  text.catch(() => files.delete(url));
  return text;
}

export function symbolUrl(library: string, name: string) {
  return `${RAW}/kicad-symbols/-/raw/${TAG}/${encodeURIComponent(library + ".kicad_symdir")}/${encodeURIComponent(name + ".kicad_sym")}`;
}
export function footprintUrl(library: string, name: string) {
  return `${RAW}/kicad-footprints/-/raw/${TAG}/${encodeURIComponent(library + ".pretty")}/${encodeURIComponent(name + ".kicad_mod")}`;
}

/** The body of one `(symbol "Name" …)` inside a single-symbol .kicad_sym file. */
function symbolBody(text: string) {
  const start = text.indexOf("(symbol ");
  const end = text.lastIndexOf(")");
  return start >= 0 && end > start ? text.slice(start, end) : "";
}

/**
 * KiCad 10 stores one symbol per file. A derived symbol `(extends "Parent")` needs its
 * parent (and grand-parents) in the same library root for symbolDefinition to merge them.
 */
async function symbolLibraryText(library: string, name: string) {
  const bodies: string[] = [];
  let current: string | null = name;
  const seen = new Set<string>();
  while (current && !seen.has(current) && seen.size < 4) {
    seen.add(current);
    const text = await fetchText(symbolUrl(library, current));
    const body = symbolBody(text);
    if (!body) throw Error("not_a_symbol_library");
    bodies.push(body);
    current = text.match(/\(extends\s+"([^"]+)"\)/)?.[1] ?? null;
    if (current && !(index as any).symbols[library]?.includes(current)) break;
  }
  return `(kicad_symbol_lib (version 20241209) (generator "tindie") ${bodies.join("\n")})`;
}

export type CadResult = {
  symbol: { preview: any; source?: string; reason?: string; library?: string; inferred?: boolean };
  footprint: { preview: any; source?: string; reason?: string; library?: string };
  model?: { path: string; revision: string; url?: string } | null;
  revision: string;
};

export type EzplmFiles = { partId: string; symbol: boolean; footprint: boolean; model: boolean };

/** A part's file from ezPLM's own library, through partdata's signed /parts/{id}/cad/{kind}. */
export async function ezplmFile(partId: string, kind: "symbol" | "footprint" | "model") {
  if (!/^p_[a-z2-7]{8,40}$/.test(partId)) throw Error("bad_part");
  return pdGetRaw(`/api/pub/v1/parts/${partId}/cad/${kind}`, kind === "model" ? { max: 15 * 1024 * 1024, cache: false } : {});
}
export const ezplmText = async (partId: string, kind: "symbol" | "footprint") =>
  new TextDecoder().decode((await ezplmFile(partId, kind)).body);
const bare = (v: string) => v.split(":").pop() || v;

export async function cadPreview(
  symbolName?: string | null,
  footprintName?: string | null,
  ez?: EzplmFiles | null,
  mpn?: string | null,
): Promise<CadResult> {
  const out: CadResult = { symbol: { preview: null }, footprint: { preview: null }, model: null, revision: TAG };
  let sym = resolveName("symbol", symbolName);
  // No symbol recorded (or not in the library): the official symbol named after this part number.
  const inferred = !sym && !ez?.symbol ? symbolForMpn(mpn) : null;
  if (inferred) {
    sym = inferred;
    symbolName = inferred.name;
  }
  const fp = resolveName("footprint", footprintName);
  const ezDownload = (kind: string) => `/api/maker/cad/${ez!.partId}/${kind}`;
  await Promise.all([
    (async () => {
      if (!symbolName) return void (out.symbol.reason = "no_symbol_in_database");
      if (sym)
        try {
          const text = await symbolLibraryText(sym.library, sym.name);
          const preview = previewSymbol(text);
          out.symbol = {
            preview: applySymbolTypography(preview, text),
            source: symbolUrl(sym.library, sym.name),
            library: `${sym.library}:${sym.name}`,
            ...(inferred ? { inferred: true } : {}),
          };
          return;
        } catch {
          out.symbol.reason = "not_previewable";
        }
      // Not in (or not drawable from) the official KiCad library: ezPLM's own library.
      if (ez?.symbol)
        try {
          const text = await ezplmText(ez.partId, "symbol");
          const name = bare(symbolName);
          const preview = previewSymbol(text);
          out.symbol = { preview: applySymbolTypography(preview, text), source: ezDownload("symbol"), library: `ezPLM:${name}` };
          return;
        } catch {
          out.symbol.reason = "not_previewable";
          return;
        }
      if (!sym) out.symbol.reason = "not_in_official_kicad_library";
    })(),
    (async () => {
      if (!footprintName) return void (out.footprint.reason = "no_footprint_in_database");
      if (fp)
        try {
          const url = footprintUrl(fp.library, fp.name);
          const text = await fetchText(url);
          out.footprint = { preview: previewFootprint(text), source: url, library: `${fp.library}:${fp.name}` };
          const m = text.match(/\(model\s+"?[^"\n)]*?([\w.-]+\.3dshapes\/[\w.+()-]+\.(?:step|stp|wrl))"?/i);
          if (m) out.model = { path: m[1], revision: "master" };
          return;
        } catch {
          out.footprint.reason = "not_previewable";
        }
      if (ez?.footprint)
        try {
          // Fetching and drawing fail for different reasons; say which (a fetch can work next time).
          const text = await ezplmText(ez.partId, "footprint").catch(() => null);
          const name = bare(footprintName);
          if (text === null) {
            out.footprint.reason = "ezplm_unavailable";
            return;
          }
          out.footprint = { preview: previewFootprint(text), source: ezDownload("footprint"), library: `ezPLM:${name}` };
          if (ez.model) out.model = { path: `ezPLM/${name}.step`, revision: "ezplm", url: ezDownload("model") };
          return;
        } catch {
          out.footprint.reason = "not_previewable";
          return;
        }
      if (!fp) out.footprint.reason = "not_in_official_kicad_library";
    })(),
  ]);
  return out;
}
