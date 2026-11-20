/**
 * 画像を配信用の形（切り抜き・WebP・サムネイル・内容のハッシュ名）にして書き出す
 * 移行スクリプトとスタジオの両方が使う
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import type { Pixels } from '../../src/pipeline/alpha.ts';
import type { ManifestBackground, ManifestImage } from '../../src/content/manifest.ts';

export const MAX_SIZE = 1024; // 長辺がこれを超える画像だけ縮小する（表示の基準）
export const THUMB_SIZE = 192;

export class FileWriter {
  private readonly filesDir: string;
  constructor(outDir: string) {
    this.filesDir = path.join(outDir, 'files');
  }
  // 内容のハッシュを名前にして書く。戻り値は manifest からの相対パス
  async write(data: Buffer, ext: string): Promise<string> {
    const name = `${createHash('sha1').update(data).digest('hex').slice(0, 16)}.${ext}`;
    await fs.mkdir(this.filesDir, { recursive: true });
    await fs.writeFile(path.join(this.filesDir, name), data);
    return `files/${name}`;
  }
}

export interface EncodedImage {
  image: ManifestImage;
  thumb: string;
}

function crop(rgba: Pixels, width: number, height: number): { image: sharp.Sharp; box: NonNullable<ReturnType<typeof alphaBBox>> } | null {
  const box = alphaBBox(rgba, width, height);
  if (!box) return null;
  const image = sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } }).extract({
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
  });
  return { image, box };
}

// RGBA（キャンバス全体）を透明でない部分で切り抜いて、WebP（劣化なし）だけを書く（サムネイルなし）。全部透明なら null
export async function encodeLayer(rgba: Pixels, width: number, height: number, writer: FileWriter): Promise<ManifestImage | null> {
  const cropped = crop(rgba, width, height);
  if (!cropped) return null;
  const data = await cropped.image.webp({ lossless: true, effort: 6 }).toBuffer();
  return { file: await writer.write(data, 'webp'), canvasW: width, canvasH: height, box: cropped.box };
}

// RGBA（キャンバス全体）を透明でない部分で切り抜いて、WebP（劣化なし）とサムネイルを書く。全部透明なら null。
// thumbFrom を渡すと、サムネイルはそちらの絵から作る（前髪と後ろ髪に分けた髪の、全体の絵など）
export async function encodeCutout(rgba: Pixels, width: number, height: number, writer: FileWriter, thumbFrom?: Pixels): Promise<EncodedImage | null> {
  const main0 = crop(rgba, width, height);
  if (!main0) return null;
  const { image: cropped, box } = main0;
  const main = await cropped.clone().webp({ lossless: true, effort: 6 }).toBuffer();
  const thumb = await ((thumbFrom && crop(thumbFrom, width, height)?.image) || cropped)
    .clone()
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85, alphaQuality: 100 })
    .toBuffer();
  return {
    image: { file: await writer.write(main, 'webp'), canvasW: width, canvasH: height, box },
    thumb: await writer.write(thumb, 'webp'),
  };
}

// サムネイルだけを書く（透明でない部分で切り抜き、192px 以内）。全部透明なら null
export async function encodeThumb(rgba: Pixels, width: number, height: number, writer: FileWriter): Promise<string | null> {
  const cropped = crop(rgba, width, height);
  if (!cropped) return null;
  const thumb = await cropped.image
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85, alphaQuality: 100 })
    .toBuffer();
  return writer.write(thumb, 'webp');
}

// 隠す所（白、不透明度が隠す強さ）: 必要な範囲だけを切り出して書く。何も無ければ null
export async function encodeMask(alpha: Uint8Array | Uint8ClampedArray, width: number, height: number, writer: FileWriter): Promise<ManifestImage | null> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = 255;
    rgba[p * 4 + 1] = 255;
    rgba[p * 4 + 2] = 255;
    rgba[p * 4 + 3] = alpha[p];
  }
  const box = alphaBBox(rgba, width, height);
  if (!box) return null;
  const data = await sharp(Buffer.from(rgba.buffer), { raw: { width, height, channels: 4 } })
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .webp({ lossless: true, effort: 6 })
    .toBuffer();
  return { file: await writer.write(data, 'webp'), canvasW: width, canvasH: height, box };
}

// 背景: 縮小して JPEG とサムネイルを書く
export async function encodeBackground(input: string | Buffer, id: string, name: string, writer: FileWriter): Promise<ManifestBackground> {
  const base = sharp(input).flatten({ background: '#ffffff' });
  const main = await base
    .clone()
    .resize({ width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  const thumb = await base
    .clone()
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  return { id, name, file: await writer.write(main, 'jpg'), thumb: await writer.write(thumb, 'jpg') };
}

export function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}
