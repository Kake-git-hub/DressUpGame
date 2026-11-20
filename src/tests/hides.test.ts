/**
 * 服が隠す所: ドールから消す分と、ほかの服（靴より下の靴下など）から消す分
 */
import { describe, expect, it } from 'vitest';
import { hidesFor } from '../engine/hides';
import type { EquippedItem } from '../types';

const DOLL = { w: 1024, h: 1024 };
let order = 0;
// 服のキャンバスは、ドールのまわりに 102px の余白を足した 1228（スタジオで作った服と同じ）
function item(id: string, layer: number, extra: Partial<EquippedItem> = {}): EquippedItem {
  return {
    id,
    name: id,
    type: id,
    imageUrl: `${id}.webp`,
    position: { x: 0, y: 0 },
    baseZIndex: layer,
    layerOrder: layer,
    canvasW: 1228,
    canvasH: 1228,
    box: { x: 0, y: 0, w: 10, h: 10 },
    equipOrder: ++order,
    ...extra,
  };
}
const hide = { url: 'shoe-hide.webp', box: { x: 440, y: 930, w: 140, h: 70 } };
const shoe = (extra: Partial<EquippedItem> = {}) => item('くつ', 2, { hide, ...extra });
const sock = (extra: Partial<EquippedItem> = {}) => item('ソックス', 1, extra);

describe('hidesFor', () => {
  it('靴の隠す所は、ドールと、靴より下の服（靴下）から消す。箱は靴下のキャンバスの位置に直す', () => {
    const result = hidesFor([sock(), shoe()], null, DOLL);
    expect(result.doll).toEqual([hide]);
    expect(result.items.get('ソックス')).toEqual([{ url: hide.url, box: { x: 440 + 102, y: 930 + 102, w: 140, h: 70 } }]);
  });

  it('同じ重なりの服・上の服・ドールの後ろの服からは消さない', () => {
    const result = hidesFor([item('インナー', 2), item('トップス', 4), item('うしろがみ', -1), shoe()], null, DOLL);
    expect([...result.items.keys()]).toEqual([]);
  });

  it('ドールと同じ大きさのキャンバスの服なら、箱はそのまま', () => {
    const result = hidesFor([sock({ canvasW: 1024, canvasH: 1024 }), shoe()], null, DOLL);
    expect(result.items.get('ソックス')).toEqual([hide]);
  });

  it('靴を動かした・大きさや傾きを変えた・調整中なら、どこも隠さない', () => {
    for (const moved of [{ adjustOffsetX: 5 }, { adjustOffsetY: -3 }, { adjustScale: 1.1 }, { adjustRotation: 10 }]) {
      const result = hidesFor([sock(), shoe(moved)], null, DOLL);
      expect(result.doll).toEqual([]);
      expect(result.items.size).toBe(0);
    }
    const adjusting = hidesFor([sock(), shoe()], 'くつ', DOLL);
    expect(adjusting.doll).toEqual([]);
    expect(adjusting.items.size).toBe(0);
  });

  it('靴下のほうを動かした・調整中なら、ドールは隠すが、靴下からは消さない', () => {
    const moved = hidesFor([sock({ adjustOffsetX: 4 }), shoe()], null, DOLL);
    expect(moved.doll).toEqual([hide]);
    expect(moved.items.has('ソックス')).toBe(false);
    const adjusting = hidesFor([sock(), shoe()], 'ソックス', DOLL);
    expect(adjusting.doll).toEqual([hide]);
    expect(adjusting.items.has('ソックス')).toBe(false);
  });

  it('前後を入れ替えて、靴下を靴より上にしたら、靴下からは消さない', () => {
    const result = hidesFor([sock({ layerAdjust: 1.5 }), shoe()], null, DOLL);
    expect(result.items.has('ソックス')).toBe(false);
  });

  it('隠す所を持つ服が無ければ、どちらも空（古い素材）', () => {
    const result = hidesFor([sock(), item('トップス', 4)], null, DOLL);
    expect(result.doll).toEqual([]);
    expect(result.items.size).toBe(0);
  });
});
