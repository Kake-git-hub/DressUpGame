/**
 * 切り抜いた絵のふちに残った、背景色の混ざりを取る純粋関数
 *
 * 単色の背景から切り抜くと、輪郭線（暗い線）や半透明のふちに背景色が混ざって残る
 * （緑の背景なら、こげ茶の線がオリーブ色に見える）。形と不透明度は変えずに、色だけを直す。
 */
import { dilate } from './morph';
import type { Rgb } from './keyColors';

// これより暗い画素（いちばん大きい成分）を「線」とみなす。明るい色（うすい色の髪や服）は、もともとの色かもしれないので触らない
const LINE_MAX = 140;
// 背景色の成分を、ほかの成分の平均よりこれだけ上までに切り下げる
const SPILL_MARGIN = 8;
// 半透明のふちの色を借りてくる範囲（px）と、「不透明」とみなす不透明度
const BORROW_REACH = 3;
const SOLID = 250;

/**
 * rgba をその場で直す。key: 切り抜いた背景の色。reach: 透明との境目から、この px 以内の画素だけを直す。
 * 背景が白のように、どの成分も大きい色のときは、混ざりと絵の色を区別できないので何もしない
 */
export function cleanKeyEdge(rgba: Uint8ClampedArray, width: number, height: number, key: Rgb, reach: number): void {
  const high = [0, 1, 2].filter((c) => key[c] >= 128);
  const low = [0, 1, 2].filter((c) => key[c] < 128);
  if (high.length === 0 || low.length === 0) return;
  const total = width * height;
  const clear = new Uint8Array(total);
  for (let p = 0; p < total; p++) clear[p] = rgba[p * 4 + 3] < 128 ? 1 : 0;
  const edge = dilate(clear, width, height, reach);

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const alpha = rgba[i + 3];
    if (!edge[p] || alpha === 0) continue;
    if (alpha >= SOLID && Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) >= LINE_MAX) continue;
    let sum = 0;
    for (const c of low) sum += rgba[i + c];
    const limit = Math.round(sum / low.length) + SPILL_MARGIN;
    for (const c of high) if (rgba[i + c] > limit) rgba[i + c] = limit;
  }
  // 半透明のふち: 背景と混ざった色なので、いちばん近い不透明な画素の色を借りる（不透明度はそのまま）
  const before = new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const alpha = before[p * 4 + 3];
      if (!edge[p] || alpha === 0 || alpha >= SOLID) continue;
      let best = -1;
      let bestDistance = Infinity;
      for (let yy = Math.max(0, y - BORROW_REACH); yy <= Math.min(height - 1, y + BORROW_REACH); yy++) {
        for (let xx = Math.max(0, x - BORROW_REACH); xx <= Math.min(width - 1, x + BORROW_REACH); xx++) {
          const q = yy * width + xx;
          if (before[q * 4 + 3] < SOLID) continue;
          const d = (xx - x) * (xx - x) + (yy - y) * (yy - y);
          if (d < bestDistance) {
            bestDistance = d;
            best = q;
          }
        }
      }
      if (best < 0) continue;
      rgba[p * 4] = before[best * 4];
      rgba[p * 4 + 1] = before[best * 4 + 1];
      rgba[p * 4 + 2] = before[best * 4 + 2];
    }
  }
}
