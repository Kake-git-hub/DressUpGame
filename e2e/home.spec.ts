/**
 * E2Eテスト: ホーム画面（だれにでも出る。「つくる」「クローゼット」は、教えた端末にだけ）
 */
import fs from 'node:fs';
import path from 'node:path';
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
  // 「つくる」まわりのファイル（中身に、その印があるもの）を、1 つも読み込んでいない。
  // （あとから読み込むファイルの名前は index-….js などで、名前では見分けられない）
  const assets = path.resolve('dist/assets');
  const marks = ['dressup_cloud_used', 'dressup_fake_backend', 'studio-make', 'closet-item', 'reveal-close', 'identitytoolkit'];
  const forbidden = fs.readdirSync(assets).filter((file) => file.endsWith('.js') && marks.some((mark) => fs.readFileSync(path.join(assets, file), 'utf8').includes(mark)));
  expect(forbidden.length).toBeGreaterThanOrEqual(5); // つなぎ役・つくる・クローゼット・届いた演出・Firebase
  const loaded = scripts.map((url) => url.split('/').pop()!.split('?')[0]);
  expect(loaded.filter((file) => forbidden.includes(file))).toEqual([]);
  expect(loaded.length).toBeGreaterThan(0);
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

test.describe('ホーム画面に追加の案内（まだアプリとして開いていない人には、だれにでも）', () => {
  // まだ何も覚えていない端末として開く
  test.use({ storageState: { cookies: [], origins: [] } });

  // 「あとで」を押した時刻を、1 日前にずらす（次の日に開いた、ことにする）
  const nextDay = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem('dressup_install_hint')!);
      localStorage.setItem('dressup_install_hint', JSON.stringify({ ...state, at: state.at - 24 * 3_600_000 }));
    });

  test('はじめて開くと、ホームに案内の窓が出る。「あとで」で閉じると、あそんでもどっても、読み込み直しても出ない。次の日は、また出る。合わせて 3 回閉じたら、もう出ない', async ({ page }) => {
    await page.goto(APP);
    await expect(page.getByTestId('install-hint')).toBeVisible();
    // あとで → 閉じる。あそんでホームにもどっても、出ない
    await page.getByTestId('install-hint-later').click();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
    await page.getByTestId('home-play').click();
    // はじめての端末なので、操作ガイドが出る。とばして、ホームへ
    await page.getByTestId('guide-skip').click();
    await gameReady(page);
    await page.getByTestId('home-back-button').click();
    await expect(page.getByTestId('home-screen')).toBeVisible();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
    // 読み込み直しても（自動の更新・ログインの戻りと同じ）、その日は出ない
    await page.reload();
    await expect(page.getByTestId('home-play')).toBeVisible();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
    // 次の日に開くと、また出る。合わせて 3 回閉じたら、何日たっても、もう出ない
    for (let i = 0; i < 2; i++) {
      await nextDay(page);
      await page.goto(APP);
      await expect(page.getByTestId('install-hint')).toBeVisible();
      await page.getByTestId('install-hint-later').click();
    }
    await nextDay(page);
    await page.goto(APP);
    await expect(page.getByTestId('home-play')).toBeVisible();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
  });

  test('もうホーム画面から開いている（アプリとして開いている）人には、出ない', async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(window.navigator, 'standalone', { value: true }));
    await page.goto(APP);
    await expect(page.getByTestId('home-play')).toBeVisible();
    await expect(page.getByTestId('install-hint')).toHaveCount(0);
  });

  test('LINE の中の画面では、「ブラウザで開く」をすすめる', async ({ browser }) => {
    const context = await browser.newContext({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari/604.1 Line/15.18.0', storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(`http://localhost:4173${APP}`);
    await expect(page.getByTestId('install-hint')).toHaveAttribute('data-kind', 'inapp');
    await expect(page.getByTestId('install-hint')).toContainText('ブラウザで開く');
    await context.close();
  });

  for (const size of [
    { name: '小さいスマホの縦', width: 320, height: 480 },
    { name: 'スマホの横', width: 667, height: 375 },
    { name: '小さいスマホの横', width: 568, height: 320 },
    { name: 'タブレットの縦', width: 820, height: 1180 },
  ]) {
    test(`案内の窓は、画面に収まり、「あとで」が押せる（${size.name}）`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.goto(APP);
      for (const id of ['install-hint', 'install-hint-later']) {
        const box = (await page.getByTestId(id).boundingBox())!;
        expect(box.x, id).toBeGreaterThanOrEqual(0);
        expect(box.y, id).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, id).toBeLessThanOrEqual(size.width);
        expect(box.y + box.height, id).toBeLessThanOrEqual(size.height);
      }
      await page.getByTestId('install-hint-later').click();
      await expect(page.getByTestId('install-hint')).toHaveCount(0);
      // 閉じたら、ホームのボタンは、そのまま押せる
      await page.getByTestId('home-play').click();
      await expect(page.getByTestId('home-screen')).toHaveCount(0);
    });
  }
});
