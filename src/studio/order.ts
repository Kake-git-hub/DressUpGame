/**
 * 一覧での服の並べ替えの計算
 */

// 並びの中で、from にあるものを to の位置へ動かした並び
export function moveInList<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, x);
  return next;
}

// from 番目の服を、target 番目の服の前（after なら後ろ）に落としたときの、動かした先の番号
export const dropIndex = (from: number, target: number, after: boolean): number => (from === target ? from : target + (after ? 1 : 0) - (from < target ? 1 : 0));

// カテゴリを、ゲームのメニューと同じ順に並べる（src/components/DressUpMenu.tsx と同じ決め方）。元の配列は変えない
// menuOrder の小さい順 → 同じなら、そのカテゴリの最初の服の重ね順（服に無ければカテゴリの重ね順）→ 最初の服が一覧で先のほう →
// 元の並び（服の無いカテゴリは、ゲームには出ないので、同じ menuOrder の中で後ろ）
export function sortCategories<T extends { id: string; menuOrder: number; layer: number }>(
  categories: T[],
  items: { category: string; layer?: number }[] = [],
): T[] {
  return categories
    .map((c, index) => {
      const first = items.findIndex((i) => i.category === c.id);
      return { c, index, layer: first < 0 ? c.layer : (items[first].layer ?? c.layer), first: first < 0 ? Infinity : first };
    })
    .sort((a, b) => a.c.menuOrder - b.c.menuOrder || Number(a.first === Infinity) - Number(b.first === Infinity) || a.layer - b.layer || a.first - b.first || a.index - b.index)
    .map((x) => x.c);
}

// 並べたカテゴリの順番を、0, 1, 2… の menuOrder にする（同じ数が無くなる）。重ね順は、いまの値のまま
export const renumberCategories = <T extends { id: string; layer: number }>(ordered: T[]): { id: string; layer: number; menuOrder: number }[] =>
  ordered.map((c, menuOrder) => ({ id: c.id, layer: c.layer, menuOrder }));
