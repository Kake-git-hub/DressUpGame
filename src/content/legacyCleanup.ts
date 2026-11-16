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

export function cleanupLegacyData(): void {
  try {
    if (localStorage.getItem(MARKER_KEY) !== null) return;
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
    localStorage.setItem(MARKER_KEY, '1');
  } catch (error) {
    console.error('旧データの削除エラー:', error);
    return;
  }
  try {
    // 画像を保存していた IndexedDB（数十MB）を削除する
    indexedDB.deleteDatabase(LEGACY_DATABASE);
  } catch (error) {
    console.error('旧データベースの削除エラー:', error);
  }
}
