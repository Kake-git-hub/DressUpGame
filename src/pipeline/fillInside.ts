/**
 * くつの内側を、肌の色で埋める純粋関数
 *
 * 画像生成 AI は、甲の開いた靴（ストラップシューズなど）を描くと、足が見える所をシルエットの色で残す。
 * そこを切り抜くと、開いた所からドールの本物の足（指や輪郭線）がのぞき、AI の描いた足と形が合わないので、ちぐはぐに見える。
 * そこで、靴に囲まれた「AI の足があった所」を切り抜かずに肌の色で埋め、靴の一部にする。ドールの足先は、その下に隠れる。
 */
import type { Box, Pixels } from './alpha';

// これより細い横の並びは、靴の本体とみなさない（切り抜きで残った細い線など）。画像の幅に対する割合
const MIN_RUN_SHARE = 0.006;

/**
 * rgba: 切り抜いた靴（その場で書き換える）。silhouette: 1 = AI の体があった所（靴と同じ位置合わせ）。
 * zone: 足もとの範囲。skin: 埋める色。fillTop: 埋める範囲の上の端（足首のあたり）。埋めた画素の数を返す
 */
export function fillInside(rgba: Pixels, silhouette: ArrayLike<number>, width: number, height: number, zone: Box, skin: [number, number, number], fillTop = zone.y): number {
  const x0 = Math.max(0, Math.round(zone.x));
  const x1 = Math.min(width, Math.round(zone.x + zone.w));
  const y0 = Math.max(0, Math.round(zone.y));
  const y1 = Math.min(height, Math.round(zone.y + zone.h));
  if (x1 <= x0 || y1 <= y0) return 0;
  const top = Math.round(fillTop); // これより上（足首から上）は埋めない。ドールの脚がそのまま見える
  const MIN_RUN = Math.max(4, Math.round(width * MIN_RUN_SHARE));
  const maxSpan = (x1 - x0) * 0.45; // 片足ぶんの幅。左右の靴にまたがって埋めない
  // 靴の本体（はっきり不透明で、横に MIN_RUN 以上続く所）
  const body = new Uint8Array(width * height);
  for (let y = y0; y < y1; y++) {
    let run = 0;
    for (let x = x0; x <= x1; x++) {
      const on = x < x1 && rgba[(y * width + x) * 4 + 3] >= 128;
      if (on) {
        run++;
        continue;
      }
      if (run >= MIN_RUN) for (let k = x - run; k < x; k++) body[y * width + k] = 1;
      run = 0;
    }
  }
  // 各列で、いちばん下にある靴の本体
  const lowest = new Int32Array(width).fill(-1);
  for (let x = x0; x < x1; x++) for (let y = y1 - 1; y >= y0; y--) if (body[y * width + x]) { lowest[x] = y; break; }

  // 靴より上にのびた細い線（AI が脚のまわりに描いた輪郭線の切り残し）を消す
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = y * width + x;
      if (rgba[p * 4 + 3] > 0 && !body[p] && y < top) rgba[p * 4 + 3] = 0;
    }
  }

  let filled = 0;
  for (let y = Math.max(y0, top); y < y1; y++) {
    // 左から見た、いちばん近い靴の本体の位置
    const left = new Int32Array(x1 - x0).fill(-1);
    let last = -1;
    for (let x = x0; x < x1; x++) {
      if (body[y * width + x]) last = x;
      left[x - x0] = last;
    }
    let right = -1;
    for (let x = x1 - 1; x >= x0; x--) {
      const p = y * width + x;
      if (body[p]) {
        right = x;
        continue;
      }
      const l = left[x - x0];
      // 靴に左右をはさまれ、下にも靴がある所（＝靴の内側）
      if (l < 0 || right < 0 || right - l > maxSpan || lowest[x] <= y) continue;
      const a = rgba[p * 4 + 3];
      if (!silhouette[p] && (a === 0 || a === 255)) continue; // AI の足でも、靴のふちでもない
      for (let c = 0; c < 3; c++) rgba[p * 4 + c] = Math.round((rgba[p * 4 + c] * a + skin[c] * (255 - a)) / 255);
      rgba[p * 4 + 3] = 255;
      filled++;
    }
  }
  return filled;
}

// ドールの肌の色: 範囲の中の、不透明な画素の中央値（輪郭線や影より、肌の画素のほうが多い）
export function skinColor(doll: Pixels, width: number, height: number, box: Box): [number, number, number] {
  const values: number[][] = [[], [], []];
  for (let y = Math.max(0, Math.round(box.y)); y < Math.min(height, Math.round(box.y + box.h)); y++) {
    for (let x = Math.max(0, Math.round(box.x)); x < Math.min(width, Math.round(box.x + box.w)); x++) {
      const p = (y * width + x) * 4;
      if (doll[p + 3] < 255) continue;
      for (let c = 0; c < 3; c++) values[c].push(doll[p + c]);
    }
  }
  return values.map((v) => (v.length ? v.sort((a, b) => a - b)[v.length >> 1] : 224)) as [number, number, number];
}
