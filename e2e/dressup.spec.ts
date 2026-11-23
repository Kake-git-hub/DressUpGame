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
// ゲームの画面を直接開く（ホームを飛ばす。?home=0 は、テストと確認用）
const APP_URL = '/DressUpGame/?content=e2e-content/&home=0';

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

test('服のメニューに「なし」は無く、上下の ▲▼ がある', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await openCategory(page, 'トップス');
  await expect(page.locator('.palette-section button', { hasText: 'なし' })).toHaveCount(0);
  await expect(page.getByTestId('menu-scroll-up')).toBeVisible();
  await expect(page.getByTestId('menu-scroll-down')).toBeVisible();
  await expect(page.getByTestId('menu-scroll-up')).toBeDisabled(); // いちばん上にいる
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
    page.getByTestId('screenshot-button').click(),
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
  const preview = page.getByTestId('adjust-preview');
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

// 通信を差し替えるテスト。サービスワーカー経由の通信は差し替えられないので、無効にして実行する
test.describe('素材の取得に失敗したとき', () => {
  test.use({ serviceWorkers: 'block' });

  test('一覧ファイルが取れないとき、案内と「もういちど」が出て、押すと復帰する', async ({ page }) => {
    let failing = true;
    await page.route('**/e2e-content/manifest.json', (route) => (failing ? route.abort() : route.continue()));
    await page.goto(APP_URL);
    await expect(page.getByTestId('status-screen')).toContainText('インターネットにつないでね');
    // どの版で止まっているかが分かるように、この画面にも版数を出す
    await expect(page.locator('.version-badge')).toBeVisible();
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

  test('読み込みの遅い服の後に別の服を着せると、後から着せた服が残る', async ({ page }) => {
    const manifest = await (await page.request.get('/DressUpGame/e2e-content/manifest.json')).json();
    const red = manifest.dolls[0].items.find((i: { name: string }) => i.name === 'red');
    await page.route(`**/e2e-content/${red.image.file}`, async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.goto(APP_URL);
    await openApp(page);
    await dragItemToDoll(page, 'トップス', 'red'); // 画像が届くまで 2.5 秒かかる
    await dragItemToDoll(page, 'トップス', 'blue'); // すぐ着替える
    await expectPixel(page, DOLL_X, TOP_Y, BLUE);
    await page.waitForTimeout(3500); // 遅れて届いた red が上書きしないこと
    expect(near(await canvasPixel(page, DOLL_X, TOP_Y), BLUE)).toBe(true);
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

test('縦長の画面では、縦の配置になる（「よこにしてね」は出ない）。横に戻すと、横の配置に戻る', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.app')).toHaveAttribute('data-orientation', 'landscape');
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator('.app')).toHaveAttribute('data-orientation', 'portrait');
  await expect(page.getByTestId('rotate-notice')).toHaveCount(0);
  // キャンバスは、幅いっぱい × 正方形の一辺（服を 2 段にする分、幅より少し低い 776）で、上に置く
  await expect.poll(async () => page.getByTestId('avatar-canvas').boundingBox()).toEqual({ x: 0, y: 0, width: 820, height: 776 });
  // ドールは正方形の中央（胴のあたりに肌の色）
  await expectPixel(page, 410, 388 + (380 - IMG / 2) * ((776 * 0.9) / 1024), SKIN);
  await page.setViewportSize({ width: VIEW_W, height: VIEW_H });
  await expect(page.locator('.app')).toHaveAttribute('data-orientation', 'landscape');
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
});

test('メニューの並び: カテゴリは並び順どおり、サムネイルは切り抜いた服', async ({ page }) => {
  await openApp(page);
  const labels = await page.locator('.palette-section button').allInnerTexts();
  const names = labels.map((l) => l.split('\n').pop()?.trim());
  expect(names.indexOf('トップス')).toBeLessThan(names.indexOf('ボトムス'));
  // セットのあるドールでは、「セット」が服のカテゴリより前に出る
  expect(names.indexOf('セット')).toBeGreaterThanOrEqual(0);
  expect(names.indexOf('セット')).toBeLessThan(Math.min(...['トップス', 'ボトムス', 'くつ', 'ソックス'].map((n) => names.indexOf(n))));
  await openCategory(page, 'トップス');
  const thumb = page.locator('.palette-section img[alt="red"]');
  const size = await thumb.evaluate((img: HTMLImageElement) => [img.naturalWidth, img.naturalHeight]);
  expect(Math.max(...size)).toBe(192);
});

test('初めて開いた 1 回だけで、オフラインでも開けて、まだ着ていない服も着られる', async ({ page, context }) => {
  await openApp(page);
  // 開き直さずに、先読みが終わるのを待つ
  await page.waitForFunction(() => document.documentElement.dataset.prefetch === 'test', null, { timeout: 60_000 });

  await context.setOffline(true);
  await page.reload();
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'blue');
  await expectPixel(page, DOLL_X, TOP_Y, BLUE);
  await openCategory(page, 'はいけい');
  const at = await itemCenter(page, 'bg');
  await page.mouse.click(at.x, at.y);
  await expectPixel(page, DOLL_X, BG_Y, BG);
  await context.setOffline(false);
});

/** 画面（キャンバスの上に重なる調整プレビューを含む）の 1 画素を読む */
async function screenPixel(page: Page, x: number, y: number): Promise<Rgba> {
  const shot = await page.screenshot({ clip: { x: Math.round(x), y: Math.round(y), width: 1, height: 1 } });
  const { data } = await sharp(shot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return [data[0], data[1], data[2], data[3]];
}

test('色スライダー: 動かすと調整中の表示がその場で変わり、確定後も同じ色', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);

  await page.locator('.tool-button').first().click();
  await expect(page.getByTestId('adjust-preview')).toBeVisible();
  expect(near(await screenPixel(page, DOLL_X, TOP_Y), RED)).toBe(true);

  // 色相 120 度: 赤 → 緑（PixiJS の色相行列どおり）
  const HUE_GREEN: Rgba = [0, 255, 0, 255];
  await page.locator('.hue-slider-vertical').fill('120');
  await expect
    .poll(async () => near(await screenPixel(page, DOLL_X, TOP_Y), HUE_GREEN, 12), { timeout: 5000, message: '調整中の表示が緑になる' })
    .toBe(true);

  // 途中の値でも追従する（240 度: 赤 → 青）
  await page.locator('.hue-slider-vertical').fill('-120');
  await expect
    .poll(async () => near(await screenPixel(page, DOLL_X, TOP_Y), [0, 0, 255, 255], 12), { timeout: 5000, message: '調整中の表示が青になる' })
    .toBe(true);

  await page.locator('.hue-slider-vertical').fill('120');
  await page.locator('.item-adjust-done-btn-small').click();
  await expect
    .poll(async () => near(await canvasPixel(page, DOLL_X, TOP_Y), HUE_GREEN, 12), { timeout: 10_000, message: '確定後も緑' })
    .toBe(true);

  // もう一度調整を開くと、選んだ色のまま表示される
  await page.locator('.tool-button').first().click();
  await expect(page.getByTestId('adjust-preview')).toBeVisible();
  await expect
    .poll(async () => near(await screenPixel(page, DOLL_X, TOP_Y), HUE_GREEN, 12), { timeout: 5000, message: '開き直しても緑' })
    .toBe(true);

  // 色のリセットで元の色に戻る
  await page.getByTestId('hue-reset').click();
  await expect(page.locator('.hue-slider-vertical')).toHaveValue('0');
  await expect
    .poll(async () => near(await screenPixel(page, DOLL_X, TOP_Y), RED, 12), { timeout: 5000, message: 'リセットで赤に戻る' })
    .toBe(true);
  await expect(page.getByTestId('hue-reset')).toBeDisabled();
});

test('隠す所を持つ服を着ると、そこだけドールが消える。動かすと隠さない', async ({ page }) => {
  await openApp(page);
  const HEM_Y = imgY(860); // ドールのすそ（ボトムスの下、隠す所の中）
  await expectPixel(page, DOLL_X, HEM_Y, SKIN);
  await dragItemToDoll(page, 'ボトムス', 'green');
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
  await expect.poll(async () => (await canvasPixel(page, DOLL_X, HEM_Y))[3], { timeout: 20_000 }).toBe(0);
  // 服を動かしたら、隠した所が服からずれるので、ドールを元どおり見せる
  await page.locator('.tool-button').first().click();
  await page.mouse.move(DOLL_X, BOTTOM_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X + 30, BOTTOM_Y, { steps: 4 });
  await page.mouse.up();
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, HEM_Y, SKIN);
});

{
  // くつ: 開きに見える肌（ピンク）は、ドールのすぐ上・靴下の下。靴の外の足は、ドールからも靴下からも消える
  const imgX = (x: number) => DOLL_X + (x - IMG / 2) * BASE_SCALE;
  const HOLE = { x: imgX(512), y: imgY(875) }; // 靴の開き
  const SIDE = { x: imgX(372), y: imgY(885) }; // 靴の左の、隠す所
  const SHOE = { x: imgX(440), y: imgY(885) }; // 靴
  const PINK: Rgba = [255, 128, 192, 255];
  const SOCK: Rgba = [64, 224, 224, 255];
  const BROWN: Rgba = [128, 64, 0, 255];

  test('くつ: 開きに肌が見え、靴の外の足は消える。色スライダーは靴だけを変える', async ({ page }) => {
    await openApp(page);
    await expectPixel(page, SIDE.x, SIDE.y, SKIN);
    await dragItemToDoll(page, 'くつ', 'shoe');
    await expectPixel(page, SHOE.x, SHOE.y, BROWN);
    await expectPixel(page, HOLE.x, HOLE.y, PINK);
    await expect.poll(async () => (await canvasPixel(page, SIDE.x, SIDE.y))[3], { timeout: 20_000 }).toBe(0);

    await page.locator('.tool-button').first().click();
    await expect(page.getByTestId('adjust-preview')).toBeVisible();
    await page.locator('.hue-slider-vertical').fill('120');
    await page.locator('.item-adjust-done-btn-small').click();
    await expect.poll(async () => near(await canvasPixel(page, SHOE.x, SHOE.y), BROWN), { timeout: 10_000 }).toBe(false);
    await expectPixel(page, HOLE.x, HOLE.y, PINK);

    // 調整中も、肌の絵は靴と一緒に見え、靴を動かすと一緒に動く。確定後も同じ。隠す所は効かなくなり、ドールの足が見える
    await page.locator('.tool-button').first().click();
    await expect(page.getByTestId('adjust-preview')).toBeVisible();
    await expect.poll(async () => near(await screenPixel(page, HOLE.x, HOLE.y), PINK), { timeout: 5000 }).toBe(true);
    await page.mouse.move(SHOE.x, SHOE.y);
    await page.mouse.down();
    await page.mouse.move(SHOE.x + 40, SHOE.y, { steps: 4 });
    await page.mouse.up();
    await expect.poll(async () => near(await screenPixel(page, HOLE.x + 40, HOLE.y), PINK), { timeout: 5000 }).toBe(true);
    await page.locator('.item-adjust-done-btn-small').click();
    await expectPixel(page, HOLE.x + 40, HOLE.y, PINK);
    await expectPixel(page, SIDE.x, SIDE.y, SKIN);
  });

  test('くつ＋靴下: 開きには靴下が見え、靴の外の靴下は消える。靴を動かすと、靴下は元どおり', async ({ page }) => {
    await openApp(page);
    await dragItemToDoll(page, 'ソックス', 'sock');
    await expectPixel(page, SIDE.x, SIDE.y, SOCK);
    await dragItemToDoll(page, 'くつ', 'shoe');
    await expectPixel(page, SHOE.x, SHOE.y, BROWN);
    await expectPixel(page, HOLE.x, HOLE.y, SOCK);
    await expect.poll(async () => (await canvasPixel(page, SIDE.x, SIDE.y))[3], { timeout: 20_000 }).toBe(0);
    // 再読み込みしても同じ
    await page.reload();
    await openApp(page);
    await expectPixel(page, HOLE.x, HOLE.y, SOCK);
    await expect.poll(async () => (await canvasPixel(page, SIDE.x, SIDE.y))[3], { timeout: 20_000 }).toBe(0);
    // 靴を動かすと、隠す所は効かなくなり、靴下が元どおり見える（靴の開きにも、靴下が見えたまま）
    await page.locator('.tool-button').first().click();
    await page.mouse.move(SHOE.x, SHOE.y);
    await page.mouse.down();
    await page.mouse.move(SHOE.x + 40, SHOE.y, { steps: 4 });
    await page.mouse.up();
    await page.locator('.item-adjust-done-btn-small').click();
    await expectPixel(page, SIDE.x, SIDE.y, SOCK);
    await expectPixel(page, HOLE.x + 40, HOLE.y, SOCK);
  });
}

test('調整の枠: 角のつまみで大きくでき、× で脱がせる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await page.locator('.tool-button').first().click();
  await expect(page.getByTestId('sticker-frame')).toBeVisible();
  // つまみ（服の右下）を、服の中心から見て同じ向きに 1.3 倍の所まで引く → 1.3 倍・回転なし
  const handle = (await page.getByTestId('sticker-rotate').boundingBox())!;
  const hx = handle.x + handle.width / 2;
  const hy = handle.y + handle.height / 2;
  const cx = DOLL_X;
  const cy = imgY(380);
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(cx + (hx - cx) * 1.3, cy + (hy - cy) * 1.3, { steps: 8 });
  await page.mouse.up();
  await page.locator('.item-adjust-done-btn-small').click();
  // 上端（y=240）が中心から 1.3 倍の所（y≈198）まで広がる
  await expectPixel(page, DOLL_X, imgY(215), RED);
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  // × で脱がせる
  await page.locator('.tool-button').first().click();
  await page.getByTestId('sticker-remove').click();
  await expect(page.locator('.item-adjust-overlay')).toHaveCount(0);
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
});

test('調整の枠: 右上の ↺ で位置・大きさ・向きだけ元に戻る', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await page.locator('.tool-button').first().click();
  await page.locator('.hue-slider-vertical').fill('120');
  await page.mouse.move(DOLL_X, DOLL_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X + ADJUST_DX, DOLL_Y, { steps: 6 });
  await page.mouse.up();
  await page.getByTestId('sticker-reset').click();
  await expect(page.locator('.hue-slider-vertical')).toHaveValue('120'); // 色はそのまま
  await page.locator('.item-adjust-done-btn-small').click();
  await expect
    .poll(async () => near(await canvasPixel(page, DOLL_X, TOP_Y), [0, 255, 0, 255], 12), { timeout: 10_000, message: '元の位置で緑' })
    .toBe(true);
});

test('着せると服が一瞬光り、写真ボタンはリセットから離れている', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await expect(page.getByTestId('equip-flash')).toHaveCount(0, { timeout: 5000 }); // 少しで消える
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  const shot = (await page.getByTestId('screenshot-button').boundingBox())!;
  const reset = (await page.locator('.reset-button-fixed').boundingBox())!;
  expect(reset.y - (shot.y + shot.height)).toBeGreaterThanOrEqual(60);
});

