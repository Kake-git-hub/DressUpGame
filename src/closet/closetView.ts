/**
 * クローゼットの並び（純粋関数）: どのドール・どのカテゴリ・どの順番で出すか
 */
import { byClosetOrder } from '../cloud/backend';
import type { MyItem } from '../cloud/backend';
import type { ManifestCategory } from '../content/manifest';
import type { DollData } from '../types';

export interface ClosetDoll {
  id: string;
  name: string;
  usable: boolean; // いま、ゲームに出ている
}
export interface ClosetGroup {
  categoryId: string; // 素材に無いカテゴリをまとめた組は、空
  label: string;
  items: MyItem[];
}

export const UNUSABLE_DOLL_NAME = 'いまは つかえない ドール';
export const OTHER_LABEL = 'そのほか';

/**
 * 自分の服のあるドール。いまのドール → ほかのゲームに出ているドール（素材の順）→ ゲームに出ていないドール（ID の順）。
 * ゲームに出ていないドール（公開をやめた、など）の服も、見て消せるように出す。
 */
export function closetDolls(items: MyItem[], dolls: DollData[], currentDollId: string): ClosetDoll[] {
  const owned = new Set(items.map((item) => item.dollId));
  const usable = dolls.filter((doll) => owned.has(doll.id)).map((doll): ClosetDoll => ({ id: doll.id, name: doll.name, usable: true }));
  const known = new Set(dolls.map((doll) => doll.id));
  const gone = [...owned].filter((id) => !known.has(id)).sort().map((id): ClosetDoll => ({ id, name: UNUSABLE_DOLL_NAME, usable: false }));
  return [...usable.filter((doll) => doll.id === currentDollId), ...usable.filter((doll) => doll.id !== currentDollId), ...gone];
}

// そのドールの服を、カテゴリごとに。カテゴリは、メニューの順。組の中は、ゲームのメニューと同じ順番。素材に無いカテゴリの服は、最後に「そのほか」
export function closetGroups(items: MyItem[], dollId: string, categories: ManifestCategory[]): ClosetGroup[] {
  const mine = items.filter((item) => item.dollId === dollId).sort(byClosetOrder);
  const groups = [...categories]
    .sort((a, b) => a.menuOrder - b.menuOrder)
    .map((category): ClosetGroup => ({ categoryId: category.id, label: category.label, items: mine.filter((item) => item.item.category === category.id) }))
    .filter((group) => group.items.length > 0);
  const known = new Set(categories.map((category) => category.id));
  const others = mine.filter((item) => !known.has(item.item.category));
  return others.length > 0 ? [...groups, { categoryId: '', label: OTHER_LABEL, items: others }] : groups;
}

// まえへ（-1）・うしろへ（+1）: 組の中で、となりと入れ替えたあとの ID の並び。動かせなければ null
export function movedOrder(group: MyItem[], itemId: string, direction: -1 | 1): string[] | null {
  const ids = group.map((item) => item.id);
  const from = ids.indexOf(itemId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return null;
  [ids[from], ids[to]] = [ids[to], ids[from]];
  return ids;
}
