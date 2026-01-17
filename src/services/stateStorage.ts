/**
 * アプリ状態の永続化サービス
 * ブラウザを離れても状態を維持
 */
import type { DollTransform, EquippedItem } from '../types';

const STORAGE_KEYS = {
  EQUIPPED_ITEMS: 'dressup_equipped_items',
  DOLL_TRANSFORM: 'dressup_doll_transform',
  CURRENT_DOLL_ID: 'dressup_current_doll_id',
  CURRENT_BACKGROUND_ID: 'dressup_current_background_id',
  // バージョン管理（古いデータを無効化するため）
  STATE_VERSION: 'dressup_state_version',
} as const;

// 現在の状態バージョン（形式変更時にインクリメント）
const CURRENT_STATE_VERSION = 2;

// バージョンチェック（古いデータをクリア）
function checkAndMigrateVersion(): void {
  try {
    const savedVersion = localStorage.getItem(STORAGE_KEYS.STATE_VERSION);
    const version = savedVersion ? parseInt(savedVersion, 10) : 0;
    
    if (version < CURRENT_STATE_VERSION) {
      // 古いドール位置データをクリア（新しいデフォルト値を使用させる）
      localStorage.removeItem(STORAGE_KEYS.DOLL_TRANSFORM);
      localStorage.setItem(STORAGE_KEYS.STATE_VERSION, String(CURRENT_STATE_VERSION));
      console.log(`State migrated from version ${version} to ${CURRENT_STATE_VERSION}`);
    }
  } catch (error) {
    console.error('バージョンチェックエラー:', error);
  }
}

// 初期化時にバージョンチェック
checkAndMigrateVersion();

// 装備アイテムを保存
export function saveEquippedItems(items: EquippedItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.EQUIPPED_ITEMS, JSON.stringify(items));
  } catch (error) {
    console.error('装備アイテム保存エラー:', error);
  }
}

// 装備アイテムを読み込み
export function loadEquippedItems(): EquippedItem[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.EQUIPPED_ITEMS);
    if (!data) return [];
    return JSON.parse(data) as EquippedItem[];
  } catch (error) {
    console.error('装備アイテム読み込みエラー:', error);
    return [];
  }
}

// ドール位置を保存
export function saveDollTransform(transform: DollTransform): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DOLL_TRANSFORM, JSON.stringify(transform));
  } catch (error) {
    console.error('ドール位置保存エラー:', error);
  }
}

// ドール位置を読み込み
export function loadDollTransform(): DollTransform | null {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.DOLL_TRANSFORM);
    if (!data) return null;
    return JSON.parse(data) as DollTransform;
  } catch (error) {
    console.error('ドール位置読み込みエラー:', error);
    return null;
  }
}

// 現在のドールIDを保存
export function saveCurrentDollId(dollId: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CURRENT_DOLL_ID, dollId);
  } catch (error) {
    console.error('ドールID保存エラー:', error);
  }
}

// 現在のドールIDを読み込み
export function loadCurrentDollId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_DOLL_ID);
  } catch (error) {
    console.error('ドールID読み込みエラー:', error);
    return null;
  }
}

// 現在の背景IDを保存
export function saveCurrentBackgroundId(bgId: string | null): void {
  try {
    if (bgId === null) {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_BACKGROUND_ID);
    } else {
      localStorage.setItem(STORAGE_KEYS.CURRENT_BACKGROUND_ID, bgId);
    }
  } catch (error) {
    console.error('背景ID保存エラー:', error);
  }
}

// 現在の背景IDを読み込み
export function loadCurrentBackgroundId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_BACKGROUND_ID);
  } catch (error) {
    console.error('背景ID読み込みエラー:', error);
    return null;
  }
}

// 全状態をクリア
export function clearAllState(): void {
  try {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  } catch (error) {
    console.error('状態クリアエラー:', error);
  }
}
