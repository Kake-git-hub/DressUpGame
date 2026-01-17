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
export const DEFAULT_CATEGORY_MAP: Record<string, { label: string; emoji: string; zIndex: number; position: { x: number; y: number }; anchorType: string; movable?: boolean }> = {
  'top': { label: 'トップス', emoji: '👚', zIndex: 20, position: { x: 0, y: -30 }, anchorType: 'torso' },
  'bottom': { label: 'ボトムス', emoji: '👖', zIndex: 10, position: { x: 0, y: 30 }, anchorType: 'hip' },
  'dress': { label: 'ワンピース', emoji: '👗', zIndex: 15, position: { x: 0, y: 0 }, anchorType: 'torso' },
  'shoes': { label: 'くつ', emoji: '👟', zIndex: 5, position: { x: 0, y: 135 }, anchorType: 'feet' },
  'accessory': { label: 'アクセサリー', emoji: '🎀', zIndex: 30, position: { x: 0, y: -125 }, anchorType: 'head', movable: true },
  'hat': { label: 'ぼうし', emoji: '🎩', zIndex: 32, position: { x: 0, y: -140 }, anchorType: 'head' },
  'socks': { label: 'くつした', emoji: '🧦', zIndex: 4, position: { x: 0, y: 100 }, anchorType: 'feet' },
  'bag': { label: 'かばん', emoji: '👜', zIndex: 35, position: { x: 60, y: 0 }, anchorType: 'torso', movable: true },
  'underwear_top': { label: 'したぎ(うえ)', emoji: '🩱', zIndex: 0, position: { x: 0, y: -30 }, anchorType: 'torso' },
  'underwear_bottom': { label: 'したぎ(した)', emoji: '🩲', zIndex: 1, position: { x: 0, y: 30 }, anchorType: 'hip' },
  'face': { label: '顔パーツ', emoji: '😊', zIndex: 40, position: { x: 0, y: -80 }, anchorType: 'head', movable: true },
};

// フォルダ名から番号とラベルを抽出
// フォーマット1: 「レイヤー順_カテゴリ並び順_ラベル」（例: "01_02_ドレス" → layerOrder: 1, categoryOrder: 2, label: "ドレス"）
// フォーマット2: 「番号_ラベル」（例: "1_くつした" → layerOrder: 1, categoryOrder: undefined, label: "くつした"）
// _movable/_overlapサフィックスは除去
export function parseFolderName(folderName: string): { 
  order: number | undefined; 
  categoryOrder: number | undefined;
  label: string 
} {
  // _movable / _overlap サフィックスを除去
  const withoutSuffix = folderName.replace(/_movable/gi, '').replace(/_overlap/gi, '');
  
  // 新フォーマット: 「レイヤー順_カテゴリ並び順_ラベル」（例: "01_02_ドレス"）
  const newMatch = withoutSuffix.match(/^(\d+)_(\d+)_(.+)$/);
  if (newMatch) {
    return {
      order: parseInt(newMatch[1], 10),
      categoryOrder: parseInt(newMatch[2], 10),
      label: newMatch[3],
    };
  }
  
  // 旧フォーマット: 「番号_ラベル」（例: "1_くつした"）
  const oldMatch = withoutSuffix.match(/^(\d+)_(.+)$/);
  if (oldMatch) {
    return {
      order: parseInt(oldMatch[1], 10),
      categoryOrder: undefined,
      label: oldMatch[2],
    };
  }
  
  // 番号なしの場合
  return {
    order: undefined,
    categoryOrder: undefined,
    label: withoutSuffix,
  };
}

// フォルダ名からカテゴリ情報を取得（なければデフォルト作成）
// フォルダ名に _movable が含まれる場合は自由配置可能
// 番号プレフィックス（例: "1_"）も除去してラベルを取得
export function getCategoryInfo(folderName: string): CategoryInfo {
  // parseFolderNameを使って番号とラベルを分離
  const parsed = parseFolderName(folderName);
  const baseName = parsed.label.toLowerCase();
  
  const mapping = DEFAULT_CATEGORY_MAP[baseName];
  if (mapping) {
    return { type: baseName, label: mapping.label, emoji: mapping.emoji };
  }
  // 未知のカテゴリはパース後のラベルをそのまま使用
  return { type: baseName, label: parsed.label, emoji: '📁' };
}

// フォルダ名から movable フラグを判定
export function isMovableCategory(folderName: string): boolean {
  const lower = folderName.toLowerCase();
  // _movable サフィックスがある場合
  if (lower.includes('_movable')) return true;
  // デフォルトで movable なカテゴリ
  const baseName = lower.replace(/_movable/gi, '').replace(/_overlap/gi, '');
  return DEFAULT_CATEGORY_MAP[baseName]?.movable ?? false;
}

// フォルダ名から overlap（重複可能）フラグを判定
export function isOverlapCategory(folderName: string): boolean {
  return folderName.toLowerCase().includes('_overlap');
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
  thumbnailUrl?: string; // サムネイル画像URL（オプション）
  position: Position; // ドール上での配置位置（基準サイズ200x300時）
  baseZIndex: number; // 基本重ね順（タイプごとのベース値）
  tags?: string[]; // 検索/フィルタ用タグ
  author?: string; // 作者名
  createdAt?: string; // 作成日
  isCustom?: boolean; // カスタムアイテムかどうか
  dollId?: string; // 紐付けられたドールID（プリセット取り込み時に設定）
  // 自動スケーリング用のアンカー情報
  anchorType?: 'head' | 'neck' | 'torso' | 'hip' | 'feet'; // どの部位に合わせるか
  // 自由配置可能フラグ（フォルダ名に_movableがあると有効）
  movable?: boolean;
  // 自由配置時のオフセット（装着後に移動した分）
  offsetX?: number;
  offsetY?: number;
  // レイヤー順（フォルダ名の先頭番号から取得、小さい方が下）
  layerOrder?: number;
  // カテゴリ並び順（フォルダ名の2番目の番号から取得、メニュー表示順）
  categoryOrder?: number;
  // 重複装備可能フラグ（フォルダ名に_overlapがあると有効）
  allowOverlap?: boolean;
}

// 装備中のアイテム（動的zIndex付き）
export interface EquippedItem extends ClothingItemData {
  equipOrder: number; // 着せた順番
  // 自由配置時のオフセット（装着後に移動した分）
  currentOffsetX?: number;
  currentOffsetY?: number;
  // 調整値（位置調整機能で変更した分）
  adjustOffsetX?: number;
  adjustOffsetY?: number;
  adjustScale?: number;    // 1.0が等倍
  adjustRotation?: number; // ラジアン
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
  x: number;        // X位置（%）
  y: number;        // Y位置（%）
  scale: number;    // スケール（1.0 = 100%）
}

// ドールのデフォルト初期位置（全体で統一）
export const DEFAULT_DOLL_TRANSFORM: DollTransform = {
  x: 50,     // 背景中央
  y: 50,     // 背景中央
  scale: 1.0,
};

// ゲーム状態
export interface GameState {
  phase: 'doll-select' | 'background-select' | 'dress-up' | 'complete';
  selectedPresetId: string | null;
  selectedBackgroundId: string | null;
  dollTransform: DollTransform;
}
