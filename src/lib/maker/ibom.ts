import type {
  CanonicalIrBundle,
  PcbIr,
  IrPoint,
} from "@/vendor/canon/lib/eda/types";
import { arcPoints } from "@/vendor/canon/lib/eda/view-geometry";
const xy = (p: IrPoint | undefined): [number, number] => [
  Number(p?.x) || 0,
  Number(p?.y) || 0,
];
const side = (s: string) => (s === "back" ? "B" : "F");
export function ibomData(bundle: CanonicalIrBundle, pcb: PcbIr) {
  const netNames = new Map(bundle.nets.map((n) => [n.id, n.canonicalName]));
  const net = (id?: string) => (id ? netNames.get(id) || id : "");
  const lines = (
    kind: string,
    g: Record<string, unknown>,
    transform = (p: [number, number]) => p,
  ): any[] => {
    if (!g.start && !g.center) return [];
    const start = xy((g.start || g.center) as IrPoint),
      end = xy(g.end as IrPoint);
    let pts: [number, number][] = [start, end];
    if (kind === "rectangle")
      pts = [start, [end[0], start[1]], end, [start[0], end[1]], start];
    if (kind === "circle") {
      const c = xy((g.center || g.start) as IrPoint),
        r = Math.hypot(end[0] - c[0], end[1] - c[1]);
      pts = Array.from({ length: 65 }, (_, i) => [
        c[0] + r * Math.cos((i * Math.PI) / 32),
        c[1] + r * Math.sin((i * Math.PI) / 32),
      ]);
    }
    if (kind === "arc" && g.mid) {
      const m = xy(g.mid as IrPoint);
      pts = arcPoints(
        { x: start[0], y: start[1] },
        { x: m[0], y: m[1] },
        { x: end[0], y: end[1] },
      ).map((p) => [p.x, p.y]);
    }
    return pts.slice(1).map((p, i) => ({
      type: "segment",
      start: transform(pts[i]),
      end: transform(p),
      width: Number(g.width) || 0.15,
    }));
  };
  const drawings: any = {
    silkscreen: { F: [], B: [] },
    fabrication: { F: [], B: [] },
  };
  const fields: Record<number, string[]> = {},
    skipped: number[] = [],
    groups = new Map<string, [string, number][]>();
  const footprints = pcb.footprints.map((fp, i) => {
    // Prefer explicit footprint links. Reference-only fallback must be unique across sheets.
    const linked = bundle.parts.filter((p) => p.footprintInstanceId === fp.id);
    const refs = bundle.parts.filter((p) => p.reference === fp.reference);
    const part = linked[0] || (refs.length === 1 ? refs[0] : undefined);
    fields[i] = [
      part?.value || fp.value,
      fp.libraryIdentifier,
      part?.manufacturerRaw || "",
      part?.mpnRaw || "",
      part?.variantStatus || "unknown",
    ];
    if (
      part?.variantStatus === "dnp" ||
      part?.variantStatus === "variant_excluded"
    )
      skipped.push(i);
    else {
      const k = JSON.stringify(fields[i]);
      const a = groups.get(k) || [];
      a.push([fp.reference, i]);
      groups.set(k, a);
    }
    const pads = pcb.pads
      .filter((p) => p.footprintId === fp.id && p.position)
      .map((p) => ({
        pos: xy(p.position),
        size: [Number(p.size?.x) || 1, Number(p.size?.y) || 1],
        angle: Number(p.rotation) || 0,
        shape: ["rect", "circle", "oval", "roundrect"].includes(p.shape)
          ? p.shape
          : "rect",
        radius: Math.min(Number(p.size?.x) || 1, Number(p.size?.y) || 1) * 0.2,
        type: p.drill ? "th" : "smd",
        drillshape: p.drill?.x === p.drill?.y ? "circle" : "oblong",
        drillsize: [Number(p.drill?.x) || 0, Number(p.drill?.y) || 0],
        layers:
          p.drill || p.layers.includes("*.Cu")
            ? ["F", "B"]
            : p.layers.includes("B.Cu")
              ? ["B"]
              : ["F"],
        net: p.netName || net(p.netId),
        pin1: p.number === "1",
      }));
    const pos = xy(fp.position),
      r = (-(Number(fp.rotation) || 0) * Math.PI) / 180;
    for (const g of fp.graphics || []) {
      const layer = /^B\./.test(g.layer) ? "B" : "F";
      const category = /SilkS/.test(g.layer)
        ? "silkscreen"
        : /Fab/.test(g.layer)
          ? "fabrication"
          : null;
      if (category)
        drawings[category][layer].push(
          ...lines(g.kind, g.geometry, (p) => [
            pos[0] + p[0] * Math.cos(r) - p[1] * Math.sin(r),
            pos[1] + p[0] * Math.sin(r) + p[1] * Math.cos(r),
          ]),
        );
    }
    const bounds = pads.length
      ? pads.flatMap((p) => [
          [
            p.pos[0] - Math.hypot(...p.size) / 2,
            p.pos[1] - Math.hypot(...p.size) / 2,
          ],
          [
            p.pos[0] + Math.hypot(...p.size) / 2,
            p.pos[1] + Math.hypot(...p.size) / 2,
          ],
        ])
      : [
          [pos[0] - 1, pos[1] - 1],
          [pos[0] + 1, pos[1] + 1],
        ];
    const min = [
        Math.min(...bounds.map((p) => p[0])),
        Math.min(...bounds.map((p) => p[1])),
      ],
      max = [
        Math.max(...bounds.map((p) => p[0])),
        Math.max(...bounds.map((p) => p[1])),
      ];
    return {
      ref: fp.reference,
      layer: side(fp.side),
      center: pos,
      bbox: {
        pos: [0, 0],
        relpos: min,
        size: [max[0] - min[0], max[1] - min[1]],
        angle: 0,
      },
      pads,
      drawings: [],
    };
  });
  const edges = pcb.boardOutline.flatMap((g) => lines(g.kind, g.geometry));
  const pts = edges.flatMap((e) => [e.start, e.end]);
  if (!pts.length)
    footprints.forEach((f) => {
      pts.push(f.bbox.relpos, [
        f.bbox.relpos[0] + f.bbox.size[0],
        f.bbox.relpos[1] + f.bbox.size[1],
      ]);
    });
  if (!pts.length) pts.push([0, 0], [10, 10]);
  const tracks: { F: any[]; B: any[] } = { F: [], B: [] };
  for (const t of pcb.tracks) {
    if (!t.start || !t.end || !["F.Cu", "B.Cu"].includes(t.layer || ""))
      continue;
    const l = t.layer === "B.Cu" ? "B" : "F";
    tracks[l].push(
      ...lines(t.kind === "segment" ? "line" : t.kind, {
        start: t.start,
        end: t.end,
        mid: t.mid,
        width: t.width,
      }).map((d) => ({ ...d, net: net(t.netId) })),
    );
  }
  for (const v of pcb.vias) {
    if (!v.position) continue;
    for (const l of ["F", "B"] as const)
      if (v.layers.includes(l + ".Cu") || v.layers.includes("*.Cu"))
        tracks[l].push({
          start: xy(v.position),
          end: xy(v.position),
          width: Number(v.size) || 0.8,
          drillsize: Number(v.drill) || 0.3,
          net: net(v.netId),
        });
  }
  // Standalone mounting holes are not BOM components, but remain visible on both sides.
  for (const p of pcb.pads.filter(
    (p) => !p.footprintId && p.position && p.drill,
  )) {
    for (const l of ["F", "B"] as const)
      tracks[l].push({
        start: xy(p.position),
        end: xy(p.position),
        width: Math.max(Number(p.drill?.x) || 0, Number(p.drill?.y) || 0),
        drillsize: Math.max(Number(p.drill?.x) || 0, Number(p.drill?.y) || 0),
        net: "",
      });
  }
  const both = [...groups.values()]
    .map((a) =>
      a.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true })),
    )
    .sort((a, b) =>
      a[0][0].localeCompare(b[0][0], undefined, { numeric: true }),
    );
  return {
    ibom_version: "v2.12.0",
    metadata: {
      title: bundle.project.name + " · " + pcb.name,
      revision: "",
      company: "Tindie Maker Tools",
      date: "",
    },
    edges_bbox: {
      minx: Math.min(...pts.map((p) => p[0])) - 0.5,
      miny: Math.min(...pts.map((p) => p[1])) - 0.5,
      maxx: Math.max(...pts.map((p) => p[0])) + 0.5,
      maxy: Math.max(...pts.map((p) => p[1])) + 0.5,
    },
    edges,
    footprints,
    drawings,
    tracks,
    zones: { F: [], B: [] },
    font_data: {},
    nets: [
      ...new Set([
        ...footprints.flatMap((f) => f.pads.map((p) => p.net)),
        ...tracks.F.map((t) => t.net),
        ...tracks.B.map((t) => t.net),
      ]),
    ].sort(),
    bom: {
      fields,
      skipped,
      both,
      F: both
        .map((a) => a.filter((x) => footprints[x[1]].layer === "F"))
        .filter((a) => a.length),
      B: both
        .map((a) => a.filter((x) => footprints[x[1]].layer === "B"))
        .filter((a) => a.length),
    },
  };
}
export const ibomConfig = {
  dark_mode: false,
  show_pads: true,
  show_fabrication: false,
  show_silkscreen: true,
  highlight_pin1: "selected",
  redraw_on_drag: true,
  board_rotation: 0,
  checkboxes: "Sourced,Placed",
  mark_when_checked: "Placed",
  bom_view: "left-right",
  layer_view: "FB",
  offset_back_rotation: false,
  kicad_text_formatting: false,
  custom_metadata: [],
  fields: ["Value", "Footprint", "Manufacturer", "MPN", "Assembly"],
};
export const scriptJson = (data: unknown) =>
  JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
