/**
 * 着せ替え状態を管理するカスタムフック
 * Custom hook for managing dress-up state
 */
import { useState, useCallback } from 'react';
import type { ClothingItemData, ClothingType, DressUpState, EquippedItem } from '../types';

// 基本zIndex値（タイプごとのベース値）
const BASE_Z_INDEX: Record<ClothingType, number> = {
  underwear_top: 0,
  underwear_bottom: 1,
  bottom: 10,
  top: 20,
  dress: 15,
  shoes: 5,
  accessory: 30,
};

// 初期状態を作成
const createInitialState = (
  availableItems: ClothingItemData[],
  defaultUnderwear?: ClothingItemData[]
): DressUpState => {
  const initialEquipped: EquippedItem[] = [];
  let equipCounter = 0;

  // デフォルトの下着を装備
  if (defaultUnderwear) {
    defaultUnderwear.forEach((item) => {
      initialEquipped.push({
        ...item,
        equipOrder: equipCounter++,
      });
    });
  }

  return {
    equippedItems: initialEquipped,
    availableItems,
    equipCounter,
  };
};

export interface UseDressUpReturn {
  // 現在の状態
  state: DressUpState;
  // 服を着せる
  equipItem: (item: ClothingItemData) => void;
  // 服を脱がせる
  unequipItem: (type: ClothingType) => void;
  // 指定タイプの装備アイテムを取得
  getEquippedItem: (type: ClothingType) => EquippedItem | null;
  // 装備中のアイテム一覧を取得（レンダリング順）
  getEquippedItems: () => EquippedItem[];
  // 全ての服を脱がせる（下着は残す）
  resetAll: () => void;
  // 下着も含めて全て脱がせる
  resetAllIncludingUnderwear: () => void;
}

export function useDressUp(
  initialItems: ClothingItemData[] = [],
  defaultUnderwear: ClothingItemData[] = []
): UseDressUpReturn {
  const [state, setState] = useState<DressUpState>(() =>
    createInitialState(initialItems, defaultUnderwear)
  );

  // 服を着せる（同じタイプの服は置き換え）
  const equipItem = useCallback((item: ClothingItemData) => {
    setState((prev) => {
      // 同じタイプのアイテムを除去
      const filteredItems = prev.equippedItems.filter((e) => e.type !== item.type);

      // 新しいアイテムを追加
      const newEquippedItem: EquippedItem = {
        ...item,
        equipOrder: prev.equipCounter,
      };

      return {
        ...prev,
        equippedItems: [...filteredItems, newEquippedItem],
        equipCounter: prev.equipCounter + 1,
      };
    });
  }, []);

  // 服を脱がせる
  const unequipItem = useCallback((type: ClothingType) => {
    setState((prev) => ({
      ...prev,
      equippedItems: prev.equippedItems.filter((e) => e.type !== type),
    }));
  }, []);

  // 指定タイプの装備アイテムを取得
  const getEquippedItem = useCallback(
    (type: ClothingType): EquippedItem | null => {
      return state.equippedItems.find((e) => e.type === type) ?? null;
    },
    [state.equippedItems]
  );

  // 装備中のアイテム一覧を取得（レンダリング順にソート）
  // 1. baseZIndex（タイプごとの基本重ね順）
  // 2. equipOrder（後から着せたものが上）
  const getEquippedItems = useCallback((): EquippedItem[] => {
    return [...state.equippedItems].sort((a, b) => {
      const baseA = BASE_Z_INDEX[a.type];
      const baseB = BASE_Z_INDEX[b.type];

      // まず基本zIndexで比較
      if (baseA !== baseB) {
        return baseA - baseB;
      }

      // 同じカテゴリ内では着せた順番で（後が上）
      return a.equipOrder - b.equipOrder;
    });
  }, [state.equippedItems]);

  // 全ての服を脱がせる（下着は残す）
  const resetAll = useCallback(() => {
    setState((prev) => ({
      ...prev,
      equippedItems: prev.equippedItems.filter(
        (e) => e.type === 'underwear_top' || e.type === 'underwear_bottom'
      ),
    }));
  }, []);

  // 下着も含めて全て脱がせる
  const resetAllIncludingUnderwear = useCallback(() => {
    setState((prev) => ({
      ...prev,
      equippedItems: [],
      equipCounter: 0,
    }));
  }, []);

  return {
    state,
    equipItem,
    unequipItem,
    getEquippedItem,
    getEquippedItems,
    resetAll,
    resetAllIncludingUnderwear,
  };
}
