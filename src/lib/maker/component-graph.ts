import { partFamily } from "./part-family";
export interface GraphDesign {
  id: string;
  projectId?: string;
  projectName: string;
  withdrawn?: boolean;
  bom?: {
    truncated?: boolean;
    items?: {
      mpn?: string | null;
      value?: string | null;
      manufacturer?: string | null;
      keyKind?: string;
      footprint?: string | null;
      package?: string | null;
      dnp?: boolean | string | null;
    }[];
  };
}
export interface GraphVariant {
  mpn: string;
  manufacturer: string;
  identity: string;
  footprints: string[];
  packages: string[];
  projects: { id: string; name: string }[];
}
export interface GraphNode {
  id: string;
  label: string;
  manufacturer: string;
  identity: string;
  familyRule: string;
  variants: GraphVariant[];
  count: number;
  projects: { id: string; name: string }[];
}
export type GraphEdgeType = "co_occurrence" | "alternative" | "series";
export interface GraphEdge {
  a: number;
  b: number;
  weight: number;
  jaccard: number;
  projects: { id: string; name: string }[];
  /** co_occurrence (same board), alternative (knowledge-graph candidate), series (same vendor and series). Default co_occurrence. */
  type?: GraphEdgeType;
  /** Alternatives: neighbour similarity 0–1 and the knowledge graph's check results. */
  similarity?: number | null;
  checks?: Record<string, string>;
  lift?: number | null;
  strong?: boolean;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  scope: {
    requested: number;
    loaded: number;
    failed: number;
    projects: number;
    truncated: number;
    catalogueTotal: number;
    generatedAt: string;
    sourceDate: string | null;
    matchedPart: string;
    eligibleNodes: number;
    /** Set for a circuit-module graph: the module's most used families (designs using each). */
    module?: {
      id: string;
      designs: number;
      items: { family: string; label: string; manufacturer: string; count: number }[];
    } | null;
  };
}
export function buildComponentGraph(designs: GraphDesign[], focus = "") {
  const projectParts = new Map<string, Set<string>>();
  const projectInfo = new Map<string, { id: string; name: string }>();
  const nodes = new Map<string, GraphNode>();
  const variantProjects = new Map<string, Set<string>>();
  for (const d of designs) {
    if (d.withdrawn) continue;
    const project = d.projectId || d.id;
    if (!projectParts.has(project)) projectParts.set(project, new Set());
    for (const row of d.bom?.items || []) {
      if (row.dnp === true || /^(true|yes|1|dnp)$/i.test(String(row.dnp || "")))
        continue;
      const mpn = row.mpn?.trim();
      const label = mpn || (row.keyKind === "exact" ? row.value?.trim() : "");
      if (
        !label ||
        label.length > 120 ||
        /^(unknown|n\/a|none|\?|-)$/i.test(label)
      )
        continue;
      // Preserve punctuation and manufacturer; never merge probable aliases.
      // Some upstream BOMs put passive values in the MPN field. Do not
      // present those values as identified component models.
      const normalized = label.replace(/\s+/g, "");
      if (
        /^(?:[0-9]+(?:\.[0-9]+)?(?:[rkm][0-9]*)?|[0-9]+(?:\.[0-9]+)?(?:[pnuµμ]f?|[mnuµμ]h|ohms?|[km]ohms?|v|w|hz|[ΩΩ]))$/i.test(
          normalized,
        ) ||
        /^(R|C|L|LED|DIODE|SW_PUSH|CONN.*|MOUNTINGHOLE.*|TESTPOINT.*)$/i.test(
          normalized,
        )
      )
        continue;
      const manufacturer = (row.manufacturer || "").trim();
      const family = partFamily(label, manufacturer);
      const id = family.family + "|" + family.manufacturer.toUpperCase();
      if (!nodes.has(id))
        nodes.set(id, {
          id,
          label: family.family,
          manufacturer: family.manufacturer,
          familyRule: family.rule,
          variants: [],
          identity: mpn ? "BOM MPN" : "BOM value · MPN unverified",
          count: 0,
          projects: [],
        });
      const node = nodes.get(id)!;
      const variantId = id + "|" + label.toUpperCase();
      let variant = node.variants.find(
        (v) => v.mpn.toUpperCase() === label.toUpperCase(),
      );
      if (!variant) {
        variant = {
          mpn: label,
          manufacturer: family.manufacturer,
          identity: mpn ? "BOM MPN" : "BOM value · MPN unverified",
          footprints: [],
          packages: [],
          projects: [],
        };
        node.variants.push(variant);
        variantProjects.set(variantId, new Set());
      }
      if (!variantProjects.get(variantId)!.has(project)) {
        variant.projects.push({ id: d.id, name: d.projectName });
        variantProjects.get(variantId)!.add(project);
      }
      if (row.footprint && !variant.footprints.includes(row.footprint))
        variant.footprints.push(row.footprint);
      if (row.package && !variant.packages.includes(row.package))
        variant.packages.push(row.package);
      if (mpn) node.identity = "BOM MPN";
      if (!projectParts.get(project)!.has(id)) {
        node.count++;
        node.projects.push({ id: d.id, name: d.projectName });
        projectParts.get(project)!.add(id);
      }
      projectInfo.set(project, { id: d.id, name: d.projectName });
    }
  }
  const ranked = [...nodes.values()].sort(
    (a, b) => b.count - a.count || a.id.localeCompare(b.id),
  );
  const focused = ranked.find(
    (n) =>
      n.label.toUpperCase() === partFamily(focus).family ||
      n.variants.some(
        (v) => v.mpn.toUpperCase() === focus.trim().toUpperCase(),
      ),
  );
  if (focused) {
    ranked.splice(ranked.indexOf(focused), 1);
    ranked.unshift(focused);
  }
  const visible = ranked.slice(0, 24);
  const edges: GraphEdge[] = [];
  for (let a = 0; a < visible.length; a++)
    for (let b = a + 1; b < visible.length; b++) {
      const projects = [...projectParts]
        .filter(([, set]) => set.has(visible[a].id) && set.has(visible[b].id))
        .map(([id]) => projectInfo.get(id)!);
      if (projects.length)
        edges.push({
          a,
          b,
          weight: projects.length,
          jaccard:
            projects.length /
            (visible[a].count + visible[b].count - projects.length),
          projects,
        });
    }
  return {
    nodes: visible,
    edges,
    projects: projectParts.size,
    eligibleNodes: ranked.length,
  };
}
