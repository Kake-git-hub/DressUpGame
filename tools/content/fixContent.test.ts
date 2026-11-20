// @vitest-environment node
/**
 * 公開済みの素材への、1 回きりの手直し: ドールの輪郭線の緑を取る、うしろがみのサムネイルを足す
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { THUMB_BODY } from '../../src/pipeline/hairLayers.ts';
import { addBackThumbs, cleanDollOutline, copyItems, removeHairShadows } from './fixContent.ts';
import { ContentStore } from './manifestEdit.ts';

let dir: string;
let store: ContentStore;
let dollId: string;
const OLIVE = [82, 84, 28]; // 緑が混ざった、こげ茶の輪郭線

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fix-content-'));
  store = new ContentStore(dir);
  await store.init();
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

// 透明な背景に、肌色の四角と、そのまわりの緑がかった輪郭線（幅 1。緑が混ざるのは、輪郭線の外側の 1〜2 px）
async function outlined(w: number, h: number, rect: [number, number, number, number]): Promise<Buffer> {
  const [x0, y0, rw, rh] = rect;
  const data = Buffer.alloc(w * h * 4);
  for (let y = y0 - 1; y < y0 + rh + 1; y++) {
    for (let x = x0 - 1; x < x0 + rw + 1; x++) {
      const inside = x >= x0 && x < x0 + rw && y >= y0 && y < y0 + rh;
      data.set(inside ? [254, 214, 190, 255] : [...OLIVE, 255], (y * w + x) * 4);
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}
// 画像の、不透明度と「緑がかった画素」の数
async function stats(file: string) {
  const { data } = await sharp(path.join(dir, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let greenish = 0;
  const alpha: number[] = [];
  for (let i = 0; i < data.length; i += 4) {
    alpha.push(data[i + 3]);
    if (data[i + 3] > 0 && data[i + 1] > data[i] && data[i + 1] > data[i + 2]) greenish++;
  }
  return { greenish, alpha };
}
const canvasOf = (rect: [number, number, number, number], size = 1024, color = [200, 30, 40]) => {
  const px = new Uint8ClampedArray(size * size * 4);
  const [x0, y0, w, h] = rect;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px.set([...color, 255], (y * size + x) * 4);
  return px;
};

describe('cleanDollOutline', () => {
  async function setup() {
    const doll = await store.addDoll({ name: 'てすと', data: await outlined(300, 600, [100, 50, 100, 500]) });
    dollId = doll.id;
    // 2 倍の元画像（拡大図のもと）
    const base = path.basename(doll.image.file, path.extname(doll.image.file));
    await fs.mkdir(path.join(dir, 'studio', 'masters'), { recursive: true });
    await sharp(path.join(dir, doll.image.file)).resize(doll.image.box.w * 2, doll.image.box.h * 2).webp({ lossless: true }).toFile(path.join(dir, 'studio', 'masters', `${base}.webp`));
    await store.writeStudioData('templates', { [dollId]: { parts: {}, regions: {} } });
    // 顔（頭の輪郭線ごと、お面のように重ねる）と、ふつうの服（緑がかった線があっても触らない）
    const face = canvasOf([480, 100, 60, 60], 1024, OLIVE);
    for (let y = 101; y < 159; y++) for (let x = 481; x < 539; x++) face.set([254, 214, 190, 255], (y * 1024 + x) * 4); // 肌の頭と、1 px の輪郭線
    const faceItem = await store.addItem(dollId, { category: 'かお', name: 'え', rgba: face, width: 1024, height: 1024 });
    const top = await store.addItem(dollId, { category: 'トップス', name: 'ふく', rgba: canvasOf([400, 300, 200, 100], 1024, OLIVE), width: 1024, height: 1024 });
    return { doll, base, faceItem, top };
  }

  it('ドール・元画像・顔の輪郭線の緑を取り、一覧と元画像の名前を付け替える。形と、ほかの服は変えない', async () => {
    const { doll, base, faceItem, top } = await setup();
    const before = await stats(doll.image.file);
    expect(before.greenish).toBeGreaterThan(0);
    const result = await cleanDollOutline(dir, dollId);
    expect(result.faces).toBe(1);

    const manifest = await store.read();
    const after = manifest.dolls[0];
    expect(after.image.file).not.toBe(doll.image.file);
    expect(after.image.box).toEqual(doll.image.box);
    const cleaned = await stats(after.image.file);
    expect(cleaned.greenish).toBe(0);
    expect(cleaned.alpha).toEqual(before.alpha);
    // 元画像は、新しいドールの画像と同じ名前で置かれ、古い名前のものは無い
    const newBase = path.basename(after.image.file, path.extname(after.image.file));
    expect(result.master).toBe(`studio/masters/${newBase}.webp`);
    expect((await stats(result.master!)).greenish).toBe(0);
    await expect(fs.access(path.join(dir, 'studio', 'masters', `${base}.webp`))).rejects.toThrow();
    // 顔は直り、服はそのまま。ID と位置は変わらない
    const face = after.items.find((i) => i.id === faceItem.id)!;
    expect(face.image.file).not.toBe(faceItem.image.file);
    expect(face.image.box).toEqual(faceItem.image.box);
    expect((await stats(face.image.file)).greenish).toBe(0);
    expect(after.items.find((i) => i.id === top.id)).toEqual(top);
    // 型紙はそのまま
    expect(await store.readStudioData('templates', {})).toEqual({ [dollId]: { parts: {}, regions: {} } });
  });

  it('2 回目は何も変えない', async () => {
    await setup();
    await cleanDollOutline(dir, dollId);
    const once = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
    await cleanDollOutline(dir, dollId);
    expect(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')).toBe(once);
  });

  it('無いドールは断る', async () => {
    await expect(cleanDollOutline(dir, 'いない')).rejects.toThrow(/いない/);
  });
});

describe('addBackThumbs', () => {
  it('後ろ髪のある品目にだけ、うしろがみのサムネイルを足す。2 回目は足さない', async () => {
    dollId = (await store.addDoll({ name: 'てすと', data: await outlined(300, 600, [100, 50, 100, 500]) })).id;
    await store.createCategory(dollId, { id: 'ヘア', label: 'ヘアスタイル', layer: 11, menuOrder: 11, overlap: false, movable: false });
    const doll = (await store.read()).dolls[0];
    const { x, y, w } = doll.image.box;
    // 後ろ髪: ドールの頭から胸までを、横に広くおおう（体の裏は、塗りつぶした色）
    const back = canvasOf([x - 60, y, w + 120, 300], 1024, [90, 50, 20]);
    const front = canvasOf([x, y, w, 40], 1024, [90, 50, 20]);
    const hair = await store.addItem(dollId, { category: 'ヘア', name: 'かみ', rgba: front, width: 1024, height: 1024, back });
    await store.addItem(dollId, { category: 'トップス', name: 'ふく', rgba: canvasOf([400, 300, 200, 100]), width: 1024, height: 1024 });
    expect(hair.backThumb).toBeUndefined();

    expect(await addBackThumbs(dir)).toBe(1);
    const items = (await store.read()).dolls[0].items;
    const thumb = items.find((i) => i.id === hair.id)!.backThumb!;
    expect(thumb).toBeDefined();
    expect(items.find((i) => i.name === 'ふく')!.backThumb).toBeUndefined();
    // サムネイルの体の所は、うすい体の色（塗りつぶしは見えない）
    const { data, info } = await sharp(path.join(dir, thumb)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const centre = ((info.height >> 1) * info.width + (info.width >> 1)) * 4;
    for (let c = 0; c < 3; c++) expect(Math.abs(data[centre + c] - THUMB_BODY[c])).toBeLessThanOrEqual(4);

    expect(await addBackThumbs(dir)).toBe(0);
  });
});

describe('removeHairShadows', () => {
  const SHADOW = [221, 167, 150]; // 肌（254, 214, 190）に落ちた影の色
  const HAIR = [24, 24, 28];
  // 画像の中の、ある色（±12）の画素の数
  async function countColor(file: string, color: number[]) {
    const { data } = await sharp(path.join(dir, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 128 && color.every((c, k) => Math.abs(data[i + k] - c) <= 12)) n++;
    return n;
  }
  const setup = async () => {
    dollId = (await store.addDoll({ name: 'てすと', data: await outlined(300, 600, [100, 50, 100, 500]) })).id;
    await store.createCategory(dollId, { id: 'ヘア', label: 'ヘアスタイル', layer: 11, menuOrder: 11, overlap: false, movable: false });
    const doll = (await store.read()).dolls[0];
    const { x, y, w } = doll.image.box;
    // 前髪: 頭の上の黒い帯（高さ 60）と、そのすぐ下の、肌に落ちた影の帯（高さ 8）
    const paint = (rgba: Uint8ClampedArray, rect: number[], color: number[]) => {
      for (let yy = rect[1]; yy < rect[1] + rect[3]; yy++) for (let xx = rect[0]; xx < rect[0] + rect[2]; xx++) rgba.set([...color, 255], (yy * 1024 + xx) * 4);
    };
    const front = canvasOf([x - 20, y - 10, w + 40, 70], 1024, HAIR);
    paint(front, [x + 4, y + 60, w - 8, 8], SHADOW);
    // 後ろ髪: 前髪と同じ絵に、体の横へ下がる房を足したもの
    const back = new Uint8ClampedArray(front);
    paint(back, [x - 40, y, 30, 300], HAIR);
    paint(back, [x + w + 10, y, 30, 300], HAIR);
    const hair = await store.addItem(dollId, { category: 'ヘア', name: 'かみ', rgba: front, width: 1024, height: 1024, back });
    const top = await store.addItem(dollId, { category: 'トップス', name: 'ふく', rgba: canvasOf([400, 300, 200, 100]), width: 1024, height: 1024 });
    return { hair, top };
  };

  it('前髪と後ろ髪から、肌に落ちた影を取る。髪の ID・名前はそのまま。ほかの品目は変えない', async () => {
    const { hair, top } = await setup();
    expect(await countColor(hair.image.file, SHADOW)).toBeGreaterThan(500);

    const result = await removeHairShadows(dir, dollId);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: hair.id });
    expect(result[0].removed).toBeGreaterThan(500);

    const items = (await store.read()).dolls[0].items;
    const fixed = items.find((i) => i.id === hair.id)!;
    expect(fixed.name).toBe('かみ');
    expect(fixed.image.file).not.toBe(hair.image.file);
    expect(await countColor(fixed.image.file, SHADOW)).toBe(0);
    expect(await countColor(fixed.back!.file, SHADOW)).toBe(0);
    // 前髪は、影の帯のぶんだけ低くなる。黒い所は残る
    expect(fixed.image.box.h).toBe(hair.image.box.h - 8);
    expect(await countColor(fixed.image.file, HAIR)).toBe(await countColor(hair.image.file, HAIR));
    expect(fixed.thumb).not.toBe(hair.thumb);
    expect(fixed.backThumb).toBeDefined();
    expect(items.find((i) => i.id === top.id)).toEqual(top);
  });

  it('2 回目は何も変えない', async () => {
    await setup();
    await removeHairShadows(dir, dollId);
    const once = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
    expect(await removeHairShadows(dir, dollId)).toEqual([]);
    expect(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')).toBe(once);
  });
});

describe('copyItems', () => {
  const setup = async () => {
    const from = await store.addDoll({ name: 'もと', data: await outlined(300, 600, [100, 50, 100, 500]) });
    const to = await store.addDoll({ name: 'さき', data: await outlined(300, 600, [100, 50, 100, 500]) });
    await store.createCategory(from.id, { id: 'かばん', label: 'かばん', layer: 12, menuOrder: 20, overlap: true, movable: false });
    const top = await store.addItem(from.id, { category: 'トップス', name: 'ふく', rgba: canvasOf([400, 300, 200, 100]), width: 1024, height: 1024, hide: new Uint8Array(1024 * 1024).fill(255, 0, 5000) });
    await store.updateItem(top.id, { layer: 7 });
    const bag = await store.addItem(from.id, { category: 'かばん', name: 'かばん', rgba: canvasOf([600, 400, 80, 80]), width: 1024, height: 1024 });
    // さきのドールにも、同じ名前の服がある
    const own = await store.addItem(to.id, { category: 'トップス', name: 'ふく', rgba: canvasOf([400, 300, 200, 100], 1024, [10, 10, 200]), width: 1024, height: 1024 });
    return { from, to, top, bag, own };
  };

  it('もとのドールの服を、さきのドールに写す。もとはそのまま。無いカテゴリは作る。絵のファイルは同じものを指す', async () => {
    const { from, to, top, bag, own } = await setup();
    const filesBefore = (await fs.readdir(path.join(dir, 'files'))).length;
    expect(await copyItems(dir, from.id, to.id)).toEqual({ copied: 2, skipped: 0, categories: ['かばん'] });

    const manifest = await store.read();
    const source = manifest.dolls.find((d) => d.id === from.id)!;
    const target = manifest.dolls.find((d) => d.id === to.id)!;
    expect(source.items).toHaveLength(2); // もとは消さない
    expect(target.items.map((i) => i.id)).toEqual([own.id, `${to.id}/トップス/ふく-2`, `${to.id}/かばん/かばん`]);
    // 名前・絵・隠す所・重ね順の上書きは、そのまま
    const copied = target.items[1];
    expect(copied).toMatchObject({ name: 'ふく', category: 'トップス', layer: 7 });
    expect(copied.image).toEqual(manifest.dolls[0].items.find((i) => i.id === top.id)!.image);
    expect(copied.hide).toBeDefined();
    expect(target.items[2].image.file).toBe(bag.image.file);
    expect(target.categories.find((c) => c.id === 'かばん')).toMatchObject({ label: 'かばん', layer: 12, menuOrder: 20, overlap: true });
    expect((await fs.readdir(path.join(dir, 'files'))).length).toBe(filesBefore);
  });

  it('2 回目は、もう写してある服を写さない', async () => {
    const { from, to } = await setup();
    await copyItems(dir, from.id, to.id);
    const once = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
    expect(await copyItems(dir, from.id, to.id)).toEqual({ copied: 0, skipped: 2, categories: [] });
    expect(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')).toBe(once);
  });

  it('無いドール・同じドールは断る', async () => {
    const { from } = await setup();
    await expect(copyItems(dir, from.id, 'いない')).rejects.toThrow(/いない/);
    await expect(copyItems(dir, 'いない', from.id)).rejects.toThrow(/いない/);
    await expect(copyItems(dir, from.id, from.id)).rejects.toThrow(/同じ/);
  });
});

