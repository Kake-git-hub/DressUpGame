/**
 * 右下に残った小さなマーク（画像生成サービスの透かしなど）を消す純粋関数
 * 本体とつながっておらず、右下隅の近くに収まる小さな塊だけを対象にする。
 * 右下まで続く絵柄や、ほかの場所にある小物（アクセサリーなど）は消さない。
 */
import type { Pixels } from './alpha';

const CORNER_REACH = 120; // 右下隅からこの範囲に収まっていること
const MAX_SIZE = 80; // 塊の外接矩形の一辺の上限
const ALPHA_THRESHOLD = 8;

// 消した塊があれば true
export function removeCornerSpeck(rgba: Pixels, width: number, height: number): boolean {
  const left = Math.max(0, width - CORNER_REACH);
  const topEdge = Math.max(0, height - CORNER_REACH);
  const visited = new Uint8Array(width * height);
  const opaque = (p: number) => rgba[p * 4 + 3] > ALPHA_THRESHOLD;
  let removed = false;

  for (let y = topEdge; y < height; y++) {
    for (let x = left; x < width; x++) {
      const start = y * width + x;
      if (visited[start] || !opaque(start)) continue;

      // 塊をたどる。範囲の外へ出るか大きすぎたら「本体の一部」とみなして打ち切る
      const component: number[] = [];
      const stack = [start];
      visited[start] = 1;
      let keep = false;
      let minX = x, maxX = x, minY = y, maxY = y;
      while (stack.length > 0) {
        const p = stack.pop()!;
        const px = p % width;
        const py = (p - px) / width;
        if (px < left || py < topEdge) {
          keep = true;
          continue; // 範囲外へは広げない（本体全体をたどらない）
        }
        component.push(p);
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        const neighbours = [px > 0 ? p - 1 : -1, px < width - 1 ? p + 1 : -1, py > 0 ? p - width : -1, py < height - 1 ? p + width : -1];
        for (const n of neighbours) {
          if (n >= 0 && !visited[n] && opaque(n)) {
            visited[n] = 1;
            stack.push(n);
          }
        }
      }
      if (keep || maxX - minX + 1 > MAX_SIZE || maxY - minY + 1 > MAX_SIZE) continue;
      for (const p of component) rgba[p * 4 + 3] = 0;
      removed = true;
    }
  }
  return removed;
}
