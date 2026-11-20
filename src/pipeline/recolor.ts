/**
 * 色スライダーの色変え（純粋関数）
 *
 * ふつうの絵は、色相を回す（hue.ts）。
 * 黒っぽい絵（黒髪など）は、色相を回しても色が変わらない（黒・灰・白には色相が無い）ので、
 * 黒い所に色を付ける: 暗さに応じて「こい色 → その色 → 白」の濃淡に置き換える。
 * 絵の中の、色のはっきりした所（ヘアピンなど）は、ふつうの絵と同じように色相だけを回す。
 */
import { applyHue, hueMatrix } from './hue';

type Pixels = Uint8ClampedArray | Uint8Array;

// 「暗くて色味のない画素」: 明るさ（0〜255）がこれ未満で、色の幅（最大 − 最小）がこれ未満
const DARK_LUMA = 77;
const DARK_CHROMA = 60;
// 不透明な画素のうち、この割合以上が暗くて色味のない画素なら「黒っぽい絵」
const DARK_SHARE = 0.5;

export function isDarkImage(rgba: Pixels): boolean {
  let opaque = 0;
  let dark = 0;
  for (let p = 0; p < rgba.length; p += 4) {
    if (rgba[p + 3] < 128) continue;
    opaque++;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    if (0.299 * r + 0.587 * g + 0.114 * b < DARK_LUMA && Math.max(r, g, b) - Math.min(r, g, b) < DARK_CHROMA) dark++;
  }
  return opaque > 0 && dark >= opaque * DARK_SHARE;
}

// スライダー 0 度のすぐ先で付く色（茶色）。そこから、スライダーの角度だけ色相を回す
const BASE_HUE = 20;
// 黒い所に付ける色の、あざやかさと明るさ（HSL）
const TINT_SATURATION = 0.62;
const TINT_LIGHTNESS = 0.42;
// 0 度からこの角度までは、少しずつ色を付ける（スライダーを動かした瞬間に、色が飛ばないように）
const RAMP_DEGREES = 24;
// 地の黒の明るさ（0〜1）。これより暗い所（線）は、付ける色をさらに暗くする。明るい所（つや）は白へ向かう
const BODY_LUMA = 0.13;
const LINE_SHADE = 0.45;
// 色の幅（0〜1）がこの範囲より小さい画素は黒・灰・白として色を付け、大きい画素は色相だけを回す
const CHROMA_FROM = 0.14;
const CHROMA_TO = 0.32;

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

// 黒い所に付ける色（スライダーの角度ごと）
export function tintFor(degrees: number): [number, number, number] {
  return hslToRgb(BASE_HUE + degrees, TINT_SATURATION, TINT_LIGHTNESS);
}

/**
 * source の RGBA を色変えして target に書く（同じ配列でもよい）。アルファは変えない。
 * dark: 黒っぽい絵か（isDarkImage）。false なら、色相を回すだけ（applyHue と同じ）
 */
export function recolor(source: Pixels, target: Uint8ClampedArray, degrees: number, dark: boolean): void {
  if (!dark || degrees === 0) {
    applyHue(source as Uint8ClampedArray, target, degrees);
    return;
  }
  const [a, b, c, d, e, f, g, h, i] = hueMatrix(degrees);
  const tint = tintFor(degrees);
  const strength = smooth(Math.abs(degrees) / RAMP_DEGREES);
  for (let p = 0; p < source.length; p += 4) {
    const r = source[p];
    const gr = source[p + 1];
    const bl = source[p + 2];
    const alpha = source[p + 3];
    if (alpha === 0) {
      target[p] = r;
      target[p + 1] = gr;
      target[p + 2] = bl;
      target[p + 3] = 0;
      continue;
    }
    // 色相を回した色（色のはっきりした所は、これをそのまま使う）
    const turned = [a * r + b * gr + c * bl, d * r + e * gr + f * bl, g * r + h * gr + i * bl];
    const chroma = (Math.max(r, gr, bl) - Math.min(r, gr, bl)) / 255;
    const amount = strength * (1 - smooth((chroma - CHROMA_FROM) / (CHROMA_TO - CHROMA_FROM)));
    if (amount > 0) {
      const luma = (0.299 * r + 0.587 * gr + 0.114 * bl) / 255;
      for (let ch = 0; ch < 3; ch++) {
        const colored =
          luma <= BODY_LUMA
            ? tint[ch] * (LINE_SHADE + (1 - LINE_SHADE) * (luma / BODY_LUMA))
            : tint[ch] + (255 - tint[ch]) * ((luma - BODY_LUMA) / (1 - BODY_LUMA));
        turned[ch] += (colored - turned[ch]) * amount;
      }
    }
    // Uint8ClampedArray が 0〜255 への丸めと切り詰めを行う
    target[p] = turned[0];
    target[p + 1] = turned[1];
    target[p + 2] = turned[2];
    target[p + 3] = alpha;
  }
}
