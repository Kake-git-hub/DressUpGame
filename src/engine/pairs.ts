/**
 * 一緒に動かす 2 枚（髪の前と、対のうしろがみ）
 *
 * メニューでは 1 点。着ているあいだは別々の 2 枚で、重なりの順番は 1 枚ずつ変えられるが、
 * 位置・大きさ・向き・色は、どちらを調整しても両方にかかる。
 */
import { drawOrder } from './layers';
import type { EquippedItem } from '../types';

type Paired = { id: string; backItemId?: string; frontItemId?: string };

// 一緒に変える調整値（重なりの順番は入れない）
export const SYNCED_KEYS = ['adjustOffsetX', 'adjustOffsetY', 'adjustScale', 'adjustRotation', 'colorHue'] as const;

// 着ている服の中の、対の相手。いなければ null（対でないうしろがみを着ているときも null）
export function partnerOf<T extends Paired>(items: readonly T[], id: string): T | null {
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  if (item.backItemId) return items.find((i) => i.id === item.backItemId) ?? null;
  if (item.frontItemId) return items.find((i) => i.id === item.frontItemId && i.backItemId === item.id) ?? null;
  return null;
}

// 相手の調整値を、もとになる 1 枚（前髪）にそろえる
export function syncPairs<T extends Paired & Partial<Record<(typeof SYNCED_KEYS)[number], number>>>(items: T[]): T[] {
  return items.map((item) => {
    if (!item.frontItemId) return item;
    const front = items.find((i) => i.id === item.frontItemId && i.backItemId === item.id);
    if (!front) return item;
    const synced = { ...item };
    for (const key of SYNCED_KEYS) {
      if (front[key] === undefined) delete synced[key];
      else synced[key] = front[key];
    }
    return synced;
  });
}

// 調整画面が、キャンバスの代わりに重ねて描く範囲のいちばん下の服: 調整中の服と、対の相手のうち、重なりが下のほう。
// これより手前のもの（服・ドール）は、調整中の見た目（位置・色）をその場で見せるために、調整画面が描く
export function adjustBaseId(items: EquippedItem[], adjustingId: string): string {
  const partner = partnerOf(items, adjustingId);
  if (!partner) return adjustingId;
  const order = drawOrder(items);
  const at = (id: string) => order.findIndex((s) => s.kind === 'item' && s.item.id === id);
  return at(partner.id) < at(adjustingId) ? partner.id : adjustingId;
}
