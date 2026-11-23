/**
 * 色のスライダーの帯の色（純粋関数）
 *
 * 帯には、その服が実際になる色を出す: まん中（0°）が元の絵の色、左右へ行くほど変わった色。
 * つまみの下の色が、服の色になる（決まった虹色の帯だと、帯のピンクへ動かしても服がピンクにならない）。
 * 色は、服の「代表の色」を、服の表示と同じ式（recolor.ts）に通して出す。
 */
import { recolor } from './recolor';

type Pixels = Uint8ClampedArray | Uint8Array;

// 帯の色の数: −180° から +180° まで、30° きざみ
const STEP_DEGREES = 30;
const STOP_COUNT = 360 / STEP_DEGREES + 1;
// 「色味のはっきりした画素」: 色の幅（最大 − 最小）÷ 255 が、これ以上（recolor.ts の CHROMA_TO と同じ）
const VIVID_CHROMA = 0.32;
// 色味のはっきりした画素が、不透明な画素のこの割合より少なければ、全体の平均を代表の色にする
const VIVID_SHARE = 0.01;

// 色あいの区切り（30° ごと、12 個）。色が 2 つある服（紺のえりと赤いスカーフ）で、まぜた色を代表にしないため
const HUE_BINS = 12;

function hueBin(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; // 0〜6
  return Math.min(HUE_BINS - 1, Math.floor((h / 6) * HUE_BINS));
}

/**
 * 代表の色。不透明で色味のはっきりした画素のうち、いちばん多い色あい（30° の区切り）の画素の平均。
 * 色味のはっきりした画素が少なすぎれば、不透明な画素ぜんぶの平均。不透明な画素が無ければ null
 */
export function mainColor(rgba: Pixels): [number, number, number] | null {
  let opaque = 0;
  let vivid = 0;
  const all = [0, 0, 0];
  const bins = Array.from({ length: HUE_BINS }, () => [0, 0, 0, 0]); // r, g, b の合計と、数
  for (let p = 0; p + 3 < rgba.length; p += 4) {
    if (rgba[p + 3] < 128) continue;
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    opaque++;
    all[0] += r;
    all[1] += g;
    all[2] += b;
    if ((Math.max(r, g, b) - Math.min(r, g, b)) / 255 >= VIVID_CHROMA) {
      vivid++;
      const bin = bins[hueBin(r, g, b)];
      bin[0] += r;
      bin[1] += g;
      bin[2] += b;
      bin[3]++;
    }
  }
  if (opaque === 0) return null;
  if (vivid < opaque * VIVID_SHARE) return [Math.round(all[0] / opaque), Math.round(all[1] / opaque), Math.round(all[2] / opaque)];
  const top = bins.reduce((best, bin) => (bin[3] > best[3] ? bin : best));
  return [Math.round(top[0] / top[3]), Math.round(top[1] / top[3]), Math.round(top[2] / top[3])];
}

/**
 * 帯の色（−180° から +180° まで 30° きざみ、13 個の "rgb(r, g, b)"）。
 * dark: 黒っぽい絵として色を付けるか（服の表示と同じ判定を渡す）。絵が透明・空なら null
 */
export function hueTrack(rgba: Pixels, dark: boolean): string[] | null {
  const main = mainColor(rgba);
  if (!main) return null;
  const source = new Uint8ClampedArray([main[0], main[1], main[2], 255]);
  const out = new Uint8ClampedArray(4);
  return Array.from({ length: STOP_COUNT }, (_, i) => {
    recolor(source, out, -180 + i * STEP_DEGREES, dark);
    return `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
  });
}

// 絵の画素を読めないとき（読み込み前・失敗）の帯: 決まった虹色
export const RAINBOW_TRACK: string[] = ['#4aa3ff', '#7d86ff', '#a26bff', '#d463d8', '#ff5fb0', '#ff5a5a', '#ff7f48', '#ffa53a', '#ffe14a', '#a8dc5a', '#63d86b', '#35c9c9', '#4aa3ff'];

/** 帯の背景（CSS）。to: 値が大きくなる向き（縦画面の帯は右、横画面の縦の帯は上） */
export function trackCss(stops: string[], to: 'right' | 'top'): string {
  return `linear-gradient(to ${to}, ${stops.join(', ')})`;
}
