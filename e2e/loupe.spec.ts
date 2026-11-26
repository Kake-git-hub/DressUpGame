/**
 * E2E: スマホ縦の調整画面の「虫めがね」（v0.44.0）と、タップで着せる（縦）
 */
import { test, expect, type Page } from '@playwright/test';

const APP_URL = '/DressUpGame/?content=e2e-content/&home=0';
type Box = { x: number; y: number; width: number; height: number };
const centerOf = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const box = async (page: Page, testId: string): Promise<Box> => (await page.getByTestId(testId).boundingBox())!;

async function openPhone(page: Page, width = 390, height = 844) {
  await page.setViewportSize({ width, height });
  await page.goto(APP_URL);
  await expect(page.getByTestId('portrait-categories')).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await page.getByTestId('avatar-canvas').boundingBox())?.y).toBe(0);
}
// 縦のメニューで、服のタイルをタップして着る
async function tapItem(page: Page, category: string, name: string) {
  await page.getByTestId('portrait-categories').getByRole('button', { name: category }).click();
  const b = (await page.getByTestId('portrait-items').locator(`img[alt="${name}"]`).boundingBox())!;
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}

test('縦のメニューでも、タップで着る', async ({ page }) => {
  await openPhone(page);
  await tapItem(page, 'トップス', 'red');
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('dressup_outfit') ?? '[]') as unknown[]).length)).toBe(1);
});

test('虫めがね: ドールの下にあり、左に重なりの一覧（下をそろえる）。なぞると、服は虫めがねの中で指に付いて動く', async ({ page }) => {
  await openPhone(page);
  await tapItem(page, 'トップス', 'red');
  await tapItem(page, 'ボトムス', 'green');
  await page.getByTestId('adjust-button').click();
  const loupe = page.getByTestId('adjust-loupe');
  await expect(loupe).toBeVisible();
  const L = await box(page, 'adjust-loupe');
  const canvas = await box(page, 'avatar-canvas');
  const bar = (await page.locator('.item-adjust-top-buttons').boundingBox())!;
  const picker = await box(page, 'adjust-picker');
  expect(L.y).toBeGreaterThanOrEqual(canvas.y + canvas.height - 0.5);
  expect(L.y + L.height).toBeLessThanOrEqual(bar.y);
  expect(L.x).toBeGreaterThanOrEqual(picker.x + picker.width);
  expect(L.x - (picker.x + picker.width)).toBeLessThanOrEqual(12); // すき間は小さい
  expect(L.x + L.width).toBeLessThanOrEqual(390);
  expect(Math.abs(picker.y + picker.height - (L.y + L.height))).toBeLessThanOrEqual(2); // 下がそろう
  // 中の服と枠。つまみは大きい（56px）
  await expect(page.getByTestId('loupe-preview')).toBeVisible();
  for (const id of ['loupe-sticker-remove', 'loupe-sticker-rotate', 'loupe-sticker-scale']) {
    const h = await box(page, id);
    expect(Math.round(h.width), id).toBe(56);
  }
  // 倍率 = 虫めがねの枠 ÷ 上の枠
  const small0 = await box(page, 'sticker-frame');
  const big0 = await box(page, 'loupe-sticker-frame');
  const zoom = big0.width / small0.width;
  expect(zoom).toBeGreaterThanOrEqual(1.5);
  expect(zoom).toBeLessThanOrEqual(2.5);
  // 虫めがねの中で 40px 右へなぞる → 虫めがねの中で 40px、上のドールでは 40 / 倍率
  const start = centerOf(big0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 40, start.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await box(page, 'loupe-sticker-frame')).x - big0.x).toBeCloseTo(40, 0);
  expect((await box(page, 'sticker-frame')).x - small0.x).toBeCloseTo(40 / zoom, 0);
  // 上のドールの上でなぞると、いままでどおり同じだけ動く
  const small1 = await box(page, 'sticker-frame');
  const c1 = centerOf(small1);
  await page.mouse.move(c1.x, c1.y);
  await page.mouse.down();
  await page.mouse.move(c1.x - 30, c1.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await box(page, 'sticker-frame')).x - small1.x).toBeCloseTo(-30, 0);
});

test('虫めがね: 大きなつまみで大きさ（向きは変わらない）と向きを変えられる。服が外へ出ると、まん中に戻る', async ({ page }) => {
  await openPhone(page);
  await tapItem(page, 'トップス', 'red');
  await page.getByTestId('adjust-button').click();
  await expect(page.getByTestId('adjust-loupe')).toBeVisible();
  const small0 = await box(page, 'sticker-frame');
  const big = await box(page, 'loupe-sticker-frame');
  const c = centerOf(big);
  // 右下のつまみを、中心から見て 1.2 倍の所へ
  const s = centerOf(await box(page, 'loupe-sticker-scale'));
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(c.x + (s.x - c.x) * 1.2, c.y + (s.y - c.y) * 1.2, { steps: 6 });
  await page.mouse.up();
  const small1 = await box(page, 'sticker-frame');
  expect(small1.width / small0.width).toBeCloseTo(1.2, 1);
  expect(small1.height / small0.height).toBeCloseTo(1.2, 1);
  // 虫めがねの中で、大きく右へ動かす（外へ出る）→ 離すと、服がまん中に戻る
  const L = await box(page, 'adjust-loupe');
  const from = centerOf(await box(page, 'loupe-sticker-frame'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(L.x + L.width - 2, from.y, { steps: 8 });
  await page.mouse.move(L.x + L.width + 60, from.y, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs(centerOf(await box(page, 'loupe-sticker-frame')).x - (L.x + L.width / 2))).toBeLessThan(40);
});

test('とても低い画面（375×667）では、虫めがねを出さない（いままでの画面）', async ({ page }) => {
  await openPhone(page, 375, 667);
  await tapItem(page, 'トップス', 'red');
  await page.getByTestId('adjust-button').click();
  await expect(page.getByTestId('sticker-frame')).toBeVisible();
  const canvas = await box(page, 'avatar-canvas');
  const bar = (await page.locator('.item-adjust-top-buttons').boundingBox())!;
  const room = bar.y - 8 - (canvas.y + canvas.height + 8);
  await expect(page.getByTestId('adjust-loupe')).toHaveCount(room >= 160 ? 1 : 0);
});

test('横画面・タブレットの縦には、虫めがねは無い', async ({ page }) => {
  for (const [w, h] of [[1180, 820], [820, 1180]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(APP_URL);
    await expect(page.locator('.app')).toHaveAttribute('data-phone', 'false');
    await expect(page.getByTestId('adjust-button')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('adjust-button').click();
    await expect(page.locator('.item-adjust-overlay')).toBeVisible();
    await expect(page.getByTestId('adjust-loupe')).toHaveCount(0);
    await page.locator('.item-adjust-done-btn-small').click();
  }
});
