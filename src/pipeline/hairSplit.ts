/**
 * 髪を「前髪（ドールの上に描く）」と「後ろ髪（ドールの下に描く）」に分ける純粋関数
 *
 * 髪を 1 枚でドールの上に重ねると、体の後ろに垂れた髪のふちが、ドールの輪郭線を削ってしまう
 * （AI が描くシルエットのふちは、ドールと数 px ずれる）。また、服より手前に出てしまう。
 * そこで、体の内側にはっきり描かれた髪（前髪・胸に垂れた房）だけを前に残し、
 * 髪の全体を後ろ髪としてドールの下に敷く。後ろ髪は、ドールとのすき間が出ないよう、体の下へ少し塗り広げる。
 */
import type { Pixels } from './alpha';

// 髪として扱うカテゴリ（名前で決める）
export const isHairCategory = (label: string): boolean => /かみ|髪|ヘア|hair/i.test(label);

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
export function splitHair(rgba: Pixels, dollAlpha: Uint8Array | Uint8ClampedArray, width: number, height: number, depth = Math.max(2, Math.round(width / DEPTH_PER))): HairSplit | null {
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
  for (let p = 0; p < total; p++) seeds[p] = hair[p] && inside[p] && fromOutside[p] === 0 ? 1 : 0;
  if (dropThinFragments(seeds) === 0) return null;

  // そこから、体のふちの帯へ、つながっている髪をたどる。
  // たどれるのは「まわりの体がすべて髪で隠れている」所だけ。
  //  - 体のふちを横切る前髪・髪がかぶさった耳: まわりの体も髪の下 → 前
  //  - 後ろ髪のふちが体の輪郭線に少しかぶっただけの所: すぐ内側の体は髪の下ではない → 前にしない（輪郭線を削らない）
  const bare = new Uint8Array(total);
  for (let p = 0; p < total; p++) bare[p] = inside[p] && !hair[p] ? 1 : 0;
  const nearBare = distance(bare, null, width, height, COVER_REACH);
  const walkable = new Uint8Array(total);
  for (let p = 0; p < total; p++) walkable[p] = hair[p] && nearBody(p) && !bare[p] && nearBare[p] === 0 ? 1 : 0;
  const grown = distance(seeds, walkable, width, height, depth * 2 + ring + 2);
  const front = new Uint8Array(total);
  for (let p = 0; p < total; p++) front[p] = seeds[p] || grown[p] > 0 ? 1 : 0;

  const frontPixels = new Uint8ClampedArray(total * 4);
  for (let p = 0; p < total; p++) if (front[p]) frontPixels.set(rgba.subarray(p * 4, p * 4 + 4), p * 4);

  // 後ろ: 髪の全体。体の近くでは、はっきりした髪の色を、体の下（と、ふちの帯）へ塗り広げる
  const back = new Uint8ClampedArray(rgba);
  const solid = new Uint8Array(total);
  for (let p = 0; p < total; p++) solid[p] = rgba[p * 4 + 3] >= 128 ? 1 : 0;
  const filled = new Uint8Array(total); // 塗り広げた距離
  let wave: number[] = [];
  for (let p = 0; p < total; p++) {
    if (!solid[p]) continue;
    if (nearBody(p)) back[p * 4 + 3] = 255; // 体の近くのふちは、半透明のままだとすき間に見える
    wave.push(p);
  }
  for (let d = 1; d <= depth * 2 && wave.length > 0; d++) {
    const next: number[] = [];
    for (const p of wave) {
      const x = p % width;
      const visit = (n: number) => {
        if (solid[n] || filled[n]) return;
        // 体の外側は、体と髪にはさまれた細いすき間だけ（髪が太ったり、体のふちに沿って伸びたりしないように）
        if (!(inside[n] || (fromInside[n] > 0 && fromInside[n] + d <= ring + 1))) return;
        filled[n] = d;
        back.set(back.subarray(p * 4, p * 4 + 3), n * 4);
        back[n * 4 + 3] = 255;
        next.push(n);
      };
      if (x > 0) visit(p - 1);
      if (x < width - 1) visit(p + 1);
      if (p >= width) visit(p - width);
      if (p < total - width) visit(p + width);
    }
    wave = next;
  }
  return { front: frontPixels, back };
}
