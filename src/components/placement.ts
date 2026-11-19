/**
 * 服を、Pixi のキャンバスに描かれるのと同じ位置に重ねるための計算（PixiEngine と同じ計算）
 */
import type { DollTransform, EquippedItem } from '../types';

// キャンバスと画面の対応（PixiEngine と同じ計算に使う値）
export interface CanvasGeometry {
  left: number; // キャンバスの画面上の位置（CSS px）
  top: number;
  scaleX: number; // Pixi の論理座標 → CSS px
  scaleY: number;
  bgCenterX: number; // 背景領域の中心（論理座標）
  bgCenterY: number;
  bgSize: number;
  unit: number; // 元キャンバスの 1px が画面上で何 CSS px になるか
}

// キャンバスの実際の位置（rect）と論理サイズから、対応を求める
export function canvasGeometry(
  rect: { left: number; top: number; width: number; height: number },
  canvasWidth: number,
  canvasHeight: number,
  menuOffset: number,
  rightOffset: number,
): CanvasGeometry {
  const availableWidth = Math.max(0, canvasWidth - menuOffset - rightOffset);
  return {
    left: rect.left,
    top: rect.top,
    scaleX: canvasWidth > 0 ? rect.width / canvasWidth : 1,
    scaleY: canvasHeight > 0 ? rect.height / canvasHeight : 1,
    bgCenterX: menuOffset + availableWidth / 2,
    bgCenterY: canvasHeight / 2,
    bgSize: canvasHeight, // 背景は 1:1 正方形で画面縦幅いっぱい
    unit: (rect.height * 0.9) / 1024, // PixiEngine: 表示高さ × 0.9 ÷ 1024
  };
}

// 服の見た目を決める調整値
export interface ItemLook {
  offsetX: number;
  offsetY: number;
  scale: number;
  rotation: number;
  hue: number;
}

export const lookOf = (item: EquippedItem): ItemLook => ({
  offsetX: item.adjustOffsetX ?? 0,
  offsetY: item.adjustOffsetY ?? 0,
  scale: item.adjustScale ?? 1,
  rotation: item.adjustRotation ?? 0,
  hue: item.colorHue ?? 0,
});

// 服の原点（元キャンバスの中心）の画面上の位置
export function itemOrigin(item: EquippedItem, look: ItemLook, g: CanvasGeometry, dollTransform: DollTransform) {
  let x: number;
  let y: number;
  if (item.movable && ((item.offsetX ?? 0) !== 0 || (item.offsetY ?? 0) !== 0)) {
    x = g.bgCenterX + ((item.offsetX ?? 0) / 100) * g.bgSize;
    y = g.bgCenterY + ((item.offsetY ?? 0) / 100) * g.bgSize;
  } else {
    x = g.bgCenterX + ((dollTransform.x - 50) / 100) * g.bgSize;
    y = g.bgCenterY + ((dollTransform.y - 50) / 100) * g.bgSize;
  }
  return { x: g.left + (x + look.offsetX) * g.scaleX, y: g.top + (y + look.offsetY) * g.scaleY };
}
