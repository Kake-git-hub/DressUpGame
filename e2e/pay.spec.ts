/**
 * E2Eテスト: チケットを買う（裏側は、端末の中だけで動く偽物。にせの支払いページ）
 *
 * つくる → 保護者の確認 → パック → 最終確認（同意の印）→ にせの支払いページ → 戻って「ふえました」。
 * 本物の Stripe には行かない。
 */
import { test, expect, type Page } from '@playwright/test';
import { fakeState, openHome, openStudio } from './helpers';

const KANJI: Record<string, number> = { 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
// 保護者の確認（漢数字の掛け算）を解く: 「十七 かける 三 は？」
async function passGate(page: Page) {
  const text = (await page.getByTestId('adult-question').textContent()) ?? '';
  const m = /十(.?) かける (.) は/.exec(text)!;
  const a = 10 + (m[1] ? KANJI[m[1]] : 0);
  await page.getByTestId('adult-answer').fill(String(a * KANJI[m[2]]));
  await page.getByTestId('adult-18').check();
  await page.getByTestId('adult-open').click();
}
// 「チケットを買う」→ 保護者の確認 → パック → 同意（支払いへ進む の前まで）
async function toConfirm(page: Page, pack = '10-300') {
  await page.getByTestId('studio-buy').click();
  await passGate(page);
  await page.getByTestId(`shop-pack-${pack}`).click();
  await expect(page.getByTestId('shop-confirm')).toContainText('税込 300 円');
  await page.getByTestId('shop-agree').check();
}
const tickets = (page: Page) => page.getByTestId('studio-tickets');

test('売っていないときは、買うボタンが無い', async ({ page }) => {
  await openHome(page, { shop: { open: false } });
  await openStudio(page);
  await expect(tickets(page)).toContainText('のこり 5 枚');
  await expect(page.getByTestId('studio-buy')).toHaveCount(0);
});

test('売っていなくても、管理者には、買うボタンが出る', async ({ page }) => {
  await openHome(page, { shop: { open: false }, admin: true });
  await openStudio(page);
  await expect(page.getByTestId('studio-buy')).toBeVisible();
});

test('ログインしていないと、買えず、ログインの案内が出る', async ({ page }) => {
  await openHome(page, { anonymous: true });
  await openStudio(page);
  await toConfirm(page);
  await page.getByTestId('shop-pay').click();
  await expect(page.getByTestId('shop-message')).toContainText('Google で ログインすると かえます');
  await expect(page.getByTestId('shop-login')).toBeVisible();
  await page.getByTestId('shop-login').click();
  await expect(page.getByTestId('shop')).toHaveCount(0);
  await expect(tickets(page)).toContainText('のこり 5 枚');
});

test('買う: 確認 → 同意 → にせの支払いページ → 払う → ふえました。残りが +10、期限が出る。戻りの URL は消える', async ({ page }) => {
  await openHome(page);
  await openStudio(page);
  await expect(tickets(page)).toContainText('のこり 5 枚');
  await page.getByTestId('studio-buy').click();
  await passGate(page);
  await page.getByTestId('shop-pack-10-300').click();
  // 最終確認: 同意の印が無いと進めない
  const confirm = page.getByTestId('shop-confirm');
  await expect(confirm).toContainText('税込 300 円');
  await expect(confirm).toContainText('返品・返金');
  await expect(page.getByTestId('shop-until')).toContainText(/20\d\d年\d+月\d+日まで/);
  await expect(page.getByTestId('shop-pay')).toBeDisabled();
  await page.getByTestId('shop-agree').check();
  await page.getByTestId('shop-pay').click();

  await expect(page.getByTestId('fake-pay')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('fake-pay-ok').click();

  await expect(page.getByTestId('pay-return')).toContainText('チケットが 10 枚 ふえました', { timeout: 30_000 });
  await expect(tickets(page)).toContainText('のこり 15 枚');
  await expect(page.getByTestId('studio-lot')).toContainText(/うち 10 枚は 20\d\d年\d+月\d+日まで/);
  expect(page.url()).not.toMatch(/pay=|session=/);
  expect(page.url()).toContain('studio=fake');
  expect((await fakeState(page))!.user.tickets).toBe(15);
  // 読み込み直しても、もう知らせない
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  await openStudio(page);
  await expect(tickets(page)).toContainText('のこり 15 枚');
  await expect(page.getByTestId('pay-notice')).toHaveCount(0);
});

test('にせの支払いページで「やめる」: ふえない', async ({ page }) => {
  await openHome(page);
  await openStudio(page);
  await toConfirm(page);
  await page.getByTestId('shop-pay').click();
  await expect(page.getByTestId('fake-pay')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('fake-pay-cancel').click();
  await expect(page.getByTestId('pay-return')).toContainText('お支払いを やめました', { timeout: 30_000 });
  await expect(tickets(page)).toContainText('のこり 5 枚');
  await expect(page.getByTestId('studio-lot')).toHaveCount(0);
  expect(page.url()).not.toMatch(/pay=/);
});

test('なかなか足されない（slow）: 「じかんが かかっています」→ 開き直すと「ふえました」', async ({ page }) => {
  test.setTimeout(120_000);
  await openHome(page, { payResult: 'slow' });
  await openStudio(page);
  await toConfirm(page);
  await page.getByTestId('shop-pay').click();
  await expect(page.getByTestId('fake-pay')).toBeVisible({ timeout: 20_000 });
  const paidAt = Date.now();
  await page.getByTestId('fake-pay-ok').click();
  await expect(page.getByTestId('pay-return')).toContainText('たしかめています', { timeout: 30_000 });
  await expect(page.getByTestId('pay-return')).toContainText('じかんが かかっています', { timeout: 45_000 });
  await expect(tickets(page)).toContainText('のこり 5 枚');
  // 偽物は、払ってから 40 秒あとに足す
  await page.waitForTimeout(Math.max(0, paidAt + 42_000 - Date.now()));
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  await openStudio(page);
  await expect(page.getByTestId('pay-notice')).toContainText('チケットが 10 枚 ふえました', { timeout: 30_000 });
  await expect(tickets(page)).toContainText('のこり 15 枚');
});

test('期限まで 14 日いないの分は、お知らせが 1 回だけ出る。ようこそも 1 回', async ({ page }) => {
  await openHome(page, { fakeLots: [{ count: 10, daysLeft: 5 }], welcome: 3 });
  await openStudio(page);
  const notices = page.getByTestId('pay-notice');
  await expect(notices.filter({ hasText: '10 枚の チケットが' })).toContainText('で つかえなくなります');
  await expect(notices.filter({ hasText: 'ようこそ！ チケットを 3 枚 プレゼント' })).toHaveCount(1);
  await expect(page.getByTestId('studio-lot')).toContainText('うち 10 枚は');
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
  await openStudio(page);
  await expect(page.getByTestId('studio-lot')).toBeVisible();
  await expect(notices).toHaveCount(0);
});