test('調整画面で重なりの前後を変えられる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await dragItemToDoll(page, 'ボトムス', 'green');
  // 最後に着たボトムスを調整する。ボトムスはトップスより下（1/2）
  await page.locator('.tool-button').first().click();
  const pickerItems = page.getByTestId('adjust-picker-item'); // 上がいちばん手前
  await expect(pickerItems).toHaveCount(2);
  await expect(pickerItems.nth(1)).toHaveClass(/on/);
  await expect(page.getByTestId('adjust-picker-doll')).toBeVisible(); // 一覧のいちばん下はドール
  // ボトムスを上に動かして、トップスに重ねる
  const OVERLAP_Y = imgY(480);
  await page.mouse.move(DOLL_X, BOTTOM_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, BOTTOM_Y - 120 * BASE_SCALE, { steps: 6 });
  await page.mouse.up();
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, OVERLAP_Y, RED); // トップスが手前
  // 前へ。調整中でも、その場で重なりが入れ替わる
  await page.locator('.tool-button').first().click();
  await page.getByTestId('layer-front').click();
  await expect(pickerItems.nth(0)).toHaveClass(/on/);
  await expect(page.getByTestId('layer-front')).toBeDisabled();
  await expect
    .poll(async () => near(await screenPixel(page, DOLL_X, OVERLAP_Y), GREEN, 12), { timeout: 5000, message: '調整中にボトムスが手前になる' })
    .toBe(true);
  // 後ろへ戻すと、その場でトップスが手前に戻る（キャンバスに描いたトップスが見える）
  await page.getByTestId('layer-back').click();
  await expect
    .poll(async () => near(await screenPixel(page, DOLL_X, OVERLAP_Y), RED, 12), { timeout: 5000, message: '調整中にトップスが手前に戻る' })
    .toBe(true);
  await page.getByTestId('layer-front').click();
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, OVERLAP_Y, GREEN);
  // 調整する服を、左の一覧で切り替えられる
  await page.locator('.tool-button').first().click();
  await pickerItems.nth(1).click();
  await expect(pickerItems.nth(1)).toHaveClass(/on/); // トップス（うしろ）
});

test('調整画面の一覧にドールが並び、服をドールの後ろに回せる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'ボトムス', 'green');
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
  await page.locator('.tool-button').first().click();
  // 一覧は上から「服 → ドール」
  const rows = page.locator('[data-testid="adjust-picker-items"] > *');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toHaveAttribute('data-testid', 'adjust-picker-doll');
  await expect(page.getByTestId('layer-front')).toBeDisabled();
  // 後ろへ: ドールの後ろに回り、調整中でもその場でドールが手前に見える
  await page.getByTestId('layer-back').click();
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'adjust-picker-doll');
  await expect(page.getByTestId('layer-back')).toBeDisabled();
  await expect(page.getByTestId('adjust-doll')).toBeVisible();
  await expect
    .poll(async () => near(await screenPixel(page, DOLL_X, BOTTOM_Y), SKIN, 12), { timeout: 5000, message: '調整中にドールが手前になる' })
    .toBe(true);
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, BOTTOM_Y, SKIN); // 確定後も、ドールが手前
  // 読み込み直しても、ドールの後ろのまま
  await page.reload();
  await expectPixel(page, DOLL_X, BOTTOM_Y, SKIN);
  // 前へ戻すと、ドールの前に出る
  await page.locator('.tool-button').first().click();
  await page.getByTestId('layer-front').click();
  await expect(page.getByTestId('adjust-doll')).toHaveCount(0);
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
});

test('調整の × で脱がせても、調整は続き、残りの服に切り替わる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await dragItemToDoll(page, 'ボトムス', 'green');
  await page.locator('.tool-button').first().click();
  await page.getByTestId('sticker-remove').click(); // 最後に着たボトムスを脱がせる
  await expect(page.locator('.item-adjust-overlay')).toBeVisible();
  await expect(page.getByTestId('adjust-picker-item')).toHaveCount(1);
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, BOTTOM_Y, SKIN);
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  // 一覧は画面の左
  await dragItemToDoll(page, 'ボトムス', 'green');
  await page.locator('.tool-button').first().click();
  const picker = (await page.getByTestId('adjust-picker').boundingBox())!;
  expect(picker.x).toBeLessThan(40);
});


