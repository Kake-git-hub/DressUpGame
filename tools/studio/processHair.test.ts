// @vitest-environment node
/**
 * 髪 1 枚の処理（位置合わせ → 取り出し → キャンバスへ → 警告）。固定素材は 2026-11-20 の試作の絵
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import type { Tile } from '../../src/pipeline/frames.ts';
import { pixelDistance } from '../../src/pipeline/keyColors.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { DollTemplate } from './processGenerated.ts';
import { processHair } from './processHair.ts';

const SIZE = 1024;
const GREEN: Rgb = [0, 255, 0];
const tile: Tile = { from: { x: 0, y: 0, w: SIZE, h: SIZE }, to: { x: 0, y: 0, w: SIZE, h: SIZE } };
const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'diff', name));
const png = (name: string) => sharp(fixture(name)).resize(SIZE, SIZE, { fit: 'fill' }).png().toBuffer();
const rawOf = async (image: Buffer) => new Uint8ClampedArray(await sharp(image).removeAlpha().ensureAlpha().raw().toBuffer());
const toPng = (rgba: Uint8ClampedArray) => sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer();

async function dollFromReference(reference: Buffer): Promise<DollTemplate> {
  const rgba = await rawOf(reference);
  const mask = new Uint8Array(SIZE * SIZE);
  for (let p = 0; p < SIZE * SIZE; p++) {
    if (pixelDistance(rgba, p * 4, GREEN) >= 70) mask[p] = 1;
    else rgba[p * 4 + 3] = 0;
  }
  return { rgba, mask, canvasW: SIZE, canvasH: SIZE };
}
function paint(rgba: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, color: (i: number) => number[]) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) rgba.set([...color((y * SIZE + x) * 4), 255], (y * SIZE + x) * 4);
}
const codes = (result: { warnings: { code: string }[] }) => result.warnings.map((w) => w.code);

describe('processHair（本物の生成画像）', async () => {
  const reference = await png('h1-pink-ref.webp');
  const generated = await png('h1-pink-gen.webp');
  const doll = await dollFromReference(reference);
  const run = (image: Buffer) => processHair(image, reference, doll, tile, SIZE, SIZE, GREEN);
  const plain = await run(generated);

  it('髪の全体と、前の範囲が取り出せる。警告なし、ずれ 0', () => {
    expect(plain.warnings).toEqual([]);
    expect(plain.alignment).toMatchObject({ scale: 1, dx: 0, dy: 0 });
    const box = alphaBBox(plain.rgba, SIZE, SIZE)!;
    expect(box.w).toBeGreaterThan(500);
    let front = 0;
    let outside = 0;
    for (let p = 0; p < SIZE * SIZE; p++) {
      if (plain.front[p] < 128) continue;
      front++;
      if (plain.rgba[p * 4 + 3] === 0) outside++;
    }
    expect(front).toBeGreaterThan(10000);
    expect(outside).toBe(0); // 前の範囲は、髪のある所だけ
    expect(plain.shape).toBeNull();
  });

  it('AI が絵を右下へずらしても、元の位置に戻して取り出す', async () => {
    const shifted = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .composite([{ input: await sharp(generated).extract({ left: 0, top: 0, width: SIZE - 20, height: SIZE - 12 }).toBuffer(), left: 20, top: 12 }])
      .png()
      .toBuffer();
    const result = await run(shifted);
    expect(result.alignment.scale).toBe(1); // ずれただけの絵に、縮小を当てはめない
    expect(Math.abs(result.alignment.dx + 20)).toBeLessThanOrEqual(2);
    expect(Math.abs(result.alignment.dy + 12)).toBeLessThanOrEqual(2);
    const a = alphaBBox(plain.rgba, SIZE, SIZE)!;
    const b = alphaBBox(result.rgba, SIZE, SIZE)!;
    for (const key of ['x', 'y'] as const) expect(Math.abs(a[key] - b[key])).toBeLessThanOrEqual(3);
    expect(Math.abs(a.x + a.w - (b.x + b.w))).toBeLessThanOrEqual(3);
    expect(codes(result)).not.toContain('poor-fit');
    expect(codes(result)).not.toContain('repainted');
  });

  it('AI が絵を大きく拡大したら、合っていないと警告する', async () => {
    const big = Math.round(SIZE * 1.12);
    const zoomed = await sharp(await sharp(generated).resize(big, big).toBuffer())
      .extract({ left: Math.round((big - SIZE) / 2), top: Math.round((big - SIZE) / 2), width: SIZE, height: SIZE })
      .png()
      .toBuffer();
    expect(codes(await run(zoomed))).toContain('poor-fit');
  });

  it('何も描かれていなければ、見つからないと警告する', async () => {
    expect(codes(await run(reference))).toEqual(['empty']);
  });

  it('髪が絵の下の端まで届いていたら、切れていると警告する', async () => {
    const rgba = await rawOf(generated);
    paint(rgba, 20, 600, 60, SIZE - 1, () => [120, 70, 40]);
    expect(codes(await run(await toPng(rgba)))).toContain('touches-edge');
  });

  it('髪から離れた所でドールが描き変えられていたら、警告する', async () => {
    const rgba = await rawOf(generated);
    paint(rgba, 480, 620, 549, 689, () => [0, 0, 220]); // おなかに青い四角
    const result = await run(await toPng(rgba));
    expect(codes(result)).toContain('repainted');
    expect(result.rgba[(650 * SIZE + 510) * 4 + 3]).toBe(0); // 髪には入れない
  });

  it('肌とほとんど同じ色の髪は、欠けているかもしれないと警告する', async () => {
    const rgba = await rawOf(reference);
    paint(rgba, 300, 80, 720, 180, () => [120, 70, 40]); // 頭の上の、はっきりした髪
    paint(rgba, 430, 200, 600, 300, (i) => [rgba[i], rgba[i + 1], Math.max(0, rgba[i + 2] - 18)]); // おでこの、肌に近い色の前髪
    expect(codes(await run(await toPng(rgba)))).toContain('color-too-close');
  });
});
