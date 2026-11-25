import { describe, expect, it } from 'vitest';
import { drawOrder, isBehindDoll, moveLayer, reorderLayer, reorderShown, sheetsAbove } from '../engine/layers';
import { adjustTargetId, isPairedBack } from '../engine/pairs';
import type { EquippedItem } from '../types';

const make = (id: string, layer: number, extra: Partial<EquippedItem> = {}): EquippedItem =>
  ({ id, name: id, type: 'x', imageUrl: `${id}.png`, position: { x: 0, y: 0 }, baseZIndex: layer, layerOrder: layer, equipOrder: 0, ...extra }) as EquippedItem;
const names = (items: EquippedItem[]) => drawOrder(items).map((s) => (s.kind === 'doll' ? 'DOLL' : `${s.item.id}:front`));
const apply = (items: EquippedItem[], id: string, direction: 1 | -1) => {
  const next = moveLayer(items, id, direction);
  return next === null ? items : items.map((i) => (i.id === id ? { ...i, layerAdjust: next } : i));
};

describe('重なりの順番', () => {
  it('セットとして着せた服は、そのセットだけの重ね順（setLayer）で重なる', () => {
    expect(names([make('top', 5, { setLayer: 2 }), make('skirt', 3)])).toEqual(['DOLL', 'top:front', 'skirt:front']);
    expect(names([make('top', 5), make('skirt', 3)])).toEqual(['DOLL', 'skirt:front', 'top:front']);
  });

  it('ふつうの服はドールの前、後ろ髪はドールの後ろに描く', () => {
    expect(names([make('hair', 11), make('backhair', -1), make('dress', 4)])).toEqual(['backhair:front', 'DOLL', 'dress:front', 'hair:front']);
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

  it('うしろがみ（ドールのすぐ後ろ）がいるとき、服を後ろへ回すと、まずドールとうしろがみのあいだ、次にうしろがみの後ろ', () => {
    let items = [make('hair', 11), make('backhair', -1), make('wings', 5)];
    items = apply(items, 'wings', -1);
    expect(names(items)).toEqual(['backhair:front', 'wings:front', 'DOLL', 'hair:front']);
    expect(sheetsAbove(items, 'wings').map((s) => s.kind)).toEqual(['doll', 'item']);
    expect(sheetsAbove(items, 'hair')).toEqual([]);
    items = apply(items, 'wings', -1);
    expect(names(items)).toEqual(['wings:front', 'backhair:front', 'DOLL', 'hair:front']);
    // うしろがみも、前へ動かせばドールの前に出せる
    items = apply(items, 'backhair', 1);
    expect(names(items)).toEqual(['wings:front', 'DOLL', 'backhair:front', 'hair:front']);
  });
});

const reorder = (items: EquippedItem[], id: string, index: number) => {
  const changes = reorderLayer(items, id, index)!;
  return items.map((i) => {
    const c = changes.find((x) => x.id === i.id);
    return c ? { ...i, layerAdjust: c.layerAdjust } : i;
  });
};

describe('重なりの並べ替え（ドラッグ）', () => {
  const base = () => [make('socks', 1), make('dress', 4), make('hair', 11)]; // 下から DOLL, socks, dress, hair
  it('いちばん上へ・まんなかへ・ドールのすぐ上へ入れられる', () => {
    expect(names(reorder(base(), 'socks', 3))).toEqual(['DOLL', 'dress:front', 'hair:front', 'socks:front']);
    expect(names(reorder(base(), 'hair', 2))).toEqual(['DOLL', 'socks:front', 'hair:front', 'dress:front']);
    expect(names(reorder(base(), 'hair', 1))).toEqual(['DOLL', 'hair:front', 'socks:front', 'dress:front']);
  });
  it('ドールより下へ入れると、ドールの後ろに回る。上へ戻すと前に出る', () => {
    const behind = reorder(base(), 'dress', 0);
    expect(names(behind)).toEqual(['dress:front', 'DOLL', 'socks:front', 'hair:front']);
    expect(isBehindDoll(behind.find((i) => i.id === 'dress')!)).toBe(true);
    expect(names(reorder(behind, 'dress', 1))).toEqual(['DOLL', 'dress:front', 'socks:front', 'hair:front']);
  });
  it('ドールの後ろどうしでも、位置どおりに入る', () => {
    const items = [make('a', 5, { layerAdjust: -7 }), make('b', 5, { layerAdjust: -6 }), make('c', 3)]; // a, b, DOLL, c
    expect(names(reorder(items, 'c', 1))).toEqual(['a:front', 'c:front', 'b:front', 'DOLL']);
    expect(names(reorder(items, 'c', 0))).toEqual(['c:front', 'a:front', 'b:front', 'DOLL']);
  });
  it('同じ重なりの値の服のあいだにも、位置どおりに入る（動かすのは、入れる服と、その上に続く同じ値の服だけ）', () => {
    const items = [make('p', 11, { equipOrder: 1 }), make('q', 11, { equipOrder: 2 }), make('r', 11, { equipOrder: 3 }), make('x', 4)];
    // 下から DOLL, x, p, q, r。x を p と q のあいだへ
    const changes = reorderLayer(items, 'x', 2)!;
    expect(changes.map((c) => c.id).sort()).toEqual(['q', 'r', 'x']);
    expect(names(reorder(items, 'x', 2))).toEqual(['DOLL', 'p:front', 'x:front', 'q:front', 'r:front']);
  });
  it('重なりの値がドールと同じ（0）服の下、ドールのすぐ上にも入る', () => {
    const items = [make('z', 0), make('y', 5)]; // DOLL, z, y
    expect(names(reorder(items, 'y', 1))).toEqual(['DOLL', 'y:front', 'z:front']);
  });
  it('いまと同じ位置なら何も変えない。範囲の外は端に丸める。知らない id は null', () => {
    expect(reorderLayer(base(), 'dress', 2)).toEqual([]);
    expect(names(reorder(base(), 'socks', 99))).toEqual(['DOLL', 'dress:front', 'hair:front', 'socks:front']);
    expect(names(reorder(base(), 'hair', -5))).toEqual(['hair:front', 'DOLL', 'socks:front', 'dress:front']);
    expect(reorderLayer(base(), 'nope', 0)).toBeNull();
  });
  it('▲▼ で動かしたあとの値からでも、続けて並べ替えられる', () => {
    let items = base();
    items = items.map((i) => (i.id === 'socks' ? { ...i, layerAdjust: moveLayer(items, 'socks', 1)! } : i)); // DOLL, dress, socks, hair
    expect(names(reorder(items, 'hair', 1))).toEqual(['DOLL', 'hair:front', 'dress:front', 'socks:front']);
  });
});

describe('重なりの並べ替え（一覧に出さない、対のうしろがみを数えない）', () => {
  // 下から: backhair（見えない）, DOLL, socks, dress, hair
  const items = () => [make('socks', 1), make('dress', 4), make('hair', 11, { backItemId: 'backhair' }), make('backhair', -1, { frontItemId: 'hair' })];
  const hidden = new Set(['backhair']);
  const shownReorder = (list: EquippedItem[], id: string, to: number) => {
    const changes = reorderShown(list, id, to, hidden)!;
    return list.map((i) => {
      const c = changes.find((x) => x.id === i.id);
      return c ? { ...i, layerAdjust: c.layerAdjust } : i;
    });
  };

  it('見えている並び（上から hair, dress, socks, DOLL）の番号で入れる', () => {
    // socks を、見えている行（socks を抜くと hair, dress, DOLL）の 0 番目 = いちばん手前へ
    expect(names(shownReorder(items(), 'socks', 0))).toEqual(['backhair:front', 'DOLL', 'dress:front', 'hair:front', 'socks:front']);
    // dress を、見えている行のいちばん下（DOLL の下）へ: ドールのすぐ後ろ。うしろがみより手前
    expect(names(shownReorder(items(), 'dress', 3))).toEqual(['backhair:front', 'dress:front', 'DOLL', 'socks:front', 'hair:front']);
    // 同じ位置なら、何も変えない
    expect(reorderShown(items(), 'dress', 1, hidden)).toEqual([]);
    expect(reorderShown(items(), 'nope', 0, hidden)).toBeNull();
  });

  it('対のうしろがみを見分け、調整する服は前髪にする', () => {
    expect(isPairedBack(items(), 'backhair')).toBe(true);
    expect(isPairedBack(items(), 'hair')).toBe(false);
    expect(adjustTargetId(items(), 'backhair')).toBe('hair');
    expect(adjustTargetId(items(), 'dress')).toBe('dress');
    // 対でないうしろがみ（前髪を着ていない）は、ふつうの服と同じ
    const alone = [make('backhair', -1, { frontItemId: 'hair' })];
    expect(isPairedBack(alone, 'backhair')).toBe(false);
    expect(adjustTargetId(alone, 'backhair')).toBe('backhair');
  });
});
