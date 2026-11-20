/**
 * まわりの色をなめらかに広げて、範囲を塗る純粋関数
 *
 * 体の裏に隠れる髪のように「絵が無い所」を、まわりの絵の色で埋めるときに使う。
 * 横 1 行ずつ左右の色をつなぐやり方は、行ごとに色が変わって横じまになる。
 * ここでは、色を半分ずつに縮めていき（色のある画素だけの平均）、戻りながら色の無い所を粗い段の色で埋める。
 * どの方向にもなめらかな色になる。
 */
import type { Pixels } from './alpha';

// rgb: 幅 × 高さ × 3。weight: 0〜1（その画素の色をどれだけ信じるか）。戻り値: 全画素の色
function pushPull(rgb: Float32Array, weight: Float32Array, width: number, height: number): Float32Array {
  if (width <= 1 && height <= 1) return rgb.slice();
  const w = Math.ceil(width / 2);
  const h = Math.ceil(height / 2);
  const small = new Float32Array(w * h * 3);
  const smallWeight = new Float32Array(w * h);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const a = weight[p];
      if (a === 0) continue;
      const q = (y >> 1) * w + (x >> 1);
      smallWeight[q] += a;
      small[q * 3] += rgb[p * 3] * a;
      small[q * 3 + 1] += rgb[p * 3 + 1] * a;
      small[q * 3 + 2] += rgb[p * 3 + 2] * a;
    }
  }
  for (let q = 0; q < w * h; q++) {
    const a = smallWeight[q];
    if (a === 0) continue;
    small[q * 3] /= a;
    small[q * 3 + 1] /= a;
    small[q * 3 + 2] /= a;
    smallWeight[q] = Math.min(1, a);
  }
  const coarse = pushPull(small, smallWeight, w, h);
  const out = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(h - 1, (y - 0.5) / 2));
    const y0 = Math.floor(fy);
    const y1 = Math.min(h - 1, y0 + 1);
    const ay = fy - y0;
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const a = weight[p];
      if (a >= 1) {
        out[p * 3] = rgb[p * 3];
        out[p * 3 + 1] = rgb[p * 3 + 1];
        out[p * 3 + 2] = rgb[p * 3 + 2];
        continue;
      }
      const fx = Math.max(0, Math.min(w - 1, (x - 0.5) / 2));
      const x0 = Math.floor(fx);
      const x1 = Math.min(w - 1, x0 + 1);
      const ax = fx - x0;
      for (let c = 0; c < 3; c++) {
        const top = coarse[(y0 * w + x0) * 3 + c] * (1 - ax) + coarse[(y0 * w + x1) * 3 + c] * ax;
        const bottom = coarse[(y1 * w + x0) * 3 + c] * (1 - ax) + coarse[(y1 * w + x1) * 3 + c] * ax;
        out[p * 3 + c] = rgb[p * 3 + c] * a + (top * (1 - ay) + bottom * ay) * (1 - a);
      }
    }
  }
  return out;
}

// source が 1 の画素の色を、全画素へなめらかに広げた色（幅 × 高さ × 3）。source が 1 つも無ければ、全部 0
export function smoothField(rgba: Pixels, source: Uint8Array, width: number, height: number): Float32Array {
  const total = width * height;
  const rgb = new Float32Array(total * 3);
  const weight = new Float32Array(total);
  for (let p = 0; p < total; p++) {
    if (!source[p]) continue;
    weight[p] = 1;
    rgb[p * 3] = rgba[p * 4];
    rgb[p * 3 + 1] = rgba[p * 4 + 1];
    rgb[p * 3 + 2] = rgba[p * 4 + 2];
  }
  return pushPull(rgb, weight, width, height);
}

// region の画素を、source の色をなめらかに広げた色で、不透明に塗る。source が 1 つも無ければ何もしない
export function fillSmooth(rgba: Uint8ClampedArray, region: Uint8Array, source: Uint8Array, width: number, height: number): void {
  if (!source.includes(1)) return;
  const field = smoothField(rgba, source, width, height);
  for (let p = 0; p < width * height; p++) {
    if (!region[p]) continue;
    rgba[p * 4] = Math.round(field[p * 3]);
    rgba[p * 4 + 1] = Math.round(field[p * 3 + 1]);
    rgba[p * 4 + 2] = Math.round(field[p * 3 + 2]);
    rgba[p * 4 + 3] = 255;
  }
}
