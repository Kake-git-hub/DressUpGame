/**
 * E2Eテスト: 着せる → 調整 → 再読み込みで復元 → 写真
 * テスト用の素材は e2e/globalSetup.ts が dist/e2e-content に用意する
 */
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';

type Rgba = [number, number, number, number];

// 画面とレイアウト（App.tsx / PixiEngine.ts と同じ計算）
const VIEW_W = 1180;
const VIEW_H = 820;
const MENU_W = 160;
const RIGHT_W = 60;
const IMG = 1024; // テスト画像の一辺
const BASE_SCALE = (VIEW_H * 0.9) / 1024; // ドール・服の表示倍率
const DOLL_X = MENU_W + (VIEW_W - MENU_W - RIGHT_W) / 2; // ドール中心X
const DOLL_Y = VIEW_H / 2; // ドール中心Y
const imgY = (y: number) => DOLL_Y + (y - IMG / 2) * BASE_SCALE;
const TOP_Y = imgY(380); // トップス(y=240〜520)の中央
const BOTTOM_Y = imgY(660); // ボトムス(y=520〜800)の中央
const BG_Y = 20; // ドールの外（背景だけが見える位置）
const ADJUST_DX = 220; // 調整で動かす量（服の幅の半分より大きい）

const SKIN: Rgba = [255, 224, 192, 255];
const RED: Rgba = [255, 0, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const GREEN: Rgba = [0, 160, 0, 255];
const BG: Rgba = [255, 255, 128, 255];

// テスト用の素材を読む起動 URL
const APP_URL = '/DressUpGame/?content=e2e-content/';

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept());
  await page.goto(APP_URL);
  await page.waitForSelector('.app');
});

function near(a: Rgba, b: Rgba, tolerance = 8): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
}

/** #avatar-canvas の1画素を読む（座標はビューポートのCSSピクセル） */
async function canvasPixel(page: Page, x: number, y: number): Promise<Rgba> {
  return page.evaluate(
    ([px, py]) => {
      const src = document.querySelector('#avatar-canvas') as HTMLCanvasElement | null;
      if (!src) return [0, 0, 0, 0] as [number, number, number, number];
      const rect = src.getBoundingClientRect();
      const sx = Math.round(((px - rect.left) / rect.width) * src.width);
      const sy = Math.round(((py - rect.top) / rect.height) * src.height);
      const out = document.createElement('canvas');
      out.width = 1;
      out.height = 1;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(src, sx, sy, 1, 1, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3]] as [number, number, number, number];
    },
    [x, y]
  );
}

async function expectPixel(page: Page, x: number, y: number, color: Rgba): Promise<void> {
  await expect
    .poll(async () => near(await canvasPixel(page, x, y), color), {
      message: `(${Math.round(x)}, ${Math.round(y)}) が ${color.join(',')} になる`,
      timeout: 20_000,
    })
    .toBe(true);
}

async function waitForMenu(page: Page): Promise<void> {
  await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible({ timeout: 60_000 });
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
}

/** メニューとドールが出るまで待つ */
async function openApp(page: Page): Promise<void> {
  await waitForMenu(page);
}

async function openCategory(page: Page, category: string): Promise<void> {
  await page.locator('.palette-section button', { hasText: category }).first().click();
  await expect(page.locator('.palette-section button', { hasText: 'もどる' })).toBeVisible();
}

async function backToCategories(page: Page): Promise<void> {
  const back = page.locator('.palette-section button', { hasText: 'もどる' });
  if (await back.isVisible()) await back.click();
  await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible();
}

async function itemCenter(page: Page, name: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(`.palette-section img[alt="${name}"]`).first().boundingBox();
  if (!box) throw new Error(`item ${name} not found`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** カテゴリを開いて、名前で指定したアイテムをドールへドラッグし、カテゴリ一覧へ戻る */
async function dragItemToDoll(page: Page, category: string, name: string): Promise<void> {
  await openCategory(page, category);
  const from = await itemCenter(page, name);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, DOLL_Y, { steps: 4 });
  await page.mouse.up();
  await backToCategories(page);
}

test('取り込み → 着せる → 着替え → 再読み込みで復元', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await dragItemToDoll(page, 'トップス', 'blue'); // 同カテゴリは入れ替え
  await expectPixel(page, DOLL_X, TOP_Y, BLUE);
  await dragItemToDoll(page, 'ボトムス', 'green');
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);

  await page.reload();
  await page.waitForSelector('.app');
  await expectPixel(page, DOLL_X, TOP_Y, BLUE);
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
});

