/**
 * 「元の絵（ドールの頭など）に描き足してもらった画像」から、描き足した分だけを取り出す純粋関数
 *
 * 顔（目・口・ほお紅・化粧）のように、肌の上にうすく重なる絵は、単色のシルエットに描かせて色で抜く方式では
 * シルエットの色がまざって取り出せない。そこで、本物の肌の上に描かせて、元の絵との違いを取り出す。
 * 取り出した絵を元の絵に重ねると、AI が描いた絵に戻る。
 */
import type { Pixels } from './alpha';

// 元の絵との色の距離がこれ以下なら「同じ」（透明）、MATTE_FULL 以上なら「描き足した」（不透明）。あいだは半透明
const MATTE_START = 14;
const MATTE_FULL = 46;
// 少しのずれを許す範囲（px。画像の幅 400px につき 1）。まわりの元の絵のどれかと同じ色なら「同じ」とみなす
const JITTER_PER = 400;
// 画像の画素数をこれで割った数より小さいかけらは、描き直しのむらとみなして消す
const SPECK_DIVISOR = 20000;
// 全体の色の変化（AI が絵全体を少し明るくするなど）を見積もるときに、元のままとみなす色の差
const DRIFT_RANGE = 24;
const DRIFT_MIN_SHARE = 0.3;
// 位置合わせで探す範囲
const SCALE_STEPS = [0.92, 0.94, 0.96, 0.98, 1, 1.02, 1.04, 1.06, 1.08];
const SHIFT_LIMIT = 0.07; // 画像の幅に対する割合
const COST_CAP = 90; // 描き足した所（大きく違う所）が位置合わせを引っぱらないように、1 画素の違いを頭打ちにする
const MIN_GAIN = 0.03; // 動かさない場合からの改善がこれ未満なら動かさない

export interface Match {
  rgba: Uint8ClampedArray; // 元の絵の位置に戻した画像
  // 画像の点 p を、(p − 中心) × scale + 中心 + (dx, dy) に写した
  scale: number;
  dx: number;
  dy: number;
}

interface Small {
  w: number;
  h: number;
  rgb: Float32Array;
}

// 面積平均で縮小する
function shrink(px: Pixels, width: number, height: number, w: number): Small {
  const h = Math.max(1, Math.round((w * height) / width));
  const rgb = new Float32Array(w * h * 3);
  const count = new Float32Array(w * h);
  for (let y = 0; y < height; y++) {
    const oy = Math.min(h - 1, Math.floor((y * h) / height));
    for (let x = 0; x < width; x++) {
      const o = oy * w + Math.min(w - 1, Math.floor((x * w) / width));
      const i = (y * width + x) * 4;
      rgb[o * 3] += px[i];
      rgb[o * 3 + 1] += px[i + 1];
      rgb[o * 3 + 2] += px[i + 2];
      count[o]++;
    }
  }
  for (let o = 0; o < w * h; o++) {
    if (count[o] === 0) continue;
    rgb[o * 3] /= count[o];
    rgb[o * 3 + 1] /= count[o];
    rgb[o * 3 + 2] /= count[o];
  }
  return { w, h, rgb };
}

// 画像を (scale, dx, dy) で動かしたときの、元の絵との違い（1 画素あたり。頭打ちあり）
function cost(image: Small, ref: Small, scale: number, dx: number, dy: number, step: number): number {
  const { w, h } = ref;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  let sum = 0;
  let n = 0;
  let seen = 0;
  for (let y = 0; y < h; y += step) {
    const sy = Math.round((y - cy - dy) / scale + cy);
    for (let x = 0; x < w; x += step) {
      seen++;
      const sx = Math.round((x - cx - dx) / scale + cx);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const a = (sy * w + sx) * 3;
      const b = (y * w + x) * 3;
      const d = Math.abs(image.rgb[a] - ref.rgb[b]) + Math.abs(image.rgb[a + 1] - ref.rgb[b + 1]) + Math.abs(image.rgb[a + 2] - ref.rgb[b + 2]);
      sum += d < COST_CAP ? d : COST_CAP;
      n++;
    }
  }
  return n < seen * 0.6 ? Infinity : sum / n;
}

/**
 * AI は、絵を少しずらしたり拡大縮小したりして返すことがある。
 * 元の絵といちばん重なる倍率とずれを探して、元の絵の位置に戻す。image と reference は同じ大きさ。
 */
