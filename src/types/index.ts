/**
 * 着せ替えゲームの型定義
 * Types for the dress-up game
 */

// 位置を表す型
export interface Position {
  x: number;
  y: number;
}

// 服アイテムの種類
export type ClothingType = 'top' | 'bottom' | 'dress' | 'accessory' | 'shoes';

// 服アイテムの定義
export interface ClothingItemData {
  id: string;
  name: string;
  type: ClothingType;
  imageUrl: string;
  position: Position; // ドール上での配置位置
  zIndex: number; // 重ね順
}

// 着せ替え状態
export interface DressUpState {
  equippedItems: Map<ClothingType, ClothingItemData | null>;
  availableItems: ClothingItemData[];
}

// ドラッグ状態
export interface DragState {
  isDragging: boolean;
  item: ClothingItemData | null;
  startPosition: Position | null;
  currentPosition: Position | null;
}

// ドールの設定
export interface DollConfig {
  width: number;
  height: number;
  imageUrl: string;
}
