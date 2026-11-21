/**
 * E2Eテスト: ホーム画面（作っている途中なので、?home=1 を開いた端末にだけ出る）
 */
import { test, expect } from '@playwright/test';

const APP = '/DressUpGame/?content=e2e-content/';

test('ふつうはホーム画面を出さず、すぐゲームの画面', async ({ page }) => {
  await page.goto(APP);
  await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('home-screen')).toHaveCount(0);
  await expect(page.getByTestId('home-back-button')).toHaveCount(0);
});

test('?home=1: あそぶでゲーム、🏠 でもどる、つくるで保護者の確認なしにスタジオ', async ({ page }) => {
  await page.goto(`${APP}&home=1`);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('home-play').click();
  await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('home-back-button').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();

  // 覚えているので、次に開いたときも出る
  await page.goto(APP);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('home-create').click();
  await expect(page.getByTestId('adult-gate')).toHaveCount(0);
  await expect(page.locator('.studio-overlay')).toBeVisible({ timeout: 60_000 });

  // ?home=0 で消す
  await page.goto(`${APP}&home=0`);
  await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('home-screen')).toHaveCount(0);
});

test('ともだちにおしえる: QR コードを出し、URL をコピーする', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${APP}&home=1`);
  await page.getByTestId('home-share').click();
  await expect(page.getByTestId('home-share-qr').locator('svg')).toBeVisible();
  await expect(page.getByTestId('home-share-status')).toHaveText('URL をコピーしたよ！');
  const url = 'http://localhost:4173/DressUpGame/';
  await expect(page.getByTestId('home-share-url')).toHaveText(url);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.getByTestId('home-share-close').click();
  await expect(page.getByTestId('home-share-dialog')).toHaveCount(0);
});

test('右上のアカウントボタン（中身は準備中）', async ({ page }) => {
  await page.goto(`${APP}&home=1`);
  await page.getByTestId('home-account').click();
  await expect(page.getByTestId('home-account-dialog')).toContainText('じゅんびちゅう');
  await page.getByTestId('home-account-close').click();
  await expect(page.getByTestId('home-account-dialog')).toHaveCount(0);
});

test('つくる: 選択肢はプルダウン、テーマと 📷 は 1 行、色のテーマは 3 つ。顔の無いドールでは 📷 は使えない', async ({ page }) => {
  await page.goto(`${APP}&home=1`);
  await page.getByTestId('home-create').click();
  await expect(page.getByTestId('app-studio')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('studio-target').selectOption({ label: 'セット' });
  await expect(page.getByTestId('studio-set-categories')).toBeVisible();
  const theme = await page.getByTestId('studio-theme').boundingBox();
  const camera = await page.getByTestId('studio-photo-button').boundingBox();
  expect(Math.abs(theme!.y + theme!.height / 2 - (camera!.y + camera!.height / 2))).toBeLessThan(4);
  for (const i of [0, 1, 2]) await expect(page.getByTestId(`studio-color-${i}`)).toBeVisible();
  await page.getByTestId('studio-color-1').fill('#123456');
  await expect(page.getByTestId('studio-color-1')).toHaveValue('#123456');
  // テスト用のドールには「かお」が無いので、📷 は使えない（写真から作れるのは顔だけ）
  await expect(page.getByTestId('studio-photo-input')).toBeDisabled();
});
