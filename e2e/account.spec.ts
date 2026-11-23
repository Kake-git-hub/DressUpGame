/**
 * E2Eテスト: 「つくる」の「アカウント」の欄（Google のアカウントでログイン・ログアウト）。裏側は、端末の中だけで動く偽物（?studio=fake）
 *
 * 偽物の裏側も、本物と同じ段取り（src/cloud/account.ts）を通る。方法 2 の「画面を移る」だけが、にせの戻り（# を付けて読み込み直す）。
 */
import { test, expect, type Page } from '@playwright/test';
import { dismissReveal, FAKE, fakeState, openHome, openStudio, order } from './helpers';

const EMAIL = 'tameshi@example.com';
const MSG = {
  done: 'Google のアカウントでログインしました',
  taken: 'この Google のアカウントは、ほかの端末で使われています。この端末のチケットと服を合わせるのは、次の版でできるようになります',
  cancelled: 'ログインを やめました',
  noPopup: '小さい窓を開けませんでした。方法 2 を試してください',
  failed: 'ログインできませんでした。少し待ってから、もう一度ためしてください',
};

const popupButton = (page: Page) => page.getByTestId('account-login-popup');
const redirectButton = (page: Page) => page.getByTestId('account-login-redirect');
// 準備が済む（ボタンが押せる）まで待つ
async function sectionReady(page: Page) {
  await expect(page.getByTestId('account-section')).toBeVisible();
  await expect(popupButton(page)).toBeEnabled({ timeout: 30_000 });
  await expect(redirectButton(page)).toBeEnabled();
}
// つくる → 欄まで
async function openAccount(page: Page) {
  await openStudio(page);
  await page.getByTestId('account-section').scrollIntoViewIfNeeded();
}
// 1 点作って、できあがるまで待つ（チケット 1 枚）
async function makeOne(page: Page) {
  await openStudio(page);
  await order(page, { label: 'トップス' }, 'うみ');
  await expect(page.getByTestId('studio-job')).toHaveCount(0, { timeout: 15_000 });
  await dismissReveal(page);
  await page.getByTestId('studio-close').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
}
const closetItems = async (page: Page) => {
  await page.getByTestId('home-closet').click();
  await expect(page.getByTestId('closet')).toBeVisible({ timeout: 60_000 });
};
const diagText = async (page: Page) => {
  page.once('dialog', (d) => void d.accept('log'));
  const badge = page.locator('.version-badge');
  for (let i = 0; i < 5; i++) await badge.click();
  const panel = page.getByTestId('diag-panel');
  await expect(panel).toBeVisible();
  return panel.locator('pre').innerText();
};

test('方法 1 で結び付ける: 「ログイン中」になり、読み込み直しても続く。チケットも服も、そのまま', async ({ page }) => {
  await openHome(page, { tickets: 5 });
  await makeOne(page);
  const before = (await fakeState(page))!;
  expect(before.user.tickets).toBe(4);

  await openAccount(page);
  await expect(page.getByTestId('account-email')).toHaveCount(0); // ログイン前
  await sectionReady(page);
  await popupButton(page).click();
  await expect(page.getByTestId('account-email')).toHaveText(`ログイン中: ${EMAIL}`);
  await expect(page.getByTestId('account-message')).toHaveText(MSG.done);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 4 枚');

  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await openAccount(page);
  await expect(page.getByTestId('account-email')).toHaveText(`ログイン中: ${EMAIL}`);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 4 枚');
  const after = (await fakeState(page))!;
  expect(after.user).toEqual(before.user);
  expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id));
  await page.getByTestId('studio-close').click();
  await closetItems(page);
  await expect(page.getByTestId('closet-item')).toHaveCount(1);
});

test('ログアウト → 方法 2 で入り直す: 空の端末になり、入り直すと、元の服とチケットが戻る。URL に # は残らない。きろくに、メールも証明も出ない', async ({ page }) => {
  await openHome(page, { tickets: 5 });
  await makeOne(page);
  const before = (await fakeState(page))!;
  await openAccount(page);
  await sectionReady(page);
  await popupButton(page).click();
  await expect(page.getByTestId('account-email')).toBeVisible();

  // ログアウト: 確かめ → 読み込み直される → 空の端末・ログイン前
  await page.getByTestId('account-logout').click();
  await expect(page.getByTestId('account-logout-confirm')).toContainText('ログアウトすると、この端末では、チケットと作った服が見えなくなります');
  await page.getByTestId('account-logout-yes').click();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 });
  // きろくは、前の回と今回しか残らない。読み込み直しをはさむので、途中で 1 回読んでおく
  const beforeLogout = await diagText(page);
  await page.getByTestId('diag-panel').getByRole('button', { name: 'とじる' }).click();
  await closetItems(page);
  await expect(page.getByTestId('closet-empty')).toBeVisible();
  await page.getByTestId('closet-close').click();
  await openAccount(page);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 0 枚');
  await expect(page.getByTestId('account-email')).toHaveCount(0);
  await sectionReady(page);

  // 方法 2: にせの「画面を移る」で読み込み直される → ホームに知らせ
  await redirectButton(page).click();
  await expect(page.getByTestId('login-notice')).toContainText(MSG.done, { timeout: 30_000 });
  expect(new URL(page.url()).hash).toBe('');
  expect(page.url()).not.toContain('#');
  await page.getByTestId('login-notice-ok').click();
  await expect(page.getByTestId('login-notice')).toHaveCount(0);
  await closetItems(page);
  await expect(page.getByTestId('closet-item')).toHaveCount(1);
  await expect(page.getByTestId('closet-item').first()).toContainText('うみのトップス');
  const after = (await fakeState(page))!;
  expect(after.user).toEqual(before.user);
  expect(after.user.tickets).toBe(4);

  // きろく: 段取りの語はあるが、メールと証明は無い
  await page.getByTestId('closet-close').click();
  const text = `${beforeLogout}\n${await diagText(page)}`;
  for (const word of ['login start popup', 'login result linked', 'login out', 'login back ok', 'login result switched']) expect(text).toContain(word);
  // 画面の大きさの「1180x820@1」にも @ があるので、ログインの行だけを見る
  const loginLines = text.split('\n').filter((line) => line.includes(' login '));
  expect(loginLines.length).toBeGreaterThanOrEqual(5);
  expect(loginLines.join('\n')).not.toContain('@');
  expect(text).not.toContain('example.com');
  expect(text).not.toContain('id_token');
});