test('髪は 1 点: 前の分と後ろの分が一緒に付き、位置と色は一緒に変わる（重なりは 1 枚ずつ）', async ({ page }) => {
  const PURPLE: Rgba = [128, 0, 255, 255];
  const SIDE_X = DOLL_X + (250 - IMG / 2) * BASE_SCALE; // トップスの左の外。うしろの分だけが見える所
  const DROP = 280 * BASE_SCALE; // 下へ動かす量（ボトムスの高さまで）
  await openApp(page);
  // blue には「後ろに描く分」がある: 着せると、前の分（青）と、後ろの分（むらさき）が付く
  await dragItemToDoll(page, 'トップス', 'blue');
  await expectPixel(page, DOLL_X, TOP_Y, BLUE);
  await expectPixel(page, SIDE_X, TOP_Y, PURPLE);
  // メニューのカテゴリは 1 つ（うしろがみのカテゴリは無い）
  await expect(page.locator('.palette-section button', { hasText: 'うしろがみ' })).toHaveCount(0);
  // 調整: 一覧は上から「前の分 → ドール → 後ろの分」の 2 枚。最初は前の分を選んでいる
  await page.locator('.tool-button').first().click();
  const rows = page.locator('[data-testid="adjust-picker-items"] > *');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toHaveAttribute('data-testid', 'adjust-picker-doll');
  const pickerItems = page.getByTestId('adjust-picker-item');
  await expect(pickerItems.nth(0)).toHaveClass(/on/);
  // 前の分を下へ動かすと、後ろの分も、その場で一緒に動く
  const before = (await page.getByTestId('adjust-partner').boundingBox())!;
  await page.mouse.move(DOLL_X, TOP_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, TOP_Y + DROP, { steps: 6 });
  await page.mouse.up();
  const moved = (await page.getByTestId('adjust-partner').boundingBox())!;
  expect(Math.abs(moved.y - before.y - DROP)).toBeLessThan(2);
  await expect.poll(async () => near(await screenPixel(page, SIDE_X, BOTTOM_Y), PURPLE, 12), { timeout: 5000, message: '調整中に、後ろの分も動く' }).toBe(true);
  // 色も一緒に変わる（色相 120 度: 青 → 赤、むらさき → だいだい）
  const ORANGE: Rgba = [255, 128, 0, 255];
  await page.locator('.hue-slider-vertical').fill('120');
  await expect.poll(async () => near(await screenPixel(page, DOLL_X, BOTTOM_Y), RED, 12), { timeout: 5000, message: '調整中に、前の分の色が変わる' }).toBe(true);
  await expect.poll(async () => near(await screenPixel(page, SIDE_X, BOTTOM_Y), ORANGE, 12), { timeout: 5000, message: '調整中に、後ろの分の色も変わる' }).toBe(true);
  await page.locator('.item-adjust-done-btn-small').click();
  // 確定後も、両方が動いて、両方の色が変わっている
  await expectPixel(page, DOLL_X, BOTTOM_Y, RED);
  await expectPixel(page, SIDE_X, BOTTOM_Y, ORANGE);
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
  // 読み込み直しても、そのまま
  await page.reload();
  await expectPixel(page, DOLL_X, BOTTOM_Y, RED);
  await expectPixel(page, SIDE_X, BOTTOM_Y, ORANGE);
  // 後ろの分を選んで動かしても、前の分が一緒に動く（上へ戻す）
  await page.locator('.tool-button').first().click();
  await pickerItems.nth(1).click();
  await expect(pickerItems.nth(1)).toHaveClass(/on/);
  await expect(page.locator('.hue-slider-vertical')).toHaveValue('120');
  await page.mouse.move(SIDE_X, BOTTOM_Y);
  await page.mouse.down();
  await page.mouse.move(SIDE_X, BOTTOM_Y - DROP, { steps: 6 });
  await page.mouse.up();
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await expectPixel(page, SIDE_X, TOP_Y, ORANGE);
  // 重なりは 1 枚ずつ: 後ろの分だけを、ドールの前へ出せる（前の分より下なので、まん中は前の分のまま）
  await page.locator('.tool-button').first().click();
  await pickerItems.nth(1).click();
  await page.getByTestId('layer-front').click();
  await expect(rows.nth(2)).toHaveAttribute('data-testid', 'adjust-picker-doll');
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  // × で脱がせると、前の分も後ろの分も脱げる（どちらを選んでいても）
  await page.locator('.tool-button').first().click();
  await pickerItems.nth(1).click();
  await page.getByTestId('sticker-remove').click();
  await expect(page.locator('.item-adjust-overlay')).toHaveCount(0);
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
  await expect.poll(async () => near(await canvasPixel(page, SIDE_X, TOP_Y), ORANGE), { timeout: 10_000 }).toBe(false);
  // 後ろの分の無い服に替えると、後ろの分も外れる
  await dragItemToDoll(page, 'トップス', 'blue');
  await expectPixel(page, SIDE_X, TOP_Y, PURPLE);
  await dragItemToDoll(page, 'トップス', 'red');
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await expect.poll(async () => near(await canvasPixel(page, SIDE_X, TOP_Y), PURPLE), { timeout: 10_000 }).toBe(false);
});

test('色スライダー: 黒い服にも色が付く（調整中の表示と、確定後が同じ色）', async ({ page }) => {
  const BLACK: Rgba = [28, 28, 32, 255];
  const chroma = (c: Rgba) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'black');
  await expectPixel(page, DOLL_X, TOP_Y, BLACK);
  await page.locator('.tool-button').first().click();
  await expect(page.getByTestId('adjust-preview')).toBeVisible();
  await page.locator('.hue-slider-vertical').fill('120');
  // 黒い所に、はっきり色が付く（色相だけを回したのでは、黒のまま）
  await expect.poll(async () => chroma(await screenPixel(page, DOLL_X, TOP_Y)), { timeout: 5000, message: '調整中に色が付く' }).toBeGreaterThan(60);
  const shown = await screenPixel(page, DOLL_X, TOP_Y);
  expect(shown[1]).toBeGreaterThan(shown[0]); // 緑のなかま
  await page.locator('.item-adjust-done-btn-small').click();
  await expect.poll(async () => near(await canvasPixel(page, DOLL_X, TOP_Y), shown, 6), { timeout: 10_000, message: '確定後も同じ色' }).toBe(true);
  // 読み込み直しても同じ色。色を戻すと黒に戻る
  await page.reload();
  await expectPixel(page, DOLL_X, TOP_Y, shown);
  await page.locator('.tool-button').first().click();
  await page.getByTestId('hue-reset').click();
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, TOP_Y, BLACK);
});

test('下の案内の文は無く、版数は右上に小さく出る（調整中も）', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.app-footer')).toHaveCount(0);
  await expect(page.getByText('ドラッグしてドールにきせてね')).toHaveCount(0);
  const badge = page.locator('.version-badge');
  await expect(badge).toHaveText(/^v\d+\.\d+\.\d+$/);
  const box = (await badge.boundingBox())!;
  expect(box.y).toBeLessThan(20);
  expect(VIEW_W - (box.x + box.width)).toBeLessThan(12);
  expect(box.height).toBeLessThanOrEqual(14);
  // メニューの下の ▼ は画面の中
  const down = (await page.getByTestId('menu-scroll-down').boundingBox())!;
  expect(down.y + down.height).toBeLessThanOrEqual(VIEW_H);
  // 調整中も出ていて、右上のボタンと重ならない
  await page.locator('.tool-button').click();
  await expect(badge).toBeVisible();
  const b = (await badge.boundingBox())!;
  const top = (await page.locator('.item-adjust-top-buttons').boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(top.y);
});

// ホーム画面から開いたとき（standalone）をまねて、開き直す。
// Chromium は display-mode をまねられないので、iPadOS が持つ navigator.standalone のほうで確かめる
async function reopenStandalone(page: Page): Promise<void> {
  await page.addInitScript(() => Object.defineProperty(window.navigator, 'standalone', { value: true }));
  await page.goto(APP_URL);
  await waitForMenu(page);
  await page.waitForTimeout(700);
}

test('ホーム画面から開いたときは、上のバーの分（24px 以上）をあける。ブラウザでは今までどおり', async ({ page }) => {
  await openApp(page);
  const tops = async () => ({
    menu: (await page.locator('.palette-section select').boundingBox())!.y,
    tool: (await page.locator('.tool-buttons').boundingBox())!.y,
    badge: (await page.locator('.version-badge').boundingBox())!.y,
  });
  // 出てくるときの動き（0.5 秒）が終わってから測る
  await page.waitForTimeout(700);
  const browser = await tops();
  // ブラウザでは、変える前（v0.21.2）と同じ位置
  expect(browser.menu).toBe(8);
  expect(browser.tool).toBe(72);
  await reopenStandalone(page);
  const standalone = await tops();
  expect(standalone.menu).toBe(browser.menu + 24);
  expect(standalone.tool).toBe(96);
  // メニューの下端は、ブラウザで開いたときと同じだけ、画面の下からあいている（下の端に寄りすぎない）
  const menuBottom = async () => {
    const box = (await page.getByTestId('menu-scroll-down').boundingBox())!;
    return VIEW_H - (box.y + box.height);
  };
  expect(await menuBottom()).toBeGreaterThanOrEqual(12);
  expect(standalone.badge).toBeGreaterThanOrEqual(24);
  // 調整画面の上のボタンも下がる
  await page.locator('.tool-button').click();
  expect((await page.locator('.item-adjust-top-buttons').boundingBox())!.y).toBe(40);
  // キャンバスは動かない（この段階では、描く位置を変えない）
  expect((await page.getByTestId('avatar-canvas').boundingBox())!.y).toBe(0);
});

