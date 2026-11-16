/**
 * 色相変換（純粋関数）
 * PixiJS の ColorMatrixFilter.hue(degrees, false) と同じ行列を使う。
 * 確定後の描画（PixiJS）と、調整中のプレビューが同じ色になる。
 */

// 3x3 行列（行優先、9 要素）。RGB 立方体を明るさの軸のまわりに回転する
export function hueMatrix(degrees: number): number[] {
  const rotation = (degrees / 180) * Math.PI;
  const cosR = Math.cos(rotation);
  const sinR = Math.sin(rotation);
  const w = 1 / 3;
  const sqrW = Math.sqrt(w);
  const diag = cosR + (1 - cosR) * w;
  const plus = w * (1 - cosR) + sqrW * sinR;
  const minus = w * (1 - cosR) - sqrW * sinR;
  return [diag, minus, plus, plus, diag, minus, minus, plus, diag];
}

// source の RGBA を変換して target に書く（同じ配列でもよい）。アルファは変えない
export function applyHue(
  source: Uint8ClampedArray,
  target: Uint8ClampedArray,
  degrees: number
): void {
  if (degrees === 0) {
    if (source !== target) target.set(source);
    return;
  }
  const [a, b, c, d, e, f, g, h, i] = hueMatrix(degrees);
  for (let p = 0; p < source.length; p += 4) {
    const r = source[p];
    const gr = source[p + 1];
    const bl = source[p + 2];
    // Uint8ClampedArray が 0〜255 への丸めと切り詰めを行う
    target[p] = a * r + b * gr + c * bl;
    target[p + 1] = d * r + e * gr + f * bl;
    target[p + 2] = g * r + h * gr + i * bl;
    target[p + 3] = source[p + 3];
  }
}
