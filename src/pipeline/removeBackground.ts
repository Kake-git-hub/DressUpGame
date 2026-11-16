/**
 * 不透明な画像の背景を透明にする純粋関数
 * 四隅の色を背景色とみなし、画像の縁からつながっている「背景色に近い画素」だけを消す。
 * 服の内側にある同じ色は、縁とつながっていないので残る。
 */
import type { Pixels } from './alpha';

// 四隅の色がこれ以上離れていたら、単色背景ではないとみなして何もしない
const CORNER_SPREAD_LIMIT = 40;

function distance(rgba: Pixels, i: number, r: number, g: number, b: number): number {
  const dr = rgba[i] - r;
  const dg = rgba[i + 1] - g;
  const db = rgba[i + 2] - b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function removeBorderBackground(rgba: Pixels, width: number, height: number, tolerance = 60): boolean {
  if (width === 0 || height === 0) return false;
  const corners = [0, width - 1, (height - 1) * width, height * width - 1].map((p) => p * 4);
  const r = Math.round(corners.reduce((s, i) => s + rgba[i], 0) / 4);
  const g = Math.round(corners.reduce((s, i) => s + rgba[i + 1], 0) / 4);
  const b = Math.round(corners.reduce((s, i) => s + rgba[i + 2], 0) / 4);
  if (corners.some((i) => distance(rgba, i, r, g, b) > CORNER_SPREAD_LIMIT)) return false;

  const total = width * height;
  const visited = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  const push = (p: number) => {
    if (visited[p]) return;
    visited[p] = 1;
    if (distance(rgba, p * 4, r, g, b) <= tolerance) stack[top++] = p;
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (top > 0) {
    const p = stack[--top];
    rgba[p * 4 + 3] = 0;
    const x = p % width;
    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (p >= width) push(p - width);
    if (p < total - width) push(p + width);
  }
  return true;
}
