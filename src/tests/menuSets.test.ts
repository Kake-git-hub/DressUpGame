/**
 * メニューの「セット」: 服を、入っているセットごとにまとめる
 */
import { describe, expect, it } from 'vitest';
import { menuSets } from '../components/menuSets';
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
});
