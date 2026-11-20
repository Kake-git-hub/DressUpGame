/**
 * useDressUp フックのユニットテスト
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDressUp } from '../hooks/useDressUp';
import type { ClothingItemData } from '../types';

// テスト用の服アイテム
const mockClothingItems: ClothingItemData[] = [
  {
    id: 'top-1',
    name: '青いTシャツ',
    type: 'top',
    imageUrl: '/images/top-1.png',
    position: { x: 0, y: 0 },
    baseZIndex: 20,
    canvasW: 1024,
    canvasH: 1024,
    box: { x: 0, y: 0, w: 1024, h: 1024 },
  },
  {
    id: 'bottom-1',
    name: 'ピンクのスカート',
    type: 'bottom',
    imageUrl: '/images/bottom-1.png',
    position: { x: 0, y: 0 },
    baseZIndex: 10,
    canvasW: 1024,
    canvasH: 1024,
    box: { x: 0, y: 0, w: 1024, h: 1024 },
  },
  {
    id: 'dress-1',
    name: '紫のワンピース',
    type: 'dress',
    imageUrl: '/images/dress-1.png',
    position: { x: 0, y: 0 },
    baseZIndex: 15,
    canvasW: 1024,
    canvasH: 1024,
    box: { x: 0, y: 0, w: 1024, h: 1024 },
  },
];

// テスト用の下着
const mockUnderwear: ClothingItemData[] = [
  {
    id: 'underwear-top-1',
    name: '白いキャミソール',
    type: 'underwear_top',
    imageUrl: '/images/underwear-top.png',
    position: { x: 0, y: 0 },
    baseZIndex: 0,
    canvasW: 1024,
    canvasH: 1024,
    box: { x: 0, y: 0, w: 1024, h: 1024 },
  },
  {
    id: 'underwear-bottom-1',
    name: '白いショーツ',
    type: 'underwear_bottom',
    imageUrl: '/images/underwear-bottom.png',
    position: { x: 0, y: 0 },
    baseZIndex: 1,
    canvasW: 1024,
    canvasH: 1024,
    box: { x: 0, y: 0, w: 1024, h: 1024 },
  },
];

describe('useDressUp', () => {
  it('初期状態では何も装備していない（下着なし）', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    // 全てのスロットがnull
    expect(result.current.getEquippedItem('top')).toBeNull();
    expect(result.current.getEquippedItem('bottom')).toBeNull();
    expect(result.current.getEquippedItem('dress')).toBeNull();
    expect(result.current.equippedItems).toHaveLength(0);
  });

  it('デフォルト下着付きで初期化できる', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems, mockUnderwear));

    // 下着が装備されている
    expect(result.current.getEquippedItem('underwear_top')).not.toBeNull();
    expect(result.current.getEquippedItem('underwear_bottom')).not.toBeNull();
    expect(result.current.equippedItems).toHaveLength(2);
  });

  it('服を着せることができる（equipItem）', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    // トップスを着せる
    act(() => {
      result.current.equipItem(mockClothingItems[0]);
    });

    const equipped = result.current.getEquippedItem('top');
    expect(equipped).not.toBeNull();
    expect(equipped?.id).toBe('top-1');
    expect(result.current.equippedItems).toHaveLength(1);
  });

  it('複数の服を着せることができる', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    // トップスとボトムスを着せる
    act(() => {
      result.current.equipItem(mockClothingItems[0]); // top
      result.current.equipItem(mockClothingItems[1]); // bottom
    });

    expect(result.current.getEquippedItem('top')).not.toBeNull();
    expect(result.current.getEquippedItem('bottom')).not.toBeNull();
    expect(result.current.equippedItems).toHaveLength(2);
  });

  it('同じタイプの服を着せると置き換わる', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    const anotherTop: ClothingItemData = {
      id: 'top-2',
      name: '赤いTシャツ',
      type: 'top',
      imageUrl: '/images/top-2.png',
      position: { x: 0, y: 0 },
      baseZIndex: 20,
      canvasW: 1024,
      canvasH: 1024,
      box: { x: 0, y: 0, w: 1024, h: 1024 },
    };

    // 最初のトップスを着せる
    act(() => {
      result.current.equipItem(mockClothingItems[0]);
    });

    // 別のトップスを着せる
    act(() => {
      result.current.equipItem(anotherTop);
    });

    // 新しいトップスに置き換わる
    const equipped = result.current.getEquippedItem('top');
    expect(equipped?.id).toBe('top-2');
    expect(result.current.equippedItems).toHaveLength(1);
  });

  it('服を脱がせることができる（unequipItem）', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    // トップスを着せる
    act(() => {
      result.current.equipItem(mockClothingItems[0]);
    });

    // トップスを脱がせる
    act(() => {
      result.current.unequipItem('top');
    });

    expect(result.current.getEquippedItem('top')).toBeNull();
    expect(result.current.equippedItems).toHaveLength(0);
  });

  it('全ての服を脱がせても下着は残る（resetAll）', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems, mockUnderwear));

    // 服を着せる
    act(() => {
      result.current.equipItem(mockClothingItems[0]);
      result.current.equipItem(mockClothingItems[1]);
    });

    // 全て脱がせる
    act(() => {
      result.current.resetAll();
    });

    // 下着だけ残る
    expect(result.current.equippedItems).toHaveLength(2);
    expect(result.current.getEquippedItem('underwear_top')).not.toBeNull();
    expect(result.current.getEquippedItem('underwear_bottom')).not.toBeNull();
  });

  it('装備アイテムはbaseZIndex順にソートされる', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    const highZIndexItem: ClothingItemData = {
      id: 'accessory-1',
      name: 'リボン',
      type: 'accessory',
      imageUrl: '/images/accessory-1.png',
      position: { x: 0, y: 0 },
      baseZIndex: 30,
      canvasW: 1024,
      canvasH: 1024,
      box: { x: 0, y: 0, w: 1024, h: 1024 },
    };

    // 異なる順で着せる
    act(() => {
      result.current.equipItem(mockClothingItems[1]); // bottom: baseZIndex 10
      result.current.equipItem(mockClothingItems[0]); // top: baseZIndex 20
      result.current.equipItem(highZIndexItem);       // accessory: baseZIndex 30
    });

    const equipped = result.current.equippedItems;

    // baseZIndex順にソートされている
    expect(equipped[0].type).toBe('bottom');    // 10
    expect(equipped[1].type).toBe('top');       // 20
    expect(equipped[2].type).toBe('accessory'); // 30
  });

  it('後から着せた同カテゴリの服は上に表示される', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    const top1: ClothingItemData = mockClothingItems[0];
    const top2: ClothingItemData = {
      id: 'top-2',
      name: '赤いTシャツ',
      type: 'top',
      imageUrl: '/images/top-2.png',
      position: { x: 0, y: 0 },
      baseZIndex: 20,
      canvasW: 1024,
      canvasH: 1024,
      box: { x: 0, y: 0, w: 1024, h: 1024 },
    };

    // top1を着せて、top2で置き換え
    act(() => {
      result.current.equipItem(top1);
    });
    act(() => {
      result.current.equipItem(top2);
    });

    const equipped = result.current.getEquippedItem('top');
    // 後から着せたtop2になっている
    expect(equipped?.id).toBe('top-2');
  });
  it('再レンダリングしても equippedItems の参照が変わらない', () => {
    const { result, rerender } = renderHook(() => useDressUp(mockClothingItems));
    act(() => result.current.equipItem(mockClothingItems[0]));
    const first = result.current.equippedItems;
    rerender();
    expect(result.current.equippedItems).toBe(first);
  });

  it('equippedItems は layerOrder + layerAdjust、同値なら equipOrder の順', () => {
    const upper: ClothingItemData = { ...mockClothingItems[0], id: 'upper', type: 'upper', layerOrder: 4 };
    const lower: ClothingItemData = { ...mockClothingItems[1], id: 'lower', type: 'lower', layerOrder: 3 };
    const same: ClothingItemData = { ...mockClothingItems[2], id: 'same', type: 'same', layerOrder: 4 };
    const { result } = renderHook(() => useDressUp([upper, lower, same]));
    act(() => result.current.equipItem(upper));
    act(() => result.current.equipItem(lower));
    act(() => result.current.equipItem(same));
    expect(result.current.equippedItems.map((i) => i.id)).toEqual(['lower', 'upper', 'same']);
    act(() => result.current.updateItemAdjustment('lower', { layerAdjust: 100 }));
    expect(result.current.equippedItems.map((i) => i.id)).toEqual(['upper', 'same', 'lower']);
  });
  it('restoreEquipped は着ている服を丸ごと置き換える', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));
    act(() => result.current.equipItem(mockClothingItems[0]));
    act(() => result.current.restoreEquipped([{ ...mockClothingItems[1], equipOrder: 7, adjustScale: 1.5 }]));
    expect(result.current.equippedItems.map((i) => i.id)).toEqual(['bottom-1']);
    expect(result.current.equippedItems[0].adjustScale).toBe(1.5);
  });

  it('restoreEquipped 後に着せた服は、復元した服より後の equipOrder になる', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));
    act(() => result.current.restoreEquipped([{ ...mockClothingItems[1], equipOrder: 7 }]));
    act(() => result.current.equipItem(mockClothingItems[0]));
    const top = result.current.equippedItems.find((i) => i.id === 'top-1');
    expect(top?.equipOrder).toBe(8);
  });

  describe('前髪と、対のうしろがみ', () => {
    const geo = { position: { x: 0, y: 0 }, canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 10, h: 10 } };
    const hair = (id: string, withBack = true): ClothingItemData => ({
      id, name: id, type: 'hair', imageUrl: `${id}.png`, baseZIndex: 11, layerOrder: 11, ...(withBack ? { backItemId: `${id}#back` } : {}), ...geo,
    });
    const backOf = (id: string): ClothingItemData => ({
      id: `${id}#back`, name: id, type: 'backhair', imageUrl: `${id}b.png`, baseZIndex: -1, layerOrder: -1, frontItemId: id, ...geo,
    });
    const ids = (r: { current: { equippedItems: { id: string }[] } }) => r.current.equippedItems.map((i) => i.id);

    it('髪を着せると、対のうしろがみも一緒に付く（うしろがみが先、前髪が最後に着た服）', () => {
      const { result } = renderHook(() => useDressUp());
      act(() => result.current.equipItem(hair('a'), backOf('a')));
      expect(ids(result)).toEqual(['a#back', 'a']);
      expect(result.current.getLastEquippedItem()?.id).toBe('a');
    });

    it('別の髪に替えると、うしろがみも替わる', () => {
      const { result } = renderHook(() => useDressUp());
      act(() => result.current.equipItem(hair('a'), backOf('a')));
      act(() => result.current.equipItem(hair('b'), backOf('b')));
      expect(ids(result)).toEqual(['b#back', 'b']);
    });

    it('うしろがみの無い髪に替えると、前の髪の対のうしろがみは外れる', () => {
      const { result } = renderHook(() => useDressUp());
      act(() => result.current.equipItem(hair('a'), backOf('a')));
      act(() => result.current.equipItem(hair('c', false)));
      expect(ids(result)).toEqual(['c']);
    });

    it('対でないうしろがみ（前の版の保存にある）は、髪を替えても、新しい対が無ければ残る', () => {
      const { result } = renderHook(() => useDressUp());
      act(() => result.current.equipItem(hair('a'), backOf('a')));
      act(() => result.current.equipItem(backOf('b')));
      expect(ids(result)).toEqual(['b#back', 'a']);
      act(() => result.current.equipItem(hair('c', false)));
      expect(ids(result)).toEqual(['b#back', 'c']);
    });

    it('位置・大きさ・向き・色は、どちらを調整しても両方にかかる。重なりの順番は 1 枚ずつ', () => {
      const { result } = renderHook(() => useDressUp());
      act(() => result.current.equipItem(hair('a'), backOf('a')));
      act(() => result.current.updateItemAdjustment('a#back', { adjustOffsetY: 30, colorHue: 90, layerAdjust: 3 }));
      let back = result.current.equippedItems.find((i) => i.id === 'a#back')!;
      let front = result.current.equippedItems.find((i) => i.id === 'a')!;
      expect(back).toMatchObject({ adjustOffsetY: 30, colorHue: 90, layerAdjust: 3 });
      expect(front).toMatchObject({ adjustOffsetY: 30, colorHue: 90 });
      expect(front.layerAdjust).toBeUndefined();

      act(() => result.current.updateItemAdjustment('a', { adjustOffsetX: -5, adjustScale: 1.2, adjustRotation: 10, colorHue: 0, layerAdjust: -1 }));
      back = result.current.equippedItems.find((i) => i.id === 'a#back')!;
      front = result.current.equippedItems.find((i) => i.id === 'a')!;
      expect(front).toMatchObject({ adjustOffsetX: -5, adjustOffsetY: 30, adjustScale: 1.2, adjustRotation: 10, colorHue: 0, layerAdjust: -1 });
      expect(back).toMatchObject({ adjustOffsetX: -5, adjustOffsetY: 30, adjustScale: 1.2, adjustRotation: 10, colorHue: 0, layerAdjust: 3 });
    });

    it('対でないうしろがみ（前の版で、別の髪のものに替えていた）は、前髪と一緒には変わらない', () => {
      const { result } = renderHook(() => useDressUp());
      act(() => result.current.equipItem(hair('a'), backOf('a')));
      act(() => result.current.equipItem(backOf('b')));
      act(() => result.current.updateItemAdjustment('a', { adjustOffsetY: 30 }));
      expect(result.current.equippedItems.find((i) => i.id === 'b#back')!.adjustOffsetY).toBeUndefined();
    });

    it('髪を脱がせると、前髪も対のうしろがみも脱げる（どちらを選んでいても）', () => {
      const { result } = renderHook(() => useDressUp());
      act(() => result.current.equipItem(hair('a'), backOf('a')));
      act(() => result.current.unequipItemById('a'));
      expect(ids(result)).toEqual([]);
      act(() => result.current.equipItem(hair('a'), backOf('a')));
      act(() => result.current.unequipItemById('a#back'));
      expect(ids(result)).toEqual([]);
    });
  });
});

// セットを着せる = パーツを続けて 1 点ずつ着せる（App の handleSetDrop と同じ呼び方）
describe('セットをまとめて着せる（続けて equipItem を呼ぶ）', () => {
  const make = (id: string, type: string, extra: Partial<ClothingItemData> = {}): ClothingItemData => ({
    id,
    name: id,
    type,
    imageUrl: `/${id}.png`,
    position: { x: 0, y: 0 },
    baseZIndex: 10,
    canvasW: 1024,
    canvasH: 1024,
    box: { x: 0, y: 0, w: 1024, h: 1024 },
    ...extra,
  });
  const backHair = make('hair#back', 'うしろがみ', { frontItemId: 'hair' });
  const hair = make('hair', 'hair', { backItemId: 'hair#back' });
  const ribbon = make('ribbon', 'accessory', { allowOverlap: true });
  const set = [make('skirt', 'bottom'), make('shirt', 'top'), ribbon, hair];
  const dressSet = (current: ReturnType<typeof useDressUp>) => {
    for (const part of set) current.equipItem(part, part.backItemId ? backHair : undefined);
  };
  const ids = (items: { id: string }[]) => items.map((i) => i.id).sort();

  it('1 回の操作で続けて着せても、全部のパーツが着る（髪は、うしろがみも一緒）', () => {
    const { result } = renderHook(() => useDressUp());
    act(() => dressSet(result.current));
    expect(ids(result.current.equippedItems)).toEqual(['hair', 'hair#back', 'ribbon', 'shirt', 'skirt']);
    // 着せた順（equipOrder）は、全部ちがう
    expect(new Set(result.current.equippedItems.map((i) => i.equipOrder)).size).toBe(5);
  });

  it('すでに着ている服: 同じカテゴリは入れ替わり、重ね着できるカテゴリの別の服と、関係ないカテゴリの服は残る。前の髪のうしろがみは外れる', () => {
    const { result } = renderHook(() => useDressUp());
    const oldBack = make('old-hair#back', 'うしろがみ', { frontItemId: 'old-hair' });
    act(() => {
      result.current.equipItem(make('old-shirt', 'top'));
      result.current.equipItem(make('pin', 'accessory', { allowOverlap: true }));
      result.current.equipItem(make('shoes', 'shoes'));
      result.current.equipItem(make('old-hair', 'hair', { backItemId: 'old-hair#back' }), oldBack);
    });
    act(() => dressSet(result.current));
    expect(ids(result.current.equippedItems)).toEqual(['hair', 'hair#back', 'pin', 'ribbon', 'shirt', 'shoes', 'skirt']);
  });

  it('1 点ずつ別々の操作で着せたときと、同じ結果になる', () => {
    const together = renderHook(() => useDressUp());
    act(() => dressSet(together.result.current));
    const oneByOne = renderHook(() => useDressUp());
    for (const part of set) act(() => oneByOne.result.current.equipItem(part, part.backItemId ? backHair : undefined));
    expect(together.result.current.equippedItems.map((i) => [i.id, i.equipOrder])).toEqual(oneByOne.result.current.equippedItems.map((i) => [i.id, i.equipOrder]));
  });

  it('セットをもう一度着せても、服は増えない', () => {
    const { result } = renderHook(() => useDressUp());
    act(() => dressSet(result.current));
    act(() => dressSet(result.current));
    expect(ids(result.current.equippedItems)).toEqual(['hair', 'hair#back', 'ribbon', 'shirt', 'skirt']);
  });
});
