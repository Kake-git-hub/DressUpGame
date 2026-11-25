import { describe, expect, it } from 'vitest';
import { dropIndex, moveInList, renumberCategories, sortCategories } from '../studio/order';

describe('スタジオの一覧での並べ替え', () => {
  it('moveInList: 前へ・後ろへ・端を越えない', () => {
    expect(moveInList(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c']);
    expect(moveInList(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveInList(['a', 'b', 'c'], 2, 9)).toEqual(['a', 'b', 'c']);
    expect(moveInList(['a', 'b', 'c'], 1, -3)).toEqual(['b', 'a', 'c']);
  });
  it('dropIndex: 絵の左半分なら前、右半分なら後ろに入る', () => {
    const drop = (list: string[], from: number, target: number, after: boolean) => moveInList(list, from, dropIndex(from, target, after));
    expect(drop(['a', 'b', 'c', 'd'], 0, 2, false)).toEqual(['b', 'a', 'c', 'd']);
    expect(drop(['a', 'b', 'c', 'd'], 0, 2, true)).toEqual(['b', 'c', 'a', 'd']);
    expect(drop(['a', 'b', 'c', 'd'], 3, 1, false)).toEqual(['a', 'd', 'b', 'c']);
    expect(drop(['a', 'b', 'c', 'd'], 3, 1, true)).toEqual(['a', 'b', 'd', 'c']);
    expect(drop(['a', 'b', 'c', 'd'], 1, 1, true)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('sortCategories', () => {
  it('menuOrder → layer → 元の順で並べる（ゲームのメニューと同じ）', () => {
    const cats = [
      { id: 'ソックス', menuOrder: 3, layer: 1 },
      { id: 'かお', menuOrder: 0, layer: 6 },
      { id: 'てぶくろ', menuOrder: 3, layer: 0 },
      { id: 'A', menuOrder: 5, layer: 2 },
      { id: 'B', menuOrder: 5, layer: 2 },
    ];
    expect(sortCategories(cats).map((c) => c.id)).toEqual(['かお', 'てぶくろ', 'ソックス', 'A', 'B']);
    expect(cats[0].id).toBe('ソックス'); // 元は変えない
  });
});

describe('renumberCategories', () => {
  it('並びの順に 0 から振り直し、layer はそのまま', () => {
    expect(renumberCategories([{ id: 'x', layer: 4 }, { id: 'y', layer: 9 }])).toEqual([
      { id: 'x', layer: 4, menuOrder: 0 },
      { id: 'y', layer: 9, menuOrder: 1 },
    ]);
  });
});
