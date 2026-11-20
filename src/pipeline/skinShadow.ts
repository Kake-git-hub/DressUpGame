/**
 * 髪が肌に落とす影を見つける純粋関数
 *
 * AI は、前髪の下の額や、髪のかかった首すじに、肌の影（肌より少し暗く、赤みのある色）を描くことがある。
 * 元の絵との違いで髪を取り出すと、この影も髪に入ってしまい、色スライダーで影だけが緑や青になる。
 * 影は、下の絵（肌）の色を決まった向きに暗くした色なので、色で見分けて髪から外す。
 */
import type { Pixels } from './alpha';
import { components, dilate } from './morph';

// 肌 → 影で、各色がどれだけ残るか（本物の絵 5 点で、肌 254,208,182 に対して影は 213〜234, 159〜181, 139〜166）
const SHADOW_KEEP = [0.87, 0.78, 0.8];
// 影の濃さ（0 = 肌のまま、1 = 上の割合どおり）。この範囲にある色を影とみなす。
// 下限は、「元の絵と違う」と数えられるいちばんうすい影（色の差 16 ≒ 濃さ 0.24）より小さくする
// （影と肌の境目のぼかしが髪として残ると、影のかたまりが肌から切り離されて、取れなくなる）
const DEPTH_MIN = 0.2;
const DEPTH_MAX = 1.7;
// 「肌を暗くした色」からの色の差が、これ以下なら影
const TOLERANCE = 16;
// 下の絵の色が、肌の色からこれ以内の所だけを見る（白い下着や輪郭線の上は見ない）
const SKIN_RANGE = 36;
// 影らしい画素が、ドールの上の髪のこの割合を超えたら、髪そのものが肌に近い色。何も外さない
const MAX_SHARE = 0.3;
// 影のかたまりが、髪のかかっていない肌からこの距離（px）以内にあれば「肌に接している」
const TOUCH = 2;
const PASSES = 4;

// 肌らしい色味: 赤 > 緑 > 青 で、赤と青の差がこれ以上（白い下着・灰色・輪郭線の黒を、肌と取り違えない）
const WARM = 30;

// 絵の中でいちばん多い色。mask が 1 の所だけを数える。warm なら、肌らしい色味の画素だけを数える
export function dominantColor(image: Pixels, mask: ArrayLike<number>, warm = false): [number, number, number] | null {
  const bins = new Map<number, [number, number, number, number]>();
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue;
    const i = p * 4;
    if (warm && !(image[i] > image[i + 1] && image[i + 1] > image[i + 2] && image[i] - image[i + 2] >= WARM)) continue;
    const key = ((image[i] >> 4) << 8) | ((image[i + 1] >> 4) << 4) | (image[i + 2] >> 4);
    const bin = bins.get(key);
    if (bin) {
      bin[0] += image[i];
      bin[1] += image[i + 1];
      bin[2] += image[i + 2];
      bin[3]++;
    } else bins.set(key, [image[i], image[i + 1], image[i + 2], 1]);
  }
  let best: [number, number, number, number] | null = null;
  for (const bin of bins.values()) if (!best || bin[3] > best[3]) best = bin;
  return best ? [best[0] / best[3], best[1] / best[3], best[2] / best[3]] : null;
}

// (r, g, b) が、下の色 (ur, ug, ub) に落ちた影の色か
export function isShadowOf(r: number, g: number, b: number, ur: number, ug: number, ub: number): boolean {
  // 影の向き: 下の色 → 下の色 × SHADOW_KEEP
  const dr = ur * (SHADOW_KEEP[0] - 1);
  const dg = ug * (SHADOW_KEEP[1] - 1);
  const db = ub * (SHADOW_KEEP[2] - 1);
  const length2 = dr * dr + dg * dg + db * db;
  if (length2 === 0) return false;
  const depth = ((r - ur) * dr + (g - ug) * dg + (b - ub) * db) / length2;
  if (depth < DEPTH_MIN || depth > DEPTH_MAX) return false;
  return Math.hypot(r - (ur + dr * depth), g - (ug + dg * depth), b - (ub + db * depth)) <= TOLERANCE;
}

/**
 * 髪に入ってしまった肌の影（1 = 影）。
 *  image: 髪の描かれた絵。under: 髪の無い絵（ドール）。どちらも同じ大きさの RGBA。
 *  hair: ドールの上の髪（1 / 0）。bare: 髪のかかっていないドール（1 / 0）。
 * 影らしい色のかたまりのうち、髪のかかっていない肌に接しているものだけを影とする（髪の中の、肌に近い色の所は残す）
 */
export function skinShadowMask(image: Pixels, under: Pixels, hair: ArrayLike<number>, bare: ArrayLike<number>, width: number, height: number): Uint8Array {
  const total = width * height;
  const shadow = new Uint8Array(total);
  const doll = new Uint8Array(total);
  let hairCount = 0;
  for (let p = 0; p < total; p++) {
    if (hair[p]) hairCount++;
    doll[p] = hair[p] || bare[p] ? 1 : 0;
  }
  // 肌の色: ドールでいちばん多い、肌らしい色味の色（白い下着のほうが広いドールでも、肌を選ぶ）
  const skin = dominantColor(under, doll, true) ?? dominantColor(under, doll);
  if (!skin || hairCount === 0) return shadow;
  const candidate = new Uint8Array(total);
  let count = 0;
  for (let p = 0; p < total; p++) {
    if (!hair[p]) continue;
    const i = p * 4;
    if (Math.hypot(under[i] - skin[0], under[i + 1] - skin[1], under[i + 2] - skin[2]) > SKIN_RANGE) continue;
    if (!isShadowOf(image[i], image[i + 1], image[i + 2], under[i], under[i + 1], under[i + 2])) continue;
    candidate[p] = 1;
    count++;
  }
  if (count === 0 || count > hairCount * MAX_SHARE) return shadow;
  // 肌に接しているかたまりを影にする。影は、濃さの違う帯が重なっていることがあるので、
  // 影にしたかたまりに接しているかたまりも、続けて影にする（PASSES 回まで）
  const open = Uint8Array.from(bare, (v) => (v ? 1 : 0));
  for (let pass = 0; pass < PASSES; pass++) {
    const near = dilate(open, width, height, TOUCH);
    let added = false;
    components(candidate, width, height, (pixels, n) => {
      let touches = false;
      for (let k = 0; k < n && !touches; k++) touches = !!near[pixels[k]];
      if (!touches) return;
      for (let k = 0; k < n; k++) {
        shadow[pixels[k]] = 1;
        open[pixels[k]] = 1;
        candidate[pixels[k]] = 0;
      }
      added = true;
    });
    if (!added) break;
  }
  return shadow;
}
