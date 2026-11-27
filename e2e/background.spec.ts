/**
 * E2Eテスト: 背景を作る（v0.49.0）。「つくる」の「はいけい」→ 届く → ゲームの背景の一覧・クローゼット・こうかん。
 * 裏側は、端末の中だけで動く偽物（?studio=fake。にせの背景は、空と地面の絵）
 */
import { test, expect, type Page } from '@playwright/test';
import { DOLL_X, dismissReveal, fakeState, openHome, openStudio, order, play, chooseTarget, themeAndCheck } from './helpers';

const BG_NAME = 'うみのはいけい';
const BG_Y = 20; // ドールの外（背景だけが見える位置）
const SKIN_Y = 820 / 2 - 400 * ((820 * 0.9) / 1024); // ドールの頭のあたり

// キャンバスの 1 点（透明度つき）。背景が無いときは、透明
async function canvasPixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    ([px, py]) => {
      const src = document.querySelector('#avatar-canvas') as HTMLCanvasElement | null;
      if (!src) return [0, 0, 0, 0];
      const rect = src.getBoundingClientRect();
      const out = document.createElement('canvas');
      out.width = 1;
      out.height = 1;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(src, Math.round(((px - rect.left) / rect.width) * src.width), Math.round(((py - rect.top) / rect.height) * src.height), 1, 1, 0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data);
    },
    [x, y],
  );
}
const backgroundShown = (page: Page) => expect.poll(async () => (await canvasPixel(page, DOLL_X, BG_Y))[3], { timeout: 20_000 }).toBe(255);
const backgroundGone = (page: Page) => expect.poll(async () => (await canvasPixel(page, DOLL_X, BG_Y))[3], { timeout: 20_000 }).toBe(0);
const dollShown = (page: Page) => expect.poll(async () => (await canvasPixel(page, DOLL_X, SKIN_Y))[3], { timeout: 20_000 }).toBe(255);
const bgTile = (page: Page) => page.getByTestId('studio-target-bg');
// 「つくる」で背景を 1 枚作って、届いた演出が出る所まで
async function makeBackground(page: Page, theme = 'うみ') {
  await openStudio(page);
  await order(page, { label: 'はいけい' }, theme);
  await expect(page.getByTestId('studio-job')).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId('reveal')).toBeVisible({ timeout: 30_000 });
}
async function closeStudio(page: Page) {
  await page.getByTestId('studio-close').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
}
async function openCloset(page: Page) {
  await page.getByTestId('home-closet').click();
  await expect(page.getByTestId('closet')).toBeVisible({ timeout: 60_000 });
}
// ゲームの、背景の一覧を開く
async function openBackgrounds(page: Page) {
  await page.locator('.palette-section button', { hasText: 'はいけい' }).first().click();
  await expect(page.locator('.palette-section button', { hasText: 'もどる' })).toBeVisible();
}
const menuBackgrounds = (page: Page) => page.locator('.palette-section [data-draggable] img').evaluateAll((list) => list.map((img) => (img as HTMLImageElement).alt));

test('「つくる」の題は「✨ つくる」。「なにを 作る？」の最後に「はいけい」（絵と名前だけ）。チケット 1 枚で作れて、届いたら「つかってみる」でゲームの背景になる', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openHome(page, { delayMs: 1500 });
  await openStudio(page);
  await expect(page.getByTestId('app-studio').locator('h2').first()).toHaveText('✨ つくる');
  await expect(page.getByTestId('studio-step')).toHaveAttribute('data-step', 'what');
  // セットのあと（いちばん最後）。素材に背景があれば、その絵
  await expect(bgTile(page)).toBeVisible();
  expect(await page.getByTestId('studio-target').locator(':scope > button').last().getAttribute('aria-label')).toBe('はいけい');
  await expect(bgTile(page).locator('img')).toHaveAttribute('src', /.+/);
  await expect(bgTile(page)).toHaveText('はいけい');
  await chooseTarget(page, 'はいけい');
  await themeAndCheck(page, 'うみ');
  await expect(page.getByTestId('studio-summary')).toContainText('はいけい');
  await expect(page.getByTestId('studio-make')).toContainText('チケット 1 枚');
  await page.getByTestId('studio-make').click();
  await expect(page.getByTestId('order-slip')).toContainText('はいけい ・ アニメ');
  await expect(page.getByTestId('order-show')).toHaveAttribute('data-phase', 'ticket', { timeout: 15_000 });
  await expect(page.getByTestId('order-ticket-count')).toHaveText('チケット 1 まい つかいました（のこり 4 まい）');
  await page.getByTestId('order-ok').click();
  // 作っている一覧に「はいけい」
  await expect(page.getByTestId('studio-job')).toContainText(`はいけい「${BG_NAME}」`);
  // 届いた演出: 背景の絵だけ（ドールは重ねない）
  await expect(page.getByTestId('reveal')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('reveal')).toContainText('あたらしい はいけいが とどいたよ！');
  await expect(page.getByTestId('reveal-name')).toHaveText(BG_NAME);
  await expect(page.getByTestId('reveal-stage').locator('img')).toHaveCount(1);
  expect((await fakeState(page))!.user.tickets).toBe(4);
  // つかってみる → ゲームの画面で、その背景になっている
  await expect(page.getByTestId('reveal-try')).toHaveText('つかってみる');
  await page.getByTestId('reveal-try').click();
  await expect(page.getByTestId('reveal')).toHaveCount(0);
  await expect(page.locator('#avatar-canvas')).toBeVisible({ timeout: 60_000 });
  await backgroundShown(page);
  await dollShown(page);
  // 読み込み直しても、その背景のまま
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  await play(page);
  await backgroundShown(page);
  expect(errors).toEqual([]);
});

