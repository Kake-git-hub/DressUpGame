// @vitest-environment node
/**
 * 移行スクリプト（プリセットのフォルダ → 配信用の一覧と画像）のテスト
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildContent } from './buildContent.ts';
import type { BuildReport } from './buildContent.ts';
import { parseManifest } from '../../src/content/manifest.ts';
import type { Manifest } from '../../src/content/manifest.ts';
import { writePresetDir, makePng } from '../../e2e/fixtures/makePreset.ts';

let root = '';
let presetDir = '';
let outDir = '';
let report: BuildReport;
let manifest: Manifest;

const readManifest = async (dir: string) => JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf-8'));

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'build-content-'));
  presetDir = path.join(root, 'preset');
  outDir = path.join(root, 'out');
  await writePresetDir(presetDir);
  const clothing = path.join(presetDir, 'doll-test/clothing');
  // 不透明な緑背景のままの服
  await fs.writeFile(
    path.join(clothing, '04_1_トップス/opaque.png'),
    await sharp(await makePng({ left: 292, top: 240, width: 440, height: 280, color: '#ff00ff' }, '#00ff00')).removeAlpha().png().toBuffer()
  );
  // 手作りサムネイルとバックアップ（どちらも無視される）
  await fs.writeFile(path.join(clothing, '04_1_トップス/red_サムネ.png'), await makePng(null, '#123456'));
  await fs.writeFile(path.join(clothing, '04_1_トップス/red.png~'), 'backup');
  // 壊れた画像
  await fs.writeFile(path.join(clothing, '03_2_ボトムス/broken.png'), 'not an image');
  // ファイル名方式（重ね順がフォルダと違う・overlap 付き・同じ名前の重複）
  const flat = await makePng({ left: 400, top: 100, width: 100, height: 60, color: '#00ffff' });
  await fs.writeFile(path.join(clothing, '5_1_トップス_red.png'), flat);
  await fs.writeFile(path.join(clothing, '12_10_アクセサリー_overlap_リボン.png'), flat);
  // 規則に合わない名前
  await fs.writeFile(path.join(clothing, 'なまえだけ.png'), flat);
  // 重ね着可・自由配置のフォルダ
  await fs.mkdir(path.join(clothing, '11_9_かざり_movable_overlap'), { recursive: true });
  await fs.writeFile(path.join(clothing, '11_9_かざり_movable_overlap/star.png'), flat);
  // 2048px の大きな服（1024 に縮小される）
  await fs.writeFile(
    path.join(clothing, '04_1_トップス/big.png'),
    await sharp({ create: { width: 2048, height: 2048, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 400, height: 200, channels: 4, background: '#ffaa00' } }).png().toBuffer(), left: 800, top: 600 }])
      .png()
      .toBuffer()
  );
  // 全ドール共通の背景
  await fs.mkdir(path.join(presetDir, 'backgrounds'), { recursive: true });
  await fs.writeFile(path.join(presetDir, 'backgrounds/shared.png'), await makePng(null, '#8080ff'));

  report = await buildContent(presetDir, outDir);
  manifest = parseManifest(await readManifest(outDir));
}, 120_000);

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const doll = () => manifest.dolls[0];
const item = (id: string) => {
  const found = doll().items.find((i) => i.id === id);
  if (!found) throw new Error(`item not found: ${id} in ${doll().items.map((i) => i.id).join(', ')}`);
  return found;
};

describe('buildContent', () => {
  it('一覧ファイルが検証を通り、件数が合う', () => {
    expect(manifest.dolls).toHaveLength(1);
    expect(doll().id).toBe('test');
    expect(doll().items).toHaveLength(9); // red, blue, opaque, big, green, flat red, リボン, なまえだけ, star
    expect(doll().backgrounds).toHaveLength(1);
    expect(manifest.backgrounds).toHaveLength(1);
    expect(report).toMatchObject({ dolls: 1, items: 9, backgrounds: 2 });
  });

  it('服は切り抜かれ、box が元の位置を指す', async () => {
    const red = item('test/トップス/red');
    expect(red.image).toMatchObject({ canvasW: 1024, canvasH: 1024, box: { x: 292, y: 240, w: 440, h: 280 } });
    const meta = await sharp(path.join(outDir, red.image.file)).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([440, 280, 'webp']);
  });

  it('ドールも切り抜かれる', () => {
    expect(doll().image.box).toEqual({ x: 320, y: 112, w: 384, h: 800 });
  });

  it('切り抜いた画像は元の画素と同じ（劣化なし）', async () => {
    const { data } = await sharp(path.join(outDir, item('test/トップス/red').image.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(Array.from(data.subarray(0, 4))).toEqual([255, 0, 0, 255]);
  });

  it('カテゴリの重ね順・並び順がフォルダ名どおり', () => {
    const cat = (id: string) => doll().categories.find((c) => c.id === id);
    expect(cat('トップス')).toMatchObject({ layer: 4, menuOrder: 1, overlap: false, movable: false });
    expect(cat('ボトムス')).toMatchObject({ layer: 3, menuOrder: 2 });
    expect(cat('かざり')).toMatchObject({ layer: 11, menuOrder: 9, overlap: true, movable: true });
  });

  it('ファイル名方式: カテゴリと違う重ね順・overlap はアイテムに持つ', () => {
    const flatRed = item('test/トップス/red-2');
    expect(flatRed.layer).toBe(5);
    expect(item('test/トップス/red').layer).toBeUndefined();
    const ribbon = item('test/アクセサリー/リボン');
    expect(ribbon.name).toBe('リボン'); // 先頭のアンダースコアは付かない
    const cat = doll().categories.find((c) => c.id === 'アクセサリー');
    expect(cat?.layer === 12 || ribbon.layer === 12).toBe(true);
    expect(cat?.overlap === true || ribbon.overlap === true).toBe(true);
  });

  it('同じ名前の服が 2 つあっても ID が衝突しない', () => {
    const ids = doll().items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('test/トップス/red');
    expect(ids).toContain('test/トップス/red-2');
  });

  it('規則に合わない名前はアクセサリー・重ね順 20 に入り、警告に出る', () => {
    const odd = item('test/アクセサリー/なまえだけ');
    const cat = doll().categories.find((c) => c.id === 'アクセサリー');
    expect(odd.layer ?? cat?.layer).toBe(20);
    expect(report.warnings.some((w) => w.includes('なまえだけ'))).toBe(true);
  });

  it('不透明な緑背景の服は自動で透明になり、警告に出る', async () => {
    const opaque = item('test/トップス/opaque');
    expect(opaque.image.box).toEqual({ x: 292, y: 240, w: 440, h: 280 });
    expect(report.warnings.some((w) => w.includes('opaque') && w.includes('透明'))).toBe(true);
  });

  it('2048px の服は 1024px 基準に縮小される', () => {
    const big = item('test/トップス/big');
    expect(big.image.canvasW).toBe(1024);
    // 縮小のにじみで縁が 1px 広がることがある
    const { x, y, w, h } = big.image.box;
    expect(Math.abs(x - 400)).toBeLessThanOrEqual(1);
    expect(Math.abs(y - 300)).toBeLessThanOrEqual(1);
    expect(Math.abs(w - 200)).toBeLessThanOrEqual(2);
    expect(Math.abs(h - 100)).toBeLessThanOrEqual(2);
  });

  it('サムネイルは長辺 192px', async () => {
    const meta = await sharp(path.join(outDir, item('test/トップス/red').thumb)).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(192);
  });

  it('背景は JPEG で、専用と共通に分かれる', async () => {
    expect(doll().backgrounds[0].file).toMatch(/\.jpg$/);
    expect(manifest.backgrounds[0].name).toBe('shared');
    const meta = await sharp(path.join(outDir, doll().backgrounds[0].file)).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('手作りサムネイルとバックアップは服として取り込まない', () => {
    expect(doll().items.some((i) => i.name.includes('サムネ'))).toBe(false);
  });

  it('壊れた画像は飛ばして警告に出し、他は処理する', () => {
    expect(doll().items.some((i) => i.name === 'broken')).toBe(false);
    expect(report.warnings.some((w) => w.includes('broken'))).toBe(true);
    expect(doll().items.some((i) => i.name === 'green')).toBe(true);
  });

  it('画像ファイル名は内容のハッシュ（16 桁）', () => {
    expect(item('test/トップス/red').image.file).toMatch(/^files\/[0-9a-f]{16}\.webp$/);
  });

  it('同じ入力で 2 回実行すると同じ一覧ファイルになる', async () => {
    const out2 = path.join(root, 'out2');
    await buildContent(presetDir, out2);
    expect(await readManifest(out2)).toEqual(await readManifest(outDir));
  }, 120_000);

  it('doll フォルダが 1 つも無ければ Error', async () => {
    const empty = path.join(root, 'empty');
    await fs.mkdir(empty, { recursive: true });
    await expect(buildContent(empty, path.join(root, 'out3'))).rejects.toThrow();
  });
});
