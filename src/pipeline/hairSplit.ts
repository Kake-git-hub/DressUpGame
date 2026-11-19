/**
 * 髪を「前髪（ドールの上に描く）」と「後ろ髪（ドールの下に描く）」に分ける純粋関数
 *
 * 髪を 1 枚でドールの上に重ねると、体の後ろに垂れた髪のふちが、ドールの輪郭線を削ってしまう
 * （AI が描くシルエットのふちは、ドールと数 px ずれる）。また、服より手前に出てしまう。
 * そこで、頭のまわりで体の内側にはっきり描かれた髪（前髪）だけを前に残し、
 * 髪の全体を後ろ髪としてドールの下に敷く。
 *
 * 後ろ髪は、マントのような 1 枚の形にする: AI の絵では体の形に穴があいているが、どうせドールの後ろに隠れるので、
 * 穴を左右の髪の色で埋める。こうすると、AI の描いた体がドールより太くても細くても、すき間が出ない。
 */
import type { Pixels } from './alpha';

// うしろがみのカテゴリ（名前で決める）: 前髪とは別の品目として、最初からドールの後ろに描く 1 枚として作る
export const isBackHairCategory = (label: string): boolean => /うしろ[がか]み|後ろ?髪|バックヘア|back ?hair/i.test(label);
// 髪として扱うカテゴリ（名前で決める）。うしろがみは含まない
export const isHairCategory = (label: string): boolean => /かみ|まえがみ|髪|ヘア|hair/i.test(label) && !isBackHairCategory(label);
// 1 枚の髪を、保存のときに前髪と後ろ髪に分けるか。うしろがみのカテゴリを持つドールでは分けない（髪のカテゴリは前髪だけを作る）
export const splitsHair = (label: string, allLabels: readonly string[]): boolean => isHairCategory(label) && !allLabels.some(isBackHairCategory);

export interface HairSplit {
  front: Uint8ClampedArray; // ドールの上に描く分
  back: Uint8ClampedArray; // ドールの下に描く分（髪の全体＋体の下への塗り広げ）
}

// 体のふちからこの深さ（px。画像の幅 128px につき 1）より内側に描かれた髪を「前」とみなす。
// ドールの輪郭線の太さと、AI のシルエットのずれを合わせたくらい
const DEPTH_PER = 128;
// 芯（太い所）を持たない小さなかけらは、AI が描き足した線（あごの線など）とみなして前から外す。
// 芯の半径（px。画像の幅 400px につき 1）と、かけらの大きさの上限（画像の画素数をこれで割った数）
const CORE_PER = 400;
const FRAGMENT_DIVISOR = 1000;
// 体のふちの帯で、髪を「前」とみなすには、まわりのこの範囲（px）の体がすべて髪で隠れていること
const COVER_REACH = 2;
// 描いた絵で穴を埋めるとき、穴のふちで、もとの髪を絵に置き換える幅（px）
const SEAM_WIDTH = 4;
// 後ろ髪で、体の外にある「体と髪のあいだのすき間」を埋める幅の上限（画像の幅に対する割合）
const GAP_SHARE = 0.02;

// from（1 の画素）からの 4 近傍の距離（1〜limit）。届かない所は 0。through が 0 の画素には入らない
function distance(from: Uint8Array, through: Uint8Array | null, width: number, height: number, limit: number): Uint8Array {
  const total = width * height;
  const dist = new Uint8Array(total);
  let wave: number[] = [];
  for (let p = 0; p < total; p++) if (from[p]) wave.push(p);
  for (let d = 1; d <= limit && wave.length > 0; d++) {
    const next: number[] = [];
    for (const p of wave) {
      const x = p % width;
      const visit = (n: number) => {
        if (from[n] || dist[n] || (through && !through[n])) return;
        dist[n] = d;
        next.push(n);
      };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < total - width) visit(p + width);
    }
    wave = next;
  }
  return dist;
}