/** 調整画面の一覧で、from 番目の行（上から、ドールの行も数える）を to 番目の行の位置までドラッグする */
async function dragPickerRow(page: Page, from: number, to: number, end: 'up' | 'cancel' = 'up'): Promise<void> {
  const rows = page.locator('[data-testid="adjust-picker-items"] > *');
  const a = (await rows.nth(from).boundingBox())!;
  const b = (await rows.nth(to).boundingBox())!;
  const x = a.x + a.width / 2;
  const fromY = a.y + a.height / 2;
  // 相手の行の中心を少し越えた所まで
  const toY = b.y + b.height / 2 + (to > from ? 6 : -6);
  await page.mouse.move(x, fromY);
  await page.mouse.down();
  await page.mouse.move(x, (fromY + toY) / 2, { steps: 4 });
  await page.mouse.move(x, toY, { steps: 4 });
  if (end === 'cancel') {
    await page.locator('[data-dragging="true"]').dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
    await page.mouse.up();
  } else {
    await page.mouse.up();
  }
}

test('調整画面の一覧をドラッグして、重なりを並べ替えられる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await dragItemToDoll(page, 'ボトムス', 'green');
  // ボトムスを上に動かして、トップスに重ねる（トップスが手前）
  await page.locator('.tool-button').first().click();
  const OVERLAP_Y = imgY(480);
  await page.mouse.move(DOLL_X, BOTTOM_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, BOTTOM_Y - 120 * BASE_SCALE, { steps: 6 });
  await page.mouse.up();
  const rows = page.locator('[data-testid="adjust-picker-items"] > *');
  const names = () => rows.evaluateAll((els) => els.map((el) => (el.getAttribute('title') ?? '').slice(0, 3)));
  await expect.poll(names).toEqual(['red', 'gre', 'ドール']);
  // 調整中の服（ボトムス）を、いちばん上へ: その場でボトムスが手前になる
  await dragPickerRow(page, 1, 0);
  await expect.poll(names).toEqual(['gre', 'red', 'ドール']);
  await expect.poll(async () => near(await screenPixel(page, DOLL_X, OVERLAP_Y), GREEN, 12)).toBe(true);
  // 調整中でない服（トップス）を、いちばん上へ戻す: 調整する服は変わらない
  await dragPickerRow(page, 1, 0);
  await expect.poll(names).toEqual(['red', 'gre', 'ドール']);
  await expect(page.getByTestId('adjust-picker-item').nth(1)).toHaveClass(/on/);
  await expect.poll(async () => near(await screenPixel(page, DOLL_X, OVERLAP_Y), RED, 12)).toBe(true);
  // となりの行までの 6 割まで動かして離せば、入れ替わる（となりの行を完全に越えなくてよい）
  {
    const r0 = (await rows.nth(0).boundingBox())!;
    const r1 = (await rows.nth(1).boundingBox())!;
    const x = r0.x + r0.width / 2;
    const y = r0.y + r0.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + (r1.y - r0.y) * 0.6, { steps: 5 });
    await page.mouse.up();
    await expect.poll(names).toEqual(['gre', 'red', 'ドール']);
    await dragPickerRow(page, 1, 0);
    await expect.poll(names).toEqual(['red', 'gre', 'ドール']);
  }
  // 少しだけ動かして離すと、並びは変わらず、その服の調整に切り替わる
  const top = (await rows.nth(0).boundingBox())!;
  await page.mouse.move(top.x + 20, top.y + 20);
  await page.mouse.down();
  await page.mouse.move(top.x + 20, top.y + 23);
  await page.mouse.up();
  await expect.poll(names).toEqual(['red', 'gre', 'ドール']);
  await expect(page.getByTestId('adjust-picker-item').nth(0)).toHaveClass(/on/);
  // 途中で取り消されたら、何も変わらない
  await dragPickerRow(page, 0, 1, 'cancel');
  await expect.poll(names).toEqual(['red', 'gre', 'ドール']);
  await expect(page.locator('[data-dragging="true"]')).toHaveCount(0);
  // トップスをドールの行より下へ: ドールの後ろに回る。確定して読み込み直しても同じ
  await dragPickerRow(page, 0, 2);
  await expect.poll(names).toEqual(['gre', 'ドール', 'red']);
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
  await page.reload();
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
  await expectPixel(page, DOLL_X, OVERLAP_Y, GREEN);
});

test.describe('調整画面の一覧を、指で動かす', () => {
  test.use({ hasTouch: true });

  type Pt = { x: number; y: number };
  // 指の入力（1 本目・2 本目…の順に、いま画面に触れている指を全部渡す）
  async function fingers(page: Page) {
    const client = await page.context().newCDPSession(page);
    return (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) =>
      client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
  }
  const rowsOf = (page: Page) => page.locator('[data-testid="adjust-picker-items"] > *');
  const namesOf = (page: Page) => rowsOf(page).evaluateAll((els) => els.map((el) => (el.getAttribute('title') ?? '').slice(0, 3)));
  const center = async (page: Page, index: number): Promise<Pt> => {
    const box = (await rowsOf(page).nth(index).boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const scrollTop = (page: Page) => page.getByTestId('adjust-picker-items').evaluate((el) => el.scrollTop);

  test('一覧が画面に収まるとき: つかんですぐ動かせば並べ替わる。2 本目の指が服に触れても、服は動かない', async ({ page }) => {
    await openApp(page);
    await dragItemToDoll(page, 'トップス', 'red');
    await dragItemToDoll(page, 'ボトムス', 'green');
    await page.locator('.tool-button').first().click();
    await expect.poll(() => namesOf(page)).toEqual(['red', 'gre', 'ドール']);
    const handle = () => page.getByTestId('sticker-rotate').boundingBox();
    const before = (await handle())!;
    const touch = await fingers(page);
    const from = await center(page, 0);
    const to = await center(page, 1);
    await touch('touchStart', [from]);
    await touch('touchMove', [{ x: from.x, y: (from.y + to.y) / 2 }]);
    // 2 本目の指（手のひら）が服の上に触れて動く
    const palm = { x: 1000, y: 700 }; // 服の枠の外（何も無い所）
    const mid = { x: from.x, y: (from.y + to.y) / 2 };
    const moved = { x: palm.x + 100, y: palm.y + 60 };
    await touch('touchStart', [mid, palm]);
    await touch('touchMove', [mid, moved]);
    await touch('touchMove', [{ x: from.x, y: to.y + 6 }, moved]);
    await touch('touchEnd', []);
    await expect.poll(() => namesOf(page)).toEqual(['gre', 'red', 'ドール']);
    const after = (await handle())!;
    expect(Math.abs(after.x - before.x)).toBeLessThan(1);
    expect(Math.abs(after.y - before.y)).toBeLessThan(1);
  });

  test('一覧が画面に収まらないとき: すばやくなぞると流れ、長く押してから動かすと並べ替わり、端で止めていても流れ続ける', async ({ page }) => {
    await openApp(page);
    await dragItemToDoll(page, 'トップス', 'red');
    await dragItemToDoll(page, 'ボトムス', 'green');
    await dragItemToDoll(page, 'ソックス', 'sock');
    await dragItemToDoll(page, 'くつ', 'shoe');
    await page.locator('.tool-button').first().click();
    await expect(rowsOf(page)).toHaveCount(5);
    // 画面を低くして、一覧が収まらないようにする
    await page.setViewportSize({ width: VIEW_W, height: 300 });
    const list = page.getByTestId('adjust-picker-items');
    await expect.poll(() => list.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(60);
    const maxScroll = await list.evaluate((el) => el.scrollHeight - el.clientHeight);
    const order = await namesOf(page);
    const on = await page.locator('[data-testid="adjust-picker-item"].on').getAttribute('title');
    const touch = await fingers(page);

    // すばやくなぞる: 一覧が流れる。並びも、調整する服も変わらない
    let p = await center(page, 1);
    await touch('touchStart', [p]);
    for (const dy of [-20, -40, -60]) await touch('touchMove', [{ x: p.x, y: p.y + dy }]);
    await touch('touchEnd', []);
    await expect.poll(() => scrollTop(page)).toBeGreaterThanOrEqual(50);
    expect(await namesOf(page)).toEqual(order);
    expect(await page.locator('[data-testid="adjust-picker-item"].on').getAttribute('title')).toBe(on);

    // 長く押してから動かす: 行が浮いて、並べ替わる
    await list.evaluate((el) => (el.scrollTop = 0));
    p = await center(page, 0);
    const next = await center(page, 1);
    await touch('touchStart', [p]);
    await expect(page.locator('[data-dragging="true"]')).toHaveCount(1); // 押し続けると浮く
    for (const f of [0.3, 0.6, 0.9]) await touch('touchMove', [{ x: p.x, y: p.y + (next.y - p.y) * f }]);
    await touch('touchEnd', []);
    await expect.poll(() => namesOf(page)).toEqual([order[1], order[0], ...order.slice(2)]);

    // 浮かせた行を一覧の下の端へ持っていき、指を止める: 一覧は下まで流れ続ける
    await list.evaluate((el) => (el.scrollTop = 0));
    p = await center(page, 0);
    const box = (await list.boundingBox())!;
    await touch('touchStart', [p]);
    await expect(page.locator('[data-dragging="true"]')).toHaveCount(1);
    await touch('touchMove', [{ x: p.x, y: p.y + 10 }]);
    await touch('touchMove', [{ x: p.x, y: box.y + box.height - 8 }]);
    await expect.poll(() => scrollTop(page), { timeout: 5000 }).toBe(maxScroll);
    // 下の端で止まる（動かしている行のぶん、余計に流れていかない）
    await page.waitForTimeout(300);
    expect(await scrollTop(page)).toBe(maxScroll);
    await touch('touchEnd', []);
    // いちばん下（ドールの後ろ）に入る
    await expect.poll(async () => (await namesOf(page)).at(-1)).toBe(order[1]);
  });
});

test('調整した服は、画面の大きさが変わっても、ドールに対して同じ位置にある', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await page.locator('.tool-button').first().click();
  await page.mouse.move(DOLL_X, TOP_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X + ADJUST_DX, TOP_Y, { steps: 6 });
  await page.mouse.up();
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, RED);
  // 高さを 3/4 にする: ドールも、服のずれも 3/4 になる
  const H2 = 615;
  await page.setViewportSize({ width: VIEW_W, height: H2 });
  const k = H2 / VIEW_H;
  const y2 = H2 / 2 + (380 - IMG / 2) * BASE_SCALE * k;
  // 服（幅 440 × 縮尺）は、ずれも 3/4 になった位置にある: 左の端の近くは服、ずれが縮んでいなければ届く右の所には服が無い
  await expectPixel(page, DOLL_X + (ADJUST_DX - 130) * k, y2, RED);
  await expect.poll(async () => near(await canvasPixel(page, DOLL_X + 310, y2), RED), { timeout: 10_000 }).toBe(false);
  // 元の大きさに戻すと、元の位置
  await page.setViewportSize({ width: VIEW_W, height: VIEW_H });
  await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, RED);
  await expectPixel(page, DOLL_X + ADJUST_DX + 140, TOP_Y, RED);
});

