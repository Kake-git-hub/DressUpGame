/**
 * AI が作った画像から、背景とシルエットを消して服だけを残す純粋関数
 */
import type { Pixels } from './alpha';
import { BACKGROUND_TOLERANCE, SILHOUETTE_TOLERANCE, pixelDistance } from './keyColors';
import type { KeyColors } from './keyColors';

// ふちの色残りとみなす距離と、消した領域からの届く範囲（px）
const FRINGE_TOLERANCE = 110;
const FRINGE_REACH = 2;
// 背景色とシルエット色がまざった色（境目）とみなす、両者を結ぶ線からの距離と、消す深さ（px）
const MIX_TOLERANCE = 40;
const MIX_REACH = 4;
// ふちのまざりを直す帯の幅（px）、基準の色を探す範囲（px）、まざりとみなす色のずれ、直す最小のまざり具合
const BAND = 3;
const REFERENCE_REACH = 5;
const MATTE_TOLERANCE = 48;
const MATTE_MIN = 0.12;
// 画像の画素数をこれで割った数より小さいかけらは、消し残りとみなして消す（2000px 四方で 80 画素）
const SPECK_DIVISOR = 50000;
// キーの色の取り除き: 消した領域からの届く範囲（画像の幅に対する割合）、
// 混ざり具合がこれ以下は服の色とみなす、そこから直し始めて RAMP で全部直す、これ以上は消す
const DESPILL_REACH = 0.03;
const DESPILL_START = 0.15;
const DESPILL_RAMP = 0.1;
const DESPILL_DROP = 0.85;
// 服の色がこれより近いと、背景・シルエットと区別できず欠けが疑われる
const CLOSE_COLOR_DISTANCE = 60;
// 背景色がこれ以上あざやか（最大の成分 − 最小の成分）なら、服に囲まれた背景色も消す（髪の房のすき間など）。
// 白い背景では、服の白いハイライトと区別できないので消さない
const CHROMATIC_SPREAD = 100;
// 体の輪郭に沿った線くず（AI が描き足した輪郭線の消し残り）とみなす、線の太さの半分（px。画像の幅 400px につき 1）と、
// 大きさの上限（画像の画素数をこれで割った数）
const OUTLINE_DEPTH_PER = 400;
const OUTLINE_DIVISOR = 100;

export interface CutoutMasks {
  background: Uint8Array; // 1 = 背景として消した
  silhouette: Uint8Array; // 1 = シルエットとして消した
}

/**
 * rgba をその場で書き換えて服だけを残す。消した領域のマスクを返す（位置合わせに使う）。
 *  1. 背景色に近く、画像の縁からつながっている画素を消す
 *  2. シルエット色に近い画素と、背景とシルエットの境目（両者がまざった色）を消す
 *  3. 縁につながらない背景色のかたまりは、シルエットに接していれば消す（首飾りの内側など）。
 *     服だけに囲まれたかたまりは、背景が白なら残し（白いハイライト）、色つきなら消す（髪の房のすき間）
 *  4. 消した領域のすぐ近くにある、背景色・シルエット色まじりの画素を消す
 *  5. ふちの画素から、まざった背景色・シルエット色を取り除き、その分だけ半透明にする
 *  6. 消し残りの小さなかけらと、体の輪郭に沿った細い線くずを消す
 */
