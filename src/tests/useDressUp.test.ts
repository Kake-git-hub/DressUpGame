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
    zIndex: 1,
  },
  {
    id: 'bottom-1',
    name: 'ピンクのスカート',
    type: 'bottom',
    imageUrl: '/images/bottom-1.png',
    position: { x: 0, y: 0 },
    zIndex: 2,
  },
  {
    id: 'dress-1',
    name: '紫のワンピース',
    type: 'dress',
    imageUrl: '/images/dress-1.png',
    position: { x: 0, y: 0 },
    zIndex: 1,
  },
];

describe('useDressUp', () => {
  it('初期状態では何も装備していない', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    // 全てのスロットがnull
    expect(result.current.getEquippedItem('top')).toBeNull();
    expect(result.current.getEquippedItem('bottom')).toBeNull();
    expect(result.current.getEquippedItem('dress')).toBeNull();
    expect(result.current.getEquippedItems()).toHaveLength(0);
  });

  it('服を着せることができる（equipItem）', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    // トップスを着せる
    act(() => {
      result.current.equipItem(mockClothingItems[0]);
    });

    expect(result.current.getEquippedItem('top')).toEqual(mockClothingItems[0]);
    expect(result.current.getEquippedItems()).toHaveLength(1);
  });

  it('複数の服を着せることができる', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    // トップスとボトムスを着せる
    act(() => {
      result.current.equipItem(mockClothingItems[0]); // top
      result.current.equipItem(mockClothingItems[1]); // bottom
    });

    expect(result.current.getEquippedItem('top')).toEqual(mockClothingItems[0]);
    expect(result.current.getEquippedItem('bottom')).toEqual(mockClothingItems[1]);
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
      zIndex: 1,
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
    expect(result.current.getEquippedItem('top')).toEqual(anotherTop);
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

  it('全ての服を脱がせることができる（resetAll）', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    // 複数着せる
    act(() => {
      result.current.equipItem(mockClothingItems[0]);
      result.current.equipItem(mockClothingItems[1]);
    });

    // 全て脱がせる
    act(() => {
      result.current.resetAll();
    });

    expect(result.current.getEquippedItems()).toHaveLength(0);
  });

  it('装備アイテムはzIndex順にソートされる', () => {
    const { result } = renderHook(() => useDressUp(mockClothingItems));

    const highZIndexItem: ClothingItemData = {
      id: 'accessory-1',
      name: 'リボン',
      type: 'accessory',
      imageUrl: '/images/accessory-1.png',
      position: { x: 0, y: 0 },
      zIndex: 10,
    };

    // zIndex 2 → zIndex 1 → zIndex 10 の順で着せる
    act(() => {
      result.current.equipItem(mockClothingItems[1]); // zIndex: 2
      result.current.equipItem(mockClothingItems[0]); // zIndex: 1
      result.current.equipItem(highZIndexItem); // zIndex: 10
    });

    const equipped = result.current.getEquippedItems();

    // zIndex順にソートされている
    expect(equipped[0].zIndex).toBe(1);
    expect(equipped[1].zIndex).toBe(2);
    expect(equipped[2].zIndex).toBe(10);
  });
});
