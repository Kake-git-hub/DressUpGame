/**
 * E2E: 操作ガイド（v0.44.0）。その場面になったとき、1 回だけ、1 つずつ出す
 */
import { test, expect, type Page } from '@playwright/test';
import { openHome, openStudio } from './helpers';

// このファイルだけ、ガイドを見ていない端末で開く
test.use({ storageState: { cookies: [], origins: [] } });

const APP_URL = '/DressUpGame/?content=e2e-content/&home=0';
const guide = (page: Page) => page.getByTestId('guide');
const seen = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('dressup_guide_seen') ?? '[]') as string[]);

async function finishGuide(page: Page, name: string, texts: string[]) {
  await expect(guide(page)).toHaveAttribute('data-guide', name, { timeout: 20_000 });
  for (const [i, text] of texts.entries()) {
    await expect(page.getByTestId('guide-text')).toHaveText(text);
    await expect(page.getByTestId('guide-next')).toHaveText(i === texts.length - 1 ? 'わかった' : 'つぎへ');
    await page.getByTestId('guide-next').click();
  }
  await expect(guide(page)).toHaveCount(0);
}

test('はじめて遊ぶ → はじめて着る → はじめて調整、の順に 1 回ずつ出る。読み込み直しても、もう出ない', async ({ page }) => {
  await page.goto(APP_URL);
  await finishGuide(page, 'play', ['ここから ふくを えらぼう', 'ふくを タップするか、ドールまで ひっぱると きられるよ']);
  expect(await seen(page)).toEqual(['play']);
  // ガイドが出ているあいだは、下の画面に触れない（幕が受け止める）。いまは消えているので、タップで着る
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  const b = (await page.locator('.palette-section img[alt="red"]').boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await finishGuide(page, 'worn', ['ここを おすと、いちや おおきさを かえられるよ']);
  await page.getByTestId('adjust-button').click();
  await expect(guide(page)).toHaveAttribute('data-guide', 'adjust', { timeout: 20_000 });
  // 横画面: 虫めがねは無いので「ふくを なぞって うごかそう」から
  await expect(page.getByTestId('guide-text')).toHaveText('ふくを なぞって うごかそう');
  await page.getByTestId('guide-skip').click();
  await expect(guide(page)).toHaveCount(0);
  expect((await seen(page)).sort()).toEqual(['adjust', 'play', 'worn']);
  await page.locator('.item-adjust-done-btn-small').click();
  await page.reload();
  await expect(page.getByTestId('adjust-button')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  await expect(guide(page)).toHaveCount(0);
});

test('スマホの縦: 調整のガイドは、虫めがね → 回す → 大きさ → 重なり → リセット → ✓', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    if (!localStorage.getItem('dressup_guide_seen')) localStorage.setItem('dressup_guide_seen', '["play","worn"]');
  });
  await page.goto(APP_URL);
  await expect(page.getByTestId('portrait-categories')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('portrait-categories').getByRole('button', { name: 'トップス' }).click();
  const b = (await page.getByTestId('portrait-items').locator('img[alt="red"]').boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.getByTestId('adjust-button').click();
  await finishGuide(page, 'adjust', [
    'この なかを なぞると、ふくが うごくよ',
    'ひっぱって まわそう',
    'ひっぱって おおきさを かえよう',
    'かさなりの じゅんばん。▲で まえへ、▼で うしろへ',
    'ぜんぶ もとに もどすよ',
    'おわったら ここを おしてね',
  ]);
});

test('ホームの「つかいかた」で、ガイドがまた出る', async ({ page }) => {
  await page.goto(APP_URL);
  await expect(guide(page)).toHaveAttribute('data-guide', 'play', { timeout: 20_000 });
  await page.getByTestId('guide-skip').click();
  await page.getByTestId('home-back-button').click();
  await page.getByTestId('home-guide').click();
  await expect(page.getByTestId('home-guide')).toHaveText('つかいかたを また だすよ');
  expect(await seen(page)).toEqual([]);
  await page.getByTestId('home-play').click();
  await expect(guide(page)).toHaveAttribute('data-guide', 'play', { timeout: 20_000 });
});

test('はじめて「つくる」を開いたとき', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('dressup_guide_seen')) localStorage.setItem('dressup_guide_seen', '["play","worn","adjust"]');
  });
  await openHome(page);
  await openStudio(page);
  await finishGuide(page, 'studio', ['えを タップして すすもう', 'ふく 1てんで、チケット 1まい つかうよ']);
});
