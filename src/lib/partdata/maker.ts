import "server-only";
import { pdGet, pdPost, PartdataError, partdataConfigured } from "./client";
import { categoryEn, hasCjk, lifecycleEn, manufacturerCanonical, manufacturerEn } from "./glossary";
import { terminology } from "@/lib/maker/english";
import type { Part, ProviderStatus } from "@/lib/maker/types";
import type { GraphData, GraphNode } from "@/lib/maker/component-graph";
import { MODULE_EN } from "./modules";
import { resolveName } from "./kicad-lib";

const P = "/api/pub/v1";
const KG = "/api/kg/v1";
export const PARTDATA_SOURCE = "Tindie parts database";

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const link = (v: unknown) => {
  try {
    const u = new URL(String(v));
    return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password ? u.href : undefined;
  } catch {
    return undefined;
  }
};
const englishText = (s: string | null | undefined) => {
  const v = String(s || "").trim();
  return hasCjk(v) ? terminology(v) : v;
};

/** Public part (list item or detail) → UI Part. */
export function toPart(p: any): Part {
  const params: Record<string, string> = {};
  const fieldSources: Record<string, string> = {};
  for (const [k, v] of Object.entries<any>(p.parameters || {})) {
    if (!v || v.value === undefined || v.value === null || v.value === "") continue;
    const key = englishText(k);
    params[key] = englishText(String(v.value));
    if (v.source) fieldSources[key] = v.source;
  }
  if (p.symbol?.source) fieldSources.symbol = p.symbol.source;
  if (p.footprint?.source) fieldSources.footprint = p.footprint.source;
  const description = p.description_en || (p.description ? englishText(p.description) : "");
  const cat = categoryEn(p.category);
  return {
    id: String(p.id),
    mpn: String(p.mpn || ""),
    manufacturer: manufacturerEn(p.manufacturer),
    description: String(description || ""),
    package: (typeof p.footprint === "string" ? p.footprint : p.footprint?.value) || undefined,
    datasheet: link(p.datasheet_url),
    productUrl: link(p.product_url),
    source: PARTDATA_SOURCE,
    parameters: params,
    cad: [],
    offers: [],
    category: cat || undefined,
    lifecycle: p.lifecycle ? lifecycleEn(p.lifecycle) : null,
    symbolName: p.symbol?.value ?? null,
    footprintName: (typeof p.footprint === "string" ? p.footprint : p.footprint?.value) ?? null,
    usedInDesigns: typeof p.used_in_designs === "number" ? p.used_in_designs : undefined,
    fieldSources,
    withheld: p.withheld ?? null,
    hasDatasheetInEzplm: !!p.has_datasheet_in_ezplm,
    detailed: "used_in_designs" in p,
    ...(hasCjk(String(p.manufacturer || "")) || hasCjk(String(p.description || ""))
      ? { originalText: { description: String(p.description || ""), parameters: {} } }
      : {}),
  };
}

/** Exact lookup + prefix search in parallel; exact rows first, de-duplicated by public ID. */
export async function searchPartdata(q: string, visitor: string) {
  const key = norm(q);
  if (key.length < 3) throw new PartdataError("Enter at least 3 characters of a part number.", 400, "query_too_short");
  const [lookup, search] = await Promise.allSettled([
    pdGet(`${P}/parts/lookup`, { mpn: q }, visitor),
    pdGet(`${P}/parts/search`, { q, limit: 20 }, visitor),
  ]);
  if (lookup.status === "rejected" && search.status === "rejected") throw lookup.reason;
  const rows = [
    ...(lookup.status === "fulfilled" ? lookup.value.data.items || [] : []),
    ...(search.status === "fulfilled" ? search.value.data.items || [] : []),
  ];
  const seen = new Set<string>();
  const items = rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).map(toPart);
  return {
    items,
    exact: lookup.status === "fulfilled" && lookup.value.data.match === "exact",
    hasMore: search.status === "fulfilled" ? !!search.value.meta?.pagination?.has_more : false,
  };
}

export async function partDetail(id: string, visitor: string) {
  if (!/^p_[a-z2-7]{8,40}$/.test(id)) throw new PartdataError("Unknown part.", 404, "not_found");
  const r = await pdGet(`${P}/parts/${id}`, {}, visitor);
  return toPart(r.data);
}

