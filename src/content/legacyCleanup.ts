/**
 * 旧方式（アプリ内取り込み）のデータを片付ける
 * 新方式の初回起動で 1 回だけ実行する。
 */
const MARKER_KEY = 'dressup_content_v1';

// 旧方式が使っていた localStorage のキー。
// ドール・背景・服装の選択も消す（ID の付け方が変わったので引き継げない）。
const LEGACY_KEYS = [
  'dressup_custom_dolls',
  'dressup_custom_clothing',
  'dressup_custom_backgrounds',
  'dressup_doll_presets',
  'dressup_current_doll_id',
  'dressup_current_background_id',
  'dressup_outfit',
  'dressup_equipped_items',
];
const LEGACY_DATABASE = 'DressUpAssets';

const DATABASE_MARKER_KEY = 'dressup_legacy_db_deleted';

// 旧方式の小さな状態を消す。ID の付け方が変わったので、残すと新しい素材と食い違う。
// アプリの状態を読む前に呼ぶ。
export function cleanupLegacyData(): void {
  try {
    if (localStorage.getItem(MARKER_KEY) !== null) return;
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
    localStorage.setItem(MARKER_KEY, '1');
  } catch (error) {
    console.error('旧データの削除エラー:', error);
  }
}

// 画像を保存していた IndexedDB（数十MB）を削除する。
// 新しい素材が読めると分かってから呼ぶ（読めないうちに消すと、何も残らなくなる）。
export function deleteLegacyDatabase(): void {
  try {
    if (localStorage.getItem(DATABASE_MARKER_KEY) !== null) return;
    indexedDB.deleteDatabase(LEGACY_DATABASE);
    localStorage.setItem(DATABASE_MARKER_KEY, '1');
  } catch (error) {
    console.error('旧データベースの削除エラー:', error);
  }
}