test('更新の前に保存した服装（調整値が画面の px）は、同じ位置で復元され、新しい形で保存し直される', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  const id = await page.evaluate(() => (JSON.parse(localStorage.getItem('dressup_outfit')!) as { id: string }[])[0].id);
  await page.evaluate(
    ([itemId, dx]) => {
      localStorage.setItem('dressup_outfit', JSON.stringify([{ id: itemId, equipOrder: 0, adjustOffsetX: dx }]));
      localStorage.removeItem('dressup_outfit_units');
    },
    [id, ADJUST_DX] as const,
  );
  await page.reload();
  await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, RED);
  await expectPixel(page, DOLL_X + ADJUST_DX + 140, TOP_Y, RED);
  const saved = await page.evaluate(() => ({
    units: localStorage.getItem('dressup_outfit_units'),
    x: (JSON.parse(localStorage.getItem('dressup_outfit')!) as { adjustOffsetX: number }[])[0].adjustOffsetX,
  }));
  expect(saved.units).toBe('doll');
  expect(saved.x).toBeCloseTo(ADJUST_DX / BASE_SCALE, 3);
});

// 枠（点線の四角と、角のつまみ）を含む層の z-index（いちばん近い、z-index を持つ先祖）
const layerZ = (page: Page, testId: string) =>
  page.getByTestId(testId).first().evaluate((el) => {
    for (let node: HTMLElement | null = el as HTMLElement; node; node = node.parentElement) {
      const z = Number(getComputedStyle(node).zIndex);
      if (Number.isFinite(z) && getComputedStyle(node).position !== 'static') return z;
    }
    return 0;
  });
const centerOf = (box: { x: number; y: number; width: number; height: number }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

test('調整中の服の枠は、手前の服より上に出る。服を動かす・回す・大きくしても、服に付いてくる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'ボトムス', 'green');
  await dragItemToDoll(page, 'トップス', 'red');
  await page.locator('.tool-button').first().click();
  // 重なりの下にあるほう（ボトムス）を調整中にする: トップスが、その手前に重なって描かれる
  await page.getByTestId('adjust-picker-items').locator('button[title="green"]').click();
  await expect(page.getByTestId('adjust-preview')).toBeVisible();
  await expect(page.locator('.adjust-front-item').first()).toBeVisible();
  const frameZ = await layerZ(page, 'sticker-frame');
  const previewZ = await layerZ(page, 'adjust-preview');
  const frontZ = await page.locator('.adjust-front-item').evaluateAll((els) => els.map((el) => Number(getComputedStyle(el).zIndex)));
  expect(frontZ.length).toBeGreaterThan(0);
  expect(Math.max(...frontZ)).toBeGreaterThan(previewZ); // 服の絵は、重なりの順のまま（手前の服が上）
  expect(frameZ).toBeGreaterThan(Math.max(...frontZ)); // 枠は、どの服よりも上
  // 下のボタン・一覧よりは下（ボタンを押せなくしない）
  expect(frameZ).toBeLessThan(Number(await page.getByTestId('adjust-picker').evaluate((el) => getComputedStyle(el).zIndex)));
  // 枠は、服の絵と同じ位置・大きさ
  const same = async (tolerance: number) => {
    const frame = (await page.getByTestId('sticker-frame').boundingBox())!;
    const picture = (await page.getByTestId('adjust-preview').boundingBox())!;
    expect(Math.abs(centerOf(frame).x - centerOf(picture).x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(centerOf(frame).y - centerOf(picture).y)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(frame.width - picture.width)).toBeLessThanOrEqual(tolerance * 2);
    expect(Math.abs(frame.height - picture.height)).toBeLessThanOrEqual(tolerance * 2);
  };
  await same(1);
  // 服を動かす
  const before = (await page.getByTestId('sticker-frame').boundingBox())!;
  await page.mouse.move(DOLL_X, BOTTOM_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X + 90, BOTTOM_Y + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await page.getByTestId('sticker-frame').boundingBox())!.x - before.x)).toBe(90);
  await same(1);
  // 右下のつまみで、大きく・回す
  const handle = centerOf((await page.getByTestId('sticker-rotate').boundingBox())!);
  await page.mouse.move(handle.x, handle.y);
  await page.mouse.down();
  await page.mouse.move(handle.x + 60, handle.y - 20, { steps: 5 });
  await page.mouse.up();
  await same(2);
  // 縦に持ち替えても、枠は服に付いている
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator('.app')).toHaveAttribute('data-orientation', 'portrait');
  await expect(page.getByTestId('sticker-frame')).toBeVisible();
  await same(2);
});

test('調整画面を開いたまま持ち替えても、確定していない調整（位置・大きさ・色）は消えない', async ({ page }) => {
  // 縦と横で、ドールの場所（正方形）の大きさが違う（820×1180 は 776、1180×820 は 820）ので、調整画面は開き直る。
  // 開き直す前に、いまの調整を覚えておく
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await page.locator('.tool-button').first().click();
  await expect(page.getByTestId('sticker-frame')).toBeVisible();
  const start = centerOf((await page.getByTestId('sticker-frame').boundingBox())!);
  // 右へ 90px 動かし、色を 120 に（✓ は押さない）
  await page.mouse.move(DOLL_X, TOP_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X + 90, TOP_Y, { steps: 5 });
  await page.mouse.up();
  await page.locator('.hue-slider-vertical').fill('120');
  await expect.poll(async () => Math.round(centerOf((await page.getByTestId('sticker-frame').boundingBox())!).x - start.x)).toBe(90);
  // 縦に持ち替える
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator('.app')).toHaveAttribute('data-orientation', 'portrait');
  await expect(page.getByTestId('sticker-frame')).toBeVisible();
  // ドールに対して同じ位置: ずれは、縮尺の比（776 ÷ 820）で縮む = 約 85px。色も残る
  const k = 776 / 820;
  const moved = centerOf((await page.getByTestId('sticker-frame').boundingBox())!);
  expect(Math.abs(moved.x - (410 + 90 * k))).toBeLessThanOrEqual(2);
  await expect(page.getByTestId('adjust-preview')).toHaveAttribute('data-hue', '120');
  await expect(page.locator('.hue-slider-vertical')).toHaveValue('120');
  // 横に戻しても、同じ
  await page.setViewportSize({ width: VIEW_W, height: VIEW_H });
  await expect(page.locator('.app')).toHaveAttribute('data-orientation', 'landscape');
  await expect.poll(async () => Math.round(centerOf((await page.getByTestId('sticker-frame').boundingBox())!).x - start.x)).toBe(90);
  await expect(page.getByTestId('adjust-preview')).toHaveAttribute('data-hue', '120');
});

test('角のつまみは、枠の外側にある（服に重ねない）。スマホは 34px、ほかは 40px', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await page.locator('.tool-button').first().click();
  await expect(page.getByTestId('sticker-frame')).toBeVisible();
  const check = async (size: number) => {
    const frame = (await page.getByTestId('sticker-frame').boundingBox())!;
    for (const [id, sx, sy] of [['sticker-remove', -1, -1], ['sticker-reset', 1, -1], ['sticker-rotate', 1, 1]] as const) {
      const box = (await page.getByTestId(id).boundingBox())!;
      expect([Math.round(box.width), Math.round(box.height)], `${id} の大きさ`).toEqual([size, size]);
      const c = centerOf(box);
      // 中心は、枠の角から外へ（縦横それぞれ、大きさの 2 割以上）
      const cornerX = sx < 0 ? frame.x : frame.x + frame.width;
      const cornerY = sy < 0 ? frame.y : frame.y + frame.height;
      expect((c.x - cornerX) * sx, `${id} の横`).toBeGreaterThanOrEqual(size * 0.2);
      expect((c.y - cornerY) * sy, `${id} の縦`).toBeGreaterThanOrEqual(size * 0.2);
      // 外へ出すぎない（角に触れている）
      expect((c.x - cornerX) * sx).toBeLessThanOrEqual(size * 0.5);
      expect((c.y - cornerY) * sy).toBeLessThanOrEqual(size * 0.5);
    }
  };
  await check(40); // 横 1180×820
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(page.locator('.app')).toHaveAttribute('data-phone', 'false');
  await check(40);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.app')).toHaveAttribute('data-phone', 'true');
  await check(34);
});

