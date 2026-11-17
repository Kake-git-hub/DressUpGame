/**
 * AI が作った画像 1 枚 → ドールのキャンバスに合わせた服
 *
 * 読む → 背景色とシルエット色の検出 → 背景とシルエットの除去 → シルエットの形でドールに位置合わせ
 * → ドールのキャンバスに置く → 右下の小片の除去 → 警告を付ける
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import { alignToDoll } from '../../src/pipeline/align.ts';
import type { Alignment } from '../../src/pipeline/align.ts';
import { closeColorRatio, cutOutClothing } from '../../src/pipeline/cutout.ts';
import { detectKeyColors } from '../../src/pipeline/keyColors.ts';
import type { KeyColors, Rgb } from '../../src/pipeline/keyColors.ts';
import { findPartShifts, warpByParts } from '../../src/pipeline/partAlign.ts';
import type { PartShift } from '../../src/pipeline/partAlign.ts';
import { removeCornerSpeck } from '../../src/pipeline/removeCornerSpeck.ts';
import type { Box } from '../../src/pipeline/alpha.ts';
import type { ManifestImage } from '../../src/content/manifest.ts';

export type { Alignment, KeyColors };

export type WarningCode = 'no-silhouette' | 'poor-fit' | 'color-too-close' | 'empty' | 'touches-edge';
export interface ProcessWarning {
  code: WarningCode;
  message: string;
}

export interface ProcessResult {
  rgba: Uint8ClampedArray; // ドールのキャンバスと同じ大きさ。服だけが残っている
  source: Uint8ClampedArray; // 切り抜く前の画像を、同じ位置合わせでドールのキャンバスに置いたもの（手直しの復元用）
  width: number;
  height: number;
  keyColors: KeyColors;
  alignment: Alignment;
  partShifts: PartShift[]; // 部位ごとの細かい直し（直さなかった部位は 0）
  closeColorRatio: number;
  warnings: ProcessWarning[];
}

// ドールをキャンバス全体に戻した画像と、その形
export interface DollTemplate {
  rgba: Uint8ClampedArray;
  mask: Uint8Array; // 1 = ドール
  canvasW: number;
  canvasH: number;
}

export interface ProcessOptions {
  nudge?: { scale: number; dx: number; dy: number }; // 自動の位置合わせに重ねる手動の微調整
  silhouetteColor?: Rgb; // 生成時に指定したシルエット色（分かっていれば）
  parts?: Box[]; // 体の部位（型紙）。あれば、部位ごとに位置を直す
}

const POOR_FIT_SCORE = 0.6;
const CLOSE_COLOR_LIMIT = 0.05;

export async function dollTemplateFromImage(data: Buffer, image: ManifestImage): Promise<DollTemplate> {
  const { canvasW, canvasH, box } = image;
  const cropped = await sharp(data).ensureAlpha().resize(box.w, box.h, { fit: 'fill' }).raw().toBuffer();
  const rgba = new Uint8ClampedArray(canvasW * canvasH * 4);
  for (let y = 0; y < box.h; y++) {
    rgba.set(cropped.subarray(y * box.w * 4, (y + 1) * box.w * 4), ((box.y + y) * canvasW + box.x) * 4);
  }
  const mask = new Uint8Array(canvasW * canvasH);
  for (let p = 0; p < mask.length; p++) if (rgba[p * 4 + 3] >= 128) mask[p] = 1;
  return { rgba, mask, canvasW, canvasH };
}

export async function loadDollTemplate(contentDir: string, image: ManifestImage): Promise<DollTemplate> {
  return dollTemplateFromImage(await fs.readFile(path.join(contentDir, image.file)), image);
}

// 元画像（RGBA）を倍率 scale で拡大縮小し、ドールのキャンバスの (dx, dy) に置く
async function place(
  rgba: Uint8ClampedArray | Buffer,
  width: number,
  height: number,
  scale: number,
  dx: number,
  dy: number,
  canvasW: number,
  canvasH: number,
): Promise<Uint8ClampedArray> {
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const resized = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } })
    .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  const out = new Uint8ClampedArray(canvasW * canvasH * 4);
  const x0 = Math.max(0, dx);
  const x1 = Math.min(canvasW, dx + w);
  if (x1 <= x0) return out;
  for (let y = Math.max(0, dy); y < Math.min(canvasH, dy + h); y++) {
    const from = ((y - dy) * w + (x0 - dx)) * 4;
    out.set(resized.subarray(from, from + (x1 - x0) * 4), (y * canvasW + x0) * 4);
  }
  return out;
}

function touchesEdge(rgba: Uint8ClampedArray, width: number, height: number): boolean {
  const box = alphaBBox(rgba, width, height);
  return !!box && (box.x === 0 || box.y === 0 || box.x + box.w === width || box.y + box.h === height);
}

export async function processGenerated(input: Buffer, doll: DollTemplate, options: ProcessOptions = {}): Promise<ProcessResult> {
  let decoded: { data: Buffer; info: sharp.OutputInfo };
  try {
    decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    throw new Error(`画像を読めませんでした（${(error as Error).message}）`);
  }
  const { width, height } = decoded.info;
  const original = new Uint8ClampedArray(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength);
  const cut = new Uint8ClampedArray(original); // 切り抜くのはコピーのほう

  const warnings: ProcessWarning[] = [];
  const toDoll = doll.canvasW / width;
  const nudge = options.nudge ?? { scale: 1, dx: 0, dy: 0 };

  // すでに背景が透明な画像（切り抜き済みの素材）は、そのまま通す
  let transparent = 0;
  for (let i = 3; i < original.length; i += 4) if (original[i] < 8) transparent++;
  const alreadyCut = transparent > (width * height) / 10;

  let keyColors: KeyColors;
  let alignment: Alignment = { scale: 1, dx: 0, dy: 0, score: 0 };
  let ratio = 0;
  let foreground: Uint8ClampedArray | null = null; // 生成画像で背景でない所（シルエット＋服）
  if (alreadyCut) {
    keyColors = { background: [0, 0, 0], silhouette: null };
    // 縦横比が違う画像は、キャンバスの中央に置く
    alignment = { scale: 1, dx: 0, dy: Math.round((doll.canvasH - height * toDoll) / 2), score: 0 };
  } else {
    keyColors = detectKeyColors(cut, width, height, {
      color: options.silhouetteColor,
      doll: { mask: doll.mask, width: doll.canvasW, height: doll.canvasH },
    });
    const masks = cutOutClothing(cut, width, height, keyColors);
    ratio = closeColorRatio(cut, width, height, keyColors);
    foreground = new Uint8ClampedArray(width * height * 4);
    for (let p = 0; p < width * height; p++) if (!masks.background[p]) foreground[p * 4 + 3] = 255;
    if (keyColors.silhouette) {
      alignment = alignToDoll({
        silhouette: masks.silhouette,
        background: masks.background,
        width,
        height,
        doll: doll.mask,
        dollWidth: doll.canvasW,
        dollHeight: doll.canvasH,
      });
      if (alignment.score < POOR_FIT_SCORE) {
        warnings.push({ code: 'poor-fit', message: 'シルエットがドールの形と合いません。位置がずれているかもしれません' });
      }
    } else {
      warnings.push({ code: 'no-silhouette', message: 'シルエットが見つかりません。位置合わせをしていません' });
    }
    if (ratio > CLOSE_COLOR_LIMIT) {
      warnings.push({ code: 'color-too-close', message: '服の色が背景またはシルエットの色に近く、服の一部が欠けているかもしれません' });
    }
  }

  const scale = toDoll * alignment.scale * nudge.scale;
  const dx = Math.round(alignment.dx + nudge.dx);
  const dy = Math.round(alignment.dy + nudge.dy);
  let rgba = await place(cut, width, height, scale, dx, dy, doll.canvasW, doll.canvasH);
  let source = await place(original, width, height, scale, dx, dy, doll.canvasW, doll.canvasH);

  // 部位ごとの細かい直し（AI が描き直したときの、指先・腕の角度などの小さなゆがみ）
  // 手の微調整（nudge）の前の位置で探し、見つけた直しを微調整後の位置に移して使う
  let partShifts: PartShift[] = [];
  if (foreground && keyColors.silhouette && options.parts?.length) {
    const baseScale = toDoll * alignment.scale;
    const bx = Math.round(alignment.dx);
    const by = Math.round(alignment.dy);
    const placed = await place(foreground, width, height, baseScale, bx, by, doll.canvasW, doll.canvasH);
    const fg = new Uint8Array(doll.canvasW * doll.canvasH);
    for (let p = 0; p < fg.length; p++) if (placed[p * 4 + 3] >= 128) fg[p] = 1;
    const found = findPartShifts(fg, doll.mask, doll.canvasW, doll.canvasH, options.parts);
    // 微調整前の点 q は、微調整後に (q - b) × nudge.scale + b + nudge.(dx, dy) へ動く
    const move = (x: number, y: number) => [(x - bx) * nudge.scale + bx + nudge.dx, (y - by) * nudge.scale + by + nudge.dy];
    partShifts = found.map((f) => {
      const [x0, y0] = move(f.box.x, f.box.y);
      const [x1, y1] = move(f.box.x + f.box.w, f.box.y + f.box.h);
      return { ...f, box: { x: Math.round(x0), y: Math.round(y0), w: Math.max(1, Math.round(x1 - x0)), h: Math.max(1, Math.round(y1 - y0)) }, dx: Math.round(f.dx * nudge.scale), dy: Math.round(f.dy * nudge.scale) };
    });
    rgba = warpByParts(rgba, doll.canvasW, doll.canvasH, partShifts);
    source = warpByParts(source, doll.canvasW, doll.canvasH, partShifts);
  }
  if (!alreadyCut) removeCornerSpeck(rgba, doll.canvasW, doll.canvasH);

  if (!alphaBBox(rgba, doll.canvasW, doll.canvasH)) {
    warnings.push({ code: 'empty', message: '服が見つかりません（全部が背景またはシルエットでした）' });
  } else if (touchesEdge(rgba, doll.canvasW, doll.canvasH)) {
    warnings.push({ code: 'touches-edge', message: '服が画像の端まで届いています。切れているかもしれません' });
  }

  return { rgba, source, width: doll.canvasW, height: doll.canvasH, keyColors, alignment, partShifts, closeColorRatio: ratio, warnings };
}
