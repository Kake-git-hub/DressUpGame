/**
 * 顔の作り方
 *
 * 服と同じ「単色のシルエットに描かせて色で抜く」方式だと、肌の代わりにシルエットの色がまざり、
 * 顔が緑がかったり、肌色の板が付いたりする。また、顔は画像のごく一部なので細部がつぶれる。
 * そこで、ドールの本物の頭を大きく写した図に顔を描かせ、その頭を肌ごと「お面」のように切り取って、ドールの頭に重ねる。
 * 目や口だけを抜き出すことはしない（抜き出すと、うすい影やほお紅が欠けたり、色が残ったりする）。
 * 切り取る形はドールの頭の形そのものなので、輪郭はドールとぴったり合う。首との境目は、ぼかしてなじませる。
 */
import sharp from 'sharp';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import type { Box } from '../../src/pipeline/alpha.ts';
import { diffMatte, matchToReference } from '../../src/pipeline/diffMatte.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { DollTemplate, ProcessResult, ProcessWarning } from './processGenerated.ts';

// 顔として扱うカテゴリ（名前で決める）。髪は含めない
export const isFaceCategory = (label: string): boolean => /かお|顔|face|メイク|おけしょう|化粧/i.test(label) && !/かみ|髪|ヘア|hair/i.test(label);

// 頭の拡大図の 1 辺（px）と、頭の大きさに対する写す範囲
export const FACE_SIZE = 1024;
const FACE_MARGIN = 1.5;
// はっきり描き変えられた画素がこれより多ければ、AI が頭ごと描き直した疑いがある
const REPAINT_LIMIT = 0.45;
// 拡大図の端は、AI が絵をずらしたときに元の絵と合わなくなる。端からこの割合は、何も描き足されていないとみなす
const EDGE_MARGIN = 0.03;

// ドールのキャンバス上の、正方形の範囲
export interface FaceCrop {
  x: number;
  y: number;
  size: number;
}

// 頭を中心に、少し広めの正方形を取る（キャンバスからはみ出さないようにずらす）
export function faceCrop(head: Box, canvasW: number, canvasH: number): FaceCrop {
  const size = Math.max(8, Math.min(canvasW, canvasH, Math.round(Math.max(head.w, head.h) * FACE_MARGIN)));
  const x = Math.min(canvasW - size, Math.max(0, Math.round(head.x + head.w / 2 - size / 2)));
  const y = Math.min(canvasH - size, Math.max(0, Math.round(head.y + head.h / 2 - size / 2)));
  return { x, y, size };
}

// 頭の拡大図（背景色の上に、本物のドールを重ねたもの）
export async function renderHeadCloseup(doll: DollTemplate, crop: FaceCrop, background: Rgb, size = FACE_SIZE): Promise<Buffer> {
  const { canvasW, canvasH } = doll;
  const rgb = Buffer.alloc(crop.size * crop.size * 3);
  for (let y = 0; y < crop.size; y++) {
    for (let x = 0; x < crop.size; x++) {
      const p = ((crop.y + y) * canvasW + crop.x + x) * 4;
      const inside = crop.y + y < canvasH && crop.x + x < canvasW;
      const a = inside ? doll.rgba[p + 3] / 255 : 0;
      for (let c = 0; c < 3; c++) rgb[(y * crop.size + x) * 3 + c] = Math.round((inside ? doll.rgba[p + c] : 0) * a + background[c] * (1 - a));
    }
  }
  return sharp(rgb, { raw: { width: crop.size, height: crop.size, channels: 3 } }).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
}

async function toRaw(image: Buffer, size: number): Promise<Uint8ClampedArray> {
  const data = await sharp(image).removeAlpha().ensureAlpha().resize(size, size, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
}

// 拡大図の大きさの画像を、ドールのキャンバスの元の位置に戻す
async function toCanvas(rgba: Uint8ClampedArray, size: number, crop: FaceCrop, canvasW: number, canvasH: number): Promise<Uint8ClampedArray> {
  const small = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: size, height: size, channels: 4 } })
    .resize(crop.size, crop.size, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  const out = new Uint8ClampedArray(canvasW * canvasH * 4);
  for (let y = 0; y < crop.size && crop.y + y < canvasH; y++) {
    const width = Math.min(crop.size, canvasW - crop.x);
    out.set(small.subarray(y * crop.size * 4, (y * crop.size + width) * 4), ((crop.y + y) * canvasW + crop.x) * 4);
  }
  return out;
}