test('スマホで、画面の端に近い服（くつ）でも、つまみを押せる（画面の中で、下の帯に隠れない）', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'くつ', 'shoe');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.app')).toHaveAttribute('data-orientation', 'portrait');
  await page.getByTestId('portrait-tools').locator('.tool-button').click();
  await expect(page.getByTestId('sticker-frame')).toBeVisible();
  const picker = (await page.getByTestId('adjust-picker').boundingBox())!;
  for (const id of ['sticker-remove', 'sticker-reset', 'sticker-rotate']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x, `${id} の左`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${id} の右`).toBeLessThanOrEqual(390);
    expect(box.y, `${id} の上`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${id} の下`).toBeLessThanOrEqual(picker.y);
    // その場所のいちばん上にあるのが、つまみ（押せる）
    const c = centerOf(box);
    expect(await page.evaluate(([x, y, testId]) => document.elementFromPoint(x as number, y as number)?.closest(`[data-testid="${testId}"]`) !== null, [c.x, c.y, id] as const), `${id} を押せる`).toBe(true);
  }
});

test('横の色の帯も、その服がなる色になる（大きさは今のまま 36×280）', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await page.locator('.tool-button').first().click();
  await expect(page.getByTestId('adjust-preview')).toBeVisible();
  const slider = page.locator('.hue-slider-vertical');
  const box = (await slider.boundingBox())!;
  expect([Math.round(box.width), Math.round(box.height)]).toEqual([36, 280]);
  await expect.poll(() => slider.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('to top');
  const stops = await slider.evaluate((el) => getComputedStyle(el).backgroundImage.match(/rgb\([^)]+\)/g) ?? []);
  expect(stops).toHaveLength(13);
  expect(stops[6]).toBe('rgb(255, 0, 0)');
  await expect(page.locator('.hue-value')).toBeVisible();
});

test('セット: ドールへドラッグすると、全部のパーツが一度に着く。パーツは、ふつうの服として 1 点ずつ着替えられる', async ({ page }) => {
  await openApp(page);
  await openCategory(page, 'セット');
  const tile = page.getByTestId('set-tile');
  await expect(tile).toHaveCount(1);
  await expect(tile).toHaveAttribute('title', 'あかみどり');
  await expect(tile.locator('img')).toHaveCount(2); // パーツのサムネイルを並べた絵
  await expect(tile).toHaveAttribute('data-worn', 'false');
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, DOLL_Y, { steps: 4 });
  await page.mouse.up();
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
  await expect(tile).toHaveAttribute('data-worn', 'true');
  const saved = () => page.evaluate(() => (JSON.parse(localStorage.getItem('dressup_outfit') ?? '[]') as { id: string }[]).map((e) => e.id.split('/').pop()));
  await expect.poll(saved).toEqual(['green', 'red']); // 重なりの小さい順（ボトムス → トップス）に着せる
  // タップ（動かさない）では着ない
  await page.locator('.reset-button-fixed').click();
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
  await tile.click();
  await page.waitForTimeout(300);
  expect(await saved()).toEqual([]);
  // もう一度着せてから、トップスだけ着替える: ボトムスは残り、セットの ✓ は消える
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, DOLL_Y, { steps: 4 });
  await page.mouse.up();
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await backToCategories(page);
  await dragItemToDoll(page, 'トップス', 'blue');
  await expectPixel(page, DOLL_X, TOP_Y, BLUE);
  await expectPixel(page, DOLL_X, BOTTOM_Y, GREEN);
  await openCategory(page, 'セット');
  await expect(page.getByTestId('set-tile')).toHaveAttribute('data-worn', 'false');
  // セットを着せると、それまでの服（青いトップス・靴下）は全部脱げて、セットだけになる
  await backToCategories(page);
  await dragItemToDoll(page, 'ソックス', 'sock');
  await expect.poll(saved).toContain('sock');
  await openCategory(page, 'セット');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, DOLL_Y, { steps: 4 });
  await page.mouse.up();
  await expectPixel(page, DOLL_X, TOP_Y, RED);
  await expect.poll(saved).toEqual(['green', 'red']);
});

