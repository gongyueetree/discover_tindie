/**
 * design-core/geometry/types.ts
 * 几何基础类型 —— 全部以毫米(mm)为单位，与显示像素解耦。
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Polygon = Point[];

export type BoardSide = 'TOP' | 'BOTTOM';

/** 旋转角，单位度。仅允许 rotationStep 的整数倍由上层约束。 */
export type Rotation = number;

/**
 * 封装几何模型。
 * body  = 元件本体（用于显示）
 * courtyard = 禁布外框（用于碰撞，比 body 略大）
 */
export interface FootprintGeometry {
  footprintId: string;
  bodyWidthMm: number;
  bodyHeightMm: number;
  courtyardWidthMm: number;
  courtyardHeightMm: number;
  assemblyHeightMm?: number;
  padCount: number;
  rotationStep: number; // 允许的最小旋转步进，如 90
  anchor: Point; // 旋转锚点（本体局部坐标，默认中心）
}

