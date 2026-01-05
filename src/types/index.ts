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

// 服アイテムの種類（動的に拡張可能なstring型）
export type ClothingType = string;

// カテゴリー表示情報
export interface CategoryInfo {
  type: ClothingType;
  label: string;
  emoji: string;
}

// デフォルトカテゴリの定義（フォルダ名からのマッピング用）
export const DEFAULT_CATEGORY_MAP: Record<string, { label: string; emoji: string; zIndex: number; position: { x: number; y: number }; anchorType: string }> = {
  'top': { label: 'トップス', emoji: '👚', zIndex: 20, position: { x: 0, y: -30 }, anchorType: 'torso' },
  'bottom': { label: 'ボトムス', emoji: '👖', zIndex: 10, position: { x: 0, y: 30 }, anchorType: 'hip' },
  'dress': { label: 'ワンピース', emoji: '👗', zIndex: 15, position: { x: 0, y: 0 }, anchorType: 'torso' },
  'shoes': { label: 'くつ', emoji: '👟', zIndex: 5, position: { x: 0, y: 135 }, anchorType: 'feet' },
  'accessory': { label: 'アクセサリー', emoji: '🎀', zIndex: 30, position: { x: 0, y: -125 }, anchorType: 'head' },
  'hat': { label: 'ぼうし', emoji: '🎩', zIndex: 32, position: { x: 0, y: -140 }, anchorType: 'head' },
  'socks': { label: 'くつした', emoji: '🧦', zIndex: 4, position: { x: 0, y: 100 }, anchorType: 'feet' },
  'bag': { label: 'かばん', emoji: '👜', zIndex: 35, position: { x: 60, y: 0 }, anchorType: 'torso' },
  'underwear_top': { label: 'したぎ(うえ)', emoji: '🩱', zIndex: 0, position: { x: 0, y: -30 }, anchorType: 'torso' },
  'underwear_bottom': { label: 'したぎ(した)', emoji: '🩲', zIndex: 1, position: { x: 0, y: 30 }, anchorType: 'hip' },
};

// フォルダ名からカテゴリ情報を取得（なければデフォルト作成）
export function getCategoryInfo(folderName: string): CategoryInfo {
  const lower = folderName.toLowerCase();
  const mapping = DEFAULT_CATEGORY_MAP[lower];
  if (mapping) {
    return { type: lower, label: mapping.label, emoji: mapping.emoji };
  }
  // 未知のカテゴリはフォルダ名をそのまま使用
  return { type: lower, label: folderName, emoji: '📁' };
}

// レガシー互換: 静的カテゴリリスト
export const CLOTHING_CATEGORIES: CategoryInfo[] = [
  { type: 'top', label: 'トップス', emoji: '👚' },
  { type: 'bottom', label: 'ボトムス', emoji: '👖' },
  { type: 'dress', label: 'ワンピース', emoji: '👗' },
  { type: 'shoes', label: 'くつ', emoji: '👟' },
  { type: 'accessory', label: 'アクセサリー', emoji: '🎀' },
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
  dollId?: string; // 紐付けられたドールID（プリセット取り込み時に設定）
  // 自動スケーリング用のアンカー情報
  anchorType?: 'head' | 'neck' | 'torso' | 'hip' | 'feet'; // どの部位に合わせるか
}

// 装備中のアイテム（動的zIndex付き）
export interface EquippedItem extends ClothingItemData {
  equipOrder: number; // 着せた順番
}

// 背景画像の定義
export interface BackgroundData {
  id: string;
  name: string;
  imageUrl: string; // 背景画像URL
  thumbnailUrl?: string; // サムネイル画像URL（オプション）
  tags?: string[];
  author?: string;
  createdAt?: string;
  isCustom?: boolean;
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

// ========== プリセット関連の型 ==========

// ドール専用プリセット（ドールと専用服をセットで管理）
export interface DollPreset {
  id: string;                     // プリセットID（フォルダ名: doll-chibi等）
  name: string;                   // 表示名
  doll: DollData;                 // ドールデータ
  clothingItems: ClothingItemData[];  // このドール専用の服
  categories: CategoryInfo[];     // 使用可能なカテゴリ（フォルダから動的に検出）
}

// ドールの位置・サイズ調整用
export interface DollTransform {
  x: number;      // X位置（%）
  y: number;      // Y位置（%）
  scale: number;  // スケール（1.0 = 100%）
}

// ゲーム状態
export interface GameState {
  phase: 'doll-select' | 'background-select' | 'dress-up' | 'complete';
  selectedPresetId: string | null;
  selectedBackgroundId: string | null;
  dollTransform: DollTransform;
}
