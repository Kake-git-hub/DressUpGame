/**
 * E2Eテスト: 取り込み → 着せる → 調整 → 再読み込みで復元 → 写真
 * テスト用プリセット（e2e/fixtures/makePreset.ts）を毎回生成して使う
 */
import { test, expect, type Page } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { makePreset } from './fixtures/makePreset';

type Rgba = [number, number, number, number];

// 画面とレイアウト（App.tsx / PixiEngine.ts と同じ計算）
const VIEW_W = 1180;
const VIEW_H = 820;
const MENU_W = 160;
const RIGHT_W = 60;
const IMG = 1024; // テスト画像の一辺
const BASE_SCALE = (VIEW_H * 0.9) / 1024; // ドール・服の表示倍率
const DOLL_X = MENU_W + (VIEW_W - MENU_W - RIGHT_W) / 2; // ドール中心X
const DOLL_Y = VIEW_H / 2; // ドール中心Y
const imgY = (y: number) => DOLL_Y + (y - IMG / 2) * BASE_SCALE;
const TOP_Y = imgY(380); // トップス(y=240〜520)の中央
const BOTTOM_Y = imgY(660); // ボトムス(y=520〜800)の中央
const BG_Y = 20; // ドールの外（背景だけが見える位置）
const ADJUST_DX = 220; // 調整で動かす量（服の幅の半分より大きい）

const SKIN: Rgba = [255, 224, 192, 255];
const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const GREEN: Rgba = [0, 160, 0, 255];
const BG: Rgba = [255, 255, 128, 255];

let presetPath = '';

test.beforeAll(async () => {
  presetPath = path.join(os.tmpdir(), `dressup-e2e-preset-${process.pid}.zip`);
  await makePreset(presetPath);
});

test.afterAll(async () => {
  await fs.rm(presetPath, { force: true });
});

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto('/DressUpGame/');
  await page.waitForSelector('.app');
});

function near(a: Rgba, b: Rgba, tolerance = 8): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
}

/** #avatar-canvas の1画素を読む（座標はビューポートのCSSピクセル） */
async function canvasPixel(page: Page, x: number, y: number): Promise<Rgba> {
  return page.evaluate(
    ([px, py]) => {
      const src = document.querySelector('#avatar-canvas') as HTMLCanvasElement | null;
      if (!src) return [0, 0, 0, 0] as [number, number, number, number];
      const rect = src.getBoundingClientRect();
      const sx = Math.round(((px - rect.left) / rect.width) * src.width);
      const sy = Math.round(((py - rect.top) / rect.height) * src.height);
      const out = document.createElement('canvas');
      out.width = 1;
      out.height = 1;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(src, sx, sy, 1, 1, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3]] as [number, number, number, number];
    },
    [x, y]
  );
}

async function expectPixel(page: Page, x: number, y: number, color: Rgba): Promise<void> {
  await expect
    .poll(async () => near(await canvasPixel(page, x, y), color), {
      message: `(${Math.round(x)}, ${Math.round(y)}) が ${color.join(',')} になる`,
      timeout: 20_000,
    })
    .toBe(true);
}

async function waitForMenu(page: Page): Promise<void> {
  await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible({ timeout: 60_000 });
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
}

/** 設定からテスト用ZIPを取り込み、メニューにカテゴリが出るまで待つ */
async function importPreset(page: Page): Promise<void> {
  await page.click('.settings-button');
  await page.setInputFiles('input[accept=".zip"]', presetPath);
  await page.waitForFunction(
    () => (localStorage.getItem('dressup_custom_clothing') ?? '').length > 10,
    null,
    { timeout: 60_000 }
  );
  await page.reload();
  await page.waitForSelector('.app');
  await waitForMenu(page);
}

async function openCategory(page: Page, category: string): Promise<void> {
  await page.locator('.palette-section button', { hasText: category }).first().click();
  await expect(page.locator('.palette-section button', { hasText: 'もどる' })).toBeVisible();
}

async function backToCategories(page: Page): Promise<void> {
  const back = page.locator('.palette-section button', { hasText: 'もどる' });
  if (await back.isVisible()) await back.click();
  await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible();
}