/**
 * AI が頭の拡大図に顔を描いた画像 → ドールの頭に重ねる「お面」（肌ごと）。head は、ドールのキャンバス上の頭の箱
 * reference は、AI に渡した拡大図（renderHeadCloseup の結果）。
 */
// お面の形（キャンバス大、0〜255）: ドールの頭（あごまで）。ふちは少し内側へぼかし、首との境目は広めにぼかす
export function headMask(doll: DollTemplate, head: Box, crop: FaceCrop): Uint8Array {
  const { canvasW, canvasH } = doll;
  const out = new Uint8Array(canvasW * canvasH);
  const x0 = Math.max(0, crop.x);
  const x1 = Math.min(canvasW, crop.x + crop.size);
  const y0 = Math.max(0, crop.y);
  const bottom = Math.min(canvasH, crop.y + crop.size, Math.round(head.y + head.h));
  const edge = Math.max(1, Math.round(head.w * 0.02)); // ふちのぼかし（px）
  const neck = Math.max(2, Math.round(head.h * 0.08)); // 首との境目のぼかし（px）
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < canvasW && y < canvasH && doll.rgba[(y * canvasW + x) * 4 + 3] >= 128;
  for (let y = y0; y < bottom; y++) {
    for (let x = x0; x < x1; x++) {
      if (!inside(x, y)) continue;
      // ふちからの深さ（上下左右に edge px まで見る）
      let depth = edge + 1;
      for (let d = 1; d <= edge && depth > edge; d++) if (!inside(x - d, y) || !inside(x + d, y) || !inside(x, y - d)) depth = d;
      const side = Math.min(1, depth / (edge + 1));
      const fade = Math.min(1, (bottom - y) / neck);
      out[y * canvasW + x] = Math.round(255 * side * fade);
    }
  }
  return out;
}

export async function processFace(generated: Buffer, reference: Buffer, doll: DollTemplate, crop: FaceCrop, background: Rgb, head: Box): Promise<ProcessResult> {
  let image: Uint8ClampedArray;
  try {
    image = await toRaw(generated, FACE_SIZE);
  } catch (error) {
    throw new Error(`画像を読めませんでした（${(error as Error).message}）`);
  }
  const ref = await toRaw(reference, FACE_SIZE);
  const match = matchToReference(image, ref, FACE_SIZE, FACE_SIZE);
  const matte = diffMatte(match.rgba, ref, FACE_SIZE, FACE_SIZE);
  const edge = Math.round(FACE_SIZE * EDGE_MARGIN);
  for (let y = 0; y < FACE_SIZE; y++) {
    for (let x = 0; x < FACE_SIZE; x++) {
      if (x < edge || y < edge || x >= FACE_SIZE - edge || y >= FACE_SIZE - edge) matte.rgba[(y * FACE_SIZE + x) * 4 + 3] = 0;
    }
  }

  const { canvasW, canvasH } = doll;
  const source = await toCanvas(match.rgba, FACE_SIZE, crop, canvasW, canvasH);
  // お面: AI が描いた頭を、ドールの頭の形で切り取る
  const rgba = new Uint8ClampedArray(source);
  const mask = headMask(doll, head, crop);
  for (let p = 0; p < mask.length; p++) rgba[p * 4 + 3] = mask[p] < 8 ? 0 : mask[p];
  // 何か描き足されたか（元の絵との違い）は、警告のためだけに見る
  const drawn = await toCanvas(matte.rgba, FACE_SIZE, crop, canvasW, canvasH);
  for (let i = 3; i < drawn.length; i += 4) if (drawn[i] < 8) drawn[i] = 0;

  const warnings: ProcessWarning[] = [];
  if (!alphaBBox(drawn, canvasW, canvasH) || !alphaBBox(rgba, canvasW, canvasH)) {
    warnings.push({ code: 'empty', message: '顔が見つかりません（元の絵から何も変わっていませんでした）' });
  } else if (matte.changedShare > REPAINT_LIMIT) {
    warnings.push({ code: 'repainted', message: 'AI が頭や背景ごと描き直したようです。肌の色や輪郭がドールと合わないかもしれません' });
  }
  return {
    rgba,
    source,
    width: canvasW,
    height: canvasH,
    keyColors: { background, silhouette: null },
    alignment: { scale: match.scale, dx: match.dx, dy: match.dy, score: 1 },
    anchorShift: null,
    partShifts: [],
    shape: null,
    closeColorRatio: 0,
    warnings,
  };
}
