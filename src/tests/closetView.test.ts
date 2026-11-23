/**
 * クローゼットの並び（どのドール・どのカテゴリ・どの順番で出すか）のテスト
 */
import { describe, expect, it } from 'vitest';
import { closetDolls, closetGroups, movedOrder, OTHER_LABEL, UNUSABLE_DOLL_NAME } from '../closet/closetView';
import type { MyItem } from '../cloud/backend';
import type { ManifestCategory } from '../content/manifest';
import type { DollData } from '../types';

const doll = (id: string, name: string): DollData => ({ id, name, bodyImageUrl: `${id}.webp`, canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 1, h: 1 } }) as DollData;
const category = (id: string, menuOrder: number): ManifestCategory => ({ id, label: `${id}のなまえ`, layer: 1, menuOrder, overlap: false, movable: false });
const item = (id: string, dollId: string, categoryId: string, order = 1): MyItem => ({
  id,
  dollId,
  item: { id, name: id, category: categoryId, image: { file: 'image', canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 1, h: 1 } }, thumb: 'thumb' },
  files: {},
  createdAt: order,
  hue: 0,
  order,
  updatedAt: order,
  notes: [],
});
const dolls = [doll('girl', 'おんなのこ'), doll('boy', 'おとこのこ'), doll('baby', 'あかちゃん')];

describe('closetDolls', () => {
  it('自分の服のあるドールだけ。いまのドールが先頭、そのあとは素材の順', () => {
    const items = [item('a', 'girl', 't'), item('b', 'baby', 't'), item('c', 'boy', 't')];
    expect(closetDolls(items, dolls, 'baby')).toEqual([
      { id: 'baby', name: 'あかちゃん', usable: true },
      { id: 'girl', name: 'おんなのこ', usable: true },
      { id: 'boy', name: 'おとこのこ', usable: true },
    ]);
    // いまのドールに服が無ければ、出さない
    expect(closetDolls([item('a', 'girl', 't')], dolls, 'boy').map((d) => d.id)).toEqual(['girl']);
  });
  it('ゲームに出ていないドールの服は、最後に「いまは つかえない ドール」として出る（usable: false）', () => {
    const items = [item('a', 'zz-gone', 't'), item('b', 'girl', 't'), item('c', 'aa-gone', 't'), item('d', 'aa-gone', 't')];
    expect(closetDolls(items, dolls, 'girl')).toEqual([
      { id: 'girl', name: 'おんなのこ', usable: true },
      { id: 'aa-gone', name: UNUSABLE_DOLL_NAME, usable: false },
      { id: 'zz-gone', name: UNUSABLE_DOLL_NAME, usable: false },
    ]);
    expect(UNUSABLE_DOLL_NAME).toBe('いまは つかえない ドール');
  });
  it('服が無ければ、空', () => {
    expect(closetDolls([], dolls, 'girl')).toEqual([]);
  });
});

describe('closetGroups', () => {
  const categories = [category('dress', 2), category('top', 1)];
  it('カテゴリは、メニューの順。組の中は、order の大きい順。ほかのドールの服は入らない', () => {
    const items = [item('d1', 'girl', 'dress', 5), item('t-old', 'girl', 'top', 1), item('t-new', 'girl', 'top', 9), item('x', 'boy', 'top', 99)];
    const groups = closetGroups(items, 'girl', categories);
    expect(groups.map((g) => [g.categoryId, g.label, g.items.map((i) => i.id)])).toEqual([
      ['top', 'topのなまえ', ['t-new', 't-old']],
      ['dress', 'dressのなまえ', ['d1']],
    ]);
  });
  it('素材に無いカテゴリの服は、最後に「そのほか」にまとめる', () => {
    const items = [item('a', 'girl', 'gone-1', 1), item('b', 'girl', 'top', 1), item('c', 'girl', 'gone-2', 2)];
    const groups = closetGroups(items, 'girl', categories);
    expect(groups.map((g) => [g.label, g.items.map((i) => i.id)])).toEqual([
      ['topのなまえ', ['b']],
      [OTHER_LABEL, ['c', 'a']],
    ]);
    expect(OTHER_LABEL).toBe('そのほか');
  });
  it('カテゴリの一覧が無い（使えないドール）ときは、全部「そのほか」', () => {
    expect(closetGroups([item('a', 'gone', 'top')], 'gone', []).map((g) => g.label)).toEqual([OTHER_LABEL]);
  });
});

describe('movedOrder', () => {
  const group = [item('a', 'girl', 'top', 3), item('b', 'girl', 'top', 2), item('c', 'girl', 'top', 1)];
  it('まえへ・うしろへ: となりと入れ替えた並びを返す', () => {
    expect(movedOrder(group, 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(movedOrder(group, 'b', 1)).toEqual(['a', 'c', 'b']);
  });
  it('端では動かせない（null）。組に無い服も null', () => {
    expect(movedOrder(group, 'a', -1)).toBeNull();
    expect(movedOrder(group, 'c', 1)).toBeNull();
    expect(movedOrder(group, 'zzz', 1)).toBeNull();
  });
});