test('もう使われている Google: 空でない端末（チケット 3）では、方法 1 も方法 2 も「ほかの端末で使われています」。チケットも、ログイン前の表示も変わらない', async ({ page }) => {
  await openHome(page, { tickets: 5 });
  await openAccount(page);
  await sectionReady(page);
  await popupButton(page).click();
  await expect(page.getByTestId('account-email')).toBeVisible();
  await page.getByTestId('account-logout').click();
  await page.getByTestId('account-logout-yes').click();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 });
  // ここで、Google の世界が置いてあり、この端末は、チケット 3 枚の別の利用者
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('dressup_fake_backend')!) as { user: { tickets: number } };
    state.user.tickets = 3;
    localStorage.setItem('dressup_fake_backend', JSON.stringify(state));
  });
  expect(await page.evaluate(() => localStorage.getItem('dressup_fake_google'))).not.toBeNull();
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();

  await openAccount(page);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 3 枚');
  await sectionReady(page);
  await popupButton(page).click();
  await expect(page.getByTestId('account-message')).toHaveText(MSG.taken);
  await expect(page.getByTestId('account-email')).toHaveCount(0);
  await expect(popupButton(page)).toBeEnabled();
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 3 枚');

  await redirectButton(page).click();
  await expect(page.getByTestId('login-notice')).toContainText(MSG.taken, { timeout: 30_000 });
  expect(page.url()).not.toContain('#');
  await page.getByTestId('login-notice-ok').click();
  expect((await fakeState(page))!.user.tickets).toBe(3);
  await openAccount(page);
  await expect(page.getByTestId('account-email')).toHaveCount(0);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 3 枚');
});

test.describe('やめた・窓が開かない', () => {
  test('窓を閉じた（auth/popup-closed-by-user）: 「ログインを やめました」。まだ押せる', async ({ page }) => {
    await openHome(page, { loginFail: 'auth/popup-closed-by-user' });
    await openAccount(page);
    await sectionReady(page);
    await popupButton(page).click();
    await expect(page.getByTestId('account-message')).toHaveText(MSG.cancelled);
    await expect(page.getByTestId('account-email')).toHaveCount(0);
    await expect(popupButton(page)).toBeEnabled();
  });

  test('窓を止められた（auth/popup-blocked）: 「方法 2 を試してください」', async ({ page }) => {
    await openHome(page, { loginFail: 'auth/popup-blocked' });
    await openAccount(page);
    await sectionReady(page);
    await popupButton(page).click();
    await expect(page.getByTestId('account-message')).toHaveText(MSG.noPopup);
    await expect(page.getByTestId('account-email')).toHaveCount(0);
  });

  test('方法 2 で Google が断った（access_denied）: ホームの知らせに「ログインを やめました」', async ({ page }) => {
    await openHome(page, { loginFail: 'access_denied' });
    await openAccount(page);
    await sectionReady(page);
    await redirectButton(page).click();
    await expect(page.getByTestId('login-notice')).toContainText(MSG.cancelled, { timeout: 30_000 });
    expect(page.url()).not.toContain('#');
    await page.getByTestId('login-notice-ok').click();
    await openAccount(page);
    await expect(page.getByTestId('account-email')).toHaveCount(0);
  });
});

test.describe('よその #', () => {
  test('覚えが無いのに、にせの戻り（#state=…&id_token=…）で開かれた: # を消して、「ログインできませんでした」。利用者は変わらない', async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('dressup_fake_options')) localStorage.setItem('dressup_fake_options', JSON.stringify({ delayMs: 300, planMs: 200, tickets: 5 }));
    });
    await page.goto(`${FAKE}&home=0#state=zzz&id_token=x.y.z`); // home=0 はゲームの画面
    await expect(page.getByTestId('login-notice')).toContainText(MSG.failed, { timeout: 30_000 });
    expect(page.url()).not.toContain('#');
    expect(page.url()).toContain('studio=fake');
    const state = (await fakeState(page))!;
    expect(state.user.tickets).toBe(5);
    await page.getByTestId('login-notice-ok').click();
    await expect(page.getByTestId('login-notice')).toHaveCount(0);
    expect((await page.evaluate(() => localStorage.getItem('dressup_fake_account'))) ?? '').not.toContain('true');
  });

  test('ログインの戻りでない #foo は、そのまま。知らせも出ない', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('dressup_fake_options', JSON.stringify({ delayMs: 300, planMs: 200 })));
    await page.goto(`${FAKE}&home=0#foo`);
    await page.waitForSelector('.app');
    await page.waitForTimeout(1500);
    expect(new URL(page.url()).hash).toBe('#foo');
    await expect(page.getByTestId('login-notice')).toHaveCount(0);
  });
});

test('縦のスマホ（390×844）: 欄の 2 つのボタンが、画面の幅に収まっている', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await openAccount(page);
  await sectionReady(page);
  for (const button of [popupButton(page), redirectButton(page)]) {
    const box = (await button.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
});