export type DesignCard = {
  id: string;
  name: string;
  kind: "open_source" | "vendor";
  /** Vendor reference designs: the manufacturer that publishes it (from the source link's site). */
  vendor?: string | null;
  sourceUrl: string;
  license: string | null;
  stars: number | null;
  edaTool: string | null;
  partCount: number;
  summary: string | null;
  coverImageUrl?: string | null;
};
function toDesign(d: any): DesignCard {
  return {
    id: String(d.id),
    name: String(d.name || "Untitled design"),
    kind: d.kind === "vendor" ? "vendor" : "open_source",
    vendor: d.kind === "vendor" ? vendorName(d.vendor, d.source_url) : null,
    sourceUrl: link(d.source_url) || "",
    license: d.license || null,
    stars: typeof d.stars === "number" ? d.stars : null,
    edaTool: d.eda_tool || null,
    partCount: Number(d.part_count) || 0,
    summary: d.summary ? englishText(d.summary) : null,
    coverImageUrl: link(d.cover_image_url) || null,
  };
}

/**
 * Designs shown on Tindie must be openable and somewhat proven: engineering files the viewer
 * can parse (KiCad, Eagle, Altium, EasyEDA / JLCEDA) and at least one GitHub star. Vendor
 * reference designs have neither, so they are not listed.
 */
export const DESIGN_RULES = {
  minStars: 1,
  // Every format the viewer parses: KiCad, Eagle, Altium Designer, EasyEDA / JLCEDA (standard and Pro).
  eda: ["kicad", "eagle", "altium", "easyeda", "jlcpro", "jlc", "jlceda", "lceda"],
};
// Vendor reference designs are trusted as published by the manufacturer: always listed, without a star rule.
const keep = (d: DesignCard) =>
  d.kind === "vendor" ||
  ((d.stars ?? 0) >= DESIGN_RULES.minStars && DESIGN_RULES.eda.includes((d.edaTool || "").toLowerCase()));

/** Manufacturer sites → display names, for vendor reference designs. */
const VENDOR_SITES: [RegExp, string][] = [
  [/(^|\.)ti\.com(\.cn)?$/, "Texas Instruments"], [/(^|\.)(analog|maximintegrated|linear)\.com$/, "Analog Devices"],
  [/(^|\.)st\.com(\.cn)?$/, "STMicroelectronics"], [/(^|\.)nxp\.com(\.cn)?$/, "NXP Semiconductors"],
  [/(^|\.)microchip\.com$/, "Microchip Technology"], [/(^|\.)(infineon|cypress)\.com$/, "Infineon Technologies"],
  [/(^|\.)onsemi\.com(\.cn)?$/, "onsemi"], [/(^|\.)renesas\.com$/, "Renesas Electronics"], [/(^|\.)espressif\.com$/, "Espressif Systems"],
  [/(^|\.)silabs\.com$/, "Silicon Labs"], [/(^|\.)nordicsemi\.com$/, "Nordic Semiconductor"], [/(^|\.)rohm\.com(\.cn)?$/, "ROHM"],
  [/(^|\.)toshiba[\w-]*\.(com|co\.jp)$/, "Toshiba"], [/(^|\.)(wch|wch-ic)\.(cn|com)$/, "WCH"], [/(^|\.)gigadevice\.com(\.cn)?$/, "GigaDevice"],
  [/(^|\.)monolithicpower\.com$/, "Monolithic Power Systems"], [/(^|\.)richtek\.com$/, "Richtek"], [/(^|\.)diodes\.com$/, "Diodes Inc"],
  [/(^|\.)vishay\.com$/, "Vishay"], [/(^|\.)murata\.com$/, "Murata"], [/(^|\.)sg-micro\.com$/, "SG Micro"], [/(^|\.)3peak\.com$/, "3PEAK"],
  [/(^|\.)raspberrypi\.(com|org)$/, "Raspberry Pi"], [/(^|\.)arduino\.cc$/, "Arduino"], [/(^|\.)xilinx\.com$/, "AMD Xilinx"],
  [/(^|\.)lattice(semi)?\.com$/, "Lattice Semiconductor"], [/(^|\.)intel\.com$/, "Intel"], [/(^|\.)skyworksinc\.com$/, "Skyworks"],
  [/(^|\.)qorvo\.com$/, "Qorvo"], [/(^|\.)semtech\.com$/, "Semtech"], [/(^|\.)power\.com$/, "Power Integrations"],
];
function vendorName(given: unknown, url: unknown): string | null {
  if (typeof given === "string" && given.trim()) return manufacturerEn(manufacturerCanonical(given.replace(/参考设计$/, "").trim()));
  try {
    const host = new URL(String(url)).hostname.replace(/^www\./, "");
    return VENDOR_SITES.find(([re]) => re.test(host))?.[1] ?? host;
  } catch {
    return null;
  }
}

