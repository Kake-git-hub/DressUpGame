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
  },
  {
    id: 'bottom-1',
    name: 'ピンクのスカート',
    type: 'bottom',
    imageUrl: '/images/bottom-1.png',
    position: { x: 0, y: 0 },
    baseZIndex: 10,
  },
  {
    id: 'dress-1',
    name: '紫のワンピース',
    type: 'dress',
    imageUrl: '/images/dress-1.png',
    position: { x: 0, y: 0 },
    baseZIndex: 15,
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
  },
  {
    id: 'underwear-bottom-1',
    name: '白いショーツ',
    type: 'underwear_bottom',
    imageUrl: '/images/underwear-bottom.png',
    position: { x: 0, y: 0 },
    baseZIndex: 1,
  },
];

describe('useDressUp', () => {
  it('初期状態では何も装備していない（下着なし）', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    // 全てのスロットがnull
    expect(result.current.getEquippedItem('top')).toBeNull();
    expect(result.current.getEquippedItem('bottom')).toBeNull();
    expect(result.current.getEquippedItem('dress')).toBeNull();
    expect(result.current.getEquippedItems()).toHaveLength(0);
  });

  it('デフォルト下着付きで初期化できる', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems, mockUnderwear));

    // 下着が装備されている
    expect(result.current.getEquippedItem('underwear_top')).not.toBeNull();
    expect(result.current.getEquippedItem('underwear_bottom')).not.toBeNull();
    expect(result.current.getEquippedItems()).toHaveLength(2);
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
    expect(result.current.getEquippedItems()).toHaveLength(1);
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
    expect(result.current.getEquippedItems()).toHaveLength(2);
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
    expect(result.current.getEquippedItems()).toHaveLength(1);
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
    expect(result.current.getEquippedItems()).toHaveLength(0);
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
    expect(result.current.getEquippedItems()).toHaveLength(2);
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
    };

    // 異なる順で着せる
    act(() => {
      result.current.equipItem(mockClothingItems[1]); // bottom: baseZIndex 10
      result.current.equipItem(mockClothingItems[0]); // top: baseZIndex 20
      result.current.equipItem(highZIndexItem);       // accessory: baseZIndex 30
    });

    const equipped = result.current.getEquippedItems();

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
});