test('ゲームの背景の一覧: そのドールの自分の背景が、公開の背景の前に出る。タップで選べる。オフラインで開き直しても、選んだまま', async ({ page, context }) => {
  await openHome(page);
  await makeBackground(page);
  await dismissReveal(page);
  await closeStudio(page);
  await play(page);
  await backgroundGone(page);
  await openBackgrounds(page);
  const names = await menuBackgrounds(page);
  expect(names[0]).toBe(BG_NAME);
  expect(names.length).toBeGreaterThan(1); // 公開の背景も、そのまま出る
  const tile = (await page.locator(`.palette-section img[alt="${BG_NAME}"]`).first().boundingBox())!;
  await page.mouse.click(tile.x + tile.width / 2, tile.y + tile.height / 2);
  await backgroundShown(page);
  // 先読みが終わってから、オフラインにして開き直す
  await page.waitForFunction(() => document.documentElement.dataset.prefetch === 'test', null, { timeout: 60_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  await play(page);
  await backgroundShown(page);
  await openBackgrounds(page);
  await expect(page.locator(`.palette-section img[alt="${BG_NAME}"]`)).toBeVisible();
  await context.setOffline(false);
});

test('クローゼット: 「はいけい」の組に出る。開くと、名前と「けす」だけ（色・ならび・いちを きめる、は無い）。名前を変えると、ゲームの一覧の名前も変わる', async ({ page }) => {
  await openHome(page);
  await makeBackground(page);
  await page.getByTestId('reveal-closet').click();
  await expect(page.getByTestId('closet')).toBeVisible({ timeout: 60_000 });
  const group = page.locator('[data-testid="closet-group"][data-category="__background"]');
  await expect(group.locator('h3')).toHaveText('はいけい');
  await expect(group.getByTestId('closet-item')).toHaveCount(1);
  await expect(group.getByTestId('closet-item')).toContainText(BG_NAME);
  await group.getByTestId('closet-item').click();
  await expect(page.getByTestId('closet-item-sheet')).toBeVisible();
  await expect(page.getByTestId('closet-stage').locator('img')).toHaveCount(1); // 背景の絵だけ（ドールは重ねない）
  await expect(page.getByTestId('closet-hue')).toHaveCount(0);
  await expect(page.getByTestId('closet-move-front')).toHaveCount(0);
  await expect(page.getByTestId('closet-fit')).toHaveCount(0);
  await expect(page.getByTestId('closet-delete')).toBeVisible();
  await page.getByTestId('closet-name').fill('ゆうやけの うみ');
  await page.getByTestId('closet-name').press('Enter');
  await page.getByTestId('closet-item-done').click();
  await expect(group.getByTestId('closet-item')).toContainText('ゆうやけの うみ');
  expect((await fakeState(page))!.items.map((i) => i.name)).toEqual(['ゆうやけの うみ']);
  await page.getByTestId('closet-close').click();
  await play(page);
  await openBackgrounds(page);
  expect((await menuBackgrounds(page))[0]).toBe('ゆうやけの うみ');
});

test('選んでいる背景を、クローゼットで消しても、ゲームは描ける（背景なしにもどる。一覧からも消える）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openHome(page);
  await makeBackground(page);
  await page.getByTestId('reveal-try').click();
  await backgroundShown(page);
  // ホーム → クローゼット → けす
  await page.getByTestId('home-back-button').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await openCloset(page);
  await page.getByTestId('closet-item').first().click();
  await page.getByTestId('closet-delete').click();
  await page.getByTestId('closet-delete-yes').click();
  await expect(page.getByTestId('closet-empty')).toBeVisible();
  expect((await fakeState(page))!.items).toEqual([]);
  await page.getByTestId('closet-close').click();
  await play(page);
  await dollShown(page);
  await backgroundGone(page);
  await openBackgrounds(page);
  expect(await menuBackgrounds(page)).not.toContain(BG_NAME);
  // 読み込み直しても、同じ（消した背景の ID が残っていても、落ちない）
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  await play(page);
  await dollShown(page);
  await backgroundGone(page);
  expect(errors).toEqual([]);
});

test('古いサーバー（背景を作れない版）では、「はいけい」のタイルが出ない（知らせも出ない）。服は、いままでどおり作れる', async ({ page }) => {
  await openHome(page, { noBackground: true });
  await openStudio(page);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 5 枚');
  await expect(page.getByTestId('studio-target').getByRole('button', { name: 'セット', exact: true })).toBeVisible();
  // つないだあと、しばらく待っても出ない
  await page.waitForTimeout(1500);
  await expect(bgTile(page)).toHaveCount(0);
  await expect(page.getByTestId('studio-problem')).toHaveCount(0);
  await expect(page.getByTestId('app-studio')).not.toContainText('古い');
  await order(page, { label: 'トップス' });
  await expect(page.getByTestId('studio-job')).toHaveCount(0, { timeout: 15_000 });
  await dismissReveal(page);
  expect((await fakeState(page))!.items).toHaveLength(1);
});

test('背景ができなかったら、チケットが戻る（「はいけい」として知らせる）', async ({ page }) => {
  await openHome(page, { tickets: 1, failCategories: ['__background'], delayMs: 2500 });
  await openStudio(page);
  await order(page, { label: 'はいけい' });
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 0 枚');
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 1 枚', { timeout: 15_000 });
  await expect(page.getByTestId('reveal')).toHaveAttribute('data-kind', 'failed-only', { timeout: 30_000 });
  await expect(page.getByTestId('reveal-failed')).toContainText('はいけい');
  expect((await fakeState(page))!.items).toEqual([]);
});

test('こうかん: 背景を出して、にせの あいての背景をもらう。もらった背景は、クローゼットの「はいけい」と、ゲームの背景の一覧に出る', async ({ page }) => {
  await openHome(page, { partner: { claimAfterMs: 600, acceptAfterMs: 500 } });
  await makeBackground(page);
  await dismissReveal(page);
  await closeStudio(page);
  await openCloset(page);
  await page.getByTestId('closet-trade').click();
  await expect(page.getByTestId('trade')).toBeVisible();
  await page.getByTestId('trade-show').click();
  // えらぶ一覧にも「はいけい」の組
  await expect(page.locator('[data-testid="trade"] section[data-category="__background"] h3')).toHaveText('はいけい');
  await page.getByTestId('trade-pick-item').first().click();
  await expect(page.getByTestId('trade-confirm')).toContainText('こうかんする？', { timeout: 15_000 });
  await expect(page.getByTestId('trade-confirm')).toContainText('にせの はいけい');
  await page.getByTestId('trade-accept').click();
  await expect(page.getByTestId('trade-done')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('trade-to-closet').click();
  const group = page.locator('[data-testid="closet-group"][data-category="__background"]');
  await expect(group.getByTestId('closet-item')).toHaveCount(1);
  await expect(group.getByTestId('closet-item')).toContainText('にせの はいけい');
  await page.getByTestId('closet-close').click();
  await play(page);
  await openBackgrounds(page);
  const names = await menuBackgrounds(page);
  expect(names[0]).toBe('にせの はいけい');
  expect(names).not.toContain(BG_NAME);
});

test('スマホの縦でも、「はいけい」のタイルが画面の幅に収まり、作れる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page, { delayMs: 60_000 });
  await openStudio(page);
  await expect(bgTile(page)).toBeVisible();
  const box = (await bgTile(page).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await order(page, { label: 'はいけい' });
  await expect(page.getByTestId('studio-job')).toHaveCount(1);
});
