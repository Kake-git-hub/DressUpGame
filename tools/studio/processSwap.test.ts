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

  it('範囲の外の細い線（AI がずらして描き直した輪郭線）は、品目につながっていても、ちぎれていても入れない', async () => {
    const gen = await rawRgb(pumps);
    // すねの上に、足首の品目につながる細い線（幅 10px。枠の幅 1024px では、19px より細いものが「細い」）と、離れた短い線を描き足す
    let x0 = -1;
    for (let x = 0; x < SIZE && x0 < 0; x++) if (doll.mask[(ZONE_TOP - 1) * SIZE + x] && doll.mask[(ZONE_TOP - 1) * SIZE + x + 30]) x0 = x + 15;
    expect(x0).toBeGreaterThan(0);
    const line = (x: number, y0: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let k = 0; k < 10; k++) gen.set([60, 40, 30], ((y * SIZE + x + k) * 4));
    };
    line(x0, ZONE_TOP - 220, ZONE_TOP + 10);
    line(x0 + 4, ZONE_TOP - 400, ZONE_TOP - 340);
    const drawn = await sharp(gen, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer();
    const result = await processSwap(drawn, reference, doll, [tile], [zone], GREEN);
    let kept = 0;
    for (let y = ZONE_TOP - 400; y < ZONE_TOP - 30; y++) for (let x = x0 - 2; x < x0 + 16; x++) if (opaque(result.rgba, y * SIZE + x)) kept++;
    expect(kept).toBe(0);
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

  it('隠す所は、差し替える範囲をまるごと（ドールの輪郭のうすい画素も残さない）。範囲の外は隠さない', async () => {
    const result = await processSwap(pumps, reference, doll, [tile], [zone], GREEN);
    let partial = 0, outside = 0;
    for (let p = 0; p < SIZE * SIZE; p++) {
      const inZone = Math.floor(p / SIZE) >= ZONE_TOP;
      if (inZone && result.hide[p] !== 255) partial++;
      if (!inZone && result.hide[p] > 0) outside++;
    }
    expect(partial).toBe(0);
    expect(outside).toBe(0);
  });

  it('足首の継ぎ目にすき間ができない: 縮めて戻したドール（隠したあと）に重ねても、脚の内側はどの行も不透明', async () => {
    // 本番と同じく、拡大図（1024）はキャンバス（ここでは 512）より細かい
    const N = SIZE / 2;
    const small = await sharp(reference).resize(N, N).removeAlpha().ensureAlpha().raw().toBuffer();
    const rgba = new Uint8ClampedArray(small);
    const mask = new Uint8Array(N * N);
    for (let p = 0; p < N * N; p++) {
      if (isGreen(small, p * 4)) rgba[p * 4 + 3] = 0;
      else mask[p] = 1;
    }
    const half: DollTemplate = { rgba, mask, canvasW: N, canvasH: N };
    const top = 333;
    const result = await processSwap(pumps, reference, half, [{ from: { x: 0, y: 0, w: N, h: N }, to: tile.to }], [{ x: 0, y: top, w: N, h: N - top }], GREEN);
    const inner = (x: number, y: number) => {
      for (let d = -5; d <= 5; d++) if (!mask[y * N + x + d]) return false;
      return true;
    };
    let thin = 0;
    for (let y = top - 5; y < top + 5; y++) {
      for (let x = 5; x < N - 5; x++) {
        if (!inner(x, y) || !inner(x, top - 6)) continue;
        const p = y * N + x;
        const dollA = (rgba[p * 4 + 3] * (255 - result.hide[p])) / 255;
        const itemA = result.rgba[p * 4 + 3];
        if (itemA + (dollA * (255 - itemA)) / 255 < 250) thin++;
      }
    }
    expect(thin).toBe(0);
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

  it('品目の色が背景色に近いと、欠けているかもしれないと警告する', async () => {
    // 足の上に茶色の靴を描き、その上に背景に近い緑の帯を付ける
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
      <rect x="250" y="700" width="520" height="260" rx="40" fill="#7a3b1e"/>
      <rect x="250" y="760" width="520" height="90" fill="#28e83c"/></svg>`;
    const painted = await sharp(reference).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
    const result = await processSwap(painted, reference, doll, [tile], [zone], GREEN);
    expect(result.warnings.map((w) => w.code)).toContain('color-too-close');
    expect(result.closeColorRatio).toBeGreaterThan(0.05);
  });

  it('品目が拡大図の上の端まで届いていたら、切れているかもしれないと警告する（ひざ上までのブーツなど）', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
      <rect x="250" y="0" width="520" height="960" fill="#7a3b1e"/></svg>`;
    const painted = await sharp(reference).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
    const result = await processSwap(painted, reference, doll, [tile], [zone], GREEN);
    expect(result.warnings.map((w) => w.code)).toContain('touches-edge');
  });

  it('脚のほとんどを覆う品目（ロングブーツ・長手袋）は、「描き直し」と警告しない', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
      <rect x="250" y="120" width="520" height="840" fill="#7a3fb0"/></svg>`;
    const painted = await sharp(reference).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
    const result = await processSwap(painted, reference, doll, [tile], [zone], GREEN);
    expect(result.warnings.map((w) => w.code)).not.toContain('repainted');
  });

  it('AI が脚の肌を塗り直したら（色が変わったら）、「描き直し」と警告する', async () => {
    // 脚全体に、少し濃い肌色をうすく重ねる（輪郭や影を描き直したのと同じ）。足には靴を描く
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
      <rect x="0" y="0" width="${SIZE}" height="700" fill="#b06a48" fill-opacity="0.45"/>
      <rect x="250" y="700" width="520" height="260" rx="40" fill="#7a3b1e"/></svg>`;
    const overlay = await sharp(Buffer.from(svg)).png().toBuffer();
    // 背景（緑）は塗らない: 脚の形の所だけに重ねる
    const legs = await sharp(Buffer.from(doll.rgba.buffer), { raw: { width: SIZE, height: SIZE, channels: 4 } }).extractChannel(3).toBuffer();
    const masked = await sharp(overlay).ensureAlpha().composite([{ input: legs, raw: { width: SIZE, height: SIZE, channels: 1 }, blend: 'dest-in' }]).png().toBuffer();
    const shoes = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect x="250" y="700" width="520" height="260" rx="40" fill="#7a3b1e"/></svg>`)).png().toBuffer();
    const painted = await sharp(reference).composite([{ input: masked }, { input: shoes }]).png().toBuffer();
    const result = await processSwap(painted, reference, doll, [tile], [zone], GREEN);
    expect(result.warnings.map((w) => w.code)).toContain('repainted');
  });

  it('何も描かれていなければ「見つかりません」', async () => {
    const result = await processSwap(reference, reference, doll, [tile], [zone], GREEN);
    expect(result.warnings.map((w) => w.code)).toContain('empty');
  });

  it('まったく別の絵が返ってきたら、警告する', async () => {
    const flipped = await sharp(boots).flip().png().toBuffer();
    const result = await processSwap(flipped, reference, doll, [tile], [zone], GREEN);
    const codes = result.warnings.map((w) => w.code);
    // 上下が逆の絵: 靴が上の端にある（端で切れた疑い）か、描き直し・位置ずれのどれかで気づく
    expect(codes.some((c) => c === 'repainted' || c === 'poor-fit' || c === 'touches-edge')).toBe(true);
  });
});
