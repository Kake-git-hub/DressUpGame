// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentStore } from '../content/manifestEdit.ts';
import { dollPrompt } from './dollPrompt.ts';
import { cutOutClothing } from '../../src/pipeline/cutout.ts';
import { cutOutDoll, importDoll, replaceDollImage } from './makeDoll.ts';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'make-doll-'));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('dollPrompt', () => {
  it('作りやすい姿勢の条件と、背景色が入る', () => {
    const prompt = dollPrompt([0, 255, 0]);
    expect(prompt).toMatch(/5\.5 heads/);
    expect(prompt).toMatch(/#00FF00/);
    expect(prompt).toMatch(/turned outward/);
    expect(prompt).toMatch(/no face/);
    // 手は、手のひらが見える「パー」の形（作者の指定）
    expect(prompt).toMatch(/palm facing the viewer/);
    expect(prompt).toMatch(/fingers spread/);
  });

  it('男の子: 見本と同じ姿勢のまま、体つきと下着だけを男の子にする指示になる', () => {
    const prompt = dollPrompt([0, 255, 0], 'boy');
    expect(prompt).toMatch(/BOY/);
    expect(prompt).toMatch(/same pose/);
    // 下着は短パンだけ。上半身は何も着ない（作者の指定）
    expect(prompt).toMatch(/only plain white fitted boxer shorts/);
    expect(prompt).toMatch(/upper body is bare/);
    expect(prompt).toMatch(/no undershirt/);
    expect(prompt).not.toMatch(/bandeau/);
    // 姿勢の条件は、女の子と同じ
    expect(prompt).toMatch(/palm facing the viewer/);
    expect(prompt).toMatch(/turned outward/);
    expect(prompt).toMatch(/no face/);
    expect(prompt).toMatch(/#00FF00/);
  });
});

describe('importDoll', () => {
  it('緑の背景のドールを切り抜いて登録し、2 倍の元画像を studio/masters に残す。カテゴリは写し元と同じ', async () => {
    const store = new ContentStore(dir);
    await store.init();
    const blank = await sharp({ create: { width: 400, height: 800, channels: 4, background: { r: 240, g: 200, b: 170, alpha: 1 } } }).png().toBuffer();
    const first = await store.addDoll({ name: 'もと', data: await sharp({ create: { width: 500, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: blank }]).png().toBuffer() });
    await store.createCategory(first.id, { id: 'とくべつ', label: 'とくべつ', layer: 5, menuOrder: 20, overlap: false, movable: false });

    const generated = await sharp(path.join(import.meta.dirname, '../../docs/superpowers/specs/2026-11-19-spike/doll_new1.webp')).png().toBuffer();
    const doll = await importDoll(dir, 'あたらしい', generated, first.id);
    const manifest = await store.read();
    expect(manifest.dolls.map((d) => d.name)).toEqual(['もと', 'あたらしい']);
    expect(doll.categories.map((c) => c.id)).toEqual(manifest.dolls[0].categories.map((c) => c.id));
    expect(doll.categories.some((c) => c.id === 'とくべつ')).toBe(true);
    expect(doll.items).toEqual([]);
    expect(doll.image.box.h).toBeGreaterThan(960);

    // 配信用の画像に、緑が残っていない
    const { data, info } = await sharp(path.join(dir, doll.image.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0, green = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      opaque++;
      if (data[i + 1] - Math.max(data[i], data[i + 2]) > 60) green++;
    }
    expect(opaque).toBeGreaterThan(info.width * info.height * 0.2);
    expect(green / opaque).toBeLessThan(0.002);

    const master = await sharp(path.join(dir, 'studio', 'masters', `${path.basename(doll.image.file, path.extname(doll.image.file))}.webp`)).metadata();
    expect([master.width, master.height]).toEqual([doll.image.box.w * 2, doll.image.box.h * 2]);
    expect(master.hasAlpha).toBe(true);
  }, 60_000);

  it('切り抜いたドールの輪郭線に、背景の緑が混ざらない。形（不透明度）は変えない', async () => {
    // 緑の背景に、こげ茶の太い輪郭線で囲んだ肌色の丸（ふちは、なめらかに背景と混ざる）
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="#00ff00"/>
      <circle cx="200" cy="200" r="120" fill="#fed6be" stroke="#3c2810" stroke-width="6"/></svg>`;
    const image = await sharp(Buffer.from(svg)).png().toBuffer();
    const { data } = await sharp(await cutOutDoll(image)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // 比べる相手: 背景を抜いただけの絵（いままでの処理）
    const raw = await sharp(image).removeAlpha().ensureAlpha().raw().toBuffer();
    const plain = new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength);
    cutOutClothing(plain, 400, 400, { background: [0, 255, 0], silhouette: null });
    let greenish = 0;
    let before = 0;
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i + 3]).toBe(plain[i + 3]);
      if (data[i + 3] === 0) continue;
      if (data[i + 1] > data[i] + 4 && data[i + 1] > data[i + 2] + 4) greenish++;
      if (plain[i + 1] > plain[i] + 4 && plain[i + 1] > plain[i + 2] + 4) before++;
    }
    expect(before).toBeGreaterThan(20); // いままでの処理では、緑がかった輪郭が残っていた
    expect(greenish).toBe(0);
  });

  it('背景が単色でない画像は断る', async () => {
    const store = new ContentStore(dir);
    await store.init();
    const noise = await sharp(Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * 7919) % 256)), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
    await expect(importDoll(dir, 'だめ', noise)).rejects.toThrow(/背景/);
  });
});

describe('replaceDollImage', () => {
  // 緑の背景（1000×1000）に立つ「ドール」: 肌色の体（x=400〜599、y=top〜899）。shirt があれば、その範囲を白く塗る
  const figure = (top: number, shirt?: [number, number]) => {
    const body = `<rect x="400" y="${top}" width="200" height="${900 - top}" fill="#fed0b4"/>`;
    const white = shirt ? `<rect x="400" y="${shirt[0]}" width="200" height="${shirt[1] - shirt[0]}" fill="#f4f2ee"/>` : '';
    return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000"><rect width="1000" height="1000" fill="#00ff00"/>${body}${white}</svg>`)).png().toBuffer();
  };

  it('ドールの絵だけを、同じ位置合わせのまま差し替える。ID・カテゴリ・服はそのまま、2 倍の元画像も付け替える', async () => {
    const store = new ContentStore(dir);
    await store.init();
    const before = await figure(100, [300, 600]);
    const doll = await importDoll(dir, 'おとこのこ', before);
    const rgba = new Uint8ClampedArray(1024 * 1024 * 4);
    for (let y = 300; y < 400; y++) for (let x = 450; x < 570; x++) rgba.set([200, 30, 30, 255], (y * 1024 + x) * 4);
    const item = await store.addItem(doll.id, { category: 'トップス', name: 'ふく', rgba, width: 1024, height: 1024 });
    const oldMaster = path.join(dir, 'studio', 'masters', `${path.basename(doll.image.file, '.webp')}.webp`);

    // 新しい絵: シャツが無く、頭が 40px（元の絵で）低い
    const replaced = await replaceDollImage(dir, doll.id, await figure(140), before);
    expect(replaced.id).toBe(doll.id);
    expect(replaced.categories).toEqual(doll.categories);
    expect(replaced.items).toEqual([item]);
    expect(replaced.image.file).not.toBe(doll.image.file);
    // 位置合わせは前と同じ: 元の絵の 800px が 983px（1.229 倍）。足もとは動かず、頭だけ 40 × 1.229 = 49px 下がる
    const { box } = doll.image;
    expect(replaced.image.box.x).toBe(box.x);
    expect(replaced.image.box.w).toBe(box.w);
    expect(replaced.image.box.y + replaced.image.box.h).toBe(box.y + box.h);
    expect(replaced.image.box.y - box.y).toBeGreaterThanOrEqual(48);
    expect(replaced.image.box.y - box.y).toBeLessThanOrEqual(50);
    // 白いシャツが無くなっている
    const { data } = await sharp(path.join(dir, replaced.image.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let white = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128 && data[i + 2] > 225) white++;
    expect(white).toBe(0);
    // 2 倍の元画像は、新しい名前で置き、古いものは消す
    const master = await sharp(path.join(dir, 'studio', 'masters', `${path.basename(replaced.image.file, '.webp')}.webp`)).metadata();
    expect([master.width, master.height]).toEqual([replaced.image.box.w * 2, replaced.image.box.h * 2]);
    await expect(fs.access(oldMaster)).rejects.toThrow();
    expect((await store.read()).dolls).toHaveLength(1);
  }, 60_000);

  it('無いドール・大きさの違う絵は断る', async () => {
    const store = new ContentStore(dir);
    await store.init();
    const before = await figure(100);
    const doll = await importDoll(dir, 'おとこのこ', before);
    await expect(replaceDollImage(dir, 'いない', before, before)).rejects.toThrow(/いない/);
    const small = await sharp(before).resize(500, 500).png().toBuffer();
    await expect(replaceDollImage(dir, doll.id, small, before)).rejects.toThrow(/大きさ/);
  }, 60_000);
});

