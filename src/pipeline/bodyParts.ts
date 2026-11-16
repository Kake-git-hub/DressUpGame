/**
 * ドールの輪郭から、体の部位の位置を推定する純粋関数（型紙のもと）
 * 推定は目安。スタジオの画面で人が直せる。
 */
import type { Box } from './alpha';

export type PartName = 'head' | 'torso' | 'hips' | 'legs' | 'feet' | 'armLeft' | 'armRight' | 'handLeft' | 'handRight';
export type BodyParts = Record<PartName, Box>;

export const PART_LABELS: Record<PartName, string> = {
  head: 'あたま',
  torso: 'むね・おなか',
  hips: 'こし',
  legs: 'あし',
  feet: 'あしさき',
  armLeft: 'うで（左）',
  armRight: 'うで（右）',
  handLeft: 'て（左）',
  handRight: 'て（右）',
};

function unionBox(boxes: Box[]): Box {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function clampBox(b: Box, width: number, height: number): Box {
  const x0 = Math.max(0, Math.min(width - 1, Math.round(b.x)));
  const y0 = Math.max(0, Math.min(height - 1, Math.round(b.y)));
  const x1 = Math.max(x0 + 1, Math.min(width, Math.round(b.x + b.w)));
  const y1 = Math.max(y0 + 1, Math.min(height, Math.round(b.y + b.h)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// mask: 1 = ドール。正面を向いて立ち、腕を体から離している姿を想定する。全部透明なら null
export function estimateBodyParts(mask: Uint8Array, width: number, height: number): BodyParts | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  const H = y1 - y0 + 1;
  // 体の中心線 = 頭（上から 10%）の中央
  let sum = 0, count = 0;
  for (let y = y0; y < y0 + Math.max(1, Math.round(H * 0.1)); y++) {
    for (let x = x0; x <= x1; x++) if (mask[y * width + x]) { sum += x; count++; }
  }
  const cx = Math.round(sum / Math.max(1, count));

  // 各行で、中心線を含むひと続きの範囲（胴）。中心線が透明なら null
  const trunk = (y: number): [number, number] | null => {
    if (y < 0 || y >= height || !mask[y * width + cx]) return null;
    let a = cx, b = cx;
    while (a > 0 && mask[y * width + a - 1]) a--;
    while (b < width - 1 && mask[y * width + b + 1]) b++;
    return [a, b];
  };
  const at = (f: number) => y0 + Math.round(H * f);
  const narrowest = (from: number, to: number, fallback: number): number => {
    let best = -1, bestW = Infinity;
    for (let y = from; y <= to; y++) {
      const t = trunk(y);
      if (t && t[1] - t[0] < bestW) { bestW = t[1] - t[0]; best = y; }
    }
    return best < 0 ? fallback : best;
  };

  const neckY = narrowest(at(0.08), at(0.28), at(0.16));
  // 股: 中心線が続けて透明になる最初の行
  let crotchY = at(0.52);
  for (let y = at(0.38); y <= at(0.75); y++) {
    let gap = true;
    for (let k = 0; k < Math.max(3, Math.round(H * 0.01)); k++) if (trunk(y + k)) { gap = false; break; }
    if (gap) { crotchY = y; break; }
  }
  const waistY = narrowest(neckY + Math.round(H * 0.12), crotchY - Math.round(H * 0.06), Math.round((neckY + crotchY) / 2));
  const ankleY = y1 - Math.round(H * 0.07);

  // 胴の横幅: 腰のあたりの「中心線を含む範囲」
  let tx0 = cx, tx1 = cx;
  for (let y = waistY; y <= crotchY; y++) {
    const t = trunk(y);
    if (t) { tx0 = Math.min(tx0, t[0]); tx1 = Math.max(tx1, t[1]); }
  }
  // 腕は、腰の高さでは胴から離れている。肩の行は腕までつながるので、胴の幅は腰の値で打ち切る
  const pad = Math.round(H * 0.01);
  const rows = (from: number, to: number, left: number, right: number): Box => {
    let a = right, b = left, top = -1, bottom = -1;
    for (let y = from; y <= to; y++) {
      for (let x = Math.max(0, left); x <= Math.min(width - 1, right); x++) {
        if (!mask[y * width + x]) continue;
        if (x < a) a = x;
        if (x > b) b = x;
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top < 0) return { x: left, y: from, w: Math.max(1, right - left), h: Math.max(1, to - from) };
    return { x: a, y: top, w: b - a + 1, h: bottom - top + 1 };
  };

  // 頭: 首より上。横は、その範囲のドール全体（頭の上に腕は来ない前提）
  const head = rows(y0, neckY, x0, x1);
  const torso = rows(neckY, waistY, tx0 - pad, tx1 + pad);
  const hips = rows(waistY, crotchY, tx0 - pad, tx1 + pad);
  const legs = rows(crotchY, ankleY, tx0 - pad * 3, tx1 + pad * 3);
  const feet = rows(ankleY, y1, tx0 - pad * 6, tx1 + pad * 6);
  const armLeft = rows(neckY, Math.min(y1, crotchY + Math.round(H * 0.2)), x0, tx0 - pad - 1);
  const armRight = rows(neckY, Math.min(y1, crotchY + Math.round(H * 0.2)), tx1 + pad + 1, x1);
  const hand = (arm: Box): Box => {
    const h = Math.max(1, Math.round(arm.h * 0.28));
    return rows(arm.y + arm.h - h, arm.y + arm.h - 1, arm.x, arm.x + arm.w - 1);
  };
  const parts: BodyParts = { head, torso, hips, legs, feet, armLeft, armRight, handLeft: hand(armLeft), handRight: hand(armRight) };
  for (const key of Object.keys(parts) as PartName[]) parts[key] = clampBox(parts[key], width, height);
  return parts;
}

// カテゴリ名から、その品目が「あるはずの範囲」を決める。決められない（どこにでも付く）ものは null
const REGION_RULES: { match: RegExp; parts: PartName[]; grow: [number, number, number, number] }[] = [
  // grow = [左右, 上, 下] ではなく [左, 上, 右, 下] へ広げる量（ドールの高さに対する割合）
  { match: /ぼうし|帽子|hat|かんむり|ティアラ/i, parts: ['head'], grow: [0.12, 0.2, 0.12, 0.02] },
  { match: /かみ|髪|ヘア|hair/i, parts: ['head', 'torso'], grow: [0.12, 0.06, 0.12, 0.05] },
  { match: /かお|顔|face|メイク|めがね/i, parts: ['head'], grow: [0.03, 0.03, 0.03, 0.03] },
  { match: /てぶくろ|手袋|glove/i, parts: ['armLeft', 'armRight', 'handLeft', 'handRight'], grow: [0.04, 0.04, 0.04, 0.04] },
  { match: /くつした|ソックス|タイツ|sock/i, parts: ['legs', 'feet'], grow: [0.05, 0.03, 0.05, 0.02] },
  { match: /くつ|靴|shoe|ブーツ/i, parts: ['feet', 'legs'], grow: [0.06, -0.3, 0.06, 0.02] },
  { match: /インナー|したぎ|inner/i, parts: ['torso', 'hips'], grow: [0.05, 0.03, 0.05, 0.05] },
  { match: /ボトムス|スカート|パンツ|ズボン|bottom/i, parts: ['hips', 'legs'], grow: [0.25, 0.04, 0.25, 0.03] },
  { match: /ドレス|ワンピース|dress|きもの|着物/i, parts: ['torso', 'hips', 'legs', 'armLeft', 'armRight'], grow: [0.2, 0.04, 0.2, 0.06] },
  { match: /トップス|アウター|シャツ|うわぎ|top|outer/i, parts: ['torso', 'hips', 'armLeft', 'armRight'], grow: [0.06, 0.05, 0.06, 0.08] },
];

export function defaultRegion(label: string, parts: BodyParts, width: number, height: number): Box | null {
  const rule = REGION_RULES.find((r) => r.match.test(label));
  if (!rule) return null;
  const base = unionBox(rule.parts.map((p) => parts[p]));
  const H = parts.feet.y + parts.feet.h - parts.head.y;
  const [l, t, r, b] = rule.grow.map((g) => g * H);
  return clampBox({ x: base.x - l, y: base.y - t, w: base.w + l + r, h: base.h + t + b }, width, height);
}

// 服の不透明な画素のうち、範囲に入っている割合（0〜1）。服が無ければ 1
export function shareInsideRegion(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, region: Box): number {
  let total = 0, inside = 0;
  for (let y = 0; y < height; y++) {
    const inY = y >= region.y && y < region.y + region.h;
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < 128) continue;
      total++;
      if (inY && x >= region.x && x < region.x + region.w) inside++;
    }
  }
  return total === 0 ? 1 : inside / total;
}