type DesignFilter = { part?: string; mpn?: string; family?: string; function?: string };

/** Up to 100 designs for one filter (5 cached pages of 20), with Tindie's rules applied. */
async function designPool(filter: DesignFilter, visitor: string) {
  const q: Record<string, string | number> = { limit: 20, min_stars: DESIGN_RULES.minStars, eda: DESIGN_RULES.eda.join(",") };
  if (filter.part) q.part = filter.part;
  else if (filter.mpn) q.mpn = filter.mpn;
  else if (filter.family) q.family = filter.family.replace(/^fam:/, "");
  else if (filter.function) q.function = filter.function;
  else throw new PartdataError("Choose a part, family or circuit module.", 400, "bad_request");
  const out: DesignCard[] = [];
  let upstreamTotal = 0;
  for (let offset = 0; offset <= 80; offset += 20) {
    const r = await pdGet(`${P}/designs`, { ...q, offset }, visitor);
    const items: DesignCard[] = (r.data.items || []).map(toDesign);
    upstreamTotal = Number(r.meta?.pagination?.total) || 0;
    out.push(...items);
    if (items.length < 20 || offset + 20 >= upstreamTotal) break;
  }
  const seen = new Set<string>();
  return out.filter((d) => keep(d) && !seen.has(d.id) && seen.add(d.id));
}

export async function designsBy(filter: DesignFilter, offset: number, visitor: string, limit = 20) {
  let pool: DesignCard[];
  let approximate = false;
  if (filter.function) {
    try {
      pool = await designPool({ function: filter.function }, visitor);
    } catch (e) {
      // A parts database without the module filter answers 400: use the module's most common
      // component families instead (knowledge graph, classified-design basis) and say so.
      if (!(e instanceof PartdataError) || e.status !== 400) throw e;
      approximate = true;
      const fams = await pdGet(`${KG}/rankings/functions/${encodeURIComponent(filter.function)}/families`, { limit: 4 }, visitor).catch(
        () => ({ data: { items: [] } }) as any,
      );
      const lists = await Promise.all(
        (fams.data.items || []).slice(0, 4).map((f: any) => designPool({ family: f.family || f.entity_id }, visitor).catch(() => [])),
      );
      const seen = new Set<string>();
      pool = lists.flat().filter((d: DesignCard) => !seen.has(d.id) && seen.add(d.id));
    }
  } else pool = await designPool(filter, visitor);
  pool.sort((a, b) => (b.stars ?? 0) - (a.stars ?? 0) || a.name.localeCompare(b.name));
  return { items: pool.slice(offset, offset + limit), total: pool.length, offset, limit, approximate };
}

export async function designDetail(id: string, visitor: string) {
  if (!/^d_[a-z2-7]{8,40}$/.test(id)) throw new PartdataError("Unknown design.", 404, "not_found");
  const r = await pdGet(`${P}/designs/${id}`, {}, visitor);
  const d = r.data;
  return {
    ...toDesign(d),
    bom: Array.isArray(d.bom)
      ? d.bom.map((b: any) => ({
          designators: String(b.designators || ""),
          quantity: Number(b.quantity) || 0,
          value: b.value || "",
          mpn: b.mpn || "",
          manufacturer: manufacturerEn(b.manufacturer),
          footprint: b.footprint || "",
          partId: b.part_id || null,
        }))
      : null,
    bomWithheldReason: d.bom_withheld_reason ? "Vendor reference design: licence not reviewed, source link only." : null,
  };
}

/** Repository path of a pinned GitHub source URL ("https://github.com/o/r/tree/<sha>/sub"). */
export function githubSource(url: string) {
  const m = url.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)(?:\/tree\/([0-9a-f]{7,40})(?:\/(.*))?)?\/?$/);
  return m ? { repo: m[1], commit: m[2] || null, subdir: m[3] || "" } : null;
}

export type MatchLine = { ref: string; status: "exact" | "ambiguous" | "candidates" | "not_found"; items: Part[] };

/** BOM rows → partdata /bom/match statuses (exact / ambiguous / candidates / not_found). */
export async function matchLines(
  lines: { ref: string; mpn: string; manufacturer: string; value: string }[],
  visitor: string,
): Promise<MatchLine[]> {
  const r = await pdPost(
    `${P}/bom/match`,
    {
      lines: lines.map((l) => ({
        ref: l.ref,
        ...(l.mpn ? { mpn: l.mpn } : { value: l.value }),
        ...(l.manufacturer ? { manufacturer: manufacturerCanonical(l.manufacturer) } : {}),
      })),
    },
    visitor,
  );
  return (r.data.lines || []).map(
    (l: any): MatchLine => ({ ref: String(l.ref), status: l.status, items: (l.items || []).map(toPart) }),
  );
}

