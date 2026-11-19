/**
 * ドールの形を単色で塗った画像（AI に渡す基準画像）を作る
 */
import sharp from 'sharp';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { DollTemplate } from './processGenerated.ts';

export const SILHOUETTE_SIZE = 2048;

// 背景色の上に、ドールの形をシルエット色で塗る。ふちはドールの透明度でなめらかにする
export async function renderSilhouette(doll: DollTemplate, color: Rgb, background: Rgb, size = SILHOUETTE_SIZE): Promise<Buffer> {
  const { canvasW, canvasH } = doll;
  const rgb = Buffer.alloc(canvasW * canvasH * 3);
  for (let p = 0; p < canvasW * canvasH; p++) {
    const a = doll.rgba[p * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.round(color[c] * a + background[c] * (1 - a));
  }
  return sharp(rgb, { raw: { width: canvasW, height: canvasH, channels: 3 } })
    .resize({ width: size, height: Math.round((size * canvasH) / canvasW), kernel: 'lanczos3' })
    .png()
    .toBuffer();
}

// 服（キャンバス大の RGBA）をドールに着せた確認用の画像
// behind は、ドールの後ろに描く分（うしろがみ）
export async function renderPreview(doll: DollTemplate, layers: Uint8ClampedArray[], background = '#e9e6f2', behind: Uint8ClampedArray[] = []): Promise<Buffer> {
  const { canvasW: width, canvasH: height } = doll;
  const raw = (px: Uint8ClampedArray) => ({ input: Buffer.from(px.buffer, px.byteOffset, px.byteLength), raw: { width, height, channels: 4 as const } });
  return sharp({ create: { width, height, channels: 3, background } })
    .composite([...behind.map(raw), raw(doll.rgba), ...layers.map(raw)])
    .png()
    .toBuffer();
}

// 不透明度だけの画像（白）。AI が描いた体の形などを画面に渡すのに使う
export function alphaToPng(alpha: Uint8Array, width: number, height: number): Promise<Buffer> {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    rgba[p * 4] = 255;
    rgba[p * 4 + 1] = 255;
    rgba[p * 4 + 2] = 255;
    rgba[p * 4 + 3] = alpha[p];
  }
  return rgbaToPng(rgba, width, height);
}

export function rgbaToPng(rgba: Uint8ClampedArray, width: number, height: number): Promise<Buffer> {
  return sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export async function pngToRgba(png: Buffer): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}