export function matchToReference(image: Pixels, reference: Pixels, width: number, height: number): Match {
  const coarseW = Math.min(128, width);
  const fineW = Math.min(512, width);
  const a = shrink(image, width, height, coarseW);
  const b = shrink(reference, width, height, coarseW);
  let best = { scale: 1, dx: 0, dy: 0, cost: cost(a, b, 1, 0, 0, 1) };
  const limit = Math.round(coarseW * SHIFT_LIMIT);
  for (const scale of SCALE_STEPS) {
    for (let dy = -limit; dy <= limit; dy++) {
      for (let dx = -limit; dx <= limit; dx++) {
        const c = cost(a, b, scale, dx, dy, 1);
        if (c < best.cost) best = { scale, dx, dy, cost: c };
      }
    }
  }

  const fa = shrink(image, width, height, fineW);
  const fb = shrink(reference, width, height, fineW);
  const up = fineW / coarseW;
  const step = fineW > 256 ? 2 : 1;
  const identity = cost(fa, fb, 1, 0, 0, step);
  let fine = { scale: 1, dx: 0, dy: 0, cost: identity };
  const reach = Math.ceil(up) + 1;
  for (const ds of [-0.01, -0.005, 0, 0.005, 0.01]) {
    const scale = best.scale + ds;
    for (let dy = Math.round(best.dy * up) - reach; dy <= Math.round(best.dy * up) + reach; dy++) {
      for (let dx = Math.round(best.dx * up) - reach; dx <= Math.round(best.dx * up) + reach; dx++) {
        const c = cost(fa, fb, scale, dx, dy, step);
        if (c < fine.cost) fine = { scale, dx, dy, cost: c };
      }
    }
  }
  if (!(fine.cost < identity * (1 - MIN_GAIN))) {
    return { rgba: new Uint8ClampedArray(image), scale: 1, dx: 0, dy: 0 };
  }

  const scale = fine.scale;
  const dx = Math.round((fine.dx * width) / fineW);
  const dy = Math.round((fine.dy * width) / fineW);
  const out = new Uint8ClampedArray(width * height * 4);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  for (let y = 0; y < height; y++) {
    const sy = (y - cy - dy) / scale + cy;
    const y0 = Math.floor(sy);
    const fy = sy - y0;
    for (let x = 0; x < width; x++) {
      const sx = (x - cx - dx) / scale + cx;
      const x0 = Math.floor(sx);
      const o = (y * width + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= width - 1 || y0 >= height - 1) {
        // 画像の外から来る所は、元の絵のまま（何も描き足されていない）とする
        for (let k = 0; k < 4; k++) out[o + k] = k === 3 ? 255 : reference[o + k];
        continue;
      }
      const fx = sx - x0;
      const i = (y0 * width + x0) * 4;
      for (let k = 0; k < 3; k++) {
        const top = image[i + k] * (1 - fx) + image[i + 4 + k] * fx;
        const bottom = image[i + width * 4 + k] * (1 - fx) + image[i + width * 4 + 4 + k] * fx;
        out[o + k] = Math.round(top * (1 - fy) + bottom * fy);
      }
      out[o + 3] = 255;
    }
  }
  return { rgba: out, scale, dx, dy };
}

export interface DiffMatte {
  rgba: Uint8ClampedArray; // 描き足した分だけ（ほかは透明）
  changedShare: number; // はっきり描き足された画素の割合（0〜1）。大きいと、AI が絵全体を描き変えた疑いがある
}

/**
 * image（元の絵に描き足した画像）から、reference（元の絵）と違う所だけを取り出す。どちらも同じ大きさで、不透明。
 *  1. 絵全体の色の変化を見積もって、差し引く
 *  2. 画素ごとに、まわり（少しのずれの範囲）の元の絵のうち、いちばん近い色との距離を求める
 *  3. 距離から不透明度を決め、重ねたときに描かれた色に戻るように色を求める
 *  4. 小さなかけらと、細い線だけのかけら（輪郭のずれの消し残り）を消す。
 *     太い所につながる細い線（まつ毛など）は残る
 */
