/**
 * E2Eテスト: こうかん（クローゼットから）。裏側は、端末の中だけで動く偽物（にせの あいて）
 */
import { test, expect, type Page } from '@playwright/test';
import { dismissReveal, openHome, openStudio, order, play } from './helpers';
import type { FakeOptions } from './helpers';

const PARTNER_ITEM = 'にせの ふく';
const MINE = 'うみのトップス';

async function makeItem(page: Page) {
  await openStudio(page);
  await order(page, { label: 'トップス' }, 'うみ');
  await expect(page.getByTestId('studio-job')).toHaveCount(0, { timeout: 15_000 });
  await dismissReveal(page);
  await page.getByTestId('studio-close').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
}
async function openTrade(page: Page) {
  await page.getByTestId('home-closet').click();
  await expect(page.getByTestId('closet')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('closet-trade').click();
  await expect(page.getByTestId('trade')).toBeVisible();
}
// 服を 1 点持って、こうかんの画面を開く
async function ready(page: Page, options: FakeOptions = {}) {
  await openHome(page, options);
  await makeItem(page);
  await openTrade(page);
}

test('QR を だす: あいてが よんで えらぶ → こうかんする → できた。クローゼットとゲームのメニューに にせの ふく', async ({ page }) => {
  await ready(page, { partner: { claimAfterMs: 600, chooseMs: 3000, acceptAfterMs: 500 } });
  await page.getByTestId('trade-show').click();
  await page.getByTestId('trade-pick-item').first().click();
  await expect(page.getByTestId('trade-qr')).toBeVisible();
  await expect(page.getByTestId('trade-partner-choosing')).toContainText('あいてが ふくを えらんでいるよ', { timeout: 15_000 });
  await expect(page.getByTestId('trade-confirm')).toContainText('こうかんする？', { timeout: 15_000 });
  await expect(page.getByTestId('trade-confirm')).toContainText(PARTNER_ITEM);
  await page.getByTestId('trade-accept').click();
  await expect(page.getByTestId('trade-done')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('trade-done')).toContainText('NEW');
  await page.getByTestId('trade-to-closet').click();
  await expect(page.getByTestId('trade')).toHaveCount(0);
  const items = page.getByTestId('closet-item');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(PARTNER_ITEM);
  await expect(items.first()).not.toContainText(MINE);
  await expect(page.getByTestId('closet-new')).toHaveCount(1);
  await page.getByTestId('closet-close').click();
  await play(page);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await expect(page.locator(`.palette-section img[alt="${PARTNER_ITEM}"]`)).toBeVisible();
  await expect(page.locator(`.palette-section img[alt="${MINE}"]`)).toHaveCount(0);
});

test('QR を よむ: テスト用の入力に FAKE → えらぶ → こうかんする → できた', async ({ page }) => {
  await ready(page);
  await page.getByTestId('trade-scan').click();
  await page.getByTestId('trade-scan-test').fill('FAKE');
  await page.getByTestId('trade-scan-test').press('Enter');
  await page.getByTestId('trade-pick-item').first().click();
  await expect(page.getByTestId('trade-confirm')).toContainText('こうかんする？', { timeout: 15_000 });
  await page.getByTestId('trade-accept').click();
  await expect(page.getByTestId('trade-done')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('trade-to-closet').click();
  await expect(page.getByTestId('closet-item').first()).toContainText(PARTNER_ITEM);
});

test('あいてが やめる: 「やめに なったよ」。服は そのまま', async ({ page }) => {
  await ready(page, { partner: { cancelAfterMs: 1200, claimAfterMs: 10_000 } });
  await page.getByTestId('trade-show').click();
  await page.getByTestId('trade-pick-item').first().click();
  await expect(page.getByTestId('trade-ended')).toContainText('やめに なったよ', { timeout: 15_000 });
  await page.getByTestId('trade-close').click();
  await expect(page.getByTestId('closet-item')).toHaveCount(1);
  await expect(page.getByTestId('closet-item').first()).toContainText(MINE);
});

test('よめなかったとき: 「もういちど よんでね」', async ({ page }) => {
  await ready(page, { partner: { refuse: 'expired' } });
  await page.getByTestId('trade-scan').click();
  await page.getByTestId('trade-scan-test').fill('FAKE');
  await page.getByTestId('trade-scan-test').press('Enter');
  await expect(page.getByTestId('trade-message')).toContainText('もういちど よんでね');
});

test('サーバーが古いとき: そう出る。カメラは開かない', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __camera: number }).__camera = 0;
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = () => {
      (window as unknown as { __camera: number }).__camera++;
      return Promise.reject(new DOMException('', 'NotAllowedError'));
    };
  });
  await ready(page, { noTrade: true });
  await expect(page.getByTestId('trade-old-server')).toContainText('サーバーが ふるい はんです');
  await expect(page.getByTestId('trade-show')).toHaveCount(0);
  await expect(page.getByTestId('trade-scan')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __camera: number }).__camera)).toBe(0);
});

test('交換できる服が無いとき: そう出る', async ({ page }) => {
  await openHome(page);
  await openTrade(page);
  await expect(page.getByTestId('trade-no-items')).toContainText('こうかんできる ふくが ないよ');
});

test('カメラを断ったとき: 理由が出る。テスト用の入力も出ている', async ({ page }) => {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (md) md.getUserMedia = () => Promise.reject(new DOMException('', 'NotAllowedError'));
  });
  await ready(page);
  await page.getByTestId('trade-scan').click();
  await expect(page.getByTestId('trade-camera-error')).toContainText('カメラを つかえないよ');
  await expect(page.getByTestId('trade-scan-test')).toBeVisible();
});
