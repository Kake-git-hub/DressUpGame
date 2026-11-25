/**
 * メニューの「セット」: 服を、入っているセットごとにまとめる
 */
import { describe, expect, it } from 'vitest';
import { menuSets, setsIndex } from '../components/menuSets';
import type { ClothingItemData } from '../types';

const item = (id: string, layer: number, sets?: ClothingItemData['sets'], extra: Partial<ClothingItemData> = {}): ClothingItemData => ({
  id,
  name: id,
  type: id,
  imageUrl: `${id}.webp`,
  position: { x: 0, y: 0 },
  baseZIndex: layer,
  layerOrder: layer,
  ...(sets ? { sets } : {}),
  ...extra,
}) as ClothingItemData;
const UMI = { id: 'umi', name: 'うみ', order: 1 };
const YAMA = { id: 'yama', name: 'やま', order: 0 };

describe('menuSets', () => {
  it('いくつものセットに入っている服は、どのセットにも入る。セットはセットの順番、パーツは重なりの小さい順', () => {
    const sets = menuSets([item('top', 5, [UMI, YAMA]), item('skirt', 3, [UMI]), item('hat', 9, [YAMA]), item('free', 1)]);
    expect(sets.map((s) => s.name)).toEqual(['やま', 'うみ']);
    expect(sets[0].items.map((i) => i.id)).toEqual(['top', 'hat']);
    expect(sets[1].items.map((i) => i.id)).toEqual(['skirt', 'top']);
  });
  it('順番の無いセット（自分の服）は、あとに服の順で。うしろがみは入れない', () => {
    const mine = { id: 'my:1', name: 'じぶん' };
    const sets = menuSets([item('a', 1, [mine]), item('b', 1, [UMI]), item('b#back', -1, [UMI], { frontItemId: 'b' })]);
    expect(sets.map((s) => s.id)).toEqual(['umi', 'my:1']);
    expect(sets[0].items.map((i) => i.id)).toEqual(['b']);
  });
  it('セットだけの重ね順は、そのセットの写しにだけ付き、並び（着せる順）にも効く。ほかのセットには付かない', () => {
    const top = item('top', 5, [{ ...UMI, layer: 1 }, YAMA]);
    const sets = menuSets([top, item('skirt', 3, [UMI]), item('hat', 9, [YAMA])]);
    const umi = sets.find((x) => x.id === 'umi')!;
    const yama = sets.find((x) => x.id === 'yama')!;
    expect(umi.items.map((i) => [i.id, i.setLayer])).toEqual([['top', 1], ['skirt', undefined]]);
    expect(yama.items.map((i) => [i.id, i.setLayer])).toEqual([['top', undefined], ['hat', undefined]]);
    expect(top).not.toHaveProperty('setLayer'); // 元の服は変えない
  });
  it('自分のセット（order が負）は、公開のセットより前。新しいセット（より小さい値）ほど前', () => {
    const older = { id: 'my:set-1', name: 'まえにつくった', order: -100 };
    const newer = { id: 'my:set-2', name: 'あたらしい', order: -200 };
    const sets = menuSets([item('a', 1, [UMI]), item('b', 1, [older]), item('c', 1, [newer]), item('d', 1, [YAMA])]);
    expect(sets.map((s) => s.id)).toEqual(['my:set-2', 'my:set-1', 'yama', 'umi']);
  });
});

describe('setsIndex（メニューで「セット」をカテゴリの何番めの前に置くか）', () => {
  it('位置が無ければ先頭。あれば、それより小さい並び順のカテゴリの後ろ（同じなら、セットが先）', () => {
    expect(setsIndex([0, 1, 2, 3])).toBe(0);
    expect(setsIndex([0, 2, 3], 1)).toBe(1);
    expect(setsIndex([0, 1, 2], 1)).toBe(1);
    expect(setsIndex([0, 1, 2], 9)).toBe(3);
  });
});