test('タップだけでは着ない（現状の動作）', async ({ page }) => {
  await openApp(page);
  await openCategory(page, 'トップス');
  const at = await itemCenter(page, 'red');
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(800);
  expect(near(await canvasPixel(page, DOLL_X, TOP_Y), SKIN)).toBe(true);
});

test('「なし」で脱げる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await openCategory(page, 'トップス');
  await page.locator('.palette-section button', { hasText: 'なし' }).click();
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
});

test('調整: 動かして完了すると位置が変わり、再読み込み後も保たれる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);

  await page.locator('.tool-button').first().click();
  await expect(page.locator('.item-adjust-overlay')).toBeVisible();
  await page.mouse.move(DOLL_X, DOLL_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X + ADJUST_DX, DOLL_Y, { steps: 6 });
  await page.mouse.up();
  await page.locator('.item-adjust-done-btn-small').click();

  await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, RED);
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);

  await page.reload();
  await page.waitForSelector('.app');
  await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, RED);
});

test('背景を選ぶと背景色が出て、リセットで服と背景が外れる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);

  await openCategory(page, 'はいけい');
  const at = await itemCenter(page, 'bg');
  await page.mouse.click(at.x, at.y); // 背景はタップで適用
  await expectPixel(page, DOLL_X, BG_Y, BG);
  await backToCategories(page);

  await page.locator('.reset-button-fixed').click(); // confirm は自動で承認
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
  await expect
    .poll(async () => (await canvasPixel(page, DOLL_X, BG_Y))[3], { timeout: 20_000 })
    .toBe(0);
});

test('写真: ダウンロードされる PNG が空でない', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.tool-button').nth(1).click(),
  ]);
  const file = await download.path();
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect(info.width).toBeGreaterThan(100);
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 0) opaque++;
  expect(opaque).toBeGreaterThan(1000);
});

test('ドラッグ中に服の再描画と保存が起きない', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await page.waitForTimeout(1500); // 着せた直後の処理が落ち着くのを待つ

  let redraws = 0;
  page.on('console', (m) => {
    if (m.text().includes('服コンテナをキャッシュしました')) redraws++;
  });
  await page.evaluate(() => {
    const w = window as unknown as { __setItemCalls: number };
    w.__setItemCalls = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      w.__setItemCalls++;
      return original.call(this, key, value);
    };
  });

  await openCategory(page, 'トップス');
  const from = await itemCenter(page, 'blue');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 40; i++) {
    await page.mouse.move(from.x + i * 10, from.y + i * 3);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(300);
  const setItemCalls = await page.evaluate(
    () => (window as unknown as { __setItemCalls: number }).__setItemCalls
  );
  const redrawsDuringDrag = redraws;
  await page.mouse.up();

  expect(redrawsDuringDrag).toBe(0);
  expect(setItemCalls).toBe(0);
});

test('着ている服の保存は 1 枚 300 バイト以下', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await dragItemToDoll(page, 'ボトムス', 'green');
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
  await page.waitForTimeout(500);
  const saved = await page.evaluate(() => localStorage.getItem('dressup_outfit'));
  expect(saved).not.toBeNull();
  const entries = JSON.parse(saved ?? '[]') as unknown[];
  expect(entries.length).toBe(2);
  expect((saved ?? '').length / entries.length).toBeLessThanOrEqual(300);
});

test('ドラッグが pointercancel で終わるとプレビューが消え、服は着ない', async ({ page }) => {
  await openApp(page);
  await openCategory(page, 'トップス');
  const from = await itemCenter(page, 'red');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, DOLL_Y, { steps: 4 });
  const preview = page.getByTestId('drag-preview');
  await expect(preview).toBeVisible();

  // 着信やシステムジェスチャーで中断されたときと同じイベントを送る
  await page.locator('.palette-section img[alt="red"]').evaluate((img) => {
    img.parentElement?.parentElement?.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true }));
  });
  await expect(preview).toBeHidden();
  await page.mouse.up();
  await page.waitForTimeout(500);
  expect(near(await canvasPixel(page, DOLL_X, TOP_Y), SKIN)).toBe(true);
});