/**
 * rgba: 切り抜いた髪（ドールのキャンバス大）。dollAlpha: ドールの不透明度（同じ大きさ）。
 * 前に残す髪が無ければ null（分けずに、いままでどおり 1 枚で使う）。
 */
export interface HairSplitOptions {
  // この行（y）より下の髪は、前にしない（頭のまわりの前髪だけを前に残す。手や腕にかかった髪は、後ろ髪としてドールの後ろへ）
  frontBottom?: number;
  // AI が描いた体と髪の形（背景でない所の不透明度、0〜255）。あれば、体の外のすき間は「AI の体があった所」だけ埋める
  bodyShape?: ArrayLike<number>;
}

// 前髪として残す範囲の下の端: あごの少し下
export const hairFrontBottom = (head: { y: number; h: number }): number => Math.round(head.y + head.h * 1.1);

export function splitHair(
  rgba: Pixels,
  dollAlpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  depth = Math.max(2, Math.round(width / DEPTH_PER)),
  options: HairSplitOptions = {},
): HairSplit | null {
  const frontBottom = options.frontBottom ?? height;
  const shape = options.bodyShape ?? null;
  const total = width * height;
  const inside = new Uint8Array(total);
  const outside = new Uint8Array(total);
  const hair = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    inside[p] = dollAlpha[p] >= 128 ? 1 : 0;
    outside[p] = 1 - inside[p];
    hair[p] = rgba[p * 4 + 3] >= 8 ? 1 : 0;
  }
  const ring = Math.max(1, Math.round(depth / 2)); // 体の外側の、ふちの帯の幅
  const fromOutside = distance(outside, null, width, height, depth + 1); // 体の内側: ふちからの深さ（1〜）。0 = もっと深い
  const fromInside = distance(inside, null, width, height, ring); // 体の外側: 体からの距離（1〜ring）。0 = もっと遠い
  const nearBody = (p: number) => inside[p] === 1 || fromInside[p] > 0;

  const reach = Math.max(1, Math.round(width / CORE_PER));
  const maxFragment = Math.round(total / FRAGMENT_DIVISOR);
  // 芯（まわり reach px がすべて mask）を持たない小さなかけらを、mask から外す。残った画素数を返す
  const dropThinFragments = (mask: Uint8Array): number => {
    const run = new Uint8Array(total);
    const core = new Uint8Array(total);
    for (let y = 0; y < height; y++) {
      let length = 0;
      for (let x = 0; x < width; x++) {
        length = mask[y * width + x] ? length + 1 : 0;
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
    let kept = 0;
    for (let start = 0; start < total; start++) {
      if (!mask[start] || seen[start]) continue;
      let size = 0;
      let hasCore = false;
      let top = 0;
      stack[top++] = start;
      seen[start] = 1;
      while (top > 0) {
        const p = stack[--top];
        piece[size++] = p;
        if (core[p]) hasCore = true;
        const x = p % width;
        const visit = (n: number) => {
          if (mask[n] && !seen[n]) {
            seen[n] = 1;
            stack[top++] = n;
          }
        };
        if (x > 0) visit(p - 1);
        if (x < width - 1) visit(p + 1);
        if (p >= width) visit(p - width);
        if (p < total - width) visit(p + width);
      }
      if (!hasCore && size < maxFragment) for (let k = 0; k < size; k++) mask[piece[k]] = 0;
      else kept += size;
    }
    return kept;
  };

  // 前: 体の深い所に描かれた髪から始める。細い線だけのかけら（AI が描き足したあごの線など）は外す
  const seeds = new Uint8Array(total);
  for (let p = 0; p < total; p++) seeds[p] = hair[p] && inside[p] && fromOutside[p] === 0 && p < frontBottom * width ? 1 : 0;
  if (dropThinFragments(seeds) === 0) return null;

  // そこから、体のふちの帯へ、つながっている髪をたどる。
  // たどれるのは「まわりの体がすべて髪で隠れている」所だけ。
  //  - 体のふちを横切る前髪・髪がかぶさった耳: まわりの体も髪の下 → 前
  //  - 後ろ髪のふちが体の輪郭線に少しかぶっただけの所: すぐ内側の体は髪の下ではない → 前にしない（輪郭線を削らない）
  const bare = new Uint8Array(total);
  for (let p = 0; p < total; p++) bare[p] = inside[p] && !hair[p] ? 1 : 0;
  const nearBare = distance(bare, null, width, height, COVER_REACH);
  const walkable = new Uint8Array(total);
  for (let p = 0; p < total; p++) walkable[p] = hair[p] && nearBody(p) && !bare[p] && nearBare[p] === 0 && p < frontBottom * width ? 1 : 0;
  const grown = distance(seeds, walkable, width, height, depth * 2 + ring + 2);
  const front = new Uint8Array(total);
  for (let p = 0; p < total; p++) front[p] = seeds[p] || grown[p] > 0 ? 1 : 0;

  const frontPixels = new Uint8ClampedArray(total * 4);
  for (let p = 0; p < total; p++) if (front[p]) frontPixels.set(rgba.subarray(p * 4, p * 4 + 4), p * 4);

  const back = fillBehindBody(rgba, inside, nearBody, width, height, depth, shape, null);
  return { front: frontPixels, back };
}

/**
 * 髪の全体に、体の形の穴を埋めた「マントのような 1 枚」を作る。
 * 埋めるのは、行ごとに、髪にはさまれた「体の下」と「髪と体のあいだの細いすき間」。
 * paint（体に隠れていた髪を描いた絵。髪のある所だけ不透明）があれば、その絵で埋める。無い所は、両側の髪の色をなめらかにつなぐ
 */
function fillBehindBody(
  rgba: Pixels,
  inside: Uint8Array,
  nearBody: (p: number) => boolean,
  width: number,
  height: number,
  depth: number,
  shape: ArrayLike<number> | null,
  paint: Pixels | null,
): Uint8ClampedArray {
  const total = width * height;
  const back = new Uint8ClampedArray(rgba);
  const solid = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    solid[p] = rgba[p * 4 + 3] >= 128 ? 1 : 0;
    if (solid[p] && nearBody(p)) back[p * 4 + 3] = 255; // 体の近くのふちは、半透明のままだとすき間に見える
  }
  // 体の外で埋めてよい所: 髪と体にはさまれた細いすき間（AI の体がドールより太かった分）。
  // すき間の幅（髪からの距離 + 体からの距離）が gapLimit 以下の所だけ。AI の体の形が分かっていれば、AI の体があった所だけ。
  // 左右に分かれた髪と体のあいだの広い空きや、腕と胴のあいだは埋めない
  const gapLimit = Math.max(depth * 2, Math.round(width * GAP_SHARE));
  const nearDoll = distance(inside, null, width, height, gapLimit);
  const gap = new Uint8Array(total);
  let wave: number[] = [];
  for (let p = 0; p < total; p++) if (solid[p]) wave.push(p);
  for (let d = 1; d <= gapLimit && wave.length > 0; d++) {
    const next: number[] = [];
    for (const p of wave) {
      const x = p % width;
      const visit = (n: number) => {
        if (solid[n] || gap[n] || inside[n]) return;
        if (nearDoll[n] === 0 || nearDoll[n] + d > gapLimit + 1) return;
        if (shape && shape[n] < 128) return;
        gap[n] = 1;
        next.push(n);
      };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < total - width) visit(p + width);
    }
    wave = next;
  }

  // 行ごとに、髪にはさまれた区間の「体の下」と「細いすき間」を、両側の髪の色をなめらかにつないで埋める
  const painted = new Uint8Array(total); // 描いた絵で埋めた所
  const inset = Math.max(1, Math.round(depth / 2)); // 色は、髪のふち（輪郭線）より少し内側から取る
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (!solid[row + x]) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) continue;
    let x = first;
    while (x <= last) {
      if (solid[row + x]) {
        x++;
        continue;
      }
      // 髪にはさまれた、髪でない区間 [a, b]
      const a = x;
      while (x <= last && !solid[row + x]) x++;
      const b = x - 1;
      // 両側の髪の色（ふちから少し内側。髪が細ければ、ふちの色）
      const colorAt = (edge: number, step: -1 | 1) => {
        let q = edge;
        for (let k = 0; k < inset && q + step >= 0 && q + step < width && solid[row + q + step]; k++) q += step;
        return (row + q) * 4;
      };
      const left = colorAt(a - 1, -1);
      const right = colorAt(b + 1, 1);
      const joined = (k: number, q: number) => {
        const t = (k - a + 1) / (b - a + 2);
        for (let c = 0; c < 3; c++) back[q + c] = Math.round(rgba[left + c] * (1 - t) + rgba[right + c] * t);
        back[q + 3] = 255;
      };
      const fillable = (k: number) => inside[row + k] === 1 || gap[row + k] === 1;
      if (!paint) {
        for (let k = a; k <= b; k++) if (fillable(k)) joined(k, (row + k) * 4);
        continue;
      }
      // 描いた絵があるとき: 絵に髪がある所は、その絵で埋める。絵に髪が無い所は、髪が無いものとして埋めない
      // （脚の後ろなど。切り抜きの残りかすを両端にして、体を塗りつぶさないように）。
      // ただし、絵のふちと髪のあいだにできる細いすき間（絵の位置が少し違う分）は、両側の色でつなぐ
      let k = a;
      while (k <= b) {
        const q = (row + k) * 4;
        if (!fillable(k)) {
          k++;
        } else if (paint[q + 3] >= 128) {
          for (let c = 0; c < 3; c++) back[q + c] = paint[q + c];
          back[q + 3] = 255;
          painted[row + k] = 1;
          k++;
        } else {
          const start = k;
          while (k <= b && fillable(k) && paint[(row + k) * 4 + 3] < 128) k++;
          if (k - start <= gapLimit) for (let m = start; m < k; m++) joined(m, (row + m) * 4);
        }
      }
    }
  }
  // 穴のふち（体の輪郭線だった所）: もとの髪のふちは、マネキンの色がにじんで線に見える。絵で埋めた所に接する数 px を、絵に置き換える
  if (paint) {
    const seam = distance(painted, solid, width, height, SEAM_WIDTH);
    for (let p = 0; p < total; p++) {
      if (seam[p] === 0 || paint[p * 4 + 3] < 128) continue;
      for (let c = 0; c < 3; c++) back[p * 4 + c] = paint[p * 4 + c];
    }
  }
  return back;
}

/**
 * うしろがみ: マネキンのまわりに描かれた髪（rgba）から、体の形の穴を埋めた 1 枚を作る。
 * paint は、マネキンを消して髪を描き足した絵（髪のある所だけ不透明）。位置や大きさが少し違っていても、穴の中の模様として使うだけなので、輪郭は rgba のまま
 */
export function capeHair(
  rgba: Pixels,
  dollAlpha: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  options: { bodyShape?: ArrayLike<number>; paint?: Pixels } = {},
): Uint8ClampedArray {
  const depth = Math.max(2, Math.round(width / DEPTH_PER));
  const total = width * height;
  const inside = new Uint8Array(total);
  for (let p = 0; p < total; p++) inside[p] = dollAlpha[p] >= 128 ? 1 : 0;
  const fromInside = distance(inside, null, width, height, Math.max(1, Math.round(depth / 2)));
  return fillBehindBody(rgba, inside, (p) => inside[p] === 1 || fromInside[p] > 0, width, height, depth, options.bodyShape ?? null, options.paint ?? null);
}
