/**
 * AI が作った画像から、背景とシルエットを消して服だけを残す純粋関数
 */
import type { Pixels } from './alpha';
import { BACKGROUND_TOLERANCE, SILHOUETTE_TOLERANCE, pixelDistance } from './keyColors';
import type { KeyColors } from './keyColors';

// ふちの色残りとみなす距離と、消した領域からの届く範囲（px）
const FRINGE_TOLERANCE = 110;
const FRINGE_REACH = 2;
// 服の色がこれより近いと、背景・シルエットと区別できず欠けが疑われる
const CLOSE_COLOR_DISTANCE = 60;

export interface CutoutMasks {
  background: Uint8Array; // 1 = 背景として消した
  silhouette: Uint8Array; // 1 = シルエットとして消した
}

/**
 * rgba をその場で書き換えて服だけを残す。消した領域のマスクを返す（位置合わせに使う）。
 *  1. 背景色に近く、画像の縁からつながっている画素を消す
 *  2. シルエット色に近い画素を消す
 *  3. 縁につながらない背景色のかたまりは、シルエットに接していれば消す（首飾りの内側など）。
 *     服だけに囲まれたかたまりは残す（白いハイライト）
 *  4. 消した領域のすぐ近くにある、背景色・シルエット色まじりの画素を消す
 *  5. ふちを 1px ぶんなじませる
 */
export function cutOutClothing(rgba: Pixels, width: number, height: number, keys: KeyColors): CutoutMasks {
  const total = width * height;
  const background = new Uint8Array(total);
  const silhouette = new Uint8Array(total);
  const bgLike = new Uint8Array(total);
  const stack = new Int32Array(total);

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (rgba[i + 3] < 8) {
      // もともと透明な画素は背景と同じ扱い
      bgLike[p] = 1;
      continue;
    }
    if (pixelDistance(rgba, i, keys.background) <= BACKGROUND_TOLERANCE) bgLike[p] = 1;
    if (keys.silhouette && pixelDistance(rgba, i, keys.silhouette) <= SILHOUETTE_TOLERANCE) {
      silhouette[p] = 1;
      bgLike[p] = 0;
    }
  }

  // 1. 縁からつながる背景
  let top = 0;
  const seed = (p: number) => {
    if (bgLike[p] && !background[p]) {
      background[p] = 1;
      stack[top++] = p;
    }
  };
  for (let x = 0; x < width; x++) {
    seed(x);
    seed((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    seed(y * width);
    seed(y * width + width - 1);
  }
  const flood = () => {
    while (top > 0) {
      const p = stack[--top];
      const x = p % width;
      if (x > 0) seed(p - 1);
      if (x < width - 1) seed(p + 1);
      if (p >= width) seed(p - width);
      if (p < total - width) seed(p + width);
    }
  };
  flood();

  // 3. 閉じ込められた背景: シルエットに接しているかたまりだけ消す
  if (keys.silhouette) {
    const visited = new Uint8Array(total);
    const component = new Int32Array(total);
    for (let start = 0; start < total; start++) {
      if (!bgLike[start] || background[start] || visited[start]) continue;
      let size = 0;
      let touches = false;
      top = 0;
      stack[top++] = start;
      visited[start] = 1;
      while (top > 0) {
        const p = stack[--top];
        component[size++] = p;
        const x = p % width;
        const visit = (n: number) => {
          if (silhouette[n]) touches = true;
          else if (bgLike[n] && !background[n] && !visited[n]) {
            visited[n] = 1;
            stack[top++] = n;
          }
        };
        if (x > 0) visit(p - 1);
        if (x < width - 1) visit(p + 1);
        if (p >= width) visit(p - width);
        if (p < total - width) visit(p + width);
      }
      if (touches) for (let k = 0; k < size; k++) background[component[k]] = 1;
    }
  }

  // 4. ふちの色残り: 消した領域から FRINGE_REACH px 以内で、背景色・シルエット色に寄った画素
  for (let round = 0; round < FRINGE_REACH; round++) {
    const addBg: number[] = [];
    const addSil: number[] = [];
    for (let p = 0; p < total; p++) {
      if (background[p] || silhouette[p]) continue;
      const x = p % width;
      const nearBg =
        (x > 0 && background[p - 1]) || (x < width - 1 && background[p + 1]) || (p >= width && background[p - width]) || (p < total - width && background[p + width]);
      const nearSil =
        (x > 0 && silhouette[p - 1]) || (x < width - 1 && silhouette[p + 1]) || (p >= width && silhouette[p - width]) || (p < total - width && silhouette[p + width]);
      if (!nearBg && !nearSil) continue;
      const i = p * 4;
      if (nearSil && keys.silhouette && pixelDistance(rgba, i, keys.silhouette) <= FRINGE_TOLERANCE) addSil.push(p);
      else if (nearBg && pixelDistance(rgba, i, keys.background) <= FRINGE_TOLERANCE) addBg.push(p);
      else if (nearBg && keys.silhouette && pixelDistance(rgba, i, keys.silhouette) <= FRINGE_TOLERANCE) addSil.push(p);
      else if (nearSil && pixelDistance(rgba, i, keys.background) <= FRINGE_TOLERANCE) addBg.push(p);
    }
    for (const p of addBg) background[p] = 1;
    for (const p of addSil) silhouette[p] = 1;
  }

  for (let p = 0; p < total; p++) if (background[p] || silhouette[p]) rgba[p * 4 + 3] = 0;

  // 5. ふちをなじませる: 消した画素に接する服の画素の alpha を、まわり 3×3 の平均にする
  const edge: number[] = [];
  const alpha: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (rgba[p * 4 + 3] === 0) continue;
      let sum = 0;
      let n = 0;
      let touchesCleared = false;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const a = rgba[(yy * width + xx) * 4 + 3];
          sum += a;
          n++;
          if (a === 0) touchesCleared = true;
        }
      }
      if (touchesCleared) {
        edge.push(p);
        alpha.push(Math.round(sum / n));
      }
    }
  }
  for (let k = 0; k < edge.length; k++) rgba[edge[k] * 4 + 3] = alpha[k];

  return { background, silhouette };
}

/**
 * 服として残った画素のうち、背景色またはシルエット色に近いものの割合（0〜1）。
 * 大きいと、服の一部が背景やシルエットと一緒に消えた疑いがある。
 */
export function closeColorRatio(rgba: Pixels, width: number, height: number, keys: KeyColors): number {
  let kept = 0;
  let close = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    if (rgba[i + 3] < 128) continue;
    kept++;
    if (
      pixelDistance(rgba, i, keys.background) < CLOSE_COLOR_DISTANCE ||
      (keys.silhouette && pixelDistance(rgba, i, keys.silhouette) < CLOSE_COLOR_DISTANCE)
    ) {
      close++;
    }
  }
  return kept === 0 ? 0 : close / kept;
}
