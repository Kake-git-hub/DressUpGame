/**
 * 着せ替え状態を管理するカスタムフック
 * Custom hook for managing dress-up state
 */
import { useState, useCallback } from 'react';
import type { ClothingItemData, ClothingType, DressUpState, EquippedItem } from '../types';

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

// アイテム調整値
export interface ItemAdjustment {
  adjustOffsetX?: number;  // 位置オフセットX（ピクセル）
  adjustOffsetY?: number;  // 位置オフセットY（ピクセル）
  adjustScale?: number;    // スケール（1.0がデフォルト）
  adjustRotation?: number; // 回転（度）
}

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
  // アイテムの調整値を更新
  updateItemAdjustment: (itemId: string, adjustment: ItemAdjustment) => void;
  // 最後に着せたアイテムを取得
  getLastEquippedItem: () => EquippedItem | null;
}

export function useDressUp(
  initialItems: ClothingItemData[] = [],
  defaultUnderwear: ClothingItemData[] = [],
  savedEquipped: EquippedItem[] = []
): UseDressUpReturn {
  const [state, setState] = useState<DressUpState>(() => {
    // 保存された装備があればそれを使用
    if (savedEquipped.length > 0) {
      const maxEquipOrder = Math.max(...savedEquipped.map(i => i.equipOrder), 0);
      return {
        equippedItems: savedEquipped,
        availableItems: initialItems,
        equipCounter: maxEquipOrder + 1,
      };
    }
    return createInitialState(initialItems, defaultUnderwear);
  });

  // 服を着せる（同じタイプの服は置き換え、ただしallowOverlap=trueのアイテムは重複可能）
  const equipItem = useCallback((item: ClothingItemData) => {
    setState((prev) => {
      let filteredItems: EquippedItem[];
      
      if (item.allowOverlap) {
        // allowOverlap=trueの場合：同じIDのアイテムのみ除去（同じアイテムの再装備）
        filteredItems = prev.equippedItems.filter((e) => e.id !== item.id);
      } else {
        // 通常：同じタイプのアイテムを除去
        filteredItems = prev.equippedItems.filter((e) => e.type !== item.type);
      }

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
  // layerOrder（フォルダ名の番号）を最優先でソート（小さい方が下＝先に描画）
  // layerOrderがない場合はbaseZIndexを使用、最後にequipOrderで安定ソート
  const getEquippedItems = useCallback((): EquippedItem[] => {
    return [...state.equippedItems].sort((a, b) => {
      // layerOrderがある場合はそれを最優先
      const aLayer = a.layerOrder ?? a.baseZIndex ?? 0;
      const bLayer = b.layerOrder ?? b.baseZIndex ?? 0;
      if (aLayer !== bLayer) {
        return aLayer - bLayer; // 小さい方が下（先に描画）
      }
      // 同じレイヤーなら着せた順番で並べる（後が上）
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

  // アイテムの調整値を更新
  const updateItemAdjustment = useCallback((itemId: string, adjustment: ItemAdjustment) => {
    setState((prev) => ({
      ...prev,
      equippedItems: prev.equippedItems.map((item) =>
        item.id === itemId
          ? {
              ...item,
              adjustOffsetX: adjustment.adjustOffsetX ?? item.adjustOffsetX,
              adjustOffsetY: adjustment.adjustOffsetY ?? item.adjustOffsetY,
              adjustScale: adjustment.adjustScale ?? item.adjustScale,
              adjustRotation: adjustment.adjustRotation ?? item.adjustRotation,
            }
          : item
      ),
    }));
  }, []);

  // 最後に着せたアイテムを取得（最大equipOrderのアイテム）
  const getLastEquippedItem = useCallback((): EquippedItem | null => {
    if (state.equippedItems.length === 0) return null;
    return state.equippedItems.reduce((latest, item) =>
      item.equipOrder > latest.equipOrder ? item : latest
    );
  }, [state.equippedItems]);

  return {
    state,
    equipItem,
    unequipItem,
    getEquippedItem,
    getEquippedItems,
    resetAll,
    resetAllIncludingUnderwear,
    updateItemAdjustment,
    getLastEquippedItem,
  };
}
