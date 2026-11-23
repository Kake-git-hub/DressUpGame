/**
 * E2Eテスト: つくる（裏側は、端末の中だけで動く偽物。?studio=fake）
 *
 * 入口は、ホームの「つくる」。注文の演出 → チケットを切る演出 → 作りかけ → できた服は自動で自分の服（クローゼット）になる。
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { APP, DOLL_X, FIRST, FIRST_Y, SECOND, SECOND_Y, expectPixel, fakeState, gameReady, openHome, openStudio, order, play, pressMake, wear } from './helpers';

const jobs = (page: import('@playwright/test').Page) => page.getByTestId('studio-job');
// 届いた知らせ（クローゼットが開く演出）が出ていたら、閉じる
async function closeReveal(page: import('@playwright/test').Page) {
  const close = page.getByTestId('reveal-close');
  if (await close.count()) await close.click();
}

test('1 点作る: 注文の演出 → チケットの演出（のこりが 1 減る）→ 作りかけ。できた服は、メニューの先頭に出て着せられる。読み込み直しても残る', async ({ page }) => {
  await openHome(page, { delayMs: 1500, planMs: 900 });
  await openStudio(page);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 5 枚');
  await expect(page.getByTestId('studio-user-code')).toHaveText(/[A-Z0-9]{8}/);
  // 確認用（偽物の裏側）のときは、そうと分かる知らせを出す
  await expect(page.getByTestId('studio-demo')).toContainText('確認用');
  // 写真のボタンと、色のテーマの欄は無い
  await expect(page.getByTestId('studio-photo-button')).toHaveCount(0);
  await expect(page.getByTestId('studio-color-0')).toHaveCount(0);
  // ドールが 1 体なら、ドールを選ぶ欄は出ない
  await expect(page.getByTestId('studio-doll')).toHaveCount(0);
  await page.getByTestId('studio-target').selectOption({ label: 'トップス' });
  await expect(page.getByTestId('studio-make')).toBeDisabled(); // テーマがまだ
  await page.getByTestId('studio-theme').fill('うみ');
  await expect(page.getByTestId('studio-make')).toContainText('チケット 1 枚');
  await page.getByTestId('studio-make').click();

  // 注文の演出: 伝票に頼んだ内容。閉じないように促す。まだ、チケットは減っていない
  const show = page.getByTestId('order-show');
  await expect(show).toHaveAttribute('data-phase', 'ordering');
  await expect(show).toContainText('この がめんを とじないでね');
  await expect(page.getByTestId('order-slip')).toContainText('トップス ・ アニメ');
  await expect(page.getByTestId('order-slip')).toContainText('「うみ」');
  expect((await fakeState(page))!.user.tickets).toBe(5);
  // チケットを切る演出: 使った枚数と、残り
  await expect(show).toHaveAttribute('data-phase', 'ticket', { timeout: 10_000 });
  await expect(page.getByTestId('order-ticket-count')).toHaveText('チケット 1 まい つかいました（のこり 4 まい）');
  await expect(show).toContainText('もう とじても だいじょうぶ。');
  await page.getByTestId('order-ok').click();
  await expect(show).toHaveCount(0);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 4 枚');
  await expect(jobs(page)).toHaveCount(1);
  await expect(page.getByTestId('studio-making')).toContainText('この画面を閉じても、アプリを閉じても、続きます');

  // できたら、作りかけから消え、自分の服になっている（「使う」は要らない）
  await expect(jobs(page)).toHaveCount(0, { timeout: 15_000 });
  await closeReveal(page);
  await page.getByTestId('studio-close').click();
  await play(page);
  // ゲームのメニューでは、カテゴリの先頭に出る（自分の服の印つき）。ドラッグで着せられる
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await expect(page.locator('.palette-section img[alt="うみのトップス"]')).toBeVisible();
  await expect(page.locator('.palette-section [data-mine="true"]')).toHaveCount(1);
  await expect(page.locator('.palette-section [data-draggable]').first()).toHaveAttribute('data-mine', 'true');
  await wear(page, 'うみのトップス');
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
  // 読み込み直しても（URL に studio を付けなくても）、服もメニューも残る
  await page.goto(`${APP}&home=0`);
  await gameReady(page);
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await expect(page.locator('.palette-section img[alt="うみのトップス"]')).toBeVisible();
});

test('注文の演出の間は、後ろのボタンを押せない。連打しても、仕事は 1 つ、引かれるチケットも 1 枚', async ({ page }) => {
  await openHome(page, { delayMs: 60_000, planMs: 1500 });
  await openStudio(page);
  await expect(page.getByTestId('studio-tickets')).toContainText('枚');
  await page.getByTestId('studio-target').selectOption({ label: 'トップス' });
  await page.getByTestId('studio-theme').fill('うみ');
  const make = (await page.getByTestId('studio-make').boundingBox())!;
  const close = (await page.getByTestId('studio-close').boundingBox())!;
  await page.getByTestId('studio-make').click();
  await expect(page.getByTestId('order-show')).toHaveAttribute('data-phase', 'ordering');
  // 演出の上から、「作る」と「とじる」のあった場所を押す
  for (let i = 0; i < 3; i++) await page.mouse.click(make.x + make.width / 2, make.y + make.height / 2);
  await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('order-show')).toHaveAttribute('data-phase', 'ticket', { timeout: 10_000 });
  await page.getByTestId('order-ok').click();
  await expect(page.getByTestId('app-studio')).toBeVisible();
  await expect(jobs(page)).toHaveCount(1);
  const state = (await fakeState(page))!;
  expect(state.jobs).toHaveLength(1);
  expect(state.user.tickets).toBe(4);
});

test('セット: 入れるものを選ぶと、その数だけチケットを使い、全部できると、ゲームの先頭のセットになる', async ({ page }) => {
  await openHome(page);
  await openStudio(page);
  await page.getByTestId('studio-target').selectOption({ label: 'セット' });
  const checks = page.getByTestId('studio-set-categories').locator('input[type=checkbox]');
  // いったん全部外して、トップスとボトムスだけにする
  for (let i = 0; i < (await checks.count()); i++) await checks.nth(i).uncheck();
  await page.getByTestId('studio-theme').fill('うみ');
  await expect(page.getByTestId('studio-hint')).toContainText('2〜6 個');
  await expect(page.getByTestId('studio-make')).toBeDisabled();
  await page.getByTestId('studio-set-categories').getByText('トップス').click();
  await page.getByTestId('studio-set-categories').getByText('ボトムス').click();
  await expect(page.getByTestId('studio-make')).toContainText('チケット 2 枚');
  await page.getByTestId('studio-make').click();
  await expect(page.getByTestId('order-slip')).toContainText('セット（2 てん） ・ アニメ');
  await expect(page.getByTestId('order-ticket-count')).toHaveText('チケット 2 まい つかいました（のこり 3 まい）', { timeout: 10_000 });
  await expect(page.getByTestId('order-ticket')).toHaveCount(2);
  await page.getByTestId('order-ok').click();
  await expect(jobs(page)).toContainText('セット「うみのセット」');
  await expect(jobs(page)).toHaveCount(0, { timeout: 15_000 });
  await closeReveal(page);
  await page.getByTestId('studio-close').click();
  await play(page);
  // メニューの「セット」の先頭に、自分のセットが出る。ドラッグすると、2 点とも着る
  await page.locator('.palette-section button', { hasText: 'セット' }).first().click();
  const first = page.locator('.palette-section [data-draggable]').first();
  await expect(first).toContainText('うみのセット');
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, 400, { steps: 4 });
  await page.mouse.up();
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
  await expectPixel(page, DOLL_X, SECOND_Y, SECOND);
});

test('チケットが足りないときは作れず、理由が出る。できなかった品目の分は、チケットが戻る', async ({ page }) => {
  await openHome(page, { tickets: 1, failCategories: ['トップス'], delayMs: 2500 });
  await openStudio(page);
  await page.getByTestId('studio-target').selectOption({ label: 'セット' });
  await page.getByTestId('studio-theme').fill('うみ');
  await expect(page.getByTestId('studio-make')).toBeDisabled();
  await expect(page.getByTestId('studio-hint')).toContainText('チケットが足りません');
  // 1 点なら作れるが、できない品目（テスト用）なので、チケットが戻る
  await order(page, { label: 'トップス' });
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 0 枚');
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 1 枚', { timeout: 15_000 });
  expect((await fakeState(page))!.items).toEqual([]);
});

test('作っている間に、読み込み直しても（閉じたつもり）、続きが見られる。閉じていた間に、できあがっている', async ({ page }) => {
  await openHome(page, { delayMs: 2500 });
  await openStudio(page);
  await order(page, { label: 'トップス' });
  await expect(jobs(page)).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  // 作りかけがあるので、ホームの「クローゼット」に ● が付く
  await expect(page.getByTestId('home-closet-dot')).toBeVisible({ timeout: 15_000 });
  await openStudio(page);
  await expect(jobs(page)).toHaveCount(1);
  await expect(page.getByTestId('studio-job-notice')).toContainText('作っています');
  // アプリを開かないまま、時間がたつ
  await page.goto('about:blank');
  await page.waitForTimeout(3000);
  await page.goto(`${APP}&home=0`);
  await gameReady(page);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await expect(page.locator('.palette-section img[alt="うみのトップス"]')).toBeVisible({ timeout: 20_000 });
});

test('縦画面でも、ホームから開けて、同じように作れる（演出も画面に収まる）', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page, { delayMs: 60_000, planMs: 1200 });
  await openStudio(page);
  await pressMake(page, { label: 'トップス' });
  await expect(page.getByTestId('order-show')).toHaveAttribute('data-phase', 'ordering');
  const warning = (await page.getByText('この がめんを とじないでね').boundingBox())!;
  expect(warning.y + warning.height).toBeLessThanOrEqual(844);
  await expect(page.getByTestId('order-show')).toHaveAttribute('data-phase', 'ticket', { timeout: 10_000 });
  const ok = (await page.getByTestId('order-ok').boundingBox())!;
  expect(ok.y + ok.height).toBeLessThanOrEqual(844);
  expect(ok.x).toBeGreaterThanOrEqual(0);
  expect(ok.x + ok.width).toBeLessThanOrEqual(390);
  await page.getByTestId('order-ok').click();
  await expect(jobs(page)).toHaveCount(1);
});

test('古いサーバーでは、知らせが出て、作る欄が出ない', async ({ page }) => {
  await openHome(page, { oldServer: true });
  await openStudio(page);
  await expect(page.getByTestId('studio-problem')).toContainText('サーバーが古い版です');
  await expect(page.getByTestId('studio-make')).toHaveCount(0);
});

test('つながっていないとき、スタジオはそう知らせる。ゲームは、そのまま遊べる', async ({ page }) => {
  await openHome(page, { offline: true });
  await openStudio(page);
  await expect(page.getByTestId('studio-problem')).toContainText('インターネット');
  await expect(page.getByTestId('studio-make')).toHaveCount(0);
  await page.getByTestId('studio-close').click();
  await play(page);
});

test('スタジオの画面と演出は、ゲームの最初の読み込みに入っていない（開いたときにだけ読み込む）', async () => {
  const dist = path.resolve('dist');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const entry = /src="([^"]*assets\/main-[^"]+\.js)"/.exec(html)?.[1] ?? /src="([^"]*assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  expect(entry).toBeTruthy();
  const main = fs.readFileSync(path.join(dist, entry!.replace(/^\/DressUpGame\//, '')), 'utf8');
  for (const mark of ['studio-make', 'adult-question', 'order-show', 'dressup_fake_backend', 'dressup_cloud_used']) expect(main, mark).not.toContain(mark);
  // 別のファイルに入っている
  const assets = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js'));
  expect(assets.some((f) => fs.readFileSync(path.join(dist, 'assets', f), 'utf8').includes('studio-make'))).toBe(true);
});

test('自分の服は、オフラインで開き直しても、メニューに出て着たまま', async ({ page, context }) => {
  await openHome(page);
  await openStudio(page);
  await order(page, { label: 'トップス' });
  await expect(jobs(page)).toHaveCount(0, { timeout: 15_000 });
  await closeReveal(page);
  await page.getByTestId('studio-close').click();
  await play(page);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await wear(page, 'うみのトップス');
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
  // 先読みが終わってから、オフラインにして開き直す
  await page.waitForFunction(() => document.documentElement.dataset.prefetch === 'test', null, { timeout: 60_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  await play(page);
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await expect(page.locator('.palette-section img[alt="うみのトップス"]')).toBeVisible();
  await context.setOffline(false);
});

test('端末の保存領域（IndexedDB）が応答しなくても、ゲームは始まる', async ({ page }) => {
  await page.addInitScript(() => {
    // open が、いつまでも返事をしない
    Object.defineProperty(window, 'indexedDB', { value: { open: () => ({}), deleteDatabase: () => ({}) }, configurable: true });
  });
  await page.goto(`${APP}&home=0`);
  await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible({ timeout: 12_000 });
});

test('ホーム画面のアプリでも出せる: 版数を 5 回押して、あいことばを入れると、ホームに「つくる」「クローゼット」が出る', async ({ page }) => {
  await page.goto(APP);
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByTestId('home-create')).toHaveCount(0);
  const answers = ['まちがい', 'home', 'fake'];
  page.on('dialog', (d) => void d.accept(answers.shift() ?? ''));
  const badge = page.locator('.version-badge');
  // 4 回では何も起きない
  for (let i = 0; i < 4; i++) await badge.click();
  await page.waitForTimeout(1600);
  // 5 回続けて押す: あいことばが違えば、何も変わらない（前の版の「home」も、もう効かない）
  for (let i = 0; i < 5; i++) await badge.click();
  await page.waitForTimeout(500);
  for (let i = 0; i < 5; i++) await badge.click();
  await page.waitForTimeout(500);
  await expect(page.getByTestId('home-create')).toHaveCount(0);
  // 正しいあいことば
  for (let i = 0; i < 5; i++) await badge.click();
  await expect(page.getByTestId('home-create')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('home-closet')).toBeVisible();
});

test.describe('スタジオの画面を読み込めないとき', () => {
  test.use({ serviceWorkers: 'block' });
  test('ゲームは消えずに、読み込めなかったことを知らせる。閉じると、ホームにもどる', async ({ page }) => {
    await openHome(page);
    // スタジオの画面のファイル（あとから読み込む分）だけ、取れないようにする
    const studioChunks = fs.readdirSync(path.resolve('dist/assets')).filter((f) => f.endsWith('.js') && fs.readFileSync(path.resolve('dist/assets', f), 'utf8').includes('studio-make'));
    expect(studioChunks.length).toBeGreaterThan(0);
    for (const chunk of studioChunks) await page.route(`**/assets/${chunk}`, (route) => route.abort());
    await page.getByTestId('home-create').click();
    await expect(page.getByTestId('studio-load-failed')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('studio-load-failed').getByRole('button').click();
    await expect(page.getByTestId('studio-load-failed')).toHaveCount(0);
    await expect(page.getByTestId('home-screen')).toBeVisible();
    await play(page);
  });
});

test('前に「つくる」を使った端末は、URL に何も付けなくても、起動のあと、裏でつなぐ（作りかけ・届いた服が分かる）', async ({ page }) => {
  await openHome(page, { delayMs: 800 });
  // まだ 1 回もつないでいない: 何もしない
  expect(await page.evaluate(() => localStorage.getItem('dressup_cloud_used'))).toBeNull();
  await openStudio(page);
  await expect(page.getByTestId('studio-tickets')).toContainText('枚');
  expect(await page.evaluate(() => localStorage.getItem('dressup_cloud_used'))).toBe('1');
  await order(page, { label: 'トップス' });
  await page.goto('about:blank');
  await page.waitForTimeout(1500);
  // ゲームを直接開く（ホームも、つくるも開かない）: 裏でつないで、届いた服がメニューに入る
  await page.goto(`${APP}&home=0`);
  await gameReady(page);
  await closeReveal(page);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await expect(page.locator('.palette-section img[alt="うみのトップス"]')).toBeVisible({ timeout: 20_000 });
});
