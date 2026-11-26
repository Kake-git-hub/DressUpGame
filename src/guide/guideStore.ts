/**
 * 操作ガイドを見たかどうか（端末に覚える）。場面ごとに 1 回だけ出す。
 * 端末の保存が読めない・書けないときは「見た」として扱う（毎回出ると、じゃまになるので）。
 */
export type GuideName = 'play' | 'worn' | 'adjust' | 'studio';
export const GUIDE_NAMES: GuideName[] = ['play', 'worn', 'adjust', 'studio'];
export const GUIDE_KEY = 'dressup_guide_seen';

function read(): GuideName[] | null {
  try {
    const raw = localStorage.getItem(GUIDE_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((x): x is GuideName => GUIDE_NAMES.includes(x as GuideName)) : [];
  } catch {
    return null;
  }
}

// まだ見ていないか（読めなければ false = 出さない）
export function shouldShowGuide(name: GuideName): boolean {
  const list = read();
  return list !== null && !list.includes(name);
}

export function markGuideSeen(name: GuideName): void {
  const list = read();
  if (list === null || list.includes(name)) return;
  try {
    localStorage.setItem(GUIDE_KEY, JSON.stringify([...list, name]));
  } catch {
    // 書けない端末: 何もしない
  }
}

// 「つかいかた」: 覚えを消す（次にその場面になると、また出る）
export function resetGuides(): void {
  try {
    localStorage.removeItem(GUIDE_KEY);
  } catch {
    // 何もしない
  }
}
