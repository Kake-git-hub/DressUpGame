import { describe, expect, it } from 'vitest';
import { SETS_ENTRY, dropIndex, menuEntries, moveInList, renumberCategories, renumberMenu, sortCategories } from '../studio/order';

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

describe('sortCategories（ゲームと同じ、同じ menuOrder の決め方）', () => {
  it('同じ menuOrder なら、そのカテゴリの最初の服の重ね順（服に無ければカテゴリの重ね順）→ 最初の服が一覧で先のほう', () => {
    // おんなのこ（2026-11-25 の素材）と同じ形: てぶくろ・ソックスがどちらも 3、重ね順 1。てぶくろの最初の服は重ね順 8
    const cats = [
      { id: 'てぶくろ', menuOrder: 3, layer: 1 },
      { id: 'ソックス', menuOrder: 3, layer: 1 },
      { id: 'から', menuOrder: 3, layer: 0 },
    ];
    const items = [
      { id: 's1', category: 'ソックス' },
      { id: 't1', category: 'てぶくろ', layer: 8 },
    ];
    expect(sortCategories(cats, items).map((c) => c.id)).toEqual(['ソックス', 'てぶくろ', 'から']);
    // 重ね順も同じなら、最初の服が一覧で先のほう
    const glovesFirst = [{ id: 't1', category: 'てぶくろ' }, { id: 's1', category: 'ソックス' }];
    expect(sortCategories(cats.slice(0, 2), glovesFirst).map((c) => c.id)).toEqual(['てぶくろ', 'ソックス']);
    expect(sortCategories(cats.slice(0, 2), [...glovesFirst].reverse()).map((c) => c.id)).toEqual(['ソックス', 'てぶくろ']);
  });
});

describe('menuEntries / renumberMenu（カテゴリの帯に「セット」も入れる）', () => {
  const cats = [
    { id: 'かお', menuOrder: 0, layer: 6 },
    { id: 'ドレス', menuOrder: 2, layer: 4 },
    { id: 'くつ', menuOrder: 7, layer: 2 },
  ];
  it('セットがあれば、位置が無いときは先頭、あるときはその並び順の所（同じならセットが先）。無ければ入れない', () => {
    expect(menuEntries(cats, true).map((e) => e.id)).toEqual([SETS_ENTRY, 'かお', 'ドレス', 'くつ']);
    expect(menuEntries(cats, true, 2).map((e) => e.id)).toEqual(['かお', SETS_ENTRY, 'ドレス', 'くつ']);
    expect(menuEntries(cats, true, 99).map((e) => e.id)).toEqual(['かお', 'ドレス', 'くつ', SETS_ENTRY]);
    expect(menuEntries(cats, false, 2).map((e) => e.id)).toEqual(['かお', 'ドレス', 'くつ']);
  });
  it('並べた順に 0 から振り直し、セットの位置も返す（セットが無ければ undefined）', () => {
    const entries = menuEntries(cats, true, 2);
    expect(renumberMenu(moveInList(entries, 1, 3))).toEqual({
      order: [
        { id: 'かお', layer: 6, menuOrder: 0 },
        { id: 'ドレス', layer: 4, menuOrder: 1 },
        { id: 'くつ', layer: 2, menuOrder: 2 },
      ],
      setsOrder: 3,
    });
    expect(renumberMenu(menuEntries(cats, false)).setsOrder).toBeUndefined();
  });
});