export function cutOutClothing(rgba: Pixels, width: number, height: number, keys: KeyColors): CutoutMasks {
  const total = width * height;
  const background = new Uint8Array(total);
  const silhouette = new Uint8Array(total);
  const bgLike = new Uint8Array(total);
  const mix = new Uint8Array(total); // 背景色とシルエット色がまざった色（両者の境目にできる）
  const stack = new Int32Array(total);
  const sil = keys.silhouette;
  const bg = keys.background;
  // 背景色→シルエット色の線分
  const axis = sil ? [sil[0] - bg[0], sil[1] - bg[1], sil[2] - bg[2]] : [0, 0, 0];
  const axisLength2 = axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2];

  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (rgba[i + 3] < 8) {
      // もともと透明な画素は背景と同じ扱い
      bgLike[p] = 1;
      continue;
    }
    if (sil && pixelDistance(rgba, i, sil) <= SILHOUETTE_TOLERANCE) {
      silhouette[p] = 1;
      continue;
    }
    if (pixelDistance(rgba, i, bg) <= BACKGROUND_TOLERANCE) {
      bgLike[p] = 1;
      continue;
    }
    if (sil && axisLength2 > 0) {
      const r = rgba[i] - bg[0];
      const g = rgba[i + 1] - bg[1];
      const b = rgba[i + 2] - bg[2];
      const t = Math.min(1, Math.max(0, (r * axis[0] + g * axis[1] + b * axis[2]) / axisLength2));
      const er = r - t * axis[0];
      const eg = g - t * axis[1];
      const eb = b - t * axis[2];
      if (er * er + eg * eg + eb * eb <= MIX_TOLERANCE * MIX_TOLERANCE) mix[p] = 1;
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
  while (top > 0) {
    const p = stack[--top];
    const x = p % width;
    if (x > 0) seed(p - 1);
    if (x < width - 1) seed(p + 1);
    if (p >= width) seed(p - width);
    if (p < total - width) seed(p + width);
  }

  const removed = (p: number) => background[p] === 1 || silhouette[p] === 1;
  const nearRemoved = (p: number) => {
    const x = p % width;
    return (x > 0 && removed(p - 1)) || (x < width - 1 && removed(p + 1)) || (p >= width && removed(p - width)) || (p < total - width && removed(p + width));
  };

  // 2. 背景とシルエットの境目（まざった色）: 消した領域に接するものを、内側へ MIX_REACH px まで消す
  if (sil) {
    for (let round = 0; round < MIX_REACH; round++) {
      const add: number[] = [];
      for (let p = 0; p < total; p++) if (mix[p] && !removed(p) && nearRemoved(p)) add.push(p);
      if (add.length === 0) break;
      for (const p of add) silhouette[p] = 1;
    }
  }

  // 3. 閉じ込められた背景: シルエットに接しているかたまりを消す。背景が色つきなら、接していなくても消す
  const chromatic = Math.max(bg[0], bg[1], bg[2]) - Math.min(bg[0], bg[1], bg[2]) >= CHROMATIC_SPREAD;
  if (sil || chromatic) {
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
      if (touches || chromatic) for (let k = 0; k < size; k++) background[component[k]] = 1;
    }
    // 新しく消した背景に接する境目も消す
    for (let round = 0; sil && round < MIX_REACH; round++) {
      const add: number[] = [];
      for (let p = 0; p < total; p++) if (mix[p] && !removed(p) && nearRemoved(p)) add.push(p);
      if (add.length === 0) break;
      for (const p of add) silhouette[p] = 1;
    }
  }

  // 4. ふちの色残り: 消した領域から FRINGE_REACH px 以内で、背景色・シルエット色に寄った画素
  for (let round = 0; round < FRINGE_REACH; round++) {
    const addBg: number[] = [];
    const addSil: number[] = [];
    for (let p = 0; p < total; p++) {
      if (removed(p) || !nearRemoved(p)) continue;
      const i = p * 4;
      if (sil && pixelDistance(rgba, i, sil) <= FRINGE_TOLERANCE) addSil.push(p);
      else if (pixelDistance(rgba, i, bg) <= FRINGE_TOLERANCE) addBg.push(p);
    }
    for (const p of addBg) background[p] = 1;
    for (const p of addSil) silhouette[p] = 1;
  }

  for (let p = 0; p < total; p++) if (removed(p)) rgba[p * 4 + 3] = 0;

  // 5. ふちの画素は「服の色」と「背景色またはシルエット色」がまざっている。
  //    少し内側の服の色を基準に、まざり具合を求めて、色を服の色に戻し、まざった分だけ半透明にする
  const depth = new Uint8Array(total); // 消した領域からの距離（1〜BAND+1）。0 = それより内側か、消した画素
  let frontier: number[] = [];
  for (let p = 0; p < total; p++) if (!removed(p) && nearRemoved(p)) frontier.push(p);
  for (const p of frontier) depth[p] = 1;
  const band: number[] = [];
  for (let d = 1; d <= BAND; d++) {
    const next: number[] = [];
    for (const p of frontier) {
      band.push(p);
      const x = p % width;
      const visit = (n: number) => {
        if (!removed(n) && depth[n] === 0) {
          depth[n] = d + 1;
          next.push(n);
        }
      };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < total - width) visit(p + width);
    }
    frontier = next;
  }
  const isInner = (p: number) => !removed(p) && (depth[p] === 0 || depth[p] > BAND);
  const keyList = sil ? [sil, bg] : [bg];
  const updates: number[] = []; // p, r, g, b, a
  for (const p of band) {
    const x = p % width;
    const y = (p - x) / width;
    // 基準の色: まわりの「内側の服」の平均
    let cr = 0, cg = 0, cb = 0, n = 0;
    for (let yy = Math.max(0, y - REFERENCE_REACH); yy <= Math.min(height - 1, y + REFERENCE_REACH); yy++) {
      for (let xx = Math.max(0, x - REFERENCE_REACH); xx <= Math.min(width - 1, x + REFERENCE_REACH); xx++) {
        const q = yy * width + xx;
        if (!isInner(q)) continue;
        cr += rgba[q * 4];
        cg += rgba[q * 4 + 1];
        cb += rgba[q * 4 + 2];
        n++;
      }
    }
    const i = p * 4;
    if (n < 3) {
      // 細い部分（内側が無い）: いちばん外の 1px だけ半透明にする
      if (depth[p] === 1) updates.push(p, rgba[i], rgba[i + 1], rgba[i + 2], 150);
      continue;
    }
    cr /= n;
    cg /= n;
    cb /= n;
    let bestT = 0;
    for (const key of keyList) {
      const ar = key[0] - cr;
      const ag = key[1] - cg;
      const ab = key[2] - cb;
      const len2 = ar * ar + ag * ag + ab * ab;
      if (len2 < 60 * 60) continue; // 服の色がキーの色に近すぎて区別できない
      const pr = rgba[i] - cr;
      const pg = rgba[i + 1] - cg;
      const pb = rgba[i + 2] - cb;
      const t = (pr * ar + pg * ag + pb * ab) / len2;
      if (t <= bestT) continue;
      const er = pr - t * ar;
      const eg = pg - t * ag;
      const eb = pb - t * ab;
      // 線から外れた色は、まざりではなく服の柄（ふち飾りなど）
      if (er * er + eg * eg + eb * eb > MATTE_TOLERANCE * MATTE_TOLERANCE) continue;
      bestT = Math.min(1, t);
    }
    // 外から 1px 目は少なくとも少しは透けさせる（なめらかなふち）。奥は、はっきりまざっているときだけ
    const floor = depth[p] === 1 ? 0.25 : 0;
    const t = Math.max(bestT < MATTE_MIN ? 0 : bestT, floor);
    if (t === 0) continue;
    if (bestT >= MATTE_MIN) updates.push(p, Math.round(cr), Math.round(cg), Math.round(cb), t > 0.9 ? 0 : Math.round(255 * (1 - t)));
    else updates.push(p, rgba[i], rgba[i + 1], rgba[i + 2], Math.round(255 * (1 - t)));
  }
  for (let k = 0; k < updates.length; k += 5) {
    const i = updates[k] * 4;
    rgba[i] = updates[k + 1];
    rgba[i + 1] = updates[k + 2];
    rgba[i + 2] = updates[k + 3];
    rgba[i + 3] = updates[k + 4];
  }

  // 5b. 服に混ざったキーの色（半透明の飾りや化粧の下から透けたシルエット色、ふちの色移り）を取り除く。
  //     消した領域の近くだけで行う（服の奥の柄は触らない）
  const reach = Math.max(8, Math.round(width * DESPILL_REACH));
  const near = new Uint8Array(total); // 1 = 消した領域から reach px 以内
  let wave: number[] = [];
  for (let p = 0; p < total; p++) if (removed(p)) wave.push(p);
  for (let d = 0; d < reach && wave.length > 0; d++) {
    const next: number[] = [];
    for (const p of wave) {
      const x = p % width;
      const visit = (n: number) => {
        if (!near[n] && !removed(n)) {
          near[n] = 1;
          next.push(n);
        }
      };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < total - width) visit(p + width);
    }
    wave = next;
  }
  despillKeys(rgba, width, height, keyList, near);

  // 6. 消し残りの小さなかけら（境目に残った数画素）と、体の輪郭に沿った細い線くずを消す。
  //    線くず = どの画素も消した領域のすぐそばにあり（細い）、シルエットと背景の両方に接している（輪郭の上にある）
  const minSize = Math.max(4, Math.round(total / SPECK_DIVISOR));
  const outlineDepth = Math.min(BAND + 1, Math.max(2, Math.round(width / OUTLINE_DEPTH_PER)));
  const outlineSize = Math.round(total / OUTLINE_DIVISOR);
  const seen = new Uint8Array(total);
  const piece = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (seen[start] || rgba[start * 4 + 3] < 8) continue;
    let size = 0;
    let thin = true;
    let onSilhouette = false;
    let onBackground = false;
    top = 0;
    stack[top++] = start;
    seen[start] = 1;
    while (top > 0) {
      const p = stack[--top];
      piece[size++] = p;
      if (depth[p] === 0 || depth[p] > outlineDepth) thin = false;
      const x = p % width;
      const visit = (n: number) => {
        if (silhouette[n]) onSilhouette = true;
        else if (background[n]) onBackground = true;
        if (!seen[n] && rgba[n * 4 + 3] >= 8) {
          seen[n] = 1;
          stack[top++] = n;
        }
      };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < total - width) visit(p + width);
    }
    if (size < minSize || (sil && thin && onSilhouette && onBackground && size < outlineSize)) {
      for (let k = 0; k < size; k++) {
        rgba[piece[k] * 4 + 3] = 0;
        background[piece[k]] = 1;
      }
    }
  }

  return { background, silhouette };
}