async function itemCenter(page: Page, index: number): Promise<{ x: number; y: number }> {
  const box = await page.locator('.palette-section img').nth(index).boundingBox();
  if (!box) throw new Error(`item ${index} not found`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** カテゴリを開いて index 番目のアイテムをドールへドラッグし、カテゴリ一覧へ戻る */
async function dragItemToDoll(page: Page, category: string, index: number): Promise<void> {
  await openCategory(page, category);
  const from = await itemCenter(page, index);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, DOLL_Y, { steps: 4 });
  await page.mouse.up();
  await backToCategories(page);
}

test('取り込み → 着せる → 着替え → 再読み込みで復元', async ({ page }) => {
  await importPreset(page);
  await dragItemToDoll(page, 'トップス', 0);
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await dragItemToDoll(page, 'トップス', 1); // 同カテゴリは入れ替え
  await expectPixel(page, DOLL_X, TOP_Y, BLUE);
  await dragItemToDoll(page, 'ボトムス', 0);
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);

  await page.reload();
  await page.waitForSelector('.app');
  await expectPixel(page, DOLL_X, TOP_Y, BLUE);
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
});

test('タップだけでは着ない（現状の動作）', async ({ page }) => {
  await importPreset(page);
  await openCategory(page, 'トップス');
  const at = await itemCenter(page, 0);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(800);
  expect(near(await canvasPixel(page, DOLL_X, TOP_Y), SKIN)).toBe(true);
});

test('「なし」で脱げる', async ({ page }) => {
  await importPreset(page);
  await dragItemToDoll(page, 'トップス', 0);
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await openCategory(page, 'トップス');
  await page.locator('.palette-section button', { hasText: 'なし' }).click();
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
});

test('調整: 動かして完了すると位置が変わり、再読み込み後も保たれる', async ({ page }) => {
  await importPreset(page);
  await dragItemToDoll(page, 'トップス', 0);
  await expectPixel(page, DOLL_X, TOP_Y, RED);

  await page.locator('.tool-button').first().click();
  await expect(page.locator('.item-adjust-overlay')).toBeVisible();
  await page.mouse.move(DOLL_X, DOLL_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X + ADJUST_DX, DOLL_Y, { steps: 6 });
  await page.mouse.up();
  await page.locator('.item-adjust-done-btn-small').click();

  await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, RED);
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);

  await page.reload();
  await page.waitForSelector('.app');
  await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, RED);
});

test('背景を選ぶと背景色が出て、リセットで服と背景が外れる', async ({ page }) => {
  await importPreset(page);
  await dragItemToDoll(page, 'トップス', 0);
  await expectPixel(page, DOLL_X, TOP_Y, RED);

  await openCategory(page, 'はいけい');
  const at = await itemCenter(page, 0);
  await page.mouse.click(at.x, at.y); // 背景はタップで適用
  await expectPixel(page, DOLL_X, BG_Y, BG);
  await backToCategories(page);

  await page.locator('.reset-button-fixed').click(); // confirm は自動で承認
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
  await expect
    .poll(async () => (await canvasPixel(page, DOLL_X, BG_Y))[3], { timeout: 20_000 })
    .toBe(0);
});

test('写真: ダウンロードされる PNG が空でない', async ({ page }) => {
  await importPreset(page);
  await dragItemToDoll(page, 'トップス', 0);
  await expectPixel(page, DOLL_X, TOP_Y, RED);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.tool-button').nth(1).click(),
  ]);
  const file = await download.path();
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBeGreaterThan(100);
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
  expect(opaque).toBeGreaterThan(1000);
});

test('ドラッグ中に服の再描画と保存が起きない', async ({ page }) => {
  await importPreset(page);
  await dragItemToDoll(page, 'トップス', 0);
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await page.waitForTimeout(1500); // 着せた直後の処理が落ち着くのを待つ

  let redraws = 0;
  page.on('console', (m) => {
    if (m.text().includes('服コンテナをキャッシュしました')) redraws++;
  });
  await page.evaluate(() => {
    const w = window as unknown as { __setItemCalls: number };
    w.__setItemCalls = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      w.__setItemCalls++;
      return original.call(this, key, value);
    };
  });

  await openCategory(page, 'トップス');
  const from = await itemCenter(page, 1);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(from.x + i * 10, from.y + i * 3);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  const setItemCalls = await page.evaluate(
    () => (window as unknown as { __setItemCalls: number }).__setItemCalls
  );
  const redrawsDuringDrag = redraws;
  await page.mouse.up();

  expect(redrawsDuringDrag).toBe(0);
  expect(setItemCalls).toBe(0);
});

test('着ている服の保存は 1 枚 300 バイト以下', async ({ page }) => {
  await importPreset(page);
  await dragItemToDoll(page, 'トップス', 0);
  await dragItemToDoll(page, 'ボトムス', 0);
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => localStorage.getItem('dressup_outfit'));
  expect(saved).not.toBeNull();
  const entries = JSON.parse(saved ?? '[]') as unknown[];
  expect(entries.length).toBe(2);
  expect((saved ?? '').length / entries.length).toBeLessThanOrEqual(300);
});
