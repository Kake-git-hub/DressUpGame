/**
 * 透明度に関する純粋関数（ブラウザでも Node でも使える）
 */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Pixels = Uint8ClampedArray | Uint8Array;

// これ以下の alpha は「透明」とみなす
const ALPHA_THRESHOLD = 8;

// 透明でない画素の外接矩形。全部透明なら null
export function alphaBBox(rgba: Pixels, width: number, height: number): Box | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3] > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// 全画素が不透明か（＝背景が抜かれていない画像か）
export function isFullyOpaque(rgba: Pixels): boolean {
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 250) return false;
  }
  return true;
}
