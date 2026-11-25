/**
 * メニューの「セット」: 服を、入っているセットごとにまとめる（純粋関数）
 */
import type { ClothingItemData } from '../types';

export interface MenuSet {
  id: string;
  name: string;
  items: ClothingItemData[];
}

/**
 * 1 点がいくつものセットに入っていれば、そのどれにも入る。うしろがみ（frontItemId のあるもの）は入れない（前髪と一緒に着る）。
 * セットの並びは、セットの順番（スタジオで決めたもの）。順番の無いセット（自分の服など）は、あとに服の順で。
 * パーツは、重なりの小さい順（着せる順）。セットだけの重ね順のある服は、setLayer を付けた写し
 */
export function menuSets(items: ClothingItemData[]): MenuSet[] {
  const map = new Map<string, { set: MenuSet; order: number }>();
  for (const item of items) {
    if (item.frontItemId) continue;
    for (const mark of item.sets ?? []) {
      const entry = map.get(mark.id) ?? { set: { id: mark.id, name: mark.name, items: [] }, order: mark.order ?? Infinity };
      // このセットだけの重ね順があれば、セットとして着せたときに使う（ほかのセットや 1 点で着たときには付かない）
      entry.set.items.push(mark.layer !== undefined ? { ...item, setLayer: mark.layer } : item);
      map.set(mark.id, entry);
    }
  }
  const layer = (i: ClothingItemData) => i.setLayer ?? i.layerOrder ?? i.baseZIndex ?? 0;
  return Array.from(map.values())
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ set }) => ({ ...set, items: [...set.items].sort((a, b) => layer(a) - layer(b)) }));
}

// メニューで「セット」を、並べたカテゴリの何番めの前に置くか。categoryOrders: 並べたカテゴリの並び順。
// 位置が無ければ先頭。あれば、それより小さい並び順のカテゴリの後ろ（同じなら、セットが先）
export const setsIndex = (categoryOrders: number[], setsOrder?: number): number =>
  setsOrder === undefined ? 0 : categoryOrders.filter((order) => order < setsOrder).length;
