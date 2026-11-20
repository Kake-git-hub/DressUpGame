/**
 * 服が隠すドールの部分（手袋・くつの下からはみ出す指先など）
 */
import type { Box, EquippedItem } from '../types';
import { defaultLimbs } from '../pipeline/limbZones';
import { effectiveLayer, isBehindDoll } from './layers';

export interface Hide {
  url: string;
  box: Box;
}

// 着せた位置のまま（動かしていない・大きさや傾きを変えていない・調整中でない）か
const inPlace = (item: EquippedItem, adjustingItemId: string | null): boolean =>
  item.id !== adjustingItemId && !(item.adjustOffsetX ?? 0) && !(item.adjustOffsetY ?? 0) && (item.adjustScale ?? 1) === 1 && !(item.adjustRotation ?? 0);

// 着ている服のうち、ドールの一部を隠すもの。
// 動かした・大きさや傾きを変えた服と、調整中の服は隠さない（隠した所が服からずれてしまうため）。
// ドールの後ろに回した服も隠さない（ドールのほうが手前に見える）
export function activeHides(items: EquippedItem[], adjustingItemId: string | null): Hide[] {
  return items.filter((item) => !!item.hide && !isBehindDoll(item) && inPlace(item, adjustingItemId)).map((item) => item.hide!);
}

// 同じ手足の服か（くつと靴下、手袋どうし）。カテゴリ名で見る
const sameLimb = (a: EquippedItem, b: EquippedItem): boolean => {
  const limbs = defaultLimbs(b.type);
  return defaultLimbs(a.type).some((limb) => limbs.includes(limb));
};

/**
 * 隠す所を、ドールと、ほかの服に分けて返す。
 *  doll: ドールから消す所（activeHides と同じ）
 *  items: 服の ID → その服から消す所。隠す所を持つ服より重なりが下で、ドールより前にあり、同じ手足の服（くつの下の靴下など）。
 *         ドレスやスカートからは消さない（隠す所は手首・足首から先の四角なので、すそや身ごろが四角くえぐれる）。
 *         箱は、その服のキャンバス上の位置に直してある（服のキャンバスは、ドールのキャンバスのまわりに余白を足したもの）。
 *         動かした・調整中の服からは消さない（消す形が服とずれるため）
 */
export function hidesFor(items: EquippedItem[], adjustingItemId: string | null, dollCanvas: { w: number; h: number }): { doll: Hide[]; items: Map<string, Hide[]> } {
  const hiders = items.filter((item) => !!item.hide && !isBehindDoll(item) && inPlace(item, adjustingItemId));
  const clipped = new Map<string, Hide[]>();
  for (const target of items) {
    if (isBehindDoll(target) || !inPlace(target, adjustingItemId)) continue;
    const dx = (target.canvasW - dollCanvas.w) / 2;
    const dy = (target.canvasH - dollCanvas.h) / 2;
    const masks = hiders
      .filter((hider) => hider.id !== target.id && effectiveLayer(target) < effectiveLayer(hider) && sameLimb(target, hider))
      .map((hider) => ({ url: hider.hide!.url, box: { ...hider.hide!.box, x: hider.hide!.box.x + dx, y: hider.hide!.box.y + dy } }));
    if (masks.length > 0) clipped.set(target.id, masks);
  }
  return { doll: hiders.map((item) => item.hide!), items: clipped };
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
