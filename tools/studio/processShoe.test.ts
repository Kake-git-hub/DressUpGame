// @vitest-environment node
/**
 * 靴 1 枚の処理（靴・肌・隠す所）。固定素材は 2026-11-20 の試作の絵と、2026-11-19 の試作の絵
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
import { processShoe } from './processShoe.ts';

const SIZE = 1024;
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];
const tile: Tile = { from: { x: 0, y: 0, w: SIZE, h: SIZE }, to: { x: 0, y: 0, w: SIZE, h: SIZE } };
const LINE = 660; // 試作の拡大図での、足首の線
const zone = { x: 322, y: LINE, w: 381, h: 197 };
const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name));
const png = (name: string) => sharp(fixture(name)).resize(SIZE, SIZE, { fit: 'fill' }).png().toBuffer();
const rawOf = async (image: Buffer) => new Uint8ClampedArray(await sharp(image).removeAlpha().ensureAlpha().raw().toBuffer());
const toPng = (rgba: Uint8ClampedArray) => sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer();
const codes = (result: { warnings: { code: string }[] }) => result.warnings.map((w) => w.code);

async function dollFromReference(reference: Buffer, background: Rgb): Promise<DollTemplate> {
  const rgba = await rawOf(reference);
  const mask = new Uint8Array(SIZE * SIZE);
  for (let p = 0; p < SIZE * SIZE; p++) {
    if (pixelDistance(rgba, p * 4, background) >= 70) mask[p] = 1;
    else rgba[p * 4 + 3] = 0;
  }
  return { rgba, mask, canvasW: SIZE, canvasH: SIZE };
}
const count = (rgba: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= 128) n++;
  return n;
};

describe('processShoe（本物の生成画像）', async () => {
  const cases = [
    { name: 'パンプス', slug: 's1-pumps', background: GREEN },
    { name: 'サンダル', slug: 's2-sandals', background: BLUE },
    { name: 'ブーツ', slug: 's3-boots', background: GREEN },
  ];
  const loaded = await Promise.all(
    cases.map(async (c) => {
      const reference = await png(`diff/${c.slug}-ref.webp`);
      const generated = await png(`diff/${c.slug}-gen.webp`);
      const doll = await dollFromReference(reference, c.background);
      return { ...c, reference, generated, doll, result: await processShoe(generated, reference, doll, [tile], [zone], c.background) };
    }),
  );
  const [pumps, , boots] = loaded;

  for (const c of loaded) {
    it(`${c.name}: 警告なし、ずれ 0。靴・隠す所ができる`, () => {
      expect(c.result.warnings).toEqual([]);
      expect(c.result.alignment).toMatchObject({ scale: 1, dx: 0, dy: 0 });
      expect(count(c.result.rgba)).toBeGreaterThan(20000);
      expect(c.result.hide.some((v) => v === 255)).toBe(true);
    });

    it(`${c.name}: 靴下を重ねると、靴下は肌の上・靴の下に見え、靴と肌の外にははみ出さない`, () => {
      const { rgba: shoe, under, hide } = c.result;
      let outside = 0;
      let overSkin = 0;
      let skinShown = 0;
      for (let p = 0; p < SIZE * SIZE; p++) {
        // 靴下 = ドールの足の形の白い絵。足首の線のすぐ下は、肌が少しずつ見えてくる帯なので、その下から数える
        if (Math.floor(p / SIZE) < LINE + 12 || !c.doll.mask[p]) continue;
        const sock = hide[p] < 128; // 隠す所の外の靴下だけが残る
        if (!sock) continue;
        const shoeHere = shoe[p * 4 + 3] >= 128;
        const underHere = under[p * 4 + 3] >= 128;
        if (!shoeHere && !underHere) outside++; // 靴にも肌にも重ならない靴下 = はみ出し
        if (!shoeHere && underHere) overSkin++; // 靴の開き: 靴下が肌をおおう
      }
      for (let p = 0; p < SIZE * SIZE; p++) if (under[p * 4 + 3] >= 128 && shoe[p * 4 + 3] < 128 && !(c.doll.mask[p] && hide[p] < 128)) skinShown++;
      expect(outside).toBeLessThan(300);
      if (c === pumps) {
        expect(overSkin).toBeGreaterThan(2000); // 甲に靴下が見える
        expect(skinShown).toBeLessThan(overSkin * 0.25); // 靴下の横から肌がのぞく所は少ない
      }
    });
  }

  it('パンプスは甲の肌を「肌」に持ち、ブーツはほとんど持たない', () => {
    expect(count(pumps.result.under)).toBeGreaterThan(3000);
    expect(count(boots.result.under)).toBeLessThan(300);
  });

  it('肌の絵に、靴の色が混ざらない。靴の絵に、広い肌が混ざらない', () => {
    let reddish = 0;
    const under = pumps.result.under;
    for (let p = 0; p < SIZE * SIZE; p++) if (under[p * 4 + 3] >= 128 && under[p * 4] > 150 && under[p * 4 + 1] < 90) reddish++;
    expect(reddish / count(under)).toBeLessThan(0.02);
    let skinInShoe = 0;
    const shoe = pumps.result.rgba;
    for (let p = 0; p < SIZE * SIZE; p++) if (shoe[p * 4 + 3] >= 128 && pixelDistance(shoe, p * 4, [254, 214, 190]) < 15) skinInShoe++;
    expect(skinInShoe / count(shoe)).toBeLessThan(0.03);
  });

  it('足首より上の、変わっていない脚は、靴にも肌にも入れない', () => {
    let above = 0;
    for (let y = 0; y < LINE - 30; y++) for (let x = 0; x < SIZE; x++) if (pumps.result.rgba[(y * SIZE + x) * 4 + 3] >= 128 || pumps.result.under[(y * SIZE + x) * 4 + 3] >= 128) above++;
    expect(above).toBeLessThan(500);
    let shaft = 0;
    for (let y = LINE - 120; y < LINE - 20; y++) for (let x = 0; x < SIZE; x++) if (boots.result.rgba[(y * SIZE + x) * 4 + 3] >= 128) shaft++;
    expect(shaft).toBeGreaterThan(5000); // ブーツの筒は入る
  });

  it('隠す所は、足首の線より上には無い', () => {
    for (const c of loaded) {
      let above = 0;
      for (let p = 0; p < (LINE - 3) * SIZE; p++) if (c.result.hide[p] > 0) above++;
      expect(above).toBe(0);
    }
  });

  it('AI が絵を 15px ずらして返しても、同じ位置に取り出す', async () => {
    const shifted = await sharp(pumps.generated).extract({ left: 0, top: 0, width: SIZE - 15, height: SIZE - 15 }).extend({ left: 15, top: 15, background: { r: 0, g: 255, b: 0 } }).png().toBuffer();
    const result = await processShoe(shifted, pumps.reference, pumps.doll, [tile], [zone], GREEN);
    const a = alphaBBox(pumps.result.rgba, SIZE, SIZE)!;
    const b = alphaBBox(result.rgba, SIZE, SIZE)!;
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(a.x + a.w - b.x - b.w)).toBeLessThanOrEqual(3);
    expect(Math.abs(a.y + a.h - b.y - b.h)).toBeLessThanOrEqual(15);
    expect(codes(result)).not.toContain('poor-fit');
  });

  it('何も描かれていなければ「見つかりません」', async () => {
    expect(codes(await processShoe(pumps.reference, pumps.reference, pumps.doll, [tile], [zone], GREEN))).toEqual(['empty']);
  });

  it('靴が肌の色だと、肌と見分けられないので警告する', async () => {
    const rgba = await rawOf(pumps.generated);
    for (let p = LINE * SIZE; p < SIZE * SIZE; p++) {
      const i = p * 4;
      if (rgba[i] > 120 && rgba[i + 1] < 110 && rgba[i + 2] < 110) rgba.set([250, 212, 188], i); // 赤い靴を肌の色に
    }
    expect(codes(await processShoe(await toPng(rgba), pumps.reference, pumps.doll, [tile], [zone], GREEN))).toContain('color-too-close');
  });

  it('AI が脚の肌を塗り直したら（色が変わったら）、「描き直し」と警告する', async () => {
    const rgba = await rawOf(pumps.generated);
    for (let p = 0; p < LINE * SIZE; p++) {
      if (!pumps.doll.mask[p]) continue;
      const i = p * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = Math.round(rgba[i + c] * 0.55 + [176, 106, 72][c] * 0.45);
    }
    expect(codes(await processShoe(await toPng(rgba), pumps.reference, pumps.doll, [tile], [zone], GREEN))).toContain('repainted');
  });

  it('靴が拡大図の上の端まで届いていたら、切れているかもしれないと警告する', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect x="250" y="0" width="520" height="900" fill="#7a3b1e"/></svg>`;
    const painted = await sharp(pumps.reference).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
    expect(codes(await processShoe(painted, pumps.reference, pumps.doll, [tile], [zone], GREEN))).toContain('touches-edge');
  });
});

describe('processShoe（2026-11-19 の試作の絵）', async () => {
  const reference = await png('swap-feet-ref.webp');
  const doll = await dollFromReference(reference, GREEN);
  const oldZone = { x: 0, y: 666, w: SIZE, h: SIZE - 666 };
  for (const name of ['swap-pumps.webp', 'swap-boots.webp']) {
    it(`${name}: 警告なしで取り出せる`, async () => {
      const result = await processShoe(await png(name), reference, doll, [tile], [oldZone], GREEN);
      expect(result.warnings).toEqual([]);
      expect(count(result.rgba)).toBeGreaterThan(20000);
    });
  }
});
