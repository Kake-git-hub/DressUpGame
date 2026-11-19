/**
 * AI が作った画像の「背景色」と「シルエット色」を調べる純粋関数
 * ドールは単色のシルエット、背景も単色、という前提の画像を扱う。
 */
import type { Pixels } from './alpha';

export type Rgb = [number, number, number];

export interface KeyColors {
  background: Rgb;
  silhouette: Rgb | null; // シルエットが無い（背景と服だけ）なら null
}

// 背景色とみなす距離。cutout.ts でも同じ値を使う
export const BACKGROUND_TOLERANCE = 70;
// シルエット色とみなす距離
export const SILHOUETTE_TOLERANCE = 28;
// シルエットは、背景でない画素のうちこの割合以上を占めること
const MIN_SILHOUETTE_SHARE = 0.05;
const MIN_HINTED_SHARE = 0.003;

export function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

export function pixelDistance(rgba: Pixels, i: number, c: Rgb): number {
  const dr = rgba[i] - c[0];
  const dg = rgba[i + 1] - c[1];
  const db = rgba[i + 2] - c[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[values.length >> 1];
}

// 背景色 = 画像の縁の画素の中央値
function detectBackground(rgba: Pixels, width: number, height: number): Rgb {
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  const add = (p: number) => {
    r.push(rgba[p * 4]);
    g.push(rgba[p * 4 + 1]);
    b.push(rgba[p * 4 + 2]);
  };
  for (let x = 0; x < width; x++) {
    add(x);
    add((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y++) {
    add(y * width);
    add(y * width + width - 1);
  }
  return [median(r), median(g), median(b)];
}

/**
 * 背景色 = 画像の縁の画素の中央値。
 * シルエット色 = 背景でない画素のうち、いちばん多い「ほぼ単色」のかたまりの色。
 * 単色の服をシルエットと取り違えないよう、手がかりを渡せる:
 *  - color: 生成時に指定したシルエット色が分かっているとき。その色の近くだけを探す
 *  - doll:  ドールの形（1 = ドール）。シルエットはドールの内側にあるはずなので、内側に多く外側に少ない色を選ぶ
 */
export interface KeyColorHint {
  color?: Rgb;
  doll?: { mask: Uint8Array; width: number; height: number };
}

export function detectKeyColors(rgba: Pixels, width: number, height: number, hint: KeyColorHint = {}): KeyColors {
  const background = detectBackground(rgba, width, height);

  // 16 段階 × 3 色のます目で数える
  // ドールの形があれば、内側の画素を +1、外側の画素を -1 として数える
  const counts = new Int32Array(4096);
  const doll = hint.doll;
  let foreground = 0;
  for (let y = 0; y < height; y++) {
    const dollRow = doll ? Math.min(doll.height - 1, Math.floor((y * doll.width) / width)) * doll.width : 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < 128) continue;
      if (pixelDistance(rgba, i, background) <= BACKGROUND_TOLERANCE) continue;
      foreground++;
      const inside = !doll || doll.mask[dollRow + Math.min(doll.width - 1, Math.floor((x * doll.width) / width))] === 1;
      counts[((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4)] += inside ? 1 : -1;
    }
  }
  if (foreground === 0) return { background, silhouette: null };

  let seed: Rgb;
  if (hint.color) {
    seed = hint.color;
  } else {
    let best = 0;
    for (let bin = 1; bin < 4096; bin++) if (counts[bin] > counts[best]) best = bin;
    seed = [((best >> 8) & 15) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
  }

  // ます目の中心から始めて、近い画素の平均に 2 回寄せる（ます目の境をまたぐ色に対応）
  let center = seed;
  let count = 0;
  for (let round = 0; round < 3; round++) {
    let sr = 0, sg = 0, sb = 0;
    count = 0;
    const reach = round === 0 ? SILHOUETTE_TOLERANCE + 14 : SILHOUETTE_TOLERANCE;
    for (let i = 0; i < rgba.length; i += 4) {
      if (rgba[i + 3] < 128) continue;
      if (pixelDistance(rgba, i, center) > reach) continue;
      if (pixelDistance(rgba, i, background) <= BACKGROUND_TOLERANCE) continue;
      sr += rgba[i];
      sg += rgba[i + 1];
      sb += rgba[i + 2];
      count++;
    }
    if (count === 0) return { background, silhouette: null };
    center = [Math.round(sr / count), Math.round(sg / count), Math.round(sb / count)];
  }
  // 色を指定されているときは、少ししか見えていなくても（ドレスなど）シルエットとして扱う
  if (count < foreground * (hint.color ? MIN_HINTED_SHARE : MIN_SILHOUETTE_SHARE)) return { background, silhouette: null };
  return { background, silhouette: center };
}

// シルエットと背景に使える色の候補。黒は暗い服の影と区別できないので入れない
const SILHOUETTE_CANDIDATES: Rgb[] = [
  [0, 255, 0], // 緑
  [255, 0, 255], // マゼンタ
  [0, 255, 255], // シアン
  [255, 255, 0], // 黄
  [0, 0, 255], // 青
  [255, 0, 0], // 赤
  [255, 128, 0], // オレンジ
];
const BACKGROUND_CANDIDATES: Rgb[] = [[255, 255, 255], ...SILHOUETTE_CANDIDATES];

/**
 * 服に使う予定の色から、いちばん離れたシルエット色と背景色を選ぶ（互いにも離れていること）。
 * 予定色が無ければ、緑のシルエットと白い背景。
 */
export function chooseKeyColors(planned: Rgb[]): { silhouette: Rgb; background: Rgb; margin: number } {
  let best = { silhouette: SILHOUETTE_CANDIDATES[0], background: BACKGROUND_CANDIDATES[0], margin: -1 };
  for (const silhouette of SILHOUETTE_CANDIDATES) {
    for (const background of BACKGROUND_CANDIDATES) {
      let margin = colorDistance(silhouette, background);
      for (const c of planned) {
        margin = Math.min(margin, colorDistance(silhouette, c), colorDistance(background, c));
      }
      if (margin > best.margin) best = { silhouette, background, margin };
    }
  }
  return best;
}

// 本物のドールを写した拡大図（差し替え式の品目）の背景色: 品目の色・肌・下着の色のどれからも遠い、はっきりした色
const SWAP_BACKGROUNDS: Rgb[] = [
  [0, 255, 0],
  [255, 0, 255],
  [0, 0, 255],
  [0, 255, 255],
];
export function chooseBackground(avoid: Rgb[]): Rgb {
  let best = SWAP_BACKGROUNDS[0];
  let bestMargin = -1;
  for (const c of SWAP_BACKGROUNDS) {
    const margin = Math.min(...avoid.map((a) => colorDistance(c, a)), 442);
    if (margin > bestMargin) {
      best = c;
      bestMargin = margin;
    }
  }
  return best;
}

// ドールの肌の色: box の中の、不透明な画素の色の中央値
export function skinColor(doll: Pixels, width: number, height: number, box: { x: number; y: number; w: number; h: number }): Rgb {
  const values: number[][] = [[], [], []];
  for (let y = Math.max(0, Math.round(box.y)); y < Math.min(height, Math.round(box.y + box.h)); y++) {
    for (let x = Math.max(0, Math.round(box.x)); x < Math.min(width, Math.round(box.x + box.w)); x++) {
      const p = (y * width + x) * 4;
      if (doll[p + 3] < 255) continue;
      for (let c = 0; c < 3; c++) values[c].push(doll[p + c]);
    }
  }
  return values.map((v) => (v.length ? v.sort((a, b) => a - b)[v.length >> 1] : 224)) as Rgb;
}
