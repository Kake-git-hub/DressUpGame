/**
 * 本体から離れた所に残った、ごく小さなかけら（切り抜きの消し残し）を消す純粋関数
 *
 * かけらが 1 つでも残ると、服の外接矩形がそこまで広がり、調整の枠や一覧の絵が小さくなる。
 * 本体のすぐそばの小さな飾り（きらきら・泡など）は残す。
 */
import type { Pixels } from './alpha';

const ALPHA_THRESHOLD = 8;
const MAX_AREA_SHARE = 0.00012; // かけらとみなす面積の上限（キャンバスの面積に対する割合。1024px で約 125 画素）
const MIN_DISTANCE_SHARE = 0.04; // 本体の外接矩形からこれ以上離れていること（キャンバスの幅に対する割合）

// 消した画素の数を返す
export function removeFarSpecks(rgba: Pixels, width: number, height: number): number {
  const total = width * height;
  const label = new Int32Array(total); // 0 = 未訪問
  const stack = new Int32Array(total);
  const opaque = (p: number) => rgba[p * 4 + 3] > ALPHA_THRESHOLD;
  const parts: { area: number; x0: number; y0: number; x1: number; y1: number }[] = [];
  for (let start = 0; start < total; start++) {
    if (label[start] || !opaque(start)) continue;
    const id = parts.length + 1;
    const part = { area: 0, x0: width, y0: height, x1: -1, y1: -1 };
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const p = stack[--top];
      const x = p % width;
      const y = (p - x) / width;
      part.area++;
      if (x < part.x0) part.x0 = x;
      if (x > part.x1) part.x1 = x;
      if (y < part.y0) part.y0 = y;
      if (y > part.y1) part.y1 = y;
      // ななめも、つながっているとみなす
      for (let ny = Math.max(0, y - 1); ny <= Math.min(height - 1, y + 1); ny++) {
        for (let nx = Math.max(0, x - 1); nx <= Math.min(width - 1, x + 1); nx++) {
          const n = ny * width + nx;
          if (!label[n] && opaque(n)) {
            label[n] = id;
            stack[top++] = n;
          }
        }
      }
    }
    parts.push(part);
  }
  const maxArea = Math.max(4, total * MAX_AREA_SHARE);
  const minDistance = width * MIN_DISTANCE_SHARE;
  const bodies = parts.filter((p) => p.area > maxArea);
  if (bodies.length === 0) return 0; // 全部が小さい（小物そのもの）なら、何も消さない
  const remove = new Uint8Array(parts.length + 1);
  parts.forEach((p, i) => {
    if (p.area > maxArea) return;
    const far = bodies.every((b) => {
      const dx = Math.max(0, b.x0 - p.x1, p.x0 - b.x1);
      const dy = Math.max(0, b.y0 - p.y1, p.y0 - b.y1);
      return Math.hypot(dx, dy) >= minDistance;
    });
    if (far) remove[i + 1] = 1;
  });
  let removed = 0;
  for (let p = 0; p < total; p++) {
    if (remove[label[p]]) {
      rgba[p * 4 + 3] = 0;
      removed++;
    }
  }
  return removed;
}
