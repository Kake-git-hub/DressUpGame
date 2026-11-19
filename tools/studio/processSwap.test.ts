// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import type { Tile } from '../../src/pipeline/frames.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { DollTemplate } from './processGenerated.ts';
import { processSwap } from './processSwap.ts';

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name));
const GREEN: Rgb = [0, 255, 0];
const SIZE = 1024;
const tile: Tile = { from: { x: 0, y: 0, w: SIZE, h: SIZE }, to: { x: 0, y: 0, w: SIZE, h: SIZE } };
const ZONE_TOP = 666; // 足首（下 35%）
const zone = { x: 0, y: ZONE_TOP, w: SIZE, h: SIZE - ZONE_TOP };
const isGreen = (d: Uint8ClampedArray | Buffer, i: number) => d[i + 1] - Math.max(d[i], d[i + 2]) > 60;

async function png(name: string): Promise<Buffer> {
  return sharp(fixture(name)).png().toBuffer();
}
async function rawRgb(image: Buffer): Promise<Buffer> {
  return sharp(image).removeAlpha().ensureAlpha().raw().toBuffer();
}
// 元の図（緑の背景に本物の脚）から、ドールの型を作る
async function dollFromReference(reference: Buffer): Promise<DollTemplate> {
  const data = await rawRgb(reference);
  const rgba = new Uint8ClampedArray(data);
  const mask = new Uint8Array(SIZE * SIZE);
  for (let p = 0; p < SIZE * SIZE; p++) {
    if (isGreen(data, p * 4)) rgba[p * 4 + 3] = 0;
    else mask[p] = 1;
  }
  return { rgba, mask, canvasW: SIZE, canvasH: SIZE };
}
const opaque = (rgba: Uint8ClampedArray, p: number) => rgba[p * 4 + 3] >= 128;

describe('processSwap（本物の生成画像）', async () => {
  const reference = await png('swap-feet-ref.webp');
  const doll = await dollFromReference(reference);
  const pumps = await png('swap-pumps.webp');
  const boots = await png('swap-boots.webp');

  it('パンプス: 足首から下はまるごと、上は変わっていない肌を入れない', async () => {
    const result = await processSwap(pumps, reference, doll, [tile], [zone], GREEN);
    expect(result.warnings).toEqual([]);
    let shin = 0, shinItem = 0, zoneItem = 0, zoneFg = 0, item = 0, greenish = 0;
    const gen = await rawRgb(pumps);
    for (let p = 0; p < SIZE * SIZE; p++) {
      const y = Math.floor(p / SIZE);
      if (opaque(result.rgba, p)) {
        item++;
        if (isGreen(result.rgba, p * 4)) greenish++;
      }
      if (y < ZONE_TOP - 20) {
        if (doll.mask[p]) {
          shin++;
          if (opaque(result.rgba, p)) shinItem++;
        }
      } else if (y >= ZONE_TOP + 4) {
        if (!isGreen(gen, p * 4)) zoneFg++;
        if (opaque(result.rgba, p)) zoneItem++;
      }
    }
    expect(shinItem / shin).toBeLessThan(0.03);
    expect(zoneItem / zoneFg).toBeGreaterThan(0.97);
    expect(zoneItem / zoneFg).toBeLessThan(1.06);
    expect(greenish / item).toBeLessThan(0.005);
  });

  it('ブーツ: 足首より上の筒とファーもアイテムになる', async () => {
    const result = await processSwap(boots, reference, doll, [tile], [zone], GREEN);
    expect(result.warnings).toEqual([]);
    let above = 0;
    for (let y = 520; y < 620; y++) for (let x = 0; x < SIZE; x++) if (opaque(result.rgba, y * SIZE + x)) above++;
    expect(above).toBeGreaterThan(2000);
    // すねの上のほう（変わっていない肌）は入れない
    let top = 0;
    for (let y = 0; y < 400; y++) for (let x = 0; x < SIZE; x++) if (opaque(result.rgba, y * SIZE + x)) top++;
    expect(top).toBeLessThan(1500);
  });

  it('隠す所は、差し替える範囲の中のドールだけ', async () => {
    const result = await processSwap(pumps, reference, doll, [tile], [zone], GREEN);
    let inside = 0, hidden = 0, outside = 0;
    for (let p = 0; p < SIZE * SIZE; p++) {
      const inZone = Math.floor(p / SIZE) >= ZONE_TOP;
      if (inZone && doll.mask[p]) {
        inside++;
        if (result.hide[p] >= 128) hidden++;
      }
      if (!inZone && result.hide[p] > 0) outside++;
    }
    expect(hidden / inside).toBeGreaterThan(0.99);
    expect(outside).toBe(0);
  });

  it('AI が絵を 12px ずらして返しても、横は同じ位置に取り出す', async () => {
    const base = await processSwap(pumps, reference, doll, [tile], [zone], GREEN);
    const shifted = await sharp(pumps)
      .extract({ left: 0, top: 0, width: SIZE - 12, height: SIZE - 12 })
      .extend({ left: 12, top: 12, background: { r: 0, g: 255, b: 0 } })
      .png()
      .toBuffer();
    const result = await processSwap(shifted, reference, doll, [tile], [zone], GREEN);
    const a = alphaBBox(base.rgba, SIZE, SIZE)!;
    const b = alphaBBox(result.rgba, SIZE, SIZE)!;
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(3);
    // 縦は、まっすぐな脚だけでは決めにくい（靴が少し上下しても見た目に響かない）ので、ゆるく見る
    expect(Math.abs(a.y + a.h - b.y - b.h)).toBeLessThanOrEqual(15);
    expect(Math.abs(a.x + a.w - b.x - b.w)).toBeLessThanOrEqual(3);
  });

  it('何も描かれていなければ「見つかりません」', async () => {
    const result = await processSwap(reference, reference, doll, [tile], [zone], GREEN);
    expect(result.warnings.map((w) => w.code)).toContain('empty');
  });

  it('まったく別の絵が返ってきたら、警告する', async () => {
    const flipped = await sharp(boots).flip().png().toBuffer();
    const result = await processSwap(flipped, reference, doll, [tile], [zone], GREEN);
    const codes = result.warnings.map((w) => w.code);
    expect(codes.includes('repainted') || codes.includes('poor-fit')).toBe(true);
  });
});
