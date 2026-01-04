/**
 * 着せ替えゲームの型定義
 * Types for the dress-up game
 */

// 位置を表す型
export interface Position {
  x: number;
  y: number;
}

// 服アイテムの種類（下着を追加）
export type ClothingType = 'underwear_top' | 'underwear_bottom' | 'top' | 'bottom' | 'dress' | 'accessory' | 'shoes';

// 服アイテムの定義
export interface ClothingItemData {
  id: string;
  name: string;
  type: ClothingType;
  imageUrl: string;
  position: Position; // ドール上での配置位置
  baseZIndex: number; // 基本重ね順（タイプごとのベース値）
}

// 装備中のアイテム（動的zIndex付き）
export interface EquippedItem extends ClothingItemData {
  equipOrder: number; // 着せた順番
}

// 着せ替え状態
export interface DressUpState {
  equippedItems: EquippedItem[];
  availableItems: ClothingItemData[];
  equipCounter: number; // 着せた順番のカウンター
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
