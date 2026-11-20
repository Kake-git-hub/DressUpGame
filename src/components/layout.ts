/**
 * 画面の配置（横・縦）
 *
 * 横: キャンバスは画面いっぱい。メニューは左、ボタンは右（描画は、その分をよけて中央に寄せる）。
 * 縦: キャンバスは「画面の幅 × 背景の正方形の一辺」にして上に置き、メニュー類は下にまとめる。
 *     描画は「キャンバスの高さ = 背景の正方形の一辺」で計算しているので、キャンバスの大きさを変えるだけでよい。
 */
export interface Layout {
  orientation: 'landscape' | 'portrait';
  // 縦: 上のあきの下に、幅いっぱい × 正方形の一辺。横: 画面いっぱい（top は使わない）
  canvas: { top: number; width: number; height: number };
  menuOffset: number; // 横 160、縦 0
  rightOffset: number; // 横 60、縦 0
  itemRows: number; // 縦の、服の行の段数（1〜3）。横は 0
  menuHeight: number; // 縦の、下のメニュー全体の高さ（下のあきを除く）。横は 0
}

// 横のメニュー幅と、右ボタン領域の幅（ボタン 44px + 余白 16px）
export const MENU_WIDTH = 160;
export const RIGHT_BUTTON_WIDTH = 60;
// 縦の、下のメニューの行の高さ
export const CATEGORY_ROW = 84;
export const ITEM_ROW = 84;
export const TOOL_ROW = 56;
const MAX_ITEM_ROWS = 3;
const MIN_STAGE = 120;

export function computeLayout(width: number, height: number, insets: { top: number; bottom: number }): Layout {
  const w = Math.max(0, Math.floor(width));
  const h = Math.max(0, Math.floor(height));
  if (h <= w) {
    return { orientation: 'landscape', canvas: { top: 0, width: w, height: h }, menuOffset: MENU_WIDTH, rightOffset: RIGHT_BUTTON_WIDTH, itemRows: 0, menuHeight: 0 };
  }
  const baseMenu = CATEGORY_ROW + ITEM_ROW + TOOL_ROW;
  const available = h - insets.top - insets.bottom;
  // 背景の正方形: 幅いっぱい。高さが足りなければ、メニューが収まるように小さくする
  const stage = Math.max(MIN_STAGE, Math.min(w, Math.floor(available - baseMenu)));
  // 余った高さは、服の行を増やすのに使う
  const spare = available - stage - baseMenu;
  const extraRows = Math.max(0, Math.min(MAX_ITEM_ROWS - 1, Math.floor(spare / ITEM_ROW)));
  return {
    orientation: 'portrait',
    canvas: { top: insets.top, width: w, height: stage },
    menuOffset: 0,
    rightOffset: 0,
    itemRows: 1 + extraRows,
    menuHeight: baseMenu + ITEM_ROW * extraRows,
  };
}
