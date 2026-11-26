/**
 * E2E: クローゼットで、自分の服の「はじめの位置」を決める（v0.45.0）。裏側は、端末の中だけで動く偽物
 */
import { test, expect, type Page } from '@playwright/test';
import { dismissReveal, fakeState, openHome, openStudio, order, play, wear } from './helpers';

type Fit = { x: number; y: number; scale: number; rotation: number };
const savedFit = async (page: Page) => ((await fakeState(page))!.items[0] as unknown as { fit?: Fit }).fit;

// 「つくる」で 1 点作って、クローゼットのその服の画面を開く
async function openClosetItem(page: Page) {
  await openStudio(page);
  await order(page, { label: 'トップス' }, 'うみ');
  await expect(page.getByTestId('studio-job')).toHaveCount(0, { timeout: 15_000 });
  await dismissReveal(page);
  await page.getByTestId('studio-close').click();
  await page.getByTestId('home-closet').click();
  await page.getByTestId('closet-item').first().click({ timeout: 60_000 });
  await expect(page.getByTestId('closet-item-sheet')).toBeVisible();
}
// 調整画面で、服をなぞって動かす
async function dragFrame(page: Page, testId: string, dx: number, dy: number) {
  const f = (await page.getByTestId(testId).boundingBox())!;
  await page.mouse.move(f.x + f.width / 2, f.y + f.height / 2);
  await page.mouse.down();
  await page.mouse.move(f.x + f.width / 2 + dx, f.y + f.height / 2 + dy, { steps: 6 });
  await page.mouse.up();
}

test('いちを きめる → 動かして ✓ → 覚える。着せると、その位置から始まる。もとに もどす で消える', async ({ page }) => {
  await openHome(page);
  await openClosetItem(page);
  await expect(page.getByTestId('closet-fit-reset')).toHaveCount(0);
  await page.getByTestId('closet-fit').click();
  await expect(page.getByTestId('fit-editor')).toBeVisible();
  // 色の帯・重なりの一覧・× は無い
  await expect(page.locator('.hue-slider-vertical')).toHaveCount(0);
  await expect(page.getByTestId('adjust-picker')).toHaveCount(0);
  await expect(page.getByTestId('sticker-remove')).toHaveCount(0);
  await dragFrame(page, 'sticker-frame', 60, 0);
  await page.locator('.item-adjust-done-btn-small').click();
  await expect(page.getByTestId('fit-editor')).toHaveCount(0);
  await expect.poll(async () => (await savedFit(page))?.x ?? 0).toBeGreaterThan(10);
  const fit = (await savedFit(page))!;
  expect(fit.y).toBeCloseTo(0, 0);
  // クローゼットの見本も、動いた位置
  await expect(page.getByTestId('closet-stage').locator('[data-fit]')).toHaveCount(1);
  await expect(page.getByTestId('closet-fit-reset')).toBeVisible();
  await page.getByTestId('closet-item-done').click();
  await page.getByTestId('closet-close').click();
  // 着せると、はじめの位置から（保存した着せ替えの位置 = はじめの位置）
  await play(page);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await wear(page, 'うみのトップス');
  await expect
    .poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('dressup_outfit') ?? '[]') as { adjustOffsetX?: number }[]).map((e) => e.adjustOffsetX ?? 0)))
    .toEqual([fit.x]);
  // 調整画面のリセットは、はじめの位置にもどす（もとの位置ではない）
  await page.getByTestId('adjust-button').click();
  const before = (await page.getByTestId('sticker-frame').boundingBox())!;
  await dragFrame(page, 'sticker-frame', -80, 40);
  await page.getByTestId('adjust-reset').click();
  await expect.poll(async () => Math.round((await page.getByTestId('sticker-frame').boundingBox())!.x)).toBe(Math.round(before.x));
  await page.locator('.item-adjust-done-btn-small').click();
  // もとに もどす
  await page.getByTestId('home-back-button').click();
  await page.getByTestId('home-closet').click();
  await page.getByTestId('closet-item').first().click();
  await page.getByTestId('closet-fit-reset').click();
  await expect.poll(() => savedFit(page)).toBeUndefined();
  await expect(page.getByTestId('closet-fit-reset')).toHaveCount(0);
});

test('やめる: 何も覚えない', async ({ page }) => {
  await openHome(page);
  await openClosetItem(page);
  await page.getByTestId('closet-fit').click();
  await dragFrame(page, 'sticker-frame', 60, 30);
  await page.getByTestId('fit-cancel').click();
  await expect(page.getByTestId('fit-editor')).toHaveCount(0);
  expect(await savedFit(page)).toBeUndefined();
});

test('サーバーが古いときは、いちを きめるを押せず、理由が出る', async ({ page }) => {
  await openHome(page, { noFit: true });
  await openClosetItem(page);
  await expect(page.getByTestId('closet-fit-old')).toBeVisible();
  await expect(page.getByTestId('closet-fit')).toBeDisabled();
});

test('スマホの縦: 決める画面にも虫めがねが出て、虫めがねの中で動かせる', async ({ page }) => {
  await openHome(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await openClosetItem(page);
  await page.getByTestId('closet-fit').click();
  await expect(page.getByTestId('adjust-loupe')).toBeVisible();
  const head = (await page.locator('.fit-editor-head').boundingBox())!;
  expect(head.height).toBeLessThan(60); // 1 行に収まる
  await dragFrame(page, 'loupe-sticker-frame', 50, 0);
  await page.locator('.item-adjust-done-btn-small').click();
  await expect.poll(async () => (await savedFit(page))?.x ?? 0).toBeGreaterThan(5);
});