test.describe('縦画面', () => {
  const PW = 820;
  const PH = 1180;
  const PS = 776; // 縦（820×1180）の、正方形の一辺: 服を 2 段（120px）にする分、幅より少し小さい
  const P_UNIT = (PS * 0.9) / 1024;
  const P_DOLL_X = PW / 2;
  const pY = (y: number) => PS / 2 + (y - IMG / 2) * P_UNIT;

  async function openPortrait(page: Page, width = PW, height = PH): Promise<void> {
    await openApp(page);
    await page.setViewportSize({ width, height });
    await expect(page.locator('.app')).toHaveAttribute('data-orientation', 'portrait');
    await expect(page.getByTestId('portrait-categories')).toBeVisible();
    // 出てくるときの動き（0.5 秒、少し下から上がる）が終わるまで待つ。途中で位置を測ると、キャンバスが 10px ほど下にある
    await expect.poll(async () => (await page.getByTestId('avatar-canvas').boundingBox())?.y).toBe(0);
  }
  const selectCategory = (page: Page, label: string) => page.getByTestId('portrait-categories').getByRole('button', { name: label }).click();
  const itemBox = async (page: Page, name: string) => (await page.getByTestId('portrait-items').locator(`img[alt="${name}"]`).boundingBox())!;

  test('服の絵は大きく、2 段まで: スマホ 390×844 は 104px・2 段、375×667 は 100px・1 段、iPad 820×1180 は 120px・2 段', async ({ page }) => {
    await openPortrait(page);
    await selectCategory(page, 'トップス');
    for (const [w, h, tile, rows, phone] of [[390, 844, 104, 2, 'true'], [375, 667, 100, 1, 'true'], [820, 1180, 120, 2, 'false']] as const) {
      await page.setViewportSize({ width: w, height: h });
      await expect(page.locator('.app')).toHaveAttribute('data-phone', phone);
      await expect.poll(async () => Math.round((await page.getByTestId('portrait-items').locator('> *').first().boundingBox())!.width), { message: `${w}×${h} の絵` }).toBe(tile);
      const first = await itemBox(page, 'red');
      const tileBox = (await page.getByTestId('portrait-items').locator('> *').first().boundingBox())!;
      expect([Math.round(tileBox.width), Math.round(tileBox.height)], `${w}×${h} の絵`).toEqual([tile, tile]);
      expect(first.width).toBeLessThanOrEqual(tile);
      const tracks = await page.getByTestId('portrait-items').evaluate((el) => getComputedStyle(el).gridTemplateRows.split(' ').length);
      expect(tracks, `${w}×${h} の段`).toBe(rows);
      // 服の行は、ボタンの行より上に収まる
      const items = (await page.getByTestId('portrait-items').boundingBox())!;
      const tools = (await page.getByTestId('portrait-tools').boundingBox())!;
      expect(items.height).toBeGreaterThanOrEqual(rows * tile);
      expect(items.y + items.height).toBeLessThanOrEqual(tools.y + 0.5);
      expect(tools.y + tools.height).toBeLessThanOrEqual(h + 0.5);
    }
  });

  test('服が行に収まらないとき、右端に次の服がのぞく', async ({ page }) => {
    await openPortrait(page, 240, 480); // 1 段・絵 84px。トップスは 3 点
    await selectCategory(page, 'トップス');
    const boxes = await page.getByTestId('portrait-items').locator('> *').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, width: r.width })));
    expect(boxes).toHaveLength(3);
    expect(boxes[1].right).toBeLessThanOrEqual(240); // 2 点は、まるごと見える
    const shown = (240 - boxes[2].left) / boxes[2].width; // 3 点めの、見えている割合
    expect(shown).toBeGreaterThanOrEqual(0.3);
    expect(shown).toBeLessThanOrEqual(0.7);
  });

  test('セットのタイルも同じ大きさで、中の絵がはみ出さない', async ({ page }) => {
    await openPortrait(page, 390, 844);
    await selectCategory(page, 'セット');
    const tile = page.getByTestId('portrait-items').getByTestId('set-tile');
    const box = (await tile.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([104, 104]);
    for (const img of await tile.locator('img').all()) {
      const b = (await img.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(box.x - 0.5);
      expect(b.y).toBeGreaterThanOrEqual(box.y - 0.5);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 0.5);
      expect(b.y + b.height).toBeLessThanOrEqual(box.y + box.height + 0.5);
    }
  });

  test('メニューは下にあり、服を上へドラッグして着せる。メニューの上で離すと着ない', async ({ page }) => {
    await openPortrait(page);
    const categories = page.getByTestId('portrait-categories');
    await expect(categories.getByRole('button', { name: 'トップス' })).toBeVisible();
    await expect(categories.getByRole('button', { name: 'ボトムス' })).toBeVisible();
    // 3 つの行は、キャンバスの下に、上から カテゴリ → 服 → ボタン の順
    const canvas = (await page.getByTestId('avatar-canvas').boundingBox())!;
    const cat = (await categories.boundingBox())!;
    const items = (await page.getByTestId('portrait-items').boundingBox())!;
    const tools = (await page.getByTestId('portrait-tools').boundingBox())!;
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(cat.y + 0.5);
    expect(cat.y + cat.height).toBeLessThanOrEqual(items.y + 0.5);
    expect(items.y + items.height).toBeLessThanOrEqual(tools.y + 0.5);
    expect(tools.y + tools.height).toBeLessThanOrEqual(PH + 0.5);
    await selectCategory(page, 'トップス');
    await expect(categories.getByRole('button', { name: 'トップス' })).toHaveAttribute('aria-pressed', 'true');
    const red = await itemBox(page, 'red');
    // ボタンの位置は、リセットが出ても変わらない
    const cameraX = (await page.getByTestId('portrait-tools').locator('.screenshot-button').boundingBox())!.x;
    // 上へドラッグして着せる。服の行を出たら（カテゴリの行の上でも）、絵が指に付いてくる
    const preview = page.getByTestId('drag-preview');
    await page.mouse.move(red.x + red.width / 2, red.y + red.height / 2);
    await page.mouse.down();
    await page.mouse.move(red.x + red.width / 2, red.y + red.height / 2 - 12, { steps: 2 });
    await expect(preview).toBeHidden(); // 服の行の中では、服そのものが動く
    await page.mouse.move(red.x + red.width / 2 + 30, cat.y + cat.height / 2, { steps: 4 });
    await expect(preview).toBeVisible();
    const pv = (await preview.boundingBox())!;
    expect(Math.abs(pv.x + pv.width / 2 - (red.x + red.width / 2 + 30))).toBeLessThan(2);
    expect(Math.abs(pv.y + pv.height / 2 - (cat.y + cat.height / 2))).toBeLessThan(2);
    // メニューより手前に見えている
    expect(await page.evaluate(([x, y]) => document.elementsFromPoint(x, y).findIndex((el) => el.getAttribute('data-testid') === 'drag-preview') === -1, [pv.x + pv.width / 2, pv.y + pv.height / 2])).toBe(true); // 押せない絵なので、当たり判定には出ない
    expect(Number(await preview.evaluate((el) => getComputedStyle(el).zIndex))).toBeGreaterThan(10);
    await page.mouse.move(P_DOLL_X, pY(380), { steps: 6 });
    await page.mouse.up();
    await expect(preview).toBeHidden();
    await expectPixel(page, P_DOLL_X, pY(380), RED);
    expect((await page.getByTestId('portrait-tools').locator('.screenshot-button').boundingBox())!.x).toBe(cameraX);
    // メニューの上で離すと着ない（青に替わらない）
    const blue = await itemBox(page, 'blue');
    await page.mouse.move(blue.x + blue.width / 2, blue.y + blue.height / 2);
    await page.mouse.down();
    await page.mouse.move(blue.x + blue.width / 2, cat.y + 20, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await expectPixel(page, P_DOLL_X, pY(380), RED);
    // ボタンの行: 調整・写真・リセット
    const toolRow = page.getByTestId('portrait-tools');
    await expect(toolRow.locator('.screenshot-button')).toBeVisible();
    await expect(toolRow.locator('.reset-button-fixed')).toBeVisible();
    await toolRow.locator('.tool-button').click();
    await expect(page.locator('.item-adjust-done-btn-small')).toBeVisible();
    await page.locator('.item-adjust-done-btn-small').click();
    await expect(toolRow.locator('.tool-button')).toBeVisible();
    // リセットで脱げる
    await toolRow.locator('.reset-button-fixed').click();
    await expectPixel(page, P_DOLL_X, pY(380), SKIN);
  });

  test('背景を選べる。ドールを切り替える欄がある', async ({ page }) => {
    await openPortrait(page);
    await expect(page.getByTestId('portrait-categories').locator('select')).toBeVisible();
    await selectCategory(page, 'はいけい');
    const bg = (await page.getByTestId('portrait-items').locator('img').first().boundingBox())!;
    await page.mouse.move(bg.x + bg.width / 2, bg.y + bg.height / 2);
    await page.mouse.down();
    await page.mouse.move(P_DOLL_X, 200, { steps: 6 });
    await page.mouse.up();
    // 縦では、背景を画面の幅いっぱいに描く（正方形 776 は幅 820 より狭いが、左右にすきまを作らない）
    const BG_X = 5;
    await expectPixel(page, BG_X, BG_Y, BG);
    await expectPixel(page, PW - 5, PS - 5, BG);
    // 古い iPad（768×1024）は、正方形がもっと狭い（620）。それでも、左右の端まで背景
    await page.setViewportSize({ width: 768, height: 1024 });
    await expectPixel(page, 5, BG_Y, BG);
    await expectPixel(page, 763, 590, BG); // 正方形は 600（1024 − メニュー 424）
    await page.setViewportSize({ width: PW, height: PH });
    await expectPixel(page, BG_X, BG_Y, BG);
    // 「なし」は、服の絵と同じ大きさ
    const none = (await page.getByTestId('portrait-items').getByRole('button', { name: /なし/ }).boundingBox())!;
    expect([Math.round(none.width), Math.round(none.height)]).toEqual([120, 120]);
    // 「なし」で外れる
    await page.getByTestId('portrait-items').getByRole('button', { name: /なし/ }).click();
    await expect.poll(async () => near(await canvasPixel(page, BG_X, BG_Y), BG)).toBe(false);
  });

  test('せまくて低い画面（360×640）でも、キャンバスと 3 つの行が重ならず、画面の中に収まる', async ({ page }) => {
    await openPortrait(page, 360, 640);
    // 出てくるときの動きが終わるまで待つ
    await expect.poll(async () => (await page.getByTestId('avatar-canvas').boundingBox())?.y).toBe(0);
    const round = (box: { x: number; y: number; width: number; height: number }) => ({ x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) });
    const canvas = round((await page.getByTestId('avatar-canvas').boundingBox())!);
    const cat = (await page.getByTestId('portrait-categories').boundingBox())!;
    const items = (await page.getByTestId('portrait-items').boundingBox())!;
    const tools = (await page.getByTestId('portrait-tools').boundingBox())!;
    expect(canvas).toEqual({ x: 0, y: 0, width: 360, height: 360 });
    expect(canvas.y + canvas.height).toBeLessThanOrEqual(cat.y + 0.5);
    expect(cat.y + cat.height).toBeLessThanOrEqual(items.y + 0.5);
    expect(items.y + items.height).toBeLessThanOrEqual(tools.y + 0.5);
    expect(tools.y + tools.height).toBeLessThanOrEqual(640.5);
    for (const box of [cat, items, tools]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(360.5);
    }
    // ボタンは 3 つとも押せる大きさで、画面の中
    for (const selector of ['.tool-button', '.screenshot-button']) {
      const b = (await page.getByTestId('portrait-tools').locator(selector).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(40);
      expect(b.x + b.width).toBeLessThanOrEqual(360);
    }
  });

  // 縦の調整画面を開き、トップス（red）を調整中にする
  async function openPortraitAdjust(page: Page, width: number, height: number): Promise<void> {
    await openPortrait(page);
    await selectCategory(page, 'トップス');
    const box = await itemBox(page, 'red');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(P_DOLL_X, pY(380), { steps: 6 });
    await page.mouse.up();
    await expectPixel(page, P_DOLL_X, pY(380), RED);
    await page.setViewportSize({ width, height });
    await page.getByTestId('portrait-tools').locator('.tool-button').click();
    await expect(page.getByTestId('adjust-preview')).toBeVisible();
  }
  const boxOf = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;
  const apart = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
    a.x + a.width <= b.x + 0.5 || b.x + b.width <= a.x + 0.5 || a.y + a.height <= b.y + 0.5 || b.y + b.height <= a.y + 0.5;

  for (const [w, h] of [[390, 844], [375, 667], [820, 1180]] as const) {
    test(`調整画面の色（${w}×${h}）: 色だけの行に、その服がなる色の太い帯。動かすと服の色が変わり、「色をもどす」で戻る`, async ({ page }) => {
      await openPortraitAdjust(page, w, h);
      const slider = page.locator('.hue-slider-vertical');
      const band = (await slider.boundingBox())!;
      expect(band.height).toBeGreaterThanOrEqual(48);
      expect(band.width).toBeGreaterThanOrEqual(w * 0.6);
      await expect(page.locator('.hue-value')).toBeHidden();
      // 帯の色: 赤い服なら、まん中（13 色のうち 7 番め）が赤
      await expect.poll(() => slider.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
      const stops = await slider.evaluate((el) => getComputedStyle(el).backgroundImage.match(/rgb\([^)]+\)/g) ?? []);
      expect(stops).toHaveLength(13);
      expect(stops[6]).toBe('rgb(255, 0, 0)');
      expect(stops[6]).not.toBe(stops[10]);
      // 動かすと、服の色が変わる
      await slider.fill('120');
      await expect(page.getByTestId('adjust-preview')).toHaveAttribute('data-hue', '120');
      await page.getByTestId('hue-reset').click();
      await expect(page.getByTestId('adjust-preview')).toHaveAttribute('data-hue', '0');
      // 帯・色をもどす・一覧・↺・✓ は、画面の中で、互いに重ならない。枠のつまみとも重ならない
      const parts = {
        band,
        hueReset: await boxOf(page, '[data-testid="hue-reset"]'),
        picker: await boxOf(page, '[data-testid="adjust-picker"]'),
        reset: await boxOf(page, '.item-adjust-reset-btn-small'),
        done: await boxOf(page, '.item-adjust-done-btn-small'),
      };
      const names = Object.keys(parts) as (keyof typeof parts)[];
      for (const name of names) {
        const b = parts[name];
        expect(b.x, `${name} の左`).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width, `${name} の右`).toBeLessThanOrEqual(w + 0.5);
        expect(b.y + b.height, `${name} の下`).toBeLessThanOrEqual(h + 0.5);
      }
      for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) expect(apart(parts[names[i]], parts[names[j]]), `${names[i]} と ${names[j]}`).toBe(true);
      for (const handle of ['sticker-remove', 'sticker-reset', 'sticker-rotate']) {
        const hb = await boxOf(page, `[data-testid="${handle}"]`);
        for (const name of names) expect(apart(hb, parts[name]), `${handle} と ${name}`).toBe(true);
      }
      // 色の行は、↺・✓ の行の上
      expect(band.y + band.height).toBeLessThanOrEqual(parts.done.y + 0.5);
      // 下の帯の高さ: 服の調整は 2 行（124px）
      expect(Math.round((await boxOf(page, '.item-adjust-top-buttons')).height)).toBe(124);
      // ドールの調整（何も着ていないとき）では、色だけの行が無く、下の帯は 1 行（64px）
      await page.getByTestId('sticker-remove').click();
      await expect(page.getByTestId('adjust-preview')).toHaveCount(0);
      if ((await page.locator('.item-adjust-overlay').count()) === 0) await page.getByTestId('portrait-tools').locator('.tool-button').click();
      await expect(page.locator('.item-adjust-overlay')).toHaveAttribute('data-mode', 'doll');
      await expect(slider).toHaveCount(0);
      expect(Math.round((await boxOf(page, '.item-adjust-top-buttons')).height)).toBe(64);
    });
  }

  test('調整画面: 一覧と色・ボタンは下にあり、一覧は左右に動かして並べ替える。持ち替えても、服はドールに対して同じ位置', async ({ page }) => {
    await openPortrait(page);
    for (const [category, name] of [['トップス', 'red'], ['ボトムス', 'green']] as const) {
      await selectCategory(page, category);
      const box = await itemBox(page, name);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(P_DOLL_X, pY(500), { steps: 6 });
      await page.mouse.up();
    }
    await expectPixel(page, P_DOLL_X, pY(660), GREEN);
    await page.getByTestId('portrait-tools').locator('.tool-button').click();
    // 一覧は、キャンバスの下に横並び（左が手前）
    const rows = page.locator('[data-testid="adjust-picker-items"] > *');
    const names = () => rows.evaluateAll((els) => els.map((el) => (el.getAttribute('title') ?? '').slice(0, 3)));
    await expect.poll(names).toEqual(['red', 'gre', 'ドール']);
    const r0 = (await rows.nth(0).boundingBox())!;
    const r1 = (await rows.nth(1).boundingBox())!;
    expect(Math.abs(r0.y - r1.y)).toBeLessThan(1);
    expect(r1.x).toBeGreaterThan(r0.x + r0.width - 1);
    expect(r0.y).toBeGreaterThanOrEqual(PS); // 正方形より下
    // 色のスライダーと ✓ ↺ も、キャンバスより下
    for (const selector of ['.item-adjust-done-btn-small', '.item-adjust-reset-btn-small', '.hue-slider-vertical']) {
      const box = (await page.locator(selector).boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(PS);
      expect(box.y + box.height).toBeLessThanOrEqual(PH);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(PW);
    }
    const slider = (await page.locator('.hue-slider-vertical').boundingBox())!;
    expect(slider.width).toBeGreaterThan(slider.height * 2); // 横向きのスライダー
    // 行を右へ動かして、となりと入れ替える
    await page.mouse.move(r0.x + r0.width / 2, r0.y + r0.height / 2);
    await page.mouse.down();
    await page.mouse.move(r0.x + r0.width / 2 + (r1.x - r0.x) * 0.7, r0.y + r0.height / 2, { steps: 5 });
    await page.mouse.up();
    await expect.poll(names).toEqual(['gre', 'red', 'ドール']);
    // 調整中の服（ボトムス）を右へ動かして確定
    const DX = 150;
    await page.mouse.move(P_DOLL_X, pY(660));
    await page.mouse.down();
    await page.mouse.move(P_DOLL_X + DX, pY(660), { steps: 6 });
    await page.mouse.up();
    await page.locator('.item-adjust-done-btn-small').click();
    await expectPixel(page, P_DOLL_X + DX + 120, pY(660), GREEN);
    // 横に持ち替える（高さ 700 の横画面: 縮尺が縦のときと違う）: ドールに対して同じ位置（ずれは、縮尺の比 だけ変わる）
    const LW = 1024;
    const LH = 700;
    await page.setViewportSize({ width: LW, height: LH });
    await expect(page.locator('.app')).toHaveAttribute('data-orientation', 'landscape');
    const lUnit = (LH * 0.9) / 1024;
    const k = lUnit / P_UNIT;
    const lDollX = MENU_W + (LW - MENU_W - RIGHT_W) / 2;
    const lY = LH / 2 + (660 - IMG / 2) * lUnit;
    // 服（ドールの絵で幅 440）は、ずれが縮尺の比で縮んだ位置にある。
    // 縮んでいれば 中心 +128・左右 ±135（-7〜263）、縮んでいなければ 中心 +150（15〜285）
    const half = (440 * lUnit) / 2;
    await expectPixel(page, lDollX + DX * k - half + 11, lY, GREEN);
    await expect.poll(async () => near(await canvasPixel(page, lDollX + DX * k + half + 11, lY), GREEN), { timeout: 10_000 }).toBe(false);
  });

  test('調整画面を開いたまま持ち替えても、落ちずに調整を続けられる', async ({ page }) => {
    await openPortrait(page);
    await selectCategory(page, 'トップス');
    const box = await itemBox(page, 'red');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(P_DOLL_X, pY(380), { steps: 6 });
    await page.mouse.up();
    await page.getByTestId('portrait-tools').locator('.tool-button').click();
    await expect(page.locator('.item-adjust-done-btn-small')).toBeVisible();
    await page.setViewportSize({ width: VIEW_W, height: VIEW_H });
    await expect(page.locator('.app')).toHaveAttribute('data-orientation', 'landscape');
    await expect(page.locator('.item-adjust-done-btn-small')).toBeVisible();
    await expect(page.getByTestId('adjust-picker-item')).toHaveCount(1);
    // 横の調整画面として動く: 動かして確定
    await page.mouse.move(DOLL_X, TOP_Y);
    await page.mouse.down();
    await page.mouse.move(DOLL_X + ADJUST_DX, TOP_Y, { steps: 6 });
    await page.mouse.up();
    await page.locator('.item-adjust-done-btn-small').click();
    await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, RED);
  });

  test('セット: 縦でも、セットを上へドラッグすると全部のパーツが着く', async ({ page }) => {
    await openPortrait(page);
    await selectCategory(page, 'セット');
    const tile = page.getByTestId('portrait-items').getByTestId('set-tile');
    await expect(tile).toHaveCount(1);
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(P_DOLL_X, pY(500), { steps: 6 });
    await page.mouse.up();
    await expectPixel(page, P_DOLL_X, pY(380), RED);
    await expectPixel(page, P_DOLL_X, pY(660), GREEN);
    await expect(tile).toHaveAttribute('data-worn', 'true');
  });

  test.describe('指での操作', () => {
    test.use({ hasTouch: true });
    type Pt = { x: number; y: number };
    async function finger(page: Page) {
      const client = await page.context().newCDPSession(page);
      return (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Pt[]) =>
        client.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) });
    }
    const tileCenter = async (page: Page, name: string): Promise<Pt> => {
      const box = await itemBox(page, name);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };

    test('服の行が画面に収まっているとき: 横に動かし始めても、そのままドールまで運べば着る', async ({ page }) => {
      await openPortrait(page);
      await selectCategory(page, 'トップス');
      const touch = await finger(page);
      const from = await tileCenter(page, 'red');
      await touch('touchStart', [from]);
      for (const dx of [15, 30, 45, 60]) await touch('touchMove', [{ x: from.x + dx, y: from.y - 2 }]);
      for (const f of [0.25, 0.5, 0.75, 1]) await touch('touchMove', [{ x: from.x + 60 + (P_DOLL_X - from.x - 60) * f, y: from.y + (pY(380) - from.y) * f }]);
      await touch('touchEnd', []);
      await expectPixel(page, P_DOLL_X, pY(380), RED);
      await expect(page.getByTestId('drag-preview')).toBeHidden();
    });

    test('服の行が画面に収まらないとき: 横になぞると行が流れて着ない。上へ動かせば着る', async ({ page }) => {
      await openPortrait(page, 240, 480); // 服の行が 1 段（絵 84px）で、3 点が幅に収まらない大きさ
      await selectCategory(page, 'トップス');
      const list = page.getByTestId('portrait-items');
      await expect.poll(() => list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(4);
      const max = await list.evaluate((el) => el.scrollWidth - el.clientWidth);
      const touch = await finger(page);
      const from = await tileCenter(page, 'blue');
      await touch('touchStart', [from]);
      for (const dx of [-15, -30, -45, -60]) await touch('touchMove', [{ x: from.x + dx, y: from.y - 3 }]);
      await touch('touchEnd', []);
      await expect.poll(() => list.evaluate((el) => el.scrollLeft)).toBe(max);
      await expect(page.getByTestId('drag-preview')).toBeHidden();
      expect(await page.evaluate(() => localStorage.getItem('dressup_outfit'))).toBeNull();
      // 上へ動かせば着る（正方形の一辺は 240）
      const unit = (240 * 0.9) / 1024;
      const target = { x: 120, y: 120 + (380 - IMG / 2) * unit };
      const start = await tileCenter(page, 'blue');
      await touch('touchStart', [start]);
      for (const f of [0.1, 0.4, 0.7, 1]) await touch('touchMove', [{ x: start.x + (target.x - start.x) * f, y: start.y + (target.y - start.y) * f }]);
      await touch('touchEnd', []);
      await expectPixel(page, target.x, target.y, BLUE);
    });
  });
});
