/** Vendored from eelib-web/lib/protopcb/outline.ts (EELIB). */
export type XY = [number, number];

/**
 * A board's outline as the core writes it to Edge.Cuts
 * (eelib-bff/src/vendor/protopcb/.../pcbExport.ts), in the board's frame:
 * millimetres from the top-left corner, y down. Arcs become short segments.
 */
export const BOARD_SHAPES = ["rect", "rounded", "circle", "lshape"] as const;
export type BoardShape = (typeof BOARD_SHAPES)[number];
type Outlined = { widthMm: number; heightMm: number; shape?: BoardShape; cornerRadiusMm?: number };

const ARC_STEPS = 8;
const CIRCLE_STEPS = 72;

/** The L's cut corner (bottom right), as the core clamps it. */
export function lshapeCut(widthMm: number, heightMm: number) {
  return { cutW: Math.min(widthMm * 0.9, Math.max(5, widthMm * 0.45)), cutH: Math.min(heightMm * 0.9, Math.max(5, heightMm * 0.4)) };
}

export function boardOutline({ widthMm: w, heightMm: h, shape = "rect", cornerRadiusMm }: Outlined): XY[] {
  if (shape === "circle") {
    const r = Math.min(w, h) / 2;
    return Array.from({ length: CIRCLE_STEPS }, (_, i) => [w / 2 + r * Math.cos((i / CIRCLE_STEPS) * Math.PI * 2), h / 2 + r * Math.sin((i / CIRCLE_STEPS) * Math.PI * 2)] as XY);
  }
  if (shape === "lshape") {
    const { cutW, cutH } = lshapeCut(w, h);
    return [
      [0, 0],
      [w, 0],
      [w, h - cutH],
      [w - cutW, h - cutH],
      [w - cutW, h],
      [0, h],
    ];
  }
  if (shape === "rounded") {
    // As set (all four alike), or 8% of the shorter side; at most half of it. A square corner is a rectangle's.
    const r = Math.min(Math.min(w, h) / 2, Math.max(0, cornerRadiusMm ?? Math.min(w, h) * 0.08));
    if (r <= 0) return [[0, 0], [w, 0], [w, h], [0, h]];
    const corner = (cx: number, cy: number, from: number): XY[] =>
      Array.from({ length: ARC_STEPS + 1 }, (_, i) => {
        const a = ((from + (i / ARC_STEPS) * 90) * Math.PI) / 180;
        return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as XY;
      });
    return [...corner(w - r, r, 270), ...corner(w - r, h - r, 0), ...corner(r, h - r, 90), ...corner(r, r, 180)];
  }
  return [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ];
}

/** The outline as an SVG path. */
export const outlinePath = (board: Outlined) => `${boardOutline(board).map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ")} Z`;