/**
 * キーの色（緑・マゼンタなど、はっきりした色）が混ざった画素から、その色を取り除く。
 * 画素を「服の色 × (1 - t) + キーの色 × t」とみなし、t（混ざり具合）を
 * 「キーで強い色の成分 − キーで弱い色の成分」の大きさから求めて、服の色に戻し、t の分だけ透けさせる。
 * 白・黒・灰色などのキーは、服の明るさと区別できないので扱わない。
 * only を渡すと、1 の画素だけを直す。
 */
export function despillKeys(rgba: Pixels, width: number, height: number, keys: readonly (readonly number[])[], only?: Uint8Array): void {
  for (const key of keys) {
    const high = [0, 1, 2].filter((c) => key[c] >= 160);
    const low = [0, 1, 2].filter((c) => key[c] <= 95);
    if (high.length === 0 || low.length === 0) continue;
    const keySpill = Math.min(...high.map((c) => key[c])) - Math.max(...low.map((c) => key[c]));
    if (keySpill <= 0) continue;
    for (let p = 0; p < width * height; p++) {
      if (only && !only[p]) continue;
      const i = p * 4;
      if (rgba[i + 3] < 8) continue;
      let hi = 255;
      for (const c of high) hi = Math.min(hi, rgba[i + c]);
      let lo = 0;
      for (const c of low) lo = Math.max(lo, rgba[i + c]);
      const t0 = (hi - lo) / keySpill;
      if (t0 <= DESPILL_START) continue;
      // 弱い混ざり（服そのものの色かもしれない）は少しだけ、強い混ざりはそのまま直す
      const w = Math.min(1, (t0 - DESPILL_START) / DESPILL_RAMP);
      const t = Math.min(1, t0 * w * w * (3 - 2 * w));
      if (t >= DESPILL_DROP) {
        rgba[i + 3] = 0;
        continue;
      }
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.max(0, Math.min(255, Math.round((rgba[i + c] - t * key[c]) / (1 - t))));
      rgba[i + 3] = Math.round(rgba[i + 3] * (1 - t));
    }
  }
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
