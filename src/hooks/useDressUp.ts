/**
 * 着せ替え状態を管理するカスタムフック
 * Custom hook for managing dress-up state
 */
import { useState, useCallback, useMemo } from 'react';
import type { ClothingItemData, ClothingType, DressUpState, EquippedItem } from '../types';
import { sortByLayer } from '../engine/layers';

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
  layerAdjust?: number;    // レイヤー調整（+で手前、-で奥）
  colorHue?: number;       // 色相調整（-180〜180度）
}

export interface UseDressUpReturn {
  // 現在の状態
  state: DressUpState;
  // 服を着せる。back は対のうしろがみ（前髪と一緒に着せる）
  equipItem: (item: ClothingItemData, back?: ClothingItemData) => void;
  // 服を脱がせる
  unequipItem: (type: ClothingType) => void;
  // 着ている服を 1 着だけ脱がせる（重ね着できるカテゴリでも、ほかは残す）
  unequipItemById: (itemId: string) => void;
  // 指定タイプの装備アイテムを取得
  getEquippedItem: (type: ClothingType) => EquippedItem | null;
  // 装備中のアイテム一覧（レンダリング順）。装備が変わらない限り同じ配列参照を返す
  equippedItems: EquippedItem[];
  // 全ての服を脱がせる（下着は残す）
  resetAll: () => void;
  // 下着も含めて全て脱がせる
  resetAllIncludingUnderwear: () => void;
  // アイテムの調整値を更新
  updateItemAdjustment: (itemId: string, adjustment: ItemAdjustment) => void;
  // 最後に着せたアイテムを取得
  getLastEquippedItem: () => EquippedItem | null;
  // 保存された装備で丸ごと置き換える
  restoreEquipped: (items: EquippedItem[]) => void;
}

export function useDressUp(
  initialItems: ClothingItemData[] = [],
  defaultUnderwear: ClothingItemData[] = []
): UseDressUpReturn {
  const [state, setState] = useState<DressUpState>(() => createInitialState(initialItems, defaultUnderwear));

  // 保存された装備で丸ごと置き換える（起動時の復元用）
  const restoreEquipped = useCallback((items: EquippedItem[]) => {
    setState((prev) => ({
      ...prev,
      equippedItems: items,
      equipCounter: Math.max(prev.equipCounter, ...items.map((i) => i.equipOrder + 1)),
    }));
  }, []);

  // 服を着せる（同じタイプの服は置き換え、ただしallowOverlap=trueのアイテムは重複可能）。
  // back（対のうしろがみ）があれば一緒に着せる。置き換えで脱げた髪の、対のうしろがみは外す
  const equipItem = useCallback((item: ClothingItemData, back?: ClothingItemData) => {
    setState((prev) => {
      // allowOverlap=true の場合は、同じIDのアイテムのみ除去（同じアイテムの再装備）
      const replaces = (e: EquippedItem, added: ClothingItemData) => (added.allowOverlap ? e.id === added.id : e.type === added.type);
      const orphans = new Set(prev.equippedItems.flatMap((e) => (replaces(e, item) && e.backItemId ? [e.backItemId] : [])));
      const kept = prev.equippedItems.filter((e) => !replaces(e, item) && !orphans.has(e.id) && !(back && replaces(e, back)));

      // うしろがみを先に、前髪を後に（「最後に着た服」は前髪）
      const added = [...(back ? [back] : []), item].map((x, i): EquippedItem => ({ ...x, equipOrder: prev.equipCounter + i }));

      return {
        ...prev,
        equippedItems: [...kept, ...added],
        equipCounter: prev.equipCounter + added.length,
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

  const unequipItemById = useCallback((itemId: string) => {
    setState((prev) => ({
      ...prev,
      equippedItems: prev.equippedItems.filter((e) => e.id !== itemId),
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
  // layerAdjust（一時的なレイヤー調整）を加算して最終レイヤー値を決定
  // layerOrderがない場合はbaseZIndexを使用、最後にequipOrderで安定ソート
  const equippedItems = useMemo((): EquippedItem[] => sortByLayer(state.equippedItems), [state.equippedItems]);

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
              layerAdjust: adjustment.layerAdjust ?? item.layerAdjust,
              colorHue: adjustment.colorHue ?? item.colorHue,
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
    unequipItemById,
    getEquippedItem,
    equippedItems,
    resetAll,
    resetAllIncludingUnderwear,
    updateItemAdjustment,
    getLastEquippedItem,
    restoreEquipped,
  };
}
