/**
 * 画面の配置（横・縦）
 *
 * 横: キャンバスは画面いっぱい。メニューは左、ボタンは右（描画は、その分をよけて中央に寄せる）。
 * 縦: キャンバスは「画面の幅 × 背景の正方形の一辺」にして上に置き、メニュー類は下にまとめる。
 *     描画は「キャンバスの高さ = 背景の正方形の一辺」で計算しているので、キャンバスの大きさを変えるだけでよい。
 *     服の行は 2 段まで。絵の大きさは、画面の幅から決める（スマホで約 104px、タブレットで約 120px）。
 */
export interface Layout {
  orientation: 'landscape' | 'portrait';
  // 縦: 上のあきの下に、幅いっぱい × 正方形の一辺。横: 画面いっぱい（top は使わない）
  canvas: { top: number; width: number; height: number };
  menuOffset: number; // 横 160、縦 0
  rightOffset: number; // 横 60、縦 0
  itemRows: number; // 縦の、服の行の段数（1〜2）。横は 0
  itemTile: number; // 縦の、服の絵の一辺（px）。横は 0
  menuHeight: number; // 縦の、下のメニュー全体の高さ（下のあきを除く）。横は 0
  phone: boolean; // 縦で、幅が 600px 未満（スマホ）。横は false
}

// 横のメニュー幅と、右ボタン領域の幅（ボタン 44px + 余白 16px）
export const MENU_WIDTH = 160;
export const RIGHT_BUTTON_WIDTH = 60;
// 縦の、下のメニューの行の高さ
export const CATEGORY_ROW = 84;
export const TOOL_ROW = 56;
// 服の行の高さ = 絵 + これ（段の間のあき）
const ITEM_ROW_GAP = 12;
const MAX_ITEM_ROWS = 2;
const MIN_STAGE = 120;
// 縦で、これより幅が狭ければスマホ
export const PHONE_MAX_WIDTH = 600;
// 2 段にしてよいのは、正方形（ドールの場所）が、幅のこの割合より小さくならないとき。
// スマホは、もともとドールが小さいので縮めない。タブレットは、少し縮めても 2 段にする
const MIN_STAGE_SHARE_PHONE = 0.9;
const MIN_STAGE_SHARE_TABLET = 0.75;

// 服の行の、タイルの間と、左のあき（App.css の .portrait-items と同じ値）
const TILE_GAP = 8;
const ROW_PAD = 8;

/**
 * 縦の、服の絵の一辺（px）。
 * 目安は「幅 × 0.267 を、96〜120 に収める」。そのうえで、右端に次の服が 3〜7 割のぞくように合わせる
 * （横に流せることが、見て分かるように）。合わせるのは、目安の ±12% まで
 */
export function portraitTile(width: number): number {
  const base = Math.min(120, Math.max(96, Math.round(width * 0.267)));
  const seen = (tile: number) => (width - ROW_PAD) / (tile + TILE_GAP); // 見える点数
  const peek = seen(base) - Math.floor(seen(base));
  if (peek >= 0.3 && peek <= 0.7) return base;
  // n 点がまるごと見えて、次が半分のぞく大きさ
  const n = Math.max(1, Math.round(seen(base) - 0.5));
  const fitted = Math.floor((width - ROW_PAD) / (n + 0.5)) - TILE_GAP;
  return Math.round(Math.min(base * 1.12, Math.max(base * 0.88, fitted)));
}

export function computeLayout(width: number, height: number, insets: { top: number; bottom: number }): Layout {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (h <= w) {
    return {
      orientation: 'landscape',
      canvas: { top: 0, width: w, height: h },
      menuOffset: MENU_WIDTH,
      rightOffset: RIGHT_BUTTON_WIDTH,
      itemRows: 0,
      itemTile: 0,
      menuHeight: 0,
      phone: false,
    };
  }
  const phone = w < PHONE_MAX_WIDTH;
  const tile = portraitTile(w);
  const row = tile + ITEM_ROW_GAP;
  const fixed = CATEGORY_ROW + TOOL_ROW;
  const available = h - insets.top - insets.bottom;
  // 背景の正方形: 幅いっぱい。高さが足りなければ、メニューが収まるように小さくする
  const stageFor = (rows: number) => Math.min(w, Math.floor(available - fixed - rows * row));
  const share = phone ? MIN_STAGE_SHARE_PHONE : MIN_STAGE_SHARE_TABLET;
  const rows = stageFor(MAX_ITEM_ROWS) >= w * share ? MAX_ITEM_ROWS : 1;
  return {
    orientation: 'portrait',
    canvas: { top: insets.top, width: w, height: Math.max(MIN_STAGE, stageFor(rows)) },
    menuOffset: 0,
    rightOffset: 0,
    itemRows: rows,
    itemTile: tile,
    menuHeight: fixed + rows * row,
    phone,
  };
}
