/**
 * E2Eテスト: ドラッグ＆ドロップで着せ替え
 */
import { test, expect } from '@playwright/test';

// テストモードのURL（PixiJSを無効化）
const TEST_URL = 'http://localhost:5173/DressUpGame/?test=true';

test.describe('着せ替えゲーム', () => {
  test.beforeEach(async ({ page }) => {
    // コンソールエラーを監視
    page.on('pageerror', err => {
      console.log('Page Error:', err.message);
    });

    // テストモードでアクセス
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.app', { timeout: 10000 });
  });

  test('ページが正しく表示される', async ({ page }) => {
    // タイトルが表示される
    await expect(page.locator('h1')).toContainText('きせかえ');

    // キャンバス（またはプレースホルダー）が表示される
    await expect(page.getByTestId('avatar-canvas')).toBeVisible();

    // 服パレットが表示される
    await expect(page.getByTestId('clothing-palette')).toBeVisible();
  });

  test('服アイテムが表示される', async ({ page }) => {
    // 少なくとも1つの服アイテムが存在する
    const clothingItems = page.locator('[data-testid^="clothing-item-"]');
    await expect(clothingItems.first()).toBeVisible();
  });

  test('服をドラッグ＆ドロップで着せることができる', async ({ page }) => {
    // トップスとキャンバスを取得
    const topItem = page.getByTestId('clothing-item-top-1');
    const canvas = page.getByTestId('avatar-canvas');
    
    await expect(topItem).toBeVisible();
    await expect(canvas).toBeVisible();

    // ドラッグ＆ドロップで着せる
    await topItem.dragTo(canvas);

    // 装備リストに追加される（リセットボタンが表示される）
    await expect(page.getByRole('button', { name: /リセット/ })).toBeVisible();
  });

  test('リセットボタンで服を脱がせることができる', async ({ page }) => {
    // 服をドラッグ＆ドロップで着せる
    const topItem = page.getByTestId('clothing-item-top-1');
    const canvas = page.getByTestId('avatar-canvas');
    await topItem.dragTo(canvas);

    // リセットボタンをクリック
    const resetButton = page.getByRole('button', { name: /リセット/ });
    await expect(resetButton).toBeVisible();
    await resetButton.click();

    // リセットボタンが消える（装備がクリアされる）
    await expect(resetButton).not.toBeVisible();
  });
});

// iPadタッチテスト
test.describe('iPadタッチ操作', () => {
  test.use({ hasTouch: true });

  test('iPadでドラッグ＆ドロップ操作ができる', async ({ page }) => {
    await page.goto(TEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('.app', { timeout: 10000 });

    // タッチデバイスでのドラッグ＆ドロップテスト
    const topItem = page.getByTestId('clothing-item-top-1');
    const canvas = page.getByTestId('avatar-canvas');
    
    await expect(topItem).toBeVisible();
    await expect(canvas).toBeVisible();

    // タッチでドラッグ＆ドロップ
    await topItem.dragTo(canvas);

    // リセットボタンが表示される
    await expect(page.getByRole('button', { name: /リセット/ })).toBeVisible();
  });
});
