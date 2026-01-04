/**
 * 着せ替え状態を管理するカスタムフック
 * Custom hook for managing dress-up state
 */
import { useState, useCallback } from 'react';
import type { ClothingItemData, ClothingType, DressUpState } from '../types';

// 初期状態を作成
const createInitialState = (availableItems: ClothingItemData[]): DressUpState => ({
  equippedItems: new Map<ClothingType, ClothingItemData | null>([
    ['top', null],
    ['bottom', null],
    ['dress', null],
    ['accessory', null],
    ['shoes', null],
  ]),
  availableItems,
});

export interface UseDressUpReturn {
  // 現在の状態
  state: DressUpState;
  // 服を着せる
  equipItem: (item: ClothingItemData) => void;
  // 服を脱がせる
  unequipItem: (type: ClothingType) => void;
  // 指定タイプの装備アイテムを取得
  getEquippedItem: (type: ClothingType) => ClothingItemData | null;
  // 装備中のアイテム一覧を取得
  getEquippedItems: () => ClothingItemData[];
  // 全ての服を脱がせる
  resetAll: () => void;
}

export function useDressUp(initialItems: ClothingItemData[] = []): UseDressUpReturn {
  const [state, setState] = useState<DressUpState>(() => createInitialState(initialItems));

  // 服を着せる（同じタイプの服は置き換え）
  const equipItem = useCallback((item: ClothingItemData) => {
    setState((prev) => {
      const newEquipped = new Map(prev.equippedItems);
      newEquipped.set(item.type, item);
      return {
        ...prev,
        equippedItems: newEquipped,
      };
    });
  }, []);

  // 服を脱がせる
  const unequipItem = useCallback((type: ClothingType) => {
    setState((prev) => {
      const newEquipped = new Map(prev.equippedItems);
      newEquipped.set(type, null);
      return {
        ...prev,
        equippedItems: newEquipped,
      };
    });
  }, []);

  // 指定タイプの装備アイテムを取得
  const getEquippedItem = useCallback(
    (type: ClothingType): ClothingItemData | null => {
      return state.equippedItems.get(type) ?? null;
    },
    [state.equippedItems]
  );

  // 装備中のアイテム一覧を取得（zIndex順にソート）
  const getEquippedItems = useCallback((): ClothingItemData[] => {
    const items: ClothingItemData[] = [];
    state.equippedItems.forEach((item) => {
      if (item) {
        items.push(item);
      }
    });
    return items.sort((a, b) => a.zIndex - b.zIndex);
  }, [state.equippedItems]);

  // 全ての服を脱がせる
  const resetAll = useCallback(() => {
    setState((prev) => createInitialState(prev.availableItems));
  }, []);

  return {
    state,
    equipItem,
    unequipItem,
    getEquippedItem,
    getEquippedItems,
    resetAll,
  };
}
