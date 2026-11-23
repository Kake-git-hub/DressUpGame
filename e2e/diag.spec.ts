/**
 * きろく（あいことば「log」）: 作者の端末でしか起きない不具合を調べるための画面
 */
import { expect, test } from '@playwright/test';

const APP_URL = '/DressUpGame/?content=e2e-content/&home=0';

test('版数を 5 回押して「log」: 端末と描画の状態・着せたセット・描画が落ちたことが、画面に出る', async ({ page }) => {
  const answers = ['log'];
  page.on('dialog', (d) => void d.accept(answers.shift() ?? ''));
  await page.goto(APP_URL);
  await page.waitForSelector('.app');
  // セットを着せる
  await page.getByText('セット', { exact: true }).first().click();
  const tile = page.getByTestId('set-tile');
  await expect(tile).toHaveCount(1);
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(640, 370, { steps: 4 });
  await page.mouse.up();
  await expect(tile).toHaveAttribute('data-worn', 'true');
  // 描画の土台（WebGL）を、わざと落とす
  await page.evaluate(() => {
    const canvas = document.querySelector('#avatar-canvas') as HTMLCanvasElement;
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    gl!.getExtension('WEBGL_lose_context')!.loseContext();
  });
  await page.waitForTimeout(300);

  const badge = page.locator('.version-badge');
  for (let i = 0; i < 5; i++) await badge.click();
  const panel = page.getByTestId('diag-panel');
  await expect(panel).toBeVisible();
  const text = await panel.locator('pre').innerText();
  expect(text).toMatch(/きせかえ v\d+\.\d+\.\d+/);
  expect(text).toContain('standalone: false');
  expect(text).toContain('1180x820');
  expect(text).toContain('"lost":true');
  expect(text).toMatch(/start v\d/);
  expect(text).toContain('set parts=2');
  expect(text).toMatch(/clothes n=2/);
  expect(text).toContain('WebGLコンテキストがロストしました');
  // 行の順番: 着せた → 落ちた
  expect(text.indexOf('set parts=2')).toBeLessThan(text.indexOf('WebGLコンテキストがロストしました'));

  // 「ほうこくする」: GitHub の、このリポジトリの「新しい Issue」が、きろく入りで開く（写して送らなくてよい）
  const link = panel.getByRole('link', { name: 'GitHub に ほうこくする' });
  await expect(link).toHaveAttribute('target', '_blank');
  const before = new URL((await link.getAttribute('href'))!);
  expect(`${before.origin}${before.pathname}`).toBe('https://github.com/Kake-git-hub/DressUpGame/issues/new');
  expect(before.searchParams.get('title')).toMatch(/^\[きろく\] v\d+\.\d+\.\d+ ほうこく$/);
  expect(before.searchParams.get('body')).toContain('set parts=2');
  expect(before.searchParams.get('body')).toContain('WebGLコンテキストがロストしました');
  // 何が起きたかを書くと、題と本文に入る
  await panel.getByPlaceholder('なにが おきましたか？').fill('セットを きせたら きえた');
  const after = new URL((await link.getAttribute('href'))!);
  expect(after.searchParams.get('title')).toContain('セットを きせたら きえた');
  expect(after.searchParams.get('body')!.startsWith('セットを きせたら きえた')).toBe(true);

  await panel.getByRole('button', { name: 'とじる' }).click();
  await expect(panel).toHaveCount(0);
});

test('きろくは、開き直しても「前の回」として残る', async ({ page }) => {
  const answers = ['log'];
  page.on('dialog', (d) => void d.accept(answers.shift() ?? ''));
  await page.goto(APP_URL);
  await page.waitForSelector('.app');
  await page.evaluate(() => console.warn('ためしの警告'));
  await page.reload();
  await page.waitForSelector('.app');
  const badge = page.locator('.version-badge');
  for (let i = 0; i < 5; i++) await badge.click();
  const text = await page.getByTestId('diag-panel').locator('pre').innerText();
  expect(text.indexOf('ためしの警告')).toBeGreaterThan(text.indexOf('前の回'));
  expect(text.indexOf('ためしの警告')).toBeLessThan(text.indexOf('今回'));
});

// ホームへ戻ると、キャンバスを片付ける。そのとき Pixi が描画の土台を手放すが、それは「落ちた」のではない。
// 前は、これも「WebGLコンテキストがロストしました」と残って、本当に落ちたのと見分けられなかった（Issue 7 のきろく）
test('ホームへ戻ったときの片付けは、きろくに「落ちた」と残さない（gl closed と残す）', async ({ page }) => {
  const answers = ['log'];
  page.on('dialog', (d) => void d.accept(answers.shift() ?? ''));
  await page.goto(APP_URL);
  await page.waitForSelector('#avatar-canvas');
  await page.waitForTimeout(500);
  await page.getByTestId('home-back-button').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.waitForTimeout(300);
  const badge = page.locator('.version-badge');
  for (let i = 0; i < 5; i++) await badge.click();
  const text = await page.getByTestId('diag-panel').locator('pre').innerText();
  expect(text).toContain('gl closed');
  expect(text).not.toContain('WebGLコンテキストがロストしました');
});

// iPad で、セットを着せるとドールも服も消える不具合（v0.35.0）。
// 服を着せるたびに、服をまとめた下書き（2 のべき乗の大きさ × なめらかにする 4 倍の作業用の領域）を確保していて、
// セット（広い範囲に服がある）を着せた瞬間に、数十〜数百 MB を一度に取っていた。描画の土台（WebGL）が落ちる原因になる
test('服を着せても、描画用の大きな作業の領域（下書き）を確保しない', async ({ page }) => {
  await page.addInitScript(() => {
    const stat = { renderbufferBytes: 0, bigTextures: 0 };
    (window as unknown as { __gpu: typeof stat }).__gpu = stat;
    const proto = WebGL2RenderingContext.prototype;
    const storage = proto.renderbufferStorage;
    proto.renderbufferStorage = function (target, format, width, height) {
      stat.renderbufferBytes += width * height * 4;
      return storage.call(this, target, format, width, height);
    };
    const multi = proto.renderbufferStorageMultisample;
    proto.renderbufferStorageMultisample = function (target, samples, format, width, height) {
      stat.renderbufferBytes += width * height * 4 * Math.max(1, samples);
      return multi.call(this, target, samples, format, width, height);
    };
    // 絵（画像）ではない、中身が空のテクスチャ = 作業用の領域。1024×1024 以上を数える
    const tex = proto.texImage2D as (...args: unknown[]) => void;
    (proto as unknown as { texImage2D: (...args: unknown[]) => void }).texImage2D = function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (args.length >= 9 && args[8] == null && (args[3] as number) * (args[4] as number) >= 1024 * 1024) stat.bigTextures++;
      return tex.apply(this, args);
    };
  });
  await page.goto(APP_URL);
  await page.waitForSelector('.app');
  await page.getByText('セット', { exact: true }).first().click();
  const tile = page.getByTestId('set-tile');
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(640, 370, { steps: 4 });
  await page.mouse.up();
  await expect(tile).toHaveAttribute('data-worn', 'true');
  await page.waitForTimeout(1500); // 着せたあとの描き直し（1 秒）が終わるまで
  const stat = await page.evaluate(() => (window as unknown as { __gpu: { renderbufferBytes: number; bigTextures: number } }).__gpu);
  expect(stat).toEqual({ renderbufferBytes: 0, bigTextures: 0 });
});