export const status = (s: ProviderStatus["status"], message?: string): ProviderStatus => ({
  source: PARTDATA_SOURCE,
  status: s,
  ...(message ? { message } : {}),
});
export { partdataConfigured };

/* ------------------------------------------------------------------ knowledge graph */

const KIND_LABEL: Record<string, string> = {
  ic: "IC",
  discrete: "Discrete",
  passive: "Passive",
  electromech: "Electromechanical",
  crystal: "Crystal / oscillator",
  other: "Other",
};
export const kindLabel = (k: string | null | undefined) => KIND_LABEL[String(k || "other")] || "Other";

function node(id: string, label: string, manufacturer: string | null, kind: string | null, count: number | null): GraphNode {
  return {
    id,
    label: label || id,
    manufacturer: manufacturerEn(manufacturer),
    identity: kindLabel(kind),
    familyRule: "Part family (package / packing / temperature suffixes removed)",
    variants: [],
    count: count ?? 0,
    projects: [],
  };
}

/**
 * Graph for the UI from the partdata KG snapshot.
 * - focus given: the family's one-hop neighbourhood (same-board co-occurrence).
 * - no focus: the most common IC families, linked where they co-occur with each other.
 */
export async function kgGraph(focus: string, visitor: string): Promise<GraphData> {
  const snap = await pdGet(`${KG}/snapshots/current`, {}, visitor);
  const N = Number(snap.data.designs) || 0;
  const nodes: GraphNode[] = [];
  const index = new Map<string, number>();
  const edges: GraphData["edges"] = [];
  const add = (n: GraphNode) => {
    if (!index.has(n.id)) index.set(n.id, nodes.push(n) - 1);
    return index.get(n.id)!;
  };
  const addEdges = (data: any) => {
    for (const e of data.edges || []) {
      const a = index.get(e.source),
        b = index.get(e.target);
      if (a === undefined || b === undefined || a === b) continue;
      if (edges.some((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))) continue;
      edges.push({
        a,
        b,
        weight: Number(e.support_count) || 0,
        jaccard: Number(e.jaccard) || 0,
        projects: [],
        lift: e.lift ?? null,
        confidence: e.confidence_ab ?? null,
        strong: !!e.strong,
      } as any);
    }
  };
  let matched = "";
  let eligible = 0;
  if (focus) {
    const fam = await resolveFamily(focus, visitor);
    if (fam) {
      matched = fam;
      const nb = await pdGet(`${KG}/neighborhood`, { entity_id: `fam:${fam}`, limit: 24, sort: "score" }, visitor);
      for (const n of nb.data.nodes || []) add(node(n.id, n.label, n.manufacturer, n.kind, n.usage_count));
      addEdges(nb.data);
      eligible = nodes.length;
    }
  }
  if (!nodes.length) {
    const rank = await pdGet(`${KG}/rankings/families`, { kind: "ic", limit: 18 }, visitor);
    for (const f of rank.data.items || []) add(node(f.family, f.label, f.manufacturer, f.kind, f.adoption_count));
    eligible = Number(rank.meta?.pagination?.total) || nodes.length;
    // Co-occurrence among the top families: one neighbourhood per family (cached 10 minutes).
    const hoods = await Promise.allSettled(
      nodes.slice(0, 10).map((n) => pdGet(`${KG}/neighborhood`, { entity_id: `fam:${n.id}`, limit: 60, sort: "n" }, visitor)),
    );
    for (const h of hoods) if (h.status === "fulfilled") addEdges(h.value.data);
  }
  return {
    nodes,
    edges,
    scope: {
      requested: N,
      loaded: N,
      failed: 0,
      projects: N,
      truncated: 0,
      catalogueTotal: N,
      generatedAt: snap.meta?.computed_at || new Date().toISOString(),
      sourceDate: snap.meta?.computed_at || null,
      matchedPart: matched || focus,
      eligibleNodes: eligible,
      snapshotId: snap.data.snapshot_id,
      basis: "Same-board co-occurrence across representative open-source designs",
    } as any,
  };
}

/**
 * MPN or family text → a family key known to the KG.
 * The ranking's `q` filter is a substring match on family keys, and a full MPN
 * (STM32F103C8T6) is longer than its family key (STM32F103). So query by a short stem
 * and pick: a family whose members include the MPN, else the longest key that prefixes it.
 */
