/**
 * E2Eテスト: 服が届いた演出（クローゼットが開く）。裏側は、端末の中だけで動く偽物
 */
import { test, expect, type Page } from '@playwright/test';
import { APP, DOLL_X, FIRST, FIRST_Y, SECOND, SECOND_Y, VIEW_H, expectPixel, fakeState, gameReady, openHome, openStudio, order, play } from './helpers';

const reveal = (page: Page) => page.getByTestId('reveal');
// ホームやゲームの画面では、進み具合を聞くのは 30 秒おき（つくる・クローゼットを開いている間は 3 秒おき）
const ARRIVE = { timeout: 45_000 };
// 「つくる」で注文して、ホームにもどる（できあがる前に）
async function orderAndGoHome(page: Page, target: string | { label: string } = { label: 'トップス' }, theme = 'うみ') {
  await openStudio(page);
  await order(page, target, theme);
  await page.getByTestId('studio-close').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
}

test('ホームで待っていると、できたときに演出が出る。とじると、もう出ない（読み込み直しても）', async ({ page }) => {
  await openHome(page, { delayMs: 2500 });
  await orderAndGoHome(page);
  await expect(reveal(page)).toHaveCount(0);
  await expect(reveal(page)).toBeVisible(ARRIVE);
  await expect(reveal(page)).toHaveAttribute('data-kind', 'arrived');
  await expect(reveal(page)).toContainText('あたらしい ふくが とどいたよ！');
  await expect(page.getByTestId('reveal-name')).toHaveText('うみのトップス');
  await expect(page.getByTestId('reveal-stage')).toBeVisible();
  // 届いた服の絵が、ドールの上に出る
  await expect(page.getByTestId('reveal-stage').locator('img[data-preview]')).toHaveCount(1);
  await page.getByTestId('reveal-close').click();
  await expect(reveal(page)).toHaveCount(0);
  // サーバーに「見た」の印が付く
  await expect.poll(async () => (await fakeState(page))!.seen).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(reveal(page)).toHaveCount(0);
});

