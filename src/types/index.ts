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
  tags?: string[]; // 検索/フィルタ用タグ
  author?: string; // 作者名
  createdAt?: string; // 作成日
  isCustom?: boolean; // カスタムアイテムかどうか
}

// 装備中のアイテム（動的zIndex付き）
export interface EquippedItem extends ClothingItemData {
  equipOrder: number; // 着せた順番
}

// ドールの定義
export interface DollData {
  id: string;
  name: string;
  bodyImageUrl: string; // 体の画像URL
  faceImageUrl?: string; // 顔の画像URL（オプション）
  skinTone?: string; // 肌の色
  defaultUnderwear?: {
    top?: string; // デフォルト下着（上）のID
    bottom?: string; // デフォルト下着（下）のID
  };
  tags?: string[];
  author?: string;
  createdAt?: string;
  isCustom?: boolean;
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

// ドールの設定（レガシー互換）
export interface DollConfig {
  width: number;
  height: number;
  imageUrl: string;
}

// インポート用のアイテムデータ形式
export interface ImportItemData {
  id: string;
  name: string;
  type: ClothingType;
  imageFile: string; // ファイル名
  position: Position;
  baseZIndex: number;
  tags?: string[];
  author?: string;
  createdAt?: string;
}

// インポート用のドールデータ形式
export interface ImportDollData {
  id: string;
  name: string;
  bodyImageFile: string;
  faceImageFile?: string;
  skinTone?: string;
  defaultUnderwear?: {
    top?: string;
    bottom?: string;
  };
  tags?: string[];
  author?: string;
  createdAt?: string;
}

// インポートファイルの形式
export interface ImportItemsFile {
  version: string;
  items: ImportItemData[];
}

export interface ImportDollsFile {
  version: string;
  dolls: ImportDollData[];
}

// ゲームデータ全体
export interface GameData {
  dolls: DollData[];
  items: ClothingItemData[];
  selectedDollId: string | null;
}