test('ドラッグ中、プレビューは指の位置に付いてくる', async ({ page }) => {
  await openApp(page);
  await openCategory(page, 'トップス');
  const from = await itemCenter(page, 'red');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(700, 300, { steps: 4 });
  const box = await page.getByTestId('drag-preview').boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x + box!.width / 2 - 700)).toBeLessThanOrEqual(2);
  expect(Math.abs(box!.y + box!.height / 2 - 300)).toBeLessThanOrEqual(2);
  // メニューやボタンより下に描く（メニュー上の操作を隠さない）
  const z = await page.evaluate(() => ({
    preview: Number(getComputedStyle(document.querySelector('[data-testid="drag-preview"]')!).zIndex),
    menu: Number(getComputedStyle(document.querySelector('.palette-section')!).zIndex),
  }));
  expect(z.preview).toBeLessThan(z.menu);
  await page.mouse.up();
});

test('服を着ていないとき、調整ボタンでドールを動かせる', async ({ page }) => {
  await openApp(page);
  await page.locator('.tool-button').first().click();
  await expect(page.locator('.item-adjust-overlay')).toBeVisible();
  await page.mouse.move(DOLL_X, DOLL_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X + ADJUST_DX, DOLL_Y, { steps: 6 });
  await page.mouse.up();
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, SKIN);
  await expect
    .poll(async () => (await canvasPixel(page, DOLL_X - 100, TOP_Y))[3], { timeout: 20_000 })
    .toBe(0);
});

test('服の画像が読めなかった起動では、保存済みの服装を上書きしない', async ({ page }) => {
  await openApp(page);
  // 画像が見つからない服だけを着ていた、という保存データを置く（読み込み失敗と同じ結果になる）
  const saved = JSON.stringify([{ id: 'missing-item', equipOrder: 0, adjustScale: 1.2 }]);
  await page.evaluate((v) => localStorage.setItem('dressup_outfit', v), saved);
  await page.reload();
  await page.waitForSelector('.app');
  await waitForMenu(page);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => localStorage.getItem('dressup_outfit'))).toBe(saved);

  // 自分で着せ替えたら、その時点の服装で保存される
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await expect
    .poll(async () => JSON.parse((await page.evaluate(() => localStorage.getItem('dressup_outfit'))) ?? '[]').length)
    .toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('dressup_outfit'))).not.toContain('missing-item');
});

/** #avatar-canvas 上で、指定色の領域の中心を求める（CSSピクセル） */
async function colorCenter(page: Page, color: Rgba): Promise<{ x: number; y: number }> {
  return page.evaluate((c) => {
    const src = document.querySelector('#avatar-canvas') as HTMLCanvasElement;
    const rect = src.getBoundingClientRect();
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const ctx = out.getContext('2d')!;
    ctx.drawImage(src, 0, 0);
    const d = ctx.getImageData(0, 0, out.width, out.height).data;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        const i = (y * out.width + x) * 4;
        if (Math.abs(d[i] - c[0]) <= 8 && Math.abs(d[i + 1] - c[1]) <= 8 && Math.abs(d[i + 2] - c[2]) <= 8 && d[i + 3] > 250) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return {
      x: rect.left + (((minX + maxX + 1) / 2) / src.width) * rect.width,
      y: rect.top + (((minY + maxY + 1) / 2) / src.height) * rect.height,
    };
  }, color);
}

test('調整: プレビューで置いた位置と、確定後の位置が一致する（ずれ 1px 未満）', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);

  await page.locator('.tool-button').first().click();
  const preview = page.locator('.item-adjust-overlay img[alt="調整プレビュー"]');
  await expect(preview).toBeVisible();
  await page.mouse.move(DOLL_X, DOLL_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X + 73, DOLL_Y + 41, { steps: 5 });
  await page.mouse.up();

  // プレビュー画像は切り抜き済みの服そのものなので、その中心が赤い矩形の中心
  const box = (await preview.boundingBox())!;
  const previewCenter = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X + 73, TOP_Y + 41, RED);
  const committed = await colorCenter(page, RED);

  expect(Math.abs(committed.x - previewCenter.x)).toBeLessThan(1);
  expect(Math.abs(committed.y - previewCenter.y)).toBeLessThan(1);
});

