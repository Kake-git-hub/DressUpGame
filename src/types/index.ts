/**
 * 着せ替えゲームの型定義
 * Types for the dress-up game
 */

// 位置を表す型
export interface Position {
  x: number;
  y: number;
}

// 関節ポイントの定義（将来のVtuber連携用）
export interface JointPoint {
  id: string;
  name: string;
  position: Position; // ドール画像内の相対位置（0-1の割合）
  parentId?: string; // 親関節のID（階層構造用）
}

// 関節データ（Vtuber連携用ボーン構造）
export interface JointData {
  // 頭部
  head: JointPoint;
  // 首
  neck: JointPoint;
  // 肩
  leftShoulder: JointPoint;
  rightShoulder: JointPoint;
  // 肘
  leftElbow: JointPoint;
  rightElbow: JointPoint;
  // 手首
  leftWrist: JointPoint;
  rightWrist: JointPoint;
  // 腰
  hip: JointPoint;
  // 膝
  leftKnee: JointPoint;
  rightKnee: JointPoint;
  // 足首
  leftAnkle: JointPoint;
  rightAnkle: JointPoint;
}

// ドールサイズ情報（自動スケーリング用）
export interface DollDimensions {
  width: number;
  height: number;
  // アンカーポイント（スケーリングの基準点）
  anchorPoints: {
    headTop: Position; // 頭頂
    neckCenter: Position; // 首の中心
    torsoCenter: Position; // 胴体中心
    hipCenter: Position; // 腰中心
    footBottom: Position; // 足底
  };
}

// 服アイテムの種類（下着を追加）
export type ClothingType = 'underwear_top' | 'underwear_bottom' | 'top' | 'bottom' | 'dress' | 'accessory' | 'shoes';

// カテゴリー表示情報
export interface CategoryInfo {
  type: ClothingType;
  label: string;
  emoji: string;
}

// 全カテゴリーの定義
export const CLOTHING_CATEGORIES: CategoryInfo[] = [
  { type: 'top', label: 'トップス', emoji: '👚' },
  { type: 'bottom', label: 'ボトムス', emoji: '👖' },
  { type: 'dress', label: 'ワンピース', emoji: '👗' },
  { type: 'shoes', label: 'くつ', emoji: '👟' },
  { type: 'accessory', label: 'アクセサリー', emoji: '🎀' },
  { type: 'underwear_top', label: 'したぎ(うえ)', emoji: '🩱' },
  { type: 'underwear_bottom', label: 'したぎ(した)', emoji: '🩲' },
];

// 服アイテムの定義
export interface ClothingItemData {
  id: string;
  name: string;
  type: ClothingType;
  imageUrl: string;
  position: Position; // ドール上での配置位置（基準サイズ200x300時）
  baseZIndex: number; // 基本重ね順（タイプごとのベース値）
  tags?: string[]; // 検索/フィルタ用タグ
  author?: string; // 作者名
  createdAt?: string; // 作成日
  isCustom?: boolean; // カスタムアイテムかどうか
  // 自動スケーリング用のアンカー情報
  anchorType?: 'head' | 'neck' | 'torso' | 'hip' | 'feet'; // どの部位に合わせるか
}

// 装備中のアイテム（動的zIndex付き）
export interface EquippedItem extends ClothingItemData {
  equipOrder: number; // 着せた順番
}

// ドールの定義（関節情報付き）
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
  // 画像サイズ情報（自動スケーリング用）
  dimensions?: DollDimensions;
  // 関節データ（Vtuber連携用）
  joints?: JointData;
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
