/**
 * 体の部位ごとの位置合わせ（全体の位置合わせのあとに行う、細かい直し）
 *
 * 画像生成 AI はシルエットも描き直すので、腕の角度や指先が数 px ずつゆがむ。
 * 全体を 1 回動かすだけでは直せないため、部位（手・腕・足など）ごとに
 * 「生成画像の体の形（背景でない部分）」が本物のドールに最も重なるずれを探し、
 * そのずれで服の画素を動かす。部位の境目は、ずれをぼかしてなめらかにつなぐ。
 *
 * 体にぴったり沿っていない所（ふくらんだスカートの下の脚など）は形が合わないので動かさない。
 */
import type { Box } from './alpha';

export interface PartShift {
  box: Box;
  dx: number; // 服をこの量だけ動かす（ドールのキャンバス px）
  dy: number;
  before: number; // 動かす前の重なり（IoU、0〜1）
  after: number; // 動かしたあとの重なり
}

export interface PartAlignOptions {
  reach?: number; // ずれを探す範囲（px）。既定はキャンバス幅の 2.5%
  minIoU?: number; // 動かしたあとの重なりがこれ未満の部位は、形が合っていないとみなして動かさない
  minGain?: number; // 重なりの改善がこれ未満なら動かさない
}

const DEFAULT_MIN_IOU = 0.7;
const DEFAULT_MIN_GAIN = 0.01;

// box の中で、fg を (dx, dy) 動かしたときのドールとの重なり（IoU）
function iou(fg: Uint8Array, doll: Uint8Array, width: number, height: number, box: Box, dx: number, dy: number): number {
  let both = 0;
  let either = 0;
  for (let y = box.y; y < box.y + box.h; y++) {
    const sy = y - dy;
    for (let x = box.x; x < box.x + box.w; x++) {
      const sx = x - dx;
      const f = sx >= 0 && sx < width && sy >= 0 && sy < height ? fg[sy * width + sx] : 0;
      const d = doll[y * width + x];
      if (f && d) both++;
      if (f || d) either++;
    }
  }
  return either === 0 ? 0 : both / either;
}

/**
 * 部位ごとのずれを探す。
 *  fg: 1 = 生成画像で背景でない所（シルエット＋服）。全体の位置合わせ後、ドールのキャンバス上
 *  doll: 1 = ドール
 */
export function findPartShifts(fg: Uint8Array, doll: Uint8Array, width: number, height: number, parts: Box[], options: PartAlignOptions = {}): PartShift[] {
  const reach = Math.max(1, Math.round(options.reach ?? width * 0.025));
  const minIoU = options.minIoU ?? DEFAULT_MIN_IOU;
  const minGain = options.minGain ?? DEFAULT_MIN_GAIN;
  const shifts: PartShift[] = [];
  for (const raw of parts) {
    const box = clamp(raw, width, height);
    if (!box) continue;
    const before = iou(fg, doll, width, height, box, 0, 0);
    // 2 px おきに探してから、まわり ±1 px を詰める
    let best = { dx: 0, dy: 0, value: before };
    for (let dy = -reach; dy <= reach; dy += 2) {
      for (let dx = -reach; dx <= reach; dx += 2) {
        const value = iou(fg, doll, width, height, box, dx, dy);
        if (value > best.value + 1e-9) best = { dx, dy, value };
      }
    }
    const center = { ...best };
    for (let dy = center.dy - 1; dy <= center.dy + 1; dy++) {
      for (let dx = center.dx - 1; dx <= center.dx + 1; dx++) {
        if (Math.abs(dx) > reach || Math.abs(dy) > reach) continue;
        const value = iou(fg, doll, width, height, box, dx, dy);
        if (value > best.value + 1e-9) best = { dx, dy, value };
      }
    }
    const use = best.value >= minIoU && best.value - before >= minGain && (best.dx !== 0 || best.dy !== 0);
    shifts.push({ box, dx: use ? best.dx : 0, dy: use ? best.dy : 0, before, after: use ? best.value : before });
  }
  return shifts;
}

