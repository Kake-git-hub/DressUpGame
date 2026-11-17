/**
 * 服が隠すドールの部分（手袋・くつの下からはみ出す指先など）
 */
import type { Box, EquippedItem } from '../types';

export interface Hide {
  url: string;
  box: Box;
}

// 着ている服のうち、ドールの一部を隠すもの。
// 動かした・大きさや傾きを変えた服と、調整中の服は隠さない（隠した所が服からずれてしまうため）
export function activeHides(items: EquippedItem[], adjustingItemId: string | null): Hide[] {
  return items
    .filter(
      (item) =>
        !!item.hide &&
        item.id !== adjustingItemId &&
        !(item.adjustOffsetX ?? 0) &&
        !(item.adjustOffsetY ?? 0) &&
        (item.adjustScale ?? 1) === 1 &&
        !(item.adjustRotation ?? 0),
    )
    .map((item) => item.hide!);
}

/**
 * ドールの画像から、隠す所を消した画像（canvas）を作る。
 *  doll: ドールの画像（box の大きさ）、dollBox: ドールのキャンバス上の位置
 *  masks: 隠す所の画像と、そのキャンバス上の位置
 */
export function eraseHides(
  doll: CanvasImageSource & { width: number; height: number },
  dollBox: Box,
  masks: { image: CanvasImageSource; box: Box }[],
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = doll.width;
  canvas.height = doll.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(doll, 0, 0, doll.width, doll.height);
  ctx.globalCompositeOperation = 'destination-out';
  // 配信画像の大きさが box と違うときに備えて、テクスチャの縮尺に換算する
  const sx = doll.width / dollBox.w;
  const sy = doll.height / dollBox.h;
  for (const m of masks) {
    ctx.drawImage(m.image, (m.box.x - dollBox.x) * sx, (m.box.y - dollBox.y) * sy, m.box.w * sx, m.box.h * sy);
  }
  ctx.globalCompositeOperation = 'source-over';
  return canvas;
}
