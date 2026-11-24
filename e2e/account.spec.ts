/**
 * E2Eテスト: 「つくる」の「アカウント」の欄（Google のアカウントでログイン・ログアウト）。裏側は、端末の中だけで動く偽物（?studio=fake）
 *
 * 偽物の裏側も、本物と同じ段取り（src/cloud/account.ts）を通る。方法 2 の「画面を移る」だけが、にせの戻り（# を付けて読み込み直す）。
 */
import { test, expect, type Page } from '@playwright/test';
import { APP, dismissReveal, FAKE, fakeState, openHome, openStudio, order } from './helpers';

const EMAIL = 'tameshi@example.com';
const MSG = {
  done: 'Google のアカウントでログインしました',
  merged: 'Google のアカウントでログインしました。この端末のチケットと服を、アカウントに合わせました',
  mergeLater: 'Google のアカウントでログインしました。この端末のチケットと服は、インターネットにつながったときに、合わせます',
  oldServer: 'この Google のアカウントは、ほかの端末で使われています。サーバーが古い版のため、まだ合わせられません（作者が載せ直す必要があります）',
  pressAgain: 'もう一度「小さい窓でログイン」を押すと、この端末のチケットと服を合わせて、ログインします',
  adminNote: 'この端末は管理者でしたが、合わせたので、管理者の印が外れました',
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
async function makeOne(page: Page, theme = 'うみ') {
  await openStudio(page);
  await order(page, { label: 'トップス' }, theme);
  await expect(page.getByTestId('studio-job')).toHaveCount(0, { timeout: 15_000 });
  await dismissReveal(page);
  await page.getByTestId('studio-close').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
}
const closetItems = async (page: Page) => {
  await page.getByTestId('home-closet').click();
  await expect(page.getByTestId('closet')).toBeVisible({ timeout: 60_000 });
};
// 偽物の設定を、あとから書き換えて、読み込み直す（設定は、起動のときに読まれる）
async function patchOptions(page: Page, patch: Record<string, unknown>) {
  await page.evaluate((p) => {
    const saved = JSON.parse(localStorage.getItem('dressup_fake_options') ?? '{}') as Record<string, unknown>;
    localStorage.setItem('dressup_fake_options', JSON.stringify({ ...saved, ...p }));
  }, patch);
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
}
// 2 台めの端末を用意する（本物の画面の操作で）:
//   Google のアカウントの世界 = チケット 5・服 1 点（うみのトップス）。ログアウトして、置いてある（dressup_fake_google）
//   この端末 = 別の匿名の利用者。チケット 3・服 1 点（ほしのトップス）。ホームに戻った状態
// 服の ID は、偽物の中の通し番号から付くので、アカウントの世界と同じ ID にならないように、番号を進めてから作る
async function setupSecondDevice(page: Page, options: Record<string, unknown> = {}, admin = false) {
  await openHome(page, { tickets: 6 });
  await makeOne(page, 'うみ');
  await openAccount(page);
  await sectionReady(page);
  await popupButton(page).click();
  await expect(page.getByTestId('account-email')).toBeVisible();
  await page.getByTestId('account-logout').click();
  await page.getByTestId('account-logout-yes').click();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 30_000 });
  expect(await page.evaluate(() => localStorage.getItem('dressup_fake_google'))).not.toBeNull();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('dressup_fake_backend')!) as { user: { tickets: number }; counter: number };
    state.user.tickets = 4;
    state.counter = 10;
    localStorage.setItem('dressup_fake_backend', JSON.stringify(state));
  });
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await makeOne(page, 'ほし');
  expect((await fakeState(page))!.user.tickets).toBe(3);
  if (admin) {
    await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('dressup_fake_backend')!) as { user: { admin: boolean } };
      state.user.admin = true;
      localStorage.setItem('dressup_fake_backend', JSON.stringify(state));
    });
  }
  await patchOptions(page, options);
}
// 合わさったあとの確かめ: チケット 8 枚・服 2 点（うみ・ほし）・「ログイン中」
async function expectMerged(page: Page) {
  await openAccount(page);
  await expect(page.getByTestId('account-email')).toContainText('ログイン中');
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 8 枚');
  await page.getByTestId('studio-close').click();
  await closetItems(page);
  await expect(page.getByTestId('closet-item')).toHaveCount(2);
  await expect(page.getByTestId('closet-item').filter({ hasText: 'うみのトップス' })).toHaveCount(1);
  await expect(page.getByTestId('closet-item').filter({ hasText: 'ほしのトップス' })).toHaveCount(1);
}
const noticeOk = async (page: Page) => {
  await page.getByTestId('login-notice-ok').click();
  await expect(page.getByTestId('login-notice')).toHaveCount(0);
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

test('合わさる（主の方法）: 空でない端末（チケット 3・服 1）が、もう使われている Google（チケット 5・服 1）に画面を移ってログイン → 知らせ → チケット 8 枚・服 2 点。URL に # は残らない', async ({ page }) => {
  await setupSecondDevice(page);
  await openAccount(page);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 3 枚');
  await expect(page.getByTestId('account-email')).toHaveCount(0);
  await sectionReady(page);
  await redirectButton(page).click();
  await expect(page.getByTestId('login-notice')).toContainText(MSG.merged, { timeout: 30_000 });
  await expect(page.getByTestId('login-notice')).not.toContainText(MSG.adminNote);
  expect(page.url()).not.toContain('#');
  await noticeOk(page);
  await expectMerged(page);
  // 合い言葉の覚えは、残っていない。置いてあった Google の世界も、もう無い
  expect(await page.evaluate(() => localStorage.getItem('dressup_adopt_pending'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('dressup_fake_google'))).toBeNull();
  // 読み込み直しても、続く（2 重に足されない）
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await openAccount(page);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 8 枚');
  const state = (await fakeState(page))!;
  expect(state.user.tickets).toBe(8);
  expect(state.items).toHaveLength(2);
});

test('合わさる（画面なしの行き来）: 断りと一緒に返る証明が無い（stashed: false）と、画面なしの行き来で入って、同じ結果。URL に # は残らない', async ({ page }) => {
  await setupSecondDevice(page, { stashed: false });
  await openAccount(page);
  await sectionReady(page);
  await redirectButton(page).click();
  await expect(page.getByTestId('login-notice')).toContainText(MSG.merged, { timeout: 30_000 });
  expect(page.url()).not.toContain('#');
  expect(new URL(page.url()).hash).toBe('');
  await noticeOk(page);
  await expectMerged(page);
});

test('合わさる（選ぶ画面つきの行き来）: 画面なしを Google が断る（silentFail）と、選ぶ画面つきで入って、同じ結果', async ({ page }) => {
  await setupSecondDevice(page, { stashed: false, silentFail: true });
  await openAccount(page);
  await sectionReady(page);
  await redirectButton(page).click();
  await expect(page.getByTestId('login-notice')).toContainText(MSG.merged, { timeout: 30_000 });
  expect(page.url()).not.toContain('#');
  await noticeOk(page);
  await expectMerged(page);
  await page.getByTestId('closet-close').click();
  // 行き来の段階が、きろくに残っている
  const text = await diagText(page);
  for (const word of ['login switch silent', 'login back error=interaction_required', 'login switch chooser', 'login result merged']) expect(text).toContain(word);
});

test('adopt が落ちる（adoptFail: 2。合わせる場面と、読み込み直した直後のやり直しの 2 回）: 「つながったときに、合わせます」。チケットは 5 枚のまま・端末の服は残る。読み込み直すと、合わさる（8 枚・2 点）', async ({ page }) => {
  await setupSecondDevice(page, { adoptFail: 2 });
  await openAccount(page);
  await sectionReady(page);
  await redirectButton(page).click();
  await expect(page.getByTestId('login-notice')).toContainText(MSG.mergeLater, { timeout: 30_000 });
  await noticeOk(page);
  // まだ合っていない: アカウントの 5 枚。端末の服（ほしのトップス）は、端末の控えに残っている
  const mid = (await fakeState(page))!;
  expect(mid.user.tickets).toBe(5);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dressup_adopt_pending') ?? 'null')?.stage)).toBe('switched');
  await openAccount(page);
  await expect(page.getByTestId('account-email')).toContainText('ログイン中');
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 5 枚');
  await page.getByTestId('studio-close').click();
  await closetItems(page);
  await expect(page.getByTestId('closet-item').filter({ hasText: 'ほしのトップス' })).toHaveCount(1);
  await page.getByTestId('closet-close').click();

  // 読み込み直す（次の起動）: もう一度 adopt して、合わさる。（直前の読み込み直しでの 1 回めのやり直しは、落ちている）
  await page.reload();
  await expect(page.getByTestId('login-notice')).toContainText('この端末のチケットと服を、アカウントに合わせました', { timeout: 30_000 });
  await noticeOk(page);
  await expectMerged(page);
  expect(await page.evaluate(() => localStorage.getItem('dressup_adopt_pending'))).toBeNull();
});

test('古いサーバー（noAdopt）: 「サーバーが古い版のため、まだ合わせられません」。チケット 3 枚のまま・ログイン前のまま。覚えも残らない', async ({ page }) => {
  await setupSecondDevice(page, { noAdopt: true });
  await openAccount(page);
  await sectionReady(page);
  await redirectButton(page).click();
  await expect(page.getByTestId('login-notice')).toContainText(MSG.oldServer, { timeout: 30_000 });
  expect(page.url()).not.toContain('#');
  await noticeOk(page);
  expect((await fakeState(page))!.user.tickets).toBe(3);
  expect(await page.evaluate(() => localStorage.getItem('dressup_adopt_pending'))).toBeNull();
  await openAccount(page);
  await expect(page.getByTestId('account-email')).toHaveCount(0);
  await expect(page.getByTestId('studio-tickets')).toContainText('のこり 3 枚');
  await page.getByTestId('studio-close').click();
  await closetItems(page);
  await expect(page.getByTestId('closet-item')).toHaveCount(1);
  // 置いてある Google の世界も、そのまま
  expect(await page.evaluate(() => localStorage.getItem('dressup_fake_google'))).not.toBeNull();
});

test.describe('小さい窓で合わさる', () => {
  test('証明が返る: 「小さい窓でログイン」→ 読み込み直しのあと、知らせ → 8 枚・2 点', async ({ page }) => {
    await setupSecondDevice(page);
    await openAccount(page);
    await sectionReady(page);
    await popupButton(page).click();
    await expect(page.getByTestId('login-notice')).toContainText(MSG.merged, { timeout: 30_000 });
    await noticeOk(page);
    await expectMerged(page);
  });

  test('証明が返らない（stashed: false）: 「もう一度「小さい窓でログイン」を押すと…」→ もう一度押す → 合わさる', async ({ page }) => {
    await setupSecondDevice(page, { stashed: false });
    await openAccount(page);
    await sectionReady(page);
    await popupButton(page).click();
    await expect(page.getByTestId('account-message')).toHaveText(MSG.pressAgain);
    await expect(page.getByTestId('account-email')).toHaveCount(0);
    expect((await fakeState(page))!.user.tickets).toBe(3);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dressup_adopt_pending') ?? 'null')?.stage)).toBe('offered');
    await expect(popupButton(page)).toBeEnabled();
    await popupButton(page).click();
    await expect(page.getByTestId('login-notice')).toContainText(MSG.merged, { timeout: 30_000 });
    await noticeOk(page);
    await expectMerged(page);
  });
});

test('管理者の端末: 同じく合わさって、知らせに「この端末は管理者でしたが…」が入る', async ({ page }) => {
  await setupSecondDevice(page, {}, true);
  await openAccount(page);
  await sectionReady(page);
  await redirectButton(page).click();
  await expect(page.getByTestId('login-notice')).toContainText(MSG.merged, { timeout: 30_000 });
  await expect(page.getByTestId('login-notice')).toContainText(MSG.adminNote);
  await expect(page.getByTestId('login-notice')).toContainText('手順書 2-11');
  await noticeOk(page);
  await expectMerged(page);
});

test('きろく: 合わさったあと、「--- ログイン ---」に段取りの行がある。メールも合い言葉も証明も無い', async ({ page }) => {
  await setupSecondDevice(page);
  await openAccount(page);
  await sectionReady(page);
  await redirectButton(page).click();
  await expect(page.getByTestId('login-notice')).toContainText(MSG.merged, { timeout: 30_000 });
  await noticeOk(page);
  const text = await diagText(page);
  expect(text).toContain('--- ログイン ---');
  const section = text.slice(text.indexOf('--- ログイン ---'));
  for (const word of ['login offer ok', 'login switch stashed', 'login adopt ok tickets=3 items=1', 'login result merged']) expect(section).toContain(word);
  // 画面の大きさの「1180x820@1」にも @ があるので、ログインの行だけを見る
  const loginLines = section.split('\n').filter((line) => line.includes(' login '));
  expect(loginLines.length).toBeGreaterThanOrEqual(5);
  expect(loginLines.join('\n')).not.toContain('@');
  expect(text).not.toContain('example.com');
  expect(text).not.toContain('id_token');
  expect(text).not.toContain('fake-sub');
  // 合い言葉（32 桁の 16 進）は、出ない
  expect(text).not.toMatch(/[0-9a-f]{32}/);
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

  test('「つくる」を教えていない端末: にせの戻り（#state=…&id_token=…）の # は消え、証明は session にも残らない', async ({ page }) => {
    await page.goto(`${APP}&studio=0&home=0#state=zzz&id_token=x.y.z`);
    await page.waitForSelector('.app');
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain('#');
    expect(await page.evaluate(() => sessionStorage.getItem('dressup_login_return'))).toBeNull();
    await expect(page.getByTestId('login-notice')).toHaveCount(0);
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