function clamp(b: Box, width: number, height: number): Box | null {
  const x0 = Math.max(0, Math.round(b.x));
  const y0 = Math.max(0, Math.round(b.y));
  const x1 = Math.min(width, Math.round(b.x + b.w));
  const y1 = Math.min(height, Math.round(b.y + b.h));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

// 横・縦に箱型でぼかす（半径 r）
function blur(field: Float32Array, width: number, height: number, r: number): Float32Array {
  const tmp = new Float32Array(field.length);
  const out = new Float32Array(field.length);
  const n = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += field[y * width + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      tmp[y * width + x] = sum / n;
      sum += field[y * width + Math.min(width - 1, x + r + 1)] - field[y * width + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / n;
      sum += tmp[Math.min(height - 1, y + r + 1) * width + x] - tmp[Math.max(0, y - r) * width + x];
    }
  }
  return out;
}

/**
 * 部位ごとのずれで、画像（RGBA）を動かした新しい画像を返す。
 * 各画素は「その画素を含むいちばん小さい部位」のずれに従う（手は腕より優先）。部位の箱から少し離れた所は動かさない。
 * 境目でちぎれないように、ずれの量をぼかしてから動かす。
 */
export function warpByParts(rgba: Uint8ClampedArray, width: number, height: number, shifts: PartShift[], smooth = Math.round(width * 0.015)): Uint8ClampedArray {
  if (!shifts.some((s) => s.dx !== 0 || s.dy !== 0)) return new Uint8ClampedArray(rgba);
  const fx = new Float32Array(width * height);
  const fy = new Float32Array(width * height);
  const area = new Float64Array(width * height).fill(Infinity);
  // 部位の箱の少し外まで、その部位のずれに従わせる（指先など、箱の端にある所までしっかり動かすため）
  const grow = smooth * 2;
  for (const s of shifts) {
    const a = s.box.w * s.box.h;
    for (let y = Math.max(0, s.box.y - grow); y < Math.min(height, s.box.y + s.box.h + grow); y++) {
      for (let x = Math.max(0, s.box.x - grow); x < Math.min(width, s.box.x + s.box.w + grow); x++) {
        const p = y * width + x;
        if (a >= area[p]) continue;
        area[p] = a;
        fx[p] = s.dx;
        fy[p] = s.dy;
      }
    }
  }
  const sx = smooth > 0 ? blur(fx, width, height, smooth) : fx;
  const sy = smooth > 0 ? blur(fy, width, height, smooth) : fy;
  const out = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (Math.abs(sx[p]) < 1e-3 && Math.abs(sy[p]) < 1e-3) {
        for (let c = 0; c < 4; c++) out[p * 4 + c] = rgba[p * 4 + c];
        continue;
      }
      // 出力の (x, y) には、元の (x - dx, y - dy) を持ってくる（双線形）
      const u = x - sx[p];
      const v = y - sy[p];
      const x0 = Math.floor(u);
      const y0 = Math.floor(v);
      const tx = u - x0;
      const ty = v - y0;
      const w00 = (1 - tx) * (1 - ty);
      const w10 = tx * (1 - ty);
      const w01 = (1 - tx) * ty;
      const w11 = tx * ty;
      const inX0 = x0 >= 0 && x0 < width;
      const inX1 = x0 + 1 >= 0 && x0 + 1 < width;
      const inY0 = y0 >= 0 && y0 < height;
      const inY1 = y0 + 1 >= 0 && y0 + 1 < height;
      const q00 = (y0 * width + x0) * 4;
      const q10 = q00 + 4;
      const q01 = q00 + width * 4;
      const q11 = q01 + 4;
      for (let c = 0; c < 4; c++) {
        let value = 0;
        if (inX0 && inY0) value += rgba[q00 + c] * w00;
        if (inX1 && inY0) value += rgba[q10 + c] * w10;
        if (inX0 && inY1) value += rgba[q01 + c] * w01;
        if (inX1 && inY1) value += rgba[q11 + c] * w11;
        out[p * 4 + c] = Math.round(value);
      }
    }
  }
  return out;
}
