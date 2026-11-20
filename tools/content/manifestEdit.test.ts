// @vitest-environment node
/**
 * 素材フォルダの編集のテスト
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentStore } from './manifestEdit.ts';

let dir: string;
let store: ContentStore;
let dollId: string;

// 透明な背景に、色付きの矩形
async function png(w: number, h: number, rect: [number, number, number, number], color = '#ff0000'): Promise<Buffer> {
  const [x, y, rw, rh] = rect;
  const patch = await sharp({ create: { width: rw, height: rh, channels: 4, background: color } }).png().toBuffer();
  return sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: patch, left: x, top: y }])
    .png()
    .toBuffer();
}
function canvas(rect: [number, number, number, number]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(1024 * 1024 * 4);
  const [x0, y0, w, h] = rect;
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px.set([255, 0, 0, 255], (y * 1024 + x) * 4);
  return px;
}
const item = (name: string, extra: object = {}) => ({ category: 'トップス', name, rgba: canvas([400, 300, 200, 100]), width: 1024, height: 1024, ...extra });
const files = async () => (await fs.readdir(path.join(dir, 'files'))).sort();
const exists = (rel: string) => fs.access(path.join(dir, rel)).then(() => true, () => false);

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'content-'));
  store = new ContentStore(dir);
  await store.init();
  dollId = (await store.addDoll({ name: 'テスト', data: await png(300, 600, [100, 50, 100, 500], '#f0c0a0') })).id;
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('ContentStore', () => {
  it('ドールの追加: 長辺 1024 のキャンバスの中央に置き、既定のカテゴリが付く', async () => {
    const doll = (await store.read()).dolls[0];
    expect(doll.id).toBe('テスト');
    expect(doll.image.canvasW).toBe(1024);
    expect(doll.image.box.h).toBe(983); // 1024 × 0.96
    expect(Math.abs(doll.image.box.x + doll.image.box.w / 2 - 512)).toBeLessThanOrEqual(1);
    expect(doll.categories.map((c) => c.id)).toContain('ドレス');
    expect(await exists(doll.image.file)).toBe(true);
  });
  it('背景が透明でない画像は、ドールにできない', async () => {
    const opaque = await sharp({ create: { width: 100, height: 200, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await expect(store.addDoll({ name: 'だめ', data: opaque })).rejects.toThrow(/透明/);
    expect((await store.read()).dolls).toHaveLength(1);
  });
  it('同じ名前のドールは別の ID になる', async () => {
    const second = await store.addDoll({ name: 'テスト', data: await png(300, 600, [100, 50, 100, 500]) });
    expect(second.id).toBe('テスト-2');
  });

  it('服の追加: 新しい ID、切り抜いた位置、画像とサムネイル', async () => {
    const added = await store.addItem(dollId, item('あかいふく'));
    expect(added.id).toBe('テスト/トップス/あかいふく');
    expect(added.image.box).toEqual({ x: 400, y: 300, w: 200, h: 100 });
    expect(await exists(added.image.file)).toBe(true);
    expect(await exists(added.thumb)).toBe(true);
    expect((await store.read()).dolls[0].items).toHaveLength(1);
  });
  it('同じ名前の追加は -2 になり、元の服は残る', async () => {
    await store.addItem(dollId, item('ふく'));
    const second = await store.addItem(dollId, item('ふく'));
    expect(second.id).toBe('テスト/トップス/ふく-2');
    expect((await store.read()).dolls[0].items).toHaveLength(2);
  });
  it('replaceId を指定すると、同じ ID のまま画像だけ差し替わる', async () => {
    const first = await store.addItem(dollId, item('ふく'));
    const replaced = await store.addItem(dollId, { ...item('ふく'), rgba: canvas([100, 100, 50, 50]), replaceId: first.id });
    expect(replaced.id).toBe(first.id);
    expect(replaced.image.box).toEqual({ x: 100, y: 100, w: 50, h: 50 });
    expect((await store.read()).dolls[0].items).toHaveLength(1);
  });
  it('肌の絵（under）を付けられ、under なしで置き換えると消える', async () => {
    const added = await store.addItem(dollId, item('くつ', { under: canvas([450, 900, 100, 50]) }));
    expect(added.under?.box).toEqual({ x: 450, y: 900, w: 100, h: 50 });
    expect(await exists(added.under!.file)).toBe(true);
    const replaced = await store.addItem(dollId, { ...item('くつ'), replaceId: added.id });
    expect(replaced.under).toBeUndefined();
    await expect(store.addItem(dollId, item('くつ2', { under: new Uint8ClampedArray(10) }))).rejects.toThrow();
  });
  it('後ろ髪のある品目に、うしろがみのサムネイル（backThumb）を付けられる。後ろ髪が無ければ付けない', async () => {
    const hair = await store.addItem(dollId, item('かみ', { back: canvas([300, 200, 400, 600]), backThumbFrom: canvas([300, 200, 400, 600]) }));
    expect(hair.backThumb).toBeDefined();
    const meta = await sharp(path.join(dir, hair.backThumb!)).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(192);
    const plain = await store.addItem(dollId, item('ふく', { backThumbFrom: canvas([300, 200, 400, 600]) }));
    expect(plain.backThumb).toBeUndefined();
    const replaced = await store.addItem(dollId, { ...item('かみ'), replaceId: hair.id });
    expect(replaced.backThumb).toBeUndefined();
  });
  it('改名・カテゴリ移動で ID は変わらない', async () => {
    const first = await store.addItem(dollId, item('ふく'));
    const changed = await store.updateItem(first.id, { name: 'あたらしいなまえ', category: 'ドレス', layer: 7 });
    expect(changed).toMatchObject({ id: first.id, name: 'あたらしいなまえ', category: 'ドレス', layer: 7 });
    expect((await store.updateItem(first.id, { layer: null })).layer).toBeUndefined();
  });
  it('服の削除', async () => {
    const first = await store.addItem(dollId, item('ふく'));
    await store.deleteItem(first.id);
    expect((await store.read()).dolls[0].items).toEqual([]);
    await expect(store.deleteItem(first.id)).rejects.toThrow(/ありません/);
  });
  it('存在しないドール・カテゴリ、大きさの違う画像、全部透明の画像は Error で、何も増えない', async () => {
    await expect(store.addItem('いない', item('ふく'))).rejects.toThrow(/ドール/);
    await expect(store.addItem(dollId, item('ふく', { category: 'ない' }))).rejects.toThrow(/カテゴリ/);
    await expect(store.addItem(dollId, item('ふく', { width: 512, height: 512, rgba: new Uint8ClampedArray(512 * 512 * 4) }))).rejects.toThrow(/大きさ/);
    await expect(store.addItem(dollId, item('ふく', { rgba: new Uint8ClampedArray(1024 * 1024 * 4) }))).rejects.toThrow(/透明/);
    expect((await store.read()).dolls[0].items).toEqual([]);
  });
  it.each(['../x', 'a/b', 'a\\b', ' 空白', '', '..'])('不正な名前 %j は Error で、何も書かれない', async (name) => {
    const before = await files();
    await expect(store.addItem(dollId, item(name))).rejects.toThrow();
    expect(await files()).toEqual(before);
  });

  it('カテゴリの追加・更新・並び替え・削除', async () => {
    await store.upsertCategory(dollId, { id: 'かばん', label: 'かばん', layer: 12, menuOrder: 11, overlap: true, movable: true });
    await store.reorderCategories(dollId, [{ id: 'かばん', layer: 5, menuOrder: 0 }]);
    const doll = (await store.read()).dolls[0];
    expect(doll.categories.find((c) => c.id === 'かばん')).toMatchObject({ layer: 5, menuOrder: 0, movable: true });
    await store.deleteCategory(dollId, 'かばん');
    expect((await store.read()).dolls[0].categories.some((c) => c.id === 'かばん')).toBe(false);
  });
  it('服の残るカテゴリは削除できない', async () => {
    await store.addItem(dollId, item('ふく'));
    await expect(store.deleteCategory(dollId, 'トップス')).rejects.toThrow(/1 点/);
  });

  it('背景の追加（ドール専用・共通）と削除', async () => {
    const data = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: '#3366aa' } }).png().toBuffer();
    const own = await store.addBackground(dollId, { name: 'うみ', data });
    const shared = await store.addBackground(null, { name: 'うみ', data });
    expect(own.id).toBe('テスト/bg/うみ');
    expect(shared.id).toBe('bg/うみ');
    expect((await sharp(path.join(dir, own.file)).metadata()).width).toBe(1024);
    let manifest = await store.read();
    expect(manifest.dolls[0].backgrounds).toHaveLength(1);
    expect(manifest.backgrounds).toHaveLength(1);
    await store.deleteBackground(own.id);
    await store.deleteBackground(shared.id);
    manifest = await store.read();
    expect(manifest.dolls[0].backgrounds).toEqual([]);
    expect(manifest.backgrounds).toEqual([]);
  });
  it('壊れた画像は背景にできない', async () => {
    await expect(store.addBackground(null, { name: 'x', data: Buffer.from('no') })).rejects.toThrow(/読めません/);
  });

  it('removeUnusedFiles は参照中の画像を消さず、不要な画像だけ消す', async () => {
    await store.removeUnusedFiles(); // ドール追加時に作られる、使わないサムネイルを先に片づける
    const first = await store.addItem(dollId, item('ふく'));
    const kept = await store.addItem(dollId, { ...item('のこす'), rgba: canvas([10, 10, 30, 30]) });
    await store.deleteItem(first.id);
    expect(await store.countUnusedFiles()).toBe(2);
    const removed = await store.removeUnusedFiles();
    expect(removed).toHaveLength(2);
    expect(await exists(kept.image.file)).toBe(true);
    expect(await exists(first.image.file)).toBe(false);
    expect(await exists((await store.read()).dolls[0].image.file)).toBe(true);
  });
  it('removeUnusedFiles は、自分が書いた画像以外（フォルダ、.gitkeep など）には触らない', async () => {
    await fs.mkdir(path.join(dir, 'files/sub'));
    await fs.writeFile(path.join(dir, 'files/.gitkeep'), '');
    await store.removeUnusedFiles();
    expect(await exists('files/sub')).toBe(true);
    expect(await exists('files/.gitkeep')).toBe(true);
  });

  it('同時に来た追加でも、全部が一覧に残る', async () => {
    await Promise.all([1, 2, 3, 4].map((n) => store.addItem(dollId, { ...item(`ふく${n}`), rgba: canvas([n * 50, 100, 40, 40]) })));
    expect((await store.read()).dolls[0].items).toHaveLength(4);
  });
  it('検証に通らない変更では、manifest.json は元のまま', async () => {
    const before = await fs.readFile(path.join(dir, 'manifest.json'), 'utf8');
    await expect(store.upsertCategory(dollId, { id: 'x', label: 'x', layer: Number.NaN, menuOrder: 0, overlap: false, movable: false })).rejects.toThrow();
    expect(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8')).toBe(before);
    expect(await exists('manifest.json.tmp')).toBe(false);
  });
  it('スタジオ用のデータを読み書きできる', async () => {
    expect(await store.readStudioData('templates', {})).toEqual({});
    await store.writeStudioData('templates', { a: 1 });
    expect(await store.readStudioData('templates', {})).toEqual({ a: 1 });
    await expect(store.writeStudioData('../x', {})).rejects.toThrow();
  });
});
