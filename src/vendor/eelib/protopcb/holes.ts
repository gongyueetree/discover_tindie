/** Vendored from eelib-web/lib/protopcb/holes.ts (EELIB). */
import type { BoardShape } from "./outline";

/**
 * Mounting holes and corners as the API fits them to a board
 * (eelib-bff/src/protopcb/core-api.ts): the page draws them as they are
 * dragged, before the change is saved. The saved board is the API's.
 */
export const HOLE_MARGIN_MM = 4;
export const HOLE_DIAMETER_MM = 3.2;
export const HOLE_DIAMETER_RANGE = { min: 1, max: 8 } as const;
const HOLE_RIM_MM = 0.5;

export type ShapeSettings = { holeMarginMm?: number; holeDiameterMm?: number; cornerRadiusMm?: number };
type Sized = { widthMm: number; heightMm: number; shape?: BoardShape } & ShapeSettings;

const round = (value: number) => Math.round(value * 1000) / 1000;

/** A rounded board's corner radius: as set or 8% of the shorter side, at most half of it. */
export function cornerRadiusOf(board: Sized): number {
  const half = Math.min(board.widthMm, board.heightMm) / 2;
  return round(Math.min(half, Math.max(0, board.cornerRadiusMm ?? half * 0.16)));
}

/** The corner holes' margin and diameter as they fit the board. */
export function holeSettingsOf(board: Sized): { marginMm: number; diameterMm: number } {
  const diameterMm = round(Math.min(HOLE_DIAMETER_RANGE.max, Math.max(HOLE_DIAMETER_RANGE.min, board.holeDiameterMm ?? HOLE_DIAMETER_MM)));
  const clear = diameterMm / 2 + HOLE_RIM_MM;
  let least = clear;
  if (board.shape === "rounded") {
    const r = cornerRadiusOf(board);
    if (r > clear) least = Math.max(least, r - (r - clear) / Math.SQRT2);
  }
  const most = Math.max(least, (Math.min(board.widthMm, board.heightMm) - diameterMm - 1) / 2);
  return { marginMm: round(Math.min(most, Math.max(least, board.holeMarginMm ?? HOLE_MARGIN_MM))), diameterMm };
}

/** The four corner holes — top left, top right, bottom left, bottom right — or none on a circle. */
export function cornerHoles(board: Sized): { xMm: number; yMm: number; diameterMm: number }[] {
  if (board.shape === "circle") return [];
  const { marginMm: m, diameterMm } = holeSettingsOf(board);
  const W = board.widthMm;
  const H = board.heightMm;
  const lastY = board.shape === "lshape" ? H - H * 0.42 - m : H - m;
  return [
    { xMm: m, yMm: m, diameterMm },
    { xMm: W - m, yMm: m, diameterMm },
    { xMm: m, yMm: H - m, diameterMm },
    { xMm: W - m, yMm: lastY, diameterMm },
  ];
}

/** Which way is into the board from each corner hole, in cornerHoles' order. */
export const HOLE_INWARD: readonly (readonly [number, number])[] = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