export function diffMatte(image: Pixels, reference: Pixels, width: number, height: number): DiffMatte {
  const total = width * height;

  // 1. 全体の色の変化: 元の絵とほぼ同じ画素の、差の中央値
  const drift = [0, 0, 0];
  const bins = [new Int32Array(DRIFT_RANGE * 2 + 1), new Int32Array(DRIFT_RANGE * 2 + 1), new Int32Array(DRIFT_RANGE * 2 + 1)];
  let similar = 0;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const dr = image[i] - reference[i];
    const dg = image[i + 1] - reference[i + 1];
    const db = image[i + 2] - reference[i + 2];
    if (Math.abs(dr) > DRIFT_RANGE || Math.abs(dg) > DRIFT_RANGE || Math.abs(db) > DRIFT_RANGE) continue;
    similar++;
    bins[0][dr + DRIFT_RANGE]++;
    bins[1][dg + DRIFT_RANGE]++;
    bins[2][db + DRIFT_RANGE]++;
  }
  if (similar >= total * DRIFT_MIN_SHARE) {
    for (let k = 0; k < 3; k++) {
      let seen = 0;
      for (let v = 0; v <= DRIFT_RANGE * 2; v++) {
        seen += bins[k][v];
        if (seen * 2 >= similar) {
          drift[k] = v - DRIFT_RANGE;
          break;
        }
      }
    }
  }

  // 2. 3. まわりの元の絵との、いちばん小さい距離 → 不透明度と色
  const reach = Math.max(1, Math.round(width / JITTER_PER));
  const out = new Uint8ClampedArray(total * 4);
  const start2 = MATTE_START * MATTE_START;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = image[i] - drift[0];
      const g = image[i + 1] - drift[1];
      const b = image[i + 2] - drift[2];
      let min2 = (r - reference[i]) ** 2 + (g - reference[i + 1]) ** 2 + (b - reference[i + 2]) ** 2;
      if (min2 > start2) {
        search: for (let yy = Math.max(0, y - reach); yy <= Math.min(height - 1, y + reach); yy++) {
          for (let xx = Math.max(0, x - reach); xx <= Math.min(width - 1, x + reach); xx++) {
            const j = (yy * width + xx) * 4;
            const d2 = (r - reference[j]) ** 2 + (g - reference[j + 1]) ** 2 + (b - reference[j + 2]) ** 2;
            if (d2 < min2) {
              min2 = d2;
              if (min2 <= start2) break search;
            }
          }
        }
      }
      if (min2 <= start2) continue;
      const a = Math.min(1, (Math.sqrt(min2) - MATTE_START) / (MATTE_FULL - MATTE_START));
      // 元の絵 × (1 − a) + 色 × a = 描かれた色、となる色
      out[i] = Math.round(reference[i] + (r - reference[i]) / a);
      out[i + 1] = Math.round(reference[i + 1] + (g - reference[i + 1]) / a);
      out[i + 2] = Math.round(reference[i + 2] + (b - reference[i + 2]) / a);
      out[i + 3] = Math.round(a * 255);
    }
  }

  // 4. 小さなかけらと、細い線だけのかけら。
  //    芯 = まわり reach px がすべて描き足された画素。芯を 1 つも持たないかけらは、輪郭のずれでできた線とみなす
  const minSize = Math.max(4, Math.round(total / SPECK_DIVISOR));
  const core = new Uint8Array(total);
  const run = new Uint8Array(total); // 横に reach px ずつ続いている
  for (let y = 0; y < height; y++) {
    let length = 0;
    for (let x = 0; x < width; x++) {
      length = out[(y * width + x) * 4 + 3] >= 8 ? length + 1 : 0;
      if (length >= reach * 2 + 1) run[y * width + x - reach] = 1;
    }
  }
  for (let x = 0; x < width; x++) {
    let length = 0;
    for (let y = 0; y < height; y++) {
      length = run[y * width + x] ? length + 1 : 0;
      if (length >= reach * 2 + 1) core[(y - reach) * width + x] = 1;
    }
  }
  const seen = new Uint8Array(total);
  const stack = new Int32Array(total);
  const piece = new Int32Array(total);
  let changed = 0;
  for (let start = 0; start < total; start++) {
    if (seen[start] || out[start * 4 + 3] < 8) continue;
    let size = 0;
    let solid = 0;
    let hasCore = false;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const p = stack[--top];
      piece[size++] = p;
      if (out[p * 4 + 3] >= 128) solid++;
      if (core[p]) hasCore = true;
      const x = p % width;
      const visit = (n: number) => {
        if (!seen[n] && out[n * 4 + 3] >= 8) {
          seen[n] = 1;
          stack[top++] = n;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < total - width) visit(p + width);
    }
    if (size < minSize || !hasCore) for (let k = 0; k < size; k++) out[piece[k] * 4 + 3] = 0;
    else changed += solid;
  }
  for (let p = 0; p < total; p++) if (out[p * 4 + 3] < 8) out.fill(0, p * 4, p * 4 + 4);

  return { rgba: out, changedShare: changed / total };
}
