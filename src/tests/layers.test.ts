import { describe, expect, it } from 'vitest';
import { drawOrder, effectiveLayer, isBehindDoll, moveLayer, sheetsAbove } from '../engine/layers';
import type { EquippedItem } from '../types';

const make = (id: string, layer: number, extra: Partial<EquippedItem> = {}): EquippedItem =>
  ({ id, name: id, type: 'x', imageUrl: `${id}.png`, position: { x: 0, y: 0 }, baseZIndex: layer, layerOrder: layer, equipOrder: 0, ...extra }) as EquippedItem;
const names = (items: EquippedItem[]) => drawOrder(items).map((s) => (s.kind === 'doll' ? 'DOLL' : `${s.item.id}:${s.kind}`));
const apply = (items: EquippedItem[], id: string, direction: 1 | -1) => {
  const next = moveLayer(items, id, direction);
  return next === null ? items : items.map((i) => (i.id === id ? { ...i, layerAdjust: next } : i));
};

describe('重なりの順番', () => {
  it('ふつうの服はドールの前、後ろ髪はドールの後ろに描く', () => {
    const hair = make('hair', 11, { back: { url: 'b.png', box: { x: 0, y: 0, w: 1, h: 1 } } });
    expect(names([hair, make('dress', 4)])).toEqual(['hair:back', 'DOLL', 'dress:front', 'hair:front']);
  });

  it('いちばん下の服を「うしろへ」動かすと、ドールの後ろに回る', () => {
    let items = [make('wings', 11), make('dress', 4)];
    items = apply(items, 'wings', -1); // ドレスの下
    expect(names(items)).toEqual(['DOLL', 'wings:front', 'dress:front']);
    items = apply(items, 'wings', -1); // ドールの後ろ
    expect(isBehindDoll(items[0])).toBe(true);
    expect(names(items)).toEqual(['wings:front', 'DOLL', 'dress:front']);
    expect(moveLayer(items, 'wings', -1)).toBeNull(); // これより後ろは無い
  });

  it('ドールの後ろの服を「まえへ」動かすと、いちばん下の服のさらに下に戻る', () => {
    let items = [make('wings', 11, { layerAdjust: -12 }), make('socks', 1)];
    items = apply(items, 'wings', 1);
    expect(names(items)).toEqual(['DOLL', 'wings:front', 'socks:front']);
    items = apply(items, 'wings', 1);
    expect(names(items)).toEqual(['DOLL', 'socks:front', 'wings:front']);
  });

  it('ドールの後ろどうしでも前後を入れ替えられ、ドールの前には出ない', () => {
    let items = [make('a', 5, { layerAdjust: -6 }), make('b', 5, { layerAdjust: -5.5 })];
    expect(names(items)).toEqual(['a:front', 'b:front', 'DOLL']);
    items = apply(items, 'a', 1);
    expect(names(items)).toEqual(['b:front', 'a:front', 'DOLL']);
    items = apply(items, 'a', -1);
    expect(names(items)).toEqual(['a:front', 'b:front', 'DOLL']);
    // 後ろに 2 着あるとき、3 着目はドールのすぐ後ろに入る
    items = apply([...items, make('c', 3)], 'c', -1);
    expect(names(items)).toEqual(['a:front', 'b:front', 'c:front', 'DOLL']);
  });

  it('ドールの後ろの服は、ほかの服の後ろ髪よりも後ろに描く', () => {
    const hair = make('hair', 11, { back: { url: 'b.png', box: { x: 0, y: 0, w: 1, h: 1 } } });
    const wings = make('wings', 11, { layerAdjust: -12 });
    expect(names([hair, wings])).toEqual(['wings:front', 'hair:back', 'DOLL', 'hair:front']);
    expect(sheetsAbove([hair, wings], 'wings').map((s) => s.kind)).toEqual(['back', 'doll', 'front']);
    expect(sheetsAbove([hair, wings], 'hair')).toEqual([]);
    expect(effectiveLayer(wings)).toBe(-1);
  });
});
