/**
 * 重なりの順番（ドールも 1 枚として数える）
 *
 * 服の重なりの値は「カテゴリの番号 + 前後の調整」。ドールは DOLL_LAYER にいて、
 * それより小さい服は、ドールの後ろに描く（はね・マントなど）。
 */
import type { EquippedItem } from '../types';

export const DOLL_LAYER = 0;

type Layered = Pick<EquippedItem, 'layerOrder' | 'baseZIndex' | 'layerAdjust'>;

export const baseLayer = (item: Layered): number => item.layerOrder ?? item.baseZIndex ?? 0;
export const effectiveLayer = (item: Layered): number => baseLayer(item) + (item.layerAdjust ?? 0);
export const isBehindDoll = (item: Layered): boolean => effectiveLayer(item) < DOLL_LAYER;

// 下から上へ並べる（同じ値なら、着せた順）
export function sortByLayer<T extends Layered & { equipOrder: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => effectiveLayer(a) - effectiveLayer(b) || a.equipOrder - b.equipOrder);
}

// 描く 1 枚: 服・ドール
export type Sheet = { kind: 'item'; item: EquippedItem } | { kind: 'doll' };

/**
 * 描く順番（下から）: ドールの後ろの服（うしろがみ・後ろに回した服）→ ドール → ほかの服
 */
export function drawOrder(items: EquippedItem[]): Sheet[] {
  const sorted = sortByLayer(items);
  const sheet = (item: EquippedItem): Sheet => ({ kind: 'item', item });
  return [...sorted.filter(isBehindDoll).map(sheet), { kind: 'doll' }, ...sorted.filter((i) => !isBehindDoll(i)).map(sheet)];
}

// 調整中の服より手前に描くもの。調整画面が、キャンバスの代わりに重ねて描く
export function sheetsAbove(items: EquippedItem[], adjustingId: string): Sheet[] {
  const order = drawOrder(items);
  const index = order.findIndex((s) => s.kind === 'item' && s.item.id === adjustingId);
  return index < 0 ? [] : order.slice(index + 1);
}

/**
 * 重なりを 1 つ前（+1）・1 つ後ろ（-1）へ動かしたときの、新しい前後の調整値。動かせなければ null。
 * 一覧は「着ている服とドール」を下から並べたもの。ドールを越えると、ドールの後ろ・前が入れ替わる
 */
export function moveLayer(items: EquippedItem[], id: string, direction: 1 | -1): number | null {
  const item = items.find((i) => i.id === id);
  if (!item) return null;
  type Row = { id: string | null; layer: number };
  const sorted = sortByLayer(items);
  const rows: Row[] = [
    ...sorted.filter(isBehindDoll).map((i) => ({ id: i.id, layer: effectiveLayer(i) })),
    { id: null, layer: DOLL_LAYER },
    ...sorted.filter((i) => !isBehindDoll(i)).map((i) => ({ id: i.id, layer: effectiveLayer(i) })),
  ];
  const index = rows.findIndex((r) => r.id === id);
  const neighbor = rows[index + direction];
  if (!neighbor) return null;
  const beyond = rows[index + direction * 2];
  const near = neighbor.layer;
  let target: number;
  if (neighbor.id === null) {
    // ドールを越える: 後ろへ → ドールのすぐ後ろ（後ろにある服のいちばん手前）。前へ → ドールのすぐ前（前にある服のいちばん奥）
    if (direction === -1) target = beyond ? beyond.layer / 2 : DOLL_LAYER - 1;
    else target = beyond ? beyond.layer / 2 : DOLL_LAYER + 0.5;
  } else {
    // 隣の服を越えた所（その先との中間。先が無ければ 1 つ分先）に置く
    const far = beyond && beyond.layer !== near ? beyond.layer : near + direction;
    target = (near + far) / 2;
    // ドールの前後は変えない（ドールを越えるのは、隣がドールのときだけ）
    if (isBehindDoll(item) && target >= DOLL_LAYER) target = near / 2;
    if (!isBehindDoll(item) && target < DOLL_LAYER) target = DOLL_LAYER;
  }
  return target - baseLayer(item);
}
