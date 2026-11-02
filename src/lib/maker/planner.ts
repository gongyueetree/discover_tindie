import { nanoid } from "nanoid";
import type { PlacedComponent } from "@/vendor/protopcb/design-core/document/types";
import { padFootprintFor } from "@/vendor/protopcb/design-core/geometry/footprint-pads";
export function makeComponent(
  name: string,
  reference: string,
  x: number,
  y: number,
): PlacedComponent {
  const p = padFootprintFor(name);
  const w = p?.bodyW || 5,
    h = p?.bodyH || 5;
  return {
    instanceId: nanoid(),
    componentId: name,
    mpn: "",
    reference,
    category:
      reference.startsWith("R") || reference.startsWith("C") ? "passive" : "ic",
    manufacturer: "",
    footprint: {
      footprintId: name,
      name,
      geometry: {
        footprintId: name,
        bodyWidthMm: w,
        bodyHeightMm: h,
        courtyardWidthMm:
          Math.max(w, ...(p?.pads.map((p) => Math.abs(p.x) * 2 + p.w) || [])) +
          1,
        courtyardHeightMm:
          Math.max(h, ...(p?.pads.map((p) => Math.abs(p.y) * 2 + p.h) || [])) +
          1,
        padCount: p?.pads.length || 0,
        rotationStep: 90,
        anchor: { x: 0, y: 0 },
      },
    },
    placement: { xMm: x, yMm: y, rotation: 0, side: "TOP", locked: false },
    quantity: 1,
    source: "CUSTOM",
    trust: {
      level: "CANDIDATE",
      evidence:
        "Generic package geometry. Verify the exact manufacturer footprint before fabrication.",
    },
  };
}
