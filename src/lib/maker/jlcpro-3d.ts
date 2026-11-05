/**
 * A JLCEDA / EasyEDA Pro board for the 3D scene (BoardScene): its copper layers under the KiCad names
 * the scene draws pads on, and a body envelope for each placed part — its footprint's Component Shape
 * outline (jlcpro-pcb.ts keeps it in the footprint's own frame) raised to the height its 3D model's
 * name gives (…-H0.6…), typical heights otherwise. The models themselves are EasyEDA library ids
 * (not in the project), so the envelopes stand in for them. Tindie addition.
 */
import type { BodyEnvelope } from "@/vendor/canon/components/BoardScene";
import type { PcbIr } from "@/vendor/canon/lib/eda/types";
import { bodyHeight } from "./easyeda-3d";

export const isJlcProBoard = (pcb: PcbIr) => /JLCEDA Pro/.test(String(pcb.coordinateSystem?.sourceUnits ?? ""));

const COPPER: Record<string, string> = { "Top Layer": "F.Cu", "Bottom Layer": "B.Cu", "Multi-Layer": "*.Cu" };

/** The board with its pads on F.Cu / B.Cu / *.Cu, as the 3D scene reads them. */
export function jlcProPcb3d(pcb: PcbIr): PcbIr {
  return { ...pcb, pads: pcb.pads.map((pad) => ({ ...pad, layers: pad.layers.map((layer) => COPPER[layer] ?? layer) })) };
}

/** One body envelope per footprint with a Component Shape outline. */
export function jlcProBodies(pcb: PcbIr): BodyEnvelope[] {
  const bodies: BodyEnvelope[] = [];
  for (const footprint of pcb.footprints) {
    const outline = (footprint.graphics ?? []).filter((g) => g.layer === "Component Shape Layer");
    const position = footprint.position;
    if (!outline.length || !position) continue;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const g of outline)
      for (const key of ["start", "mid", "end", "center"]) {
        const p = g.geometry[key] as { x: string; y: string } | undefined;
        if (!p) continue;
        const [x, y] = [Number(p.x), Number(p.y)];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    if (!(x1 - x0 > 0.05 && y1 - y0 > 0.05)) continue;
    // The outline's centre, from the footprint's frame (as the 2D view turns it) to the board's.
    const angle = (Number(footprint.rotation) || 0) * (Math.PI / 180);
    const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const title = footprint.fields?.["3D Model Title"] || footprint.libraryIdentifier || "";
    bodies.push({
      reference: footprint.reference,
      x: Number(position.x) + cx * Math.cos(angle) + cy * Math.sin(angle),
      y: Number(position.y) - cx * Math.sin(angle) + cy * Math.cos(angle),
      w: x1 - x0,
      h: y1 - y0,
      height: bodyHeight(title),
      rotation: -(Number(footprint.rotation) || 0),
      bottom: footprint.side === "back",
    });
  }
  return bodies;
}