test('閉じている間にできた分は、次に開いたときに出る', async ({ page }) => {
  await openHome(page, { delayMs: 2000 });
  await orderAndGoHome(page);
  await page.goto('about:blank');
  await page.waitForTimeout(3000);
  await page.goto(APP);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(reveal(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reveal-name')).toHaveText('うみのトップス');
});

test('ゲームで遊んでいる最中でも出る。服をドラッグしている間は出ず、離すと出る。とじると、着ていた服はそのまま', async ({ page }) => {
  await openHome(page, { delayMs: 3500 });
  await orderAndGoHome(page);
  await play(page);
  // 公開の服（red）をつかんで、ドールの上まで運び、そのまま持っている
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  const tile = page.locator('.palette-section img[alt="red"]').first();
  await expect(tile).toBeVisible();
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, VIEW_H / 2, { steps: 4 });
  // 持っている間に、できあがる。演出は、まだ出ない
  await expect.poll(async () => (await fakeState(page))!.jobs[0].done, { timeout: 15_000 }).toBe(true);
  await page.waitForTimeout(4000); // 30 秒おきの聞き直しを待たずに済むよう、すぐ下で確かめる
  await expect(reveal(page)).toHaveCount(0);
  // 離すと、服が着て、演出が出る
  await page.mouse.up();
  await expect(reveal(page)).toBeVisible({ timeout: 40_000 });
  await page.getByTestId('reveal-close').click();
  await expect(reveal(page)).toHaveCount(0);
  // 遊んでいた画面に、そのままもどる（着せた red は、着たまま）
  await expectPixel(page, DOLL_X, 400, [255, 0, 0]);
});

test('きせてみる: ゲームの画面になり、届いた服を着ている', async ({ page }) => {
  await openHome(page, { delayMs: 2000 });
  await orderAndGoHome(page);
  await expect(reveal(page)).toBeVisible(ARRIVE);
  await page.getByTestId('reveal-try').click();
  await expect(reveal(page)).toHaveCount(0);
  await gameReady(page);
  await expect(page.getByTestId('home-screen')).toHaveCount(0);
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
});

test('クローゼットをみる: クローゼットが開き、届いた服に NEW が付いている', async ({ page }) => {
  await openHome(page, { delayMs: 2000 });
  await orderAndGoHome(page);
  await expect(reveal(page)).toBeVisible(ARRIVE);
  await page.getByTestId('reveal-closet').click();
  await expect(reveal(page)).toHaveCount(0);
  await expect(page.getByTestId('closet')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('closet-item')).toHaveCount(1);
  await expect(page.getByTestId('closet-new')).toHaveCount(1);
});

test('セット: 全部そろってから 1 回だけ出て、全部を着た絵。きせてみるで、全部着る', async ({ page }) => {
  await openHome(page, { delayMs: 1200 });
  await openStudio(page);
  await page.getByTestId('studio-target').selectOption({ label: 'セット' });
  const checks = page.getByTestId('studio-set-categories').locator('input[type=checkbox]');
  for (let i = 0; i < (await checks.count()); i++) await checks.nth(i).uncheck();
  await page.getByTestId('studio-set-categories').getByText('トップス').click();
  await page.getByTestId('studio-set-categories').getByText('ボトムス').click();
  await page.getByTestId('studio-theme').fill('うみ');
  await page.getByTestId('studio-make').click();
  await page.getByTestId('order-ok').click({ timeout: 15_000 });
  // 1 点目ができても、まだ出ない
  await expect.poll(async () => (await fakeState(page))!.items.length, { timeout: 15_000 }).toBe(1);
  await expect(reveal(page)).toHaveCount(0);
  await expect(reveal(page)).toBeVisible(ARRIVE);
  await expect(page.getByTestId('reveal-name')).toHaveText('うみのセット');
  await expect(page.getByTestId('reveal-stage').locator('img[data-preview]')).toHaveCount(2);
  await page.getByTestId('reveal-try').click();
  await gameReady(page);
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
  await expectPixel(page, DOLL_X, SECOND_Y, SECOND);
  // もう出ない
  await page.waitForTimeout(1500);
  await expect(reveal(page)).toHaveCount(0);
});

test('セットの一部ができなかったら、同じ画面に知らせが出る。全部できなかったら、とびらは出ず、知らせだけ（1 回だけ）', async ({ page }) => {
  await openHome(page, { delayMs: 800, failCategories: ['ボトムス'] });
  await openStudio(page);
  await page.getByTestId('studio-target').selectOption({ label: 'セット' });
  const checks = page.getByTestId('studio-set-categories').locator('input[type=checkbox]');
  for (let i = 0; i < (await checks.count()); i++) await checks.nth(i).uncheck();
  await page.getByTestId('studio-set-categories').getByText('トップス').click();
  await page.getByTestId('studio-set-categories').getByText('ボトムス').click();
  await page.getByTestId('studio-theme').fill('うみ');
  await page.getByTestId('studio-make').click();
  await page.getByTestId('order-ok').click({ timeout: 15_000 });
  await expect(reveal(page)).toBeVisible(ARRIVE);
  await expect(reveal(page)).toHaveAttribute('data-kind', 'arrived');
  await expect(page.getByTestId('reveal-failed')).toHaveText('ボトムスは つくれませんでした。チケットは もどしました');
  await page.getByTestId('reveal-close').click();
  // チケットは、できなかった 1 枚だけ戻っている
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 4 枚');

  // 1 点だけ（できないカテゴリ）
  await order(page, { label: 'ボトムス' });
  await expect(reveal(page)).toBeVisible(ARRIVE);
  await expect(reveal(page)).toHaveAttribute('data-kind', 'failed-only');
  await expect(reveal(page)).toContainText('つくれませんでした');
  await expect(page.getByTestId('reveal-failed')).toContainText('チケットは もどしました');
  await expect(page.getByTestId('reveal-stage')).toHaveCount(0);
  await expect(page.getByTestId('reveal-try')).toHaveCount(0);
  await page.getByTestId('reveal-close').click();
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 4 枚');
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(reveal(page)).toHaveCount(0);
});

test('2 つ続けて終わると、1 つずつ順に出る（古い順）', async ({ page }) => {
  await openHome(page, { delayMs: 2500 });
  await openStudio(page);
  await order(page, { label: 'トップス' }, 'うみ');
  await order(page, { label: 'ボトムス' }, 'やま');
  await page.getByTestId('studio-close').click();
  await page.goto('about:blank');
  await page.waitForTimeout(3500);
  await page.goto(APP);
  await expect(reveal(page)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('reveal-name')).toHaveText('うみのトップス');
  await page.getByTestId('reveal-close').click();
  await expect(page.getByTestId('reveal-name')).toHaveText('やまのボトムス', { timeout: 10_000 });
  await page.getByTestId('reveal-close').click();
  await expect(reveal(page)).toHaveCount(0);
});

test('スマホの縦でも、演出のボタンが画面に収まる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page, { delayMs: 1500 });
  await orderAndGoHome(page);
  await expect(reveal(page)).toBeVisible(ARRIVE);
  for (const id of ['reveal-try', 'reveal-closet', 'reveal-close']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x, id).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, id).toBeLessThanOrEqual(390);
    expect(box.y + box.height, id).toBeLessThanOrEqual(844);
  }
});