export async function resolveFamily(text: string, visitor: string): Promise<string | null> {
  const q = norm(text);
  if (q.length < 3) return null;
  for (const stem of [q, q.slice(0, 5)].filter((v, i, a) => v.length >= 3 && a.indexOf(v) === i)) {
    const r = await pdGet(`${KG}/rankings/families`, { q: stem, limit: 200 }, visitor);
    const items: any[] = r.data.items || [];
    const exact = items.find((f) => f.family === q || (f.members || []).some((m: string) => norm(m) === q));
    if (exact) return exact.family as string;
    const prefix = items
      .filter((f) => q.startsWith(f.family) && f.family.length >= 3)
      .sort((a, b) => b.family.length - a.family.length)[0];
    if (prefix) return prefix.family as string;
  }
  return null;
}

export async function familyInfo(family: string, visitor: string) {
  const f = family.replace(/^fam:/, "");
  if (!/^[A-Z0-9]{2,60}$/.test(f)) throw new PartdataError("Unknown family.", 404, "not_found");
  const [designs, alternatives, functions] = await Promise.allSettled([
    designsBy({ family: f }, 0, visitor, 8),
    pdGet(`${KG}/families/${f}/alternatives`, { limit: 8 }, visitor),
    pdGet(`${KG}/families/${f}/functions`, {}, visitor),
  ]);
  return {
    family: f,
    designs: designs.status === "fulfilled" ? designs.value : { items: [], total: 0 },
    alternatives:
      alternatives.status === "fulfilled"
        ? (alternatives.value.data.items || []).map((a: any) => ({
            family: a.to,
            label: a.label,
            manufacturer: manufacturerEn(a.manufacturer),
            usage: a.usage_count,
            similarity: a.neighbor_similarity,
            sameBoard: a.same_board_designs,
            checks: a.checks || {},
          }))
        : [],
    functions:
      functions.status === "fulfilled"
        ? (functions.value.data.items || []).map((x: any) => ({
            id: x.function_id,
            name: englishText(x.name),
            designs: x.adoption_count,
          }))
        : [],
  };
}

export async function familyRanking(kind: string, q: string, offset: number, visitor: string) {
  const r = await pdGet(
    `${KG}/rankings/families`,
    { kind: kind || undefined, q: q ? norm(q) : undefined, limit: 24, offset },
    visitor,
  );
  return {
    items: (r.data.items || []).map((f: any) => ({
      family: f.family,
      label: f.label,
      manufacturer: manufacturerEn(f.manufacturer),
      kind: kindLabel(f.kind),
      designs: f.adoption_count,
      rate: f.adoption_rate,
      rank: f.rank,
    })),
    total: Number(r.meta?.pagination?.total) || 0,
    denominator: Number(r.meta?.denominator_count) || 0,
  };
}

/* ------------------------------------------------------------------ circuit modules */

export type ModuleNode = { id: string; parent: string | null; name: string; depth: number; minor: boolean; children: ModuleNode[] };

/** partdata's circuit-module category tree, English names (src/lib/partdata/modules.ts). */
export async function moduleTree(visitor?: string): Promise<ModuleNode[]> {
  const r = await pdGet(`${KG}/functions`, {}, visitor);
  const rows: any[] = Array.isArray(r.data) ? r.data : [];
  const nodes = new Map<string, ModuleNode>();
  for (const m of rows)
    nodes.set(m.function_id, {
      id: m.function_id,
      parent: m.parent_id || null,
      name: MODULE_EN[m.function_id] || englishText(m.name) || m.function_id,
      depth: Number(m.depth) || 0,
      minor: !!m.minor,
      children: [],
    });
  const roots: ModuleNode[] = [];
  for (const n of nodes.values()) (n.parent && nodes.get(n.parent) ? nodes.get(n.parent)!.children : roots).push(n);
  return roots;
}

/**
 * Parts for the PCB planner: only those with a footprint the official KiCad library has.
 * Uses the list's footprint when partdata sends it; otherwise reads the top results' details.
 */
export async function plannerParts(q: string, visitor: string) {
  const key = norm(q);
  if (key.length < 3) throw new PartdataError("Enter at least 3 characters of a part number.", 400, "query_too_short");
  const r = await pdGet(`${P}/parts/search`, { q, limit: 20, with_footprint: 1 }, visitor);
  const rows: any[] = r.data.items || [];
  const listed = rows.some((x) => "footprint" in x);
  const parts: Part[] = listed
    ? rows.map(toPart)
    : (await Promise.allSettled(rows.slice(0, 12).map((x) => partDetail(x.id, visitor)))).flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  return parts.filter((p) => p.footprintName && resolveName("footprint", p.footprintName));
}
