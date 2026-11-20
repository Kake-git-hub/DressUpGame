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
  it('ドールの改名と非表示: ID は変わらない。hidden は false で項目ごと消える。使えない名前・無いドールは Error', async () => {
    const changed = await store.updateDoll(dollId, { name: 'おんなのこ', hidden: true });
    expect(changed).toMatchObject({ id: dollId, name: 'おんなのこ', hidden: true });
    expect((await store.read()).dolls[0]).toMatchObject({ id: dollId, name: 'おんなのこ', hidden: true });
    await store.updateDoll(dollId, { hidden: false });
    expect('hidden' in (await store.read()).dolls[0]).toBe(false);
    await expect(store.updateDoll(dollId, { name: ' ' })).rejects.toThrow();
    await expect(store.updateDoll('ない', { hidden: true })).rejects.toThrow(/ありません/);
  });
  it('カテゴリの中の服の並び替え: ほかのカテゴリの服の位置は変わらない。足りない・余分な ID は Error', async () => {
    const a = await store.addItem(dollId, item('a'));
    const d = await store.addItem(dollId, { ...item('d'), category: 'ドレス' });
    const b = await store.addItem(dollId, item('b'));
    const c = await store.addItem(dollId, item('c'));
    await store.reorderItems(dollId, 'トップス', [c.id, a.id, b.id]);
    expect((await store.read()).dolls[0].items.map((i) => i.name)).toEqual(['c', 'd', 'a', 'b']);
    await expect(store.reorderItems(dollId, 'トップス', [c.id, a.id])).rejects.toThrow();
    await expect(store.reorderItems(dollId, 'トップス', [c.id, a.id, b.id, d.id])).rejects.toThrow();
    await expect(store.reorderItems(dollId, 'トップス', [c.id, a.id, a.id])).rejects.toThrow();
  });
  it('服の位置と大きさの変更: 服の中心を軸に大きさを変えてから動かす。後ろ髪・肌・隠す所も一緒に動く。サムネイルはそのまま', async () => {
    const hide = new Uint8Array(1024 * 1024);
    for (let y = 300; y < 400; y++) for (let x = 400; x < 600; x++) hide[y * 1024 + x] = 255;
    const added = await store.addItem(dollId, item('ふく', { back: canvas([300, 200, 400, 600]), under: canvas([450, 380, 100, 20]), hide }));
    const moved = await store.transformItem(added.id, { scale: 1, dx: 10, dy: -20 });
    expect(moved.image.box).toEqual({ x: 410, y: 280, w: 200, h: 100 });
    expect(moved.back!.box).toEqual({ x: 310, y: 180, w: 400, h: 600 });
    expect(moved.under!.box).toEqual({ x: 460, y: 360, w: 100, h: 20 });
    expect(moved.hide!.box).toEqual({ x: 410, y: 280, w: 200, h: 100 });
    expect(moved.thumb).toBe(added.thumb);
    // 服の中心（510, 330）を軸に 2 倍
    const scaled = await store.transformItem(added.id, { scale: 2, dx: 0, dy: 0 });
    expect(scaled.image.box).toEqual({ x: 310, y: 230, w: 400, h: 200 });
    expect(scaled.back!.box).toEqual({ x: 110, y: 30, w: 800, h: 994 }); // 下はキャンバスの外に出た分が切れる
    const meta = await sharp(path.join(dir, scaled.image.file)).metadata();
    expect([meta.width, meta.height]).toEqual([400, 200]);
    expect((await store.read()).dolls[0].items[0].image.box).toEqual(scaled.image.box);
  });
  it('服の位置の変更: キャンバスの外に出た分は切れる。全部出たり、倍率がおかしかったりすれば Error で、何も変わらない', async () => {
    const added = await store.addItem(dollId, item('ふく'));
    const cut = await store.transformItem(added.id, { scale: 1, dx: 500, dy: 0 });
    expect(cut.image.box).toEqual({ x: 900, y: 300, w: 124, h: 100 });
    await expect(store.transformItem(added.id, { scale: 1, dx: 2000, dy: 0 })).rejects.toThrow();
    await expect(store.transformItem(added.id, { scale: 0, dx: 0, dy: 0 })).rejects.toThrow();
    await expect(store.transformItem(added.id, { scale: Number.NaN, dx: 0, dy: 0 })).rejects.toThrow();
    expect((await store.read()).dolls[0].items[0].image.box).toEqual(cut.image.box);
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
  it('背景のコピー: 同じ絵のまま、ほかのドール（null なら全部のドールで使う）に足す。もうあれば足さない。無い背景・ドールは Error', async () => {
    const bg = await store.addBackground(dollId, { name: 'うみ', data: await png(64, 64, [0, 0, 64, 64], '#3080ff') });
    const other = await store.addDoll({ name: 'べつ', data: await png(300, 600, [100, 50, 100, 500]) });
    const copied = await store.copyBackground(bg.id, other.id);
    expect(copied).toMatchObject({ id: 'べつ/bg/うみ', name: 'うみ', file: bg.file, thumb: bg.thumb });
    const shared = await store.copyBackground(bg.id, null);
    expect(shared).toMatchObject({ id: 'bg/うみ', file: bg.file });
    // もう同じ絵があれば、そのまま返す（増えない）
    expect(await store.copyBackground(bg.id, other.id)).toEqual(copied);
    const m = await store.read();
    expect(m.dolls.find((d) => d.id === other.id)!.backgrounds).toHaveLength(1);
    expect(m.backgrounds).toHaveLength(1);
    expect(m.dolls.find((d) => d.id === dollId)!.backgrounds).toEqual([bg]);
    await expect(store.copyBackground('ない', other.id)).rejects.toThrow(/ありません/);
    await expect(store.copyBackground(bg.id, 'いない')).rejects.toThrow(/ありません/);
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

  describe('セット', () => {
    const umi = { id: 'アニメ/セット/うみ', name: 'うみ' };
    const dollOf = async () => (await store.read()).dolls[0];

    it('newSetId は「ドール/セット/名前」。同じ名前のセットがあれば -2 を付ける', async () => {
      const doll = await dollOf();
      expect(store.newSetId(doll, 'うみ')).toBe(`${doll.id}/セット/うみ`);
      doll.sets = [{ id: `${doll.id}/セット/うみ`, name: 'うみ' }];
      expect(store.newSetId(doll, 'うみ')).toBe(`${doll.id}/セット/うみ-2`);
      expect(() => store.newSetId(doll, 'a/b')).toThrow();
    });

    it('セットを付けて保存すると、セットができて、服に印が付く。2 点目は同じセットに入る', async () => {
      const doll = await dollOf();
      const set = { id: store.newSetId(doll, 'うみ'), name: 'うみ' };
      const a = await store.addItem(doll.id, item('シャツ', { set }));
      const b = await store.addItem(doll.id, item('ぼうし', { set }));
      const after = await dollOf();
      expect(after.sets).toEqual([set]);
      expect(a.set).toBe(set.id);
      expect(b.set).toBe(set.id);
      // セットを付けない服には印が無い
      const c = await store.addItem(doll.id, item('べつ'));
      expect(c).not.toHaveProperty('set');
    });

    it('差し替え（replaceId）: セットの指定が無ければ今の印を残し、あれば付け替える', async () => {
      const doll = await dollOf();
      const a = await store.addItem(doll.id, item('シャツ', { set: umi }));
      const same = await store.addItem(doll.id, item('シャツ', { replaceId: a.id }));
      expect(same.set).toBe(umi.id);
      const yama = { id: 'アニメ/セット/やま', name: 'やま' };
      const moved = await store.addItem(doll.id, item('シャツ', { replaceId: a.id, set: yama }));
      expect(moved.set).toBe(yama.id);
      // うみ にはもう服が無いので、消える
      expect((await dollOf()).sets).toEqual([yama]);
    });

    it('最後の 1 点を消す・外すと、セットも消える。1 点残っていれば残る', async () => {
      const doll = await dollOf();
      const a = await store.addItem(doll.id, item('シャツ', { set: umi }));
      const b = await store.addItem(doll.id, item('ぼうし', { set: umi }));
      await store.deleteItem(a.id);
      expect((await dollOf()).sets).toEqual([umi]);
      const left = await store.updateItem(b.id, { set: null });
      expect(left).not.toHaveProperty('set');
      expect(await dollOf()).not.toHaveProperty('sets');
      // 名前だけの変更では、印は変わらない
      const c = await store.addItem(doll.id, item('くつ', { set: umi }));
      expect((await store.updateItem(c.id, { name: 'あかいくつ' })).set).toBe(umi.id);
    });

    it('あとから服をセットに入れる（いまあるセット・新しいセット）。無いセットは Error', async () => {
      const doll = await dollOf();
      const a = await store.addItem(doll.id, item('シャツ', { set: umi }));
      const b = await store.addItem(doll.id, item('ぼうし'));
      expect((await store.updateItem(b.id, { set: umi.id })).set).toBe(umi.id);
      const made = await store.updateItem(a.id, { set: { name: 'やま' } });
      const yama = (await dollOf()).sets!.find((x) => x.name === 'やま')!;
      expect(made.set).toBe(yama.id);
      expect(yama.id).toBe(`${doll.id}/セット/やま`);
      await expect(store.updateItem(b.id, { set: 'ない' })).rejects.toThrow(/ありません/);
      expect((await store.read()).dolls[0].items.find((i) => i.id === b.id)!.set).toBe(umi.id);
    });

    it('ほかのドールの同じ名前のセットには触らない。カテゴリを移しても印は残る', async () => {
      const first = await dollOf();
      const other = await store.addDoll({ name: 'べつのドール', data: await png(300, 600, [100, 50, 100, 500], '#f0c0a0') });
      const setA = { id: store.newSetId(first, 'うみ'), name: 'うみ' };
      const setB = { id: store.newSetId(other, 'うみ'), name: 'うみ' };
      expect(setA.id).not.toBe(setB.id);
      const a = await store.addItem(first.id, item('シャツ', { set: setA }));
      const b = await store.addItem(other.id, item('シャツ', { set: setB }));
      // 1 体目の最後の 1 点を消す: 1 体目のセットだけが消える
      await store.deleteItem(a.id);
      const dolls = (await store.read()).dolls;
      expect(dolls.find((d) => d.id === first.id)).not.toHaveProperty('sets');
      expect(dolls.find((d) => d.id === other.id)!.sets).toEqual([setB]);
      // カテゴリを移しても、印は残る
      const moved = await store.updateItem(b.id, { category: 'アクセサリー' });
      expect(moved.set).toBe(setB.id);
      expect((await store.read()).dolls.find((d) => d.id === other.id)!.sets).toEqual([setB]);
    });

    it('セットの ID は 200 文字まで（ドールの ID + 名前で、80 文字を超えることがある）', async () => {
      const doll = await dollOf();
      const long = { id: `${doll.id}/セット/${'あ'.repeat(120)}`, name: 'ながい' };
      expect((await store.addItem(doll.id, item('シャツ', { set: long }))).set).toBe(long.id);
      await expect(store.addItem(doll.id, item('べつ', { set: { id: 'x'.repeat(201), name: 'x' } }))).rejects.toThrow();
    });

    it('renameSet は名前だけを変える（ID と服の印はそのまま）。無いセット・使えない名前は Error', async () => {
      const doll = await dollOf();
      const a = await store.addItem(doll.id, item('シャツ', { set: umi }));
      expect(await store.renameSet(doll.id, umi.id, 'なつのうみ')).toEqual({ id: umi.id, name: 'なつのうみ' });
      const after = await dollOf();
      expect(after.sets).toEqual([{ id: umi.id, name: 'なつのうみ' }]);
      expect(after.items.find((i) => i.id === a.id)!.set).toBe(umi.id);
      await expect(store.renameSet(doll.id, '無い', 'x')).rejects.toThrow(/セット/);
      await expect(store.renameSet(doll.id, umi.id, 'a/b')).rejects.toThrow();
    });
  });
});
