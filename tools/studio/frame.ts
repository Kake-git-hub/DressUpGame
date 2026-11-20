/**
 * 拡大図（枠）の描画と、できた絵をキャンバスに戻す処理
 *
 * 枠の決め方は src/pipeline/frames.ts。ここは画像の拡大縮小（sharp）を受け持つ。
 * hi は、ドールの高解像度の型（無ければ、ふつうの型をそのまま渡す）。scale = hi の大きさ ÷ キャンバスの大きさ。
 */
import sharp from 'sharp';
import type { Box } from '../../src/pipeline/alpha.ts';
import { FRAME_SIZE } from '../../src/pipeline/frames.ts';
import type { Tile } from '../../src/pipeline/frames.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { DollTemplate } from './processGenerated.ts';

// 枠の範囲のドールを、to の大きさの RGBA にする
async function tileRgba(hi: DollTemplate, scale: number, tile: Tile): Promise<Uint8ClampedArray> {
  const left = Math.max(0, Math.round(tile.from.x * scale));
  const top = Math.max(0, Math.round(tile.from.y * scale));
  const width = Math.max(1, Math.min(hi.canvasW - left, Math.round(tile.from.w * scale)));
  const height = Math.max(1, Math.min(hi.canvasH - top, Math.round(tile.from.h * scale)));
  const data = await sharp(Buffer.from(hi.rgba.buffer, hi.rgba.byteOffset, hi.rgba.byteLength), { raw: { width: hi.canvasW, height: hi.canvasH, channels: 4 } })
    .extract({ left, top, width, height })
    .resize(tile.to.w, tile.to.h, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
}

// AI に渡す拡大図。silhouette が null なら本物のドール、色があればその色で塗ったシルエット
export async function renderFrame(hi: DollTemplate, scale: number, tiles: Tile[], background: Rgb, silhouette: Rgb | null): Promise<Buffer> {
  const rgb = Buffer.alloc(FRAME_SIZE * FRAME_SIZE * 3);
  for (let p = 0; p < FRAME_SIZE * FRAME_SIZE; p++) rgb.set(background, p * 3);
  for (const tile of tiles) {
    const px = await tileRgba(hi, scale, tile);
    for (let y = 0; y < tile.to.h; y++) {
      for (let x = 0; x < tile.to.w; x++) {
        const i = (y * tile.to.w + x) * 4;
        const a = px[i + 3] / 255;
        const o = ((tile.to.y + y) * FRAME_SIZE + tile.to.x + x) * 3;
        for (let c = 0; c < 3; c++) rgb[o + c] = Math.round((silhouette ? silhouette[c] : px[i + c]) * a + background[c] * (1 - a));
      }
    }
  }
  return sharp(rgb, { raw: { width: FRAME_SIZE, height: FRAME_SIZE, channels: 3 } }).png().toBuffer();
}

// 枠の中だけの型（to の大きさ）。これを processGenerated に渡すと、拡大図の上で切り抜きと位置合わせができる
export async function tileTemplate(hi: DollTemplate, scale: number, tile: Tile): Promise<DollTemplate> {
  const rgba = await tileRgba(hi, scale, tile);
  const mask = new Uint8Array(tile.to.w * tile.to.h);
  for (let p = 0; p < mask.length; p++) if (rgba[p * 4 + 3] >= 128) mask[p] = 1;
  return { rgba, mask, canvasW: tile.to.w, canvasH: tile.to.h };
}

// to の大きさの絵を、キャンバスの from の位置に縮めて重ねる
export async function pasteTile(target: Uint8ClampedArray, canvasW: number, canvasH: number, rgba: Uint8ClampedArray, tile: Tile): Promise<void> {
  const { from, to } = tile;
  const small = await sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: to.w, height: to.h, channels: 4 } })
    .resize(from.w, from.h, { fit: 'fill', kernel: 'lanczos3' })
    .raw()
    .toBuffer();
  for (let y = 0; y < from.h; y++) {
    if (from.y + y < 0 || from.y + y >= canvasH) continue;
    for (let x = 0; x < from.w; x++) {
      if (from.x + x < 0 || from.x + x >= canvasW) continue;
      const i = (y * from.w + x) * 4;
      const a = small[i + 3] / 255;
      if (a === 0) continue;
      const o = ((from.y + y) * canvasW + from.x + x) * 4;
      const b = target[o + 3] / 255;
      const out = a + b * (1 - a);
      for (let c = 0; c < 3; c++) target[o + c] = Math.round((small[i + c] * a + target[o + c] * b * (1 - a)) / out);
      target[o + 3] = Math.round(out * 255);
    }
  }
}

// 不透明度だけの版（形・隠す所など）
export async function pasteTileAlpha(target: Uint8Array, canvasW: number, canvasH: number, alpha: Uint8Array, tile: Tile): Promise<void> {
  const { from, to } = tile;
  // sharp は、1 チャンネルの入力でも 3 チャンネルで返すことがある。1 チャンネルに取り直す
  const small = await sharp(Buffer.from(alpha.buffer, alpha.byteOffset, alpha.byteLength), { raw: { width: to.w, height: to.h, channels: 1 } })
    .resize(from.w, from.h, { fit: 'fill', kernel: 'lanczos3' })
    .extractChannel(0)
    .raw()
    .toBuffer();
  if (small.length !== from.w * from.h) throw new Error(`pasteTileAlpha: ${from.w}×${from.h} の 1 チャンネルを期待しましたが、${small.length} バイトでした`);
  for (let y = 0; y < from.h; y++) {
    if (from.y + y < 0 || from.y + y >= canvasH) continue;
    for (let x = 0; x < from.w; x++) {
      if (from.x + x < 0 || from.x + x >= canvasW) continue;
      const o = (from.y + y) * canvasW + from.x + x;
      target[o] = Math.max(target[o], small[y * from.w + x]);
    }
  }
}

// キャンバス上の箱 → 枠の中（to の中の座標。to の左上が原点）の箱
export function toTile(box: Box, tile: Tile): Box {
  const kx = tile.to.w / tile.from.w;
  const ky = tile.to.h / tile.from.h;
  return { x: Math.round((box.x - tile.from.x) * kx), y: Math.round((box.y - tile.from.y) * ky), w: Math.round(box.w * kx), h: Math.round(box.h * ky) };
}
