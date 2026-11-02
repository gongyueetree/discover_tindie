/**
 * design-core/geometry/index.ts
 * 纯几何计算函数。无 React、无 DOM、无副作用，可独立单元测试。
 */
import type { Point, Rect, Polygon, FootprintGeometry, Rotation } from './types';

export * from './types';

export const MM_PER_PX = 0.25; // 1px = 0.25mm  → 4px/mm
export const PX_PER_MM = 4;

export const mmToPx = (mm: number): number => mm * PX_PER_MM;
export const pxToMm = (px: number): number => px * MM_PER_PX;

/** 两个轴对齐矩形是否重叠（可附加间隙 gap）。 */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

/** 点是否在矩形内。 */
export function pointInRect(p: Point, r: Rect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** 射线法判断点是否在多边形内。 */
export function pointInPolygon(p: Point, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** 多边形外接矩形。 */
export function polygonBounds(poly: Polygon): Rect {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * 给定封装几何 + 位置 + 旋转，返回其 courtyard 的轴对齐外接矩形（mm）。
 * 90°/270° 旋转时宽高互换。
 */
export function footprintCourtyardRect(
  geom: FootprintGeometry,
  pos: Point,
  rotation: Rotation
): Rect {
  const swap = rotation % 180 !== 0;
  const w = swap ? geom.courtyardHeightMm : geom.courtyardWidthMm;
  const h = swap ? geom.courtyardWidthMm : geom.courtyardHeightMm;
  return { x: pos.x - w / 2, y: pos.y - h / 2, width: w, height: h };
}

/** body 外接矩形（用于显示尺寸）。 */
export function footprintBodyRect(
  geom: FootprintGeometry,
  pos: Point,
  rotation: Rotation
): Rect {
  const swap = rotation % 180 !== 0;
  const w = swap ? geom.bodyHeightMm : geom.bodyWidthMm;
  const h = swap ? geom.bodyWidthMm : geom.bodyHeightMm;
  return { x: pos.x - w / 2, y: pos.y - h / 2, width: w, height: h };
}

/** 把一个矩形夹紧到边界矩形内，返回新的左上角坐标。 */
export function clampRectInside(inner: Rect, bounds: Rect, margin = 0): Point {
  return {
    x: Math.max(bounds.x + margin, Math.min(inner.x, bounds.x + bounds.width - margin - inner.width)),
    y: Math.max(bounds.y + margin, Math.min(inner.y, bounds.y + bounds.height - margin - inner.height)),
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

