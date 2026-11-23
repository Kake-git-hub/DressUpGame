/**
 * E2Eテスト: ホーム画面（だれにでも出る。「つくる」「クローゼット」は、教えた端末にだけ）
 */
import { test, expect } from '@playwright/test';

const APP = '/DressUpGame/?content=e2e-content/';
const gameReady = (page: import('@playwright/test').Page) => expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible({ timeout: 60_000 });

test('だれでも、開くとホーム。あそぶでゲーム、🏠 でもどる', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('home-play').click();
  await gameReady(page);
  await expect(page.getByTestId('home-screen')).toHaveCount(0);
  await page.getByTestId('home-back-button').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  // 次に開いても、ホームから
  await page.goto(APP);
  await expect(page.getByTestId('home-screen')).toBeVisible();
});

test('教えていない端末には、つくる・クローゼット・アカウントのボタンが無い。Firebase の部品も、つなぎ役も読み込まない', async ({ page }) => {
  const scripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });
  await page.goto(APP);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByTestId('home-play')).toBeVisible();
  await expect(page.getByTestId('home-share')).toBeVisible();
  await expect(page.getByTestId('home-create')).toHaveCount(0);
  await expect(page.getByTestId('home-closet')).toHaveCount(0);
  await expect(page.getByTestId('home-account')).toHaveCount(0);
  await page.getByTestId('home-play').click();
  await gameReady(page);
  // ゲームの画面にも、「つくる」の入口は無い
  await expect(page.getByTestId('studio-button')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(scripts.filter((url) => /firebase|boot-|appStudio|session/i.test(url))).toEqual([]);
});

test('「つくる」を教えた端末（?studio=fake）には、つくる・クローゼットがある。ゲームの画面に ✨ は無い', async ({ page }) => {
  await page.goto(`${APP}&studio=fake`);
  await expect(page.getByTestId('home-create')).toBeVisible();
  await expect(page.getByTestId('home-closet')).toBeVisible();
  // 覚えているので、次に開いたときも出る
  await page.goto(APP);
  await expect(page.getByTestId('home-create')).toBeVisible();
  await page.getByTestId('home-play').click();
  await gameReady(page);
  await expect(page.getByTestId('studio-button')).toHaveCount(0);
  await expect(page.getByTestId('home-back-button')).toBeVisible();
  // 「つくる」は、保護者の確認なしで開く（販売を始めるまで）。閉じると、ホームにもどる
  await page.getByTestId('home-back-button').click();
  await page.getByTestId('home-create').click();
  await expect(page.getByTestId('adult-gate')).toHaveCount(0);
  await expect(page.getByTestId('app-studio')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('studio-close').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  // ?studio=0 で、ボタンが消える
  await page.goto(`${APP}&studio=0`);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByTestId('home-create')).toHaveCount(0);
});

test('?home=0 は、その読み込みだけ、すぐゲーム（覚えない）', async ({ page }) => {
  await page.goto(`${APP}&home=0`);
  await gameReady(page);
  await expect(page.getByTestId('home-screen')).toHaveCount(0);
  await page.goto(APP);
  await expect(page.getByTestId('home-screen')).toBeVisible();
});

test('縦でも、ホームのボタンが全部、画面に収まる（スマホ・「つくる」を教えた端末）', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${APP}&studio=fake`);
  for (const id of ['home-play', 'home-create', 'home-closet', 'home-share']) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, id).not.toBeNull();
    expect(box!.y, id).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height, id).toBeLessThanOrEqual(667);
  }
});

test('ともだちにおしえる: QR コードを出し、URL をコピーする', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(APP);
  await page.getByTestId('home-share').click();
  await expect(page.getByTestId('home-share-qr').locator('svg')).toBeVisible();
  await expect(page.getByTestId('home-share-status')).toHaveText('URL をコピーしたよ！');
  const url = 'http://localhost:4173/DressUpGame/';
  await expect(page.getByTestId('home-share-url')).toHaveText(url);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await page.getByTestId('home-share-close').click();
  await expect(page.getByTestId('home-share-dialog')).toHaveCount(0);
});