test('設定ボタンは無い（取り込みは廃止）', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.settings-button')).toHaveCount(0);
  await expect(page.locator('.version-badge')).toContainText('v');
});

test('一覧ファイルが取れないとき、案内と「もういちど」が出て、押すと復帰する', async ({ page }) => {
  let failing = true;
  await page.route('**/e2e-content/manifest.json', (route) => (failing ? route.abort() : route.continue()));
  await page.goto(APP_URL);
  await expect(page.getByTestId('status-screen')).toContainText('インターネットにつないでね');
  failing = false;
  await page.getByRole('button', { name: 'もういちど' }).click();
  await waitForMenu(page);
});

test('一覧ファイルが壊れていても、落ちずに案内が出る', async ({ page }) => {
  await page.route('**/e2e-content/manifest.json', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":1,"dolls":"x"}' }));
  await page.goto(APP_URL);
  await expect(page.getByTestId('status-screen')).toContainText('インターネットにつないでね');
});

test('画像 1 枚が 404 でも、他の服は着られる', async ({ page }) => {
  const manifest = await (await page.request.get('/DressUpGame/e2e-content/manifest.json')).json();
  const red = manifest.dolls[0].items.find((i: { name: string }) => i.name === 'red');
  await page.route(`**/e2e-content/${red.image.file}`, (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(APP_URL);
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red'); // 画像が無い服
  await dragItemToDoll(page, 'ボトムス', 'green');
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
  await expectPixel(page, DOLL_X, TOP_Y, SKIN); // 読めなかった服は表示されないだけ
});

test('一覧から消えた服は、その 1 枚だけ外れる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await dragItemToDoll(page, 'ボトムス', 'green');
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
  // 一覧から red を取り除いて配信する
  await page.route('**/e2e-content/manifest.json', async (route) => {
    const response = await route.fetch();
    const manifest = await response.json();
    manifest.dolls[0].items = manifest.dolls[0].items.filter((i: { name: string }) => i.name !== 'red');
    await route.fulfill({ response, json: manifest });
  });
  await page.reload();
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
  expect(near(await canvasPixel(page, DOLL_X, TOP_Y), SKIN)).toBe(true);
});

test('旧方式のデータは初回起動で消え、2 回目以降は服装を消さない', async ({ page }) => {
  await openApp(page);
  // 旧版から更新した直後の状態を作る
  await page.evaluate(() => {
    localStorage.removeItem('dressup_content_v1');
    localStorage.setItem('dressup_custom_clothing', '[{"id":"custom-clothing-1"}]');
    localStorage.setItem('dressup_outfit', '[{"id":"custom-clothing-1","equipOrder":0}]');
  });
  await page.reload();
  await openApp(page);
  expect(await page.evaluate(() => localStorage.getItem('dressup_custom_clothing'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('dressup_outfit'))).toBeNull();

  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await page.reload();
  await expectPixel(page, DOLL_X, TOP_Y, RED);
});

test('縦長の画面では「よこにしてね」が出る', async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId('rotate-notice')).toBeHidden();
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.getByTestId('rotate-notice')).toBeVisible();
  await expect(page.getByTestId('rotate-notice')).toContainText('よこにしてね');
  await page.setViewportSize({ width: VIEW_W, height: VIEW_H });
  await expect(page.getByTestId('rotate-notice')).toBeHidden();
});

test('メニューの並び: カテゴリは並び順どおり、サムネイルは切り抜いた服', async ({ page }) => {
  await openApp(page);
  const labels = await page.locator('.palette-section button').allInnerTexts();
  const names = labels.map((l) => l.split('\n').pop()?.trim());
  expect(names.indexOf('トップス')).toBeLessThan(names.indexOf('ボトムス'));
  await openCategory(page, 'トップス');
  const thumb = page.locator('.palette-section img[alt="red"]');
  const size = await thumb.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(Math.max(...size)).toBe(192);
});
