/**
 * E2Eテスト: アプリの中のスタジオ（裏側は、端末の中だけで動く偽物。?studio=fake）
 */
import fs from 'node:fs';
import path from 'node:path';
import { test, expect, type Page } from '@playwright/test';

const APP = '/DressUpGame/?content=e2e-content/';
const FAKE = `${APP}&studio=fake`;
const VIEW_W = 1180;
const VIEW_H = 820;
const BASE_SCALE = (VIEW_H * 0.9) / 1024;
const DOLL_X = 160 + (VIEW_W - 160 - 60) / 2;
const imgY = (y: number) => VIEW_H / 2 + (y - 512) * BASE_SCALE;
// 偽物が作る絵の色（1 点目・2 点目）と、ドールのキャンバスの上の位置（中心）
const FIRST = [224, 64, 160];
const SECOND = [64, 160, 224];
const FIRST_Y = imgY(400);
const SECOND_Y = imgY(600);

async function pixel(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    ([px, py]) => {
      const src = document.querySelector('#avatar-canvas') as HTMLCanvasElement | null;
      if (!src) return [0, 0, 0]; // まだ読み込み中
      const rect = src.getBoundingClientRect();
      const out = document.createElement('canvas');
      out.width = 1;
      out.height = 1;
      const ctx = out.getContext('2d')!;
      ctx.drawImage(src, Math.round(((px - rect.left) / rect.width) * src.width), Math.round(((py - rect.top) / rect.height) * src.height), 1, 1, 0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
    },
    [x, y],
  );
}
const near = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 10);
const expectPixel = (page: Page, x: number, y: number, color: number[]) => expect.poll(async () => near(await pixel(page, x, y), color), { timeout: 20_000 }).toBe(true);

async function open(page: Page, url = FAKE, options: { delayMs?: number; failCategories?: string[]; tickets?: number } = {}) {
  // 偽物の速さなどは、端末の保存から読む（テスト用の入口）
  await page.addInitScript((o) => {
    if (!localStorage.getItem('dressup_fake_options')) localStorage.setItem('dressup_fake_options', JSON.stringify(o));
  }, { delayMs: 300, ...options });
  await page.goto(url);
  await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible({ timeout: 60_000 });
}

// 入口の問い（「十二 かける 七 は？」）を読んで、答えを返す
const KANJI: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function answerOf(question: string): number {
  const m = /^(十)?([一二三四五六七八九])?\s*かける\s*([二三四五六七八九])/.exec(question.trim());
  if (!m) throw new Error(`問いを読めません: ${question}`);
  return ((m[1] ? 10 : 0) + (m[2] ? KANJI[m[2]] : 0)) * KANJI[m[3]];
}
async function passGate(page: Page) {
  await page.getByTestId('studio-button').click();
  await expect(page.getByTestId('adult-gate')).toBeVisible();
  await page.getByTestId('adult-answer').fill(String(answerOf((await page.getByTestId('adult-question').textContent()) ?? '')));
  await page.getByTestId('adult-18').check();
  await page.getByTestId('adult-open').click();
  await expect(page.getByTestId('app-studio')).toBeVisible();
  await expect(page.getByTestId('studio-tickets')).toContainText('枚');
}
async function make(page: Page, target: string, theme = 'うみ') {
  await page.getByTestId(`studio-target-${target}`).click();
  await page.getByTestId('studio-theme').fill(theme);
  await page.getByTestId('studio-make').click();
}
const candidates = (page: Page) => page.getByTestId('studio-candidate');

test('「つくる」のボタンは、教えた URL を開いた端末にだけ出る（次からも出る）。?studio=0 で消える', async ({ page }) => {
  await open(page, APP);
  await expect(page.getByTestId('studio-button')).toHaveCount(0);
  await open(page, FAKE);
  await expect(page.getByTestId('studio-button')).toBeVisible();
  await open(page, APP);
  await expect(page.getByTestId('studio-button')).toBeVisible();
  await open(page, `${APP}&studio=0`);
  await expect(page.getByTestId('studio-button')).toHaveCount(0);
});

test('入口は保護者用: 問いに正しく答えて、18 歳以上に印を付けないと開かない。開いたあとは、閉じるまで聞かない', async ({ page }) => {
  await open(page);
  await page.getByTestId('studio-button').click();
  const gate = page.getByTestId('adult-gate');
  await expect(gate).toBeVisible();
  await expect(gate).toContainText('おとなの方へ');
  await expect(page.getByTestId('adult-open')).toBeDisabled();
  const question = (await page.getByTestId('adult-question').textContent()) ?? '';
  const answer = answerOf(question);
  // 答えだけ・印だけでは開かない
  await page.getByTestId('adult-answer').fill(String(answer));
  await expect(page.getByTestId('adult-open')).toBeDisabled();
  await page.getByTestId('adult-answer').fill('');
  await page.getByTestId('adult-18').check();
  await expect(page.getByTestId('adult-open')).toBeDisabled();
  // まちがえると、知らせが出て、問いが替わる
  await page.getByTestId('adult-answer').fill(String(answer + 1));
  await page.getByTestId('adult-open').click();
  await expect(page.getByTestId('adult-error')).toBeVisible();
  await expect(page.getByTestId('app-studio')).toHaveCount(0);
  await expect(page.getByTestId('adult-answer')).toHaveValue('');
  // やめる
  await page.getByTestId('adult-cancel').click();
  await expect(gate).toHaveCount(0);
  // 正しく答えると開く。閉じて開き直しても、もう聞かない
  await passGate(page);
  await page.getByTestId('studio-close').click();
  await expect(page.getByTestId('app-studio')).toHaveCount(0);
  await page.getByTestId('studio-button').click();
  await expect(page.getByTestId('app-studio')).toBeVisible();
});

test('1 点作る: チケットが 1 枚減り、できた服を「使う」と、自分のメニューに出て着せられる。読み込み直しても残る', async ({ page }) => {
  await open(page);
  await passGate(page);
  await expect(page.getByTestId('studio-tickets')).toContainText('5');
  await expect(page.getByTestId('studio-user-code')).toHaveText(/[A-Z0-9]{8}/);
  // 確認用（偽物の裏側）のときは、そうと分かる知らせを出す
  await expect(page.getByTestId('studio-demo')).toContainText('確認用');
  await page.getByTestId('studio-target-トップス').click();
  await expect(page.getByTestId('studio-make')).toBeDisabled(); // テーマがまだ
  await page.getByTestId('studio-theme').fill('うみ');
  await expect(page.getByTestId('studio-make')).toContainText('チケット 1 枚');
  await page.getByTestId('studio-make').click();
  await expect(page.getByTestId('studio-tickets')).toContainText('4');
  await expect(candidates(page)).toHaveCount(1);
  await expect(candidates(page)).toHaveAttribute('data-status', 'done', { timeout: 10_000 });
  await expect(candidates(page).locator('img[data-preview]')).toBeVisible();
  await candidates(page).getByTestId('studio-candidate-name').fill('うみのふく');
  await candidates(page).getByTestId('studio-keep').click();
  await expect(candidates(page)).toHaveCount(0);
  await expect(page.getByTestId('studio-my-item')).toHaveCount(1);
  await expect(page.getByTestId('studio-my-item')).toContainText('うみのふく');
  await page.getByTestId('studio-close').click();
  // ゲームのメニューに出る（自分の服の印つき）。ドラッグで着せられる
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  const tile = page.locator('.palette-section img[alt="うみのふく"]');
  await expect(tile).toBeVisible();
  await expect(page.locator('.palette-section [data-mine="true"]')).toHaveCount(1);
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, VIEW_H / 2, { steps: 4 });
  await page.mouse.up();
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
  // 読み込み直しても（URL に studio を付けなくても）、服もメニューも残る
  await page.goto(APP);
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await expect(page.locator('.palette-section img[alt="うみのふく"]')).toBeVisible();
});

test('「捨てる」と自分の服にならない。自分の服は「消す」で消える', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await open(page);
  await passGate(page);
  await make(page, 'トップス');
  await expect(candidates(page)).toHaveAttribute('data-status', 'done', { timeout: 10_000 });
  await candidates(page).getByTestId('studio-discard').click();
  await expect(candidates(page)).toHaveCount(0);
  await expect(page.getByTestId('studio-my-item')).toHaveCount(0);
  await make(page, 'トップス', 'そら');
  await expect(candidates(page)).toHaveAttribute('data-status', 'done', { timeout: 10_000 });
  await candidates(page).getByTestId('studio-keep').click();
  await expect(page.getByTestId('studio-my-item')).toHaveCount(1);
  await page.getByTestId('studio-my-delete').click();
  await expect(page.getByTestId('studio-my-item')).toHaveCount(0);
  await page.getByTestId('studio-close').click();
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await expect(page.locator('.palette-section [data-mine="true"]')).toHaveCount(0);
});

test('セット: 入れるものを選ぶと、その数だけチケットを使い、全部「使う」とゲームのセットになる', async ({ page }) => {
  await open(page);
  await passGate(page);
  await page.getByTestId('studio-target-set').click();
  const boxes = page.getByTestId('studio-set-categories');
  await expect(boxes).toBeVisible();
  for (const label of await boxes.locator('label').allTextContents()) {
    const name = label.trim();
    const box = boxes.getByLabel(name, { exact: true });
    if ((await box.isChecked()) !== ['トップス', 'ボトムス'].includes(name)) await box.click();
  }
  await page.getByTestId('studio-theme').fill('うみ');
  await expect(page.getByTestId('studio-make')).toContainText('チケット 2 枚');
  await page.getByTestId('studio-make').click();
  await expect(page.getByTestId('studio-tickets')).toContainText('3');
  await expect(candidates(page)).toHaveCount(2);
  await expect(candidates(page).nth(1)).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  await candidates(page).first().getByTestId('studio-keep').click();
  await expect(candidates(page)).toHaveCount(1);
  await candidates(page).first().getByTestId('studio-keep').click();
  await expect(page.getByTestId('studio-my-item')).toHaveCount(2);
  await page.getByTestId('studio-close').click();
  // メニューの「セット」に、作ったセットが出る（テスト用の素材のセットと合わせて 2 つ）
  await page.locator('.palette-section button', { hasText: 'セット' }).first().click();
  const mine = page.locator('[data-testid="set-tile"][title="うみのセット"]');
  await expect(mine).toHaveCount(1);
  const box = (await mine.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, VIEW_H / 2, { steps: 4 });
  await page.mouse.up();
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
  await expectPixel(page, DOLL_X, SECOND_Y, SECOND);
});

test('チケットが足りないときは作れず、理由が出る。できなかった品目の分は、チケットが戻る', async ({ page }) => {
  await open(page, FAKE, { failCategories: ['くつ'], tickets: 1 });
  await passGate(page);
  await expect(page.getByTestId('studio-tickets')).toContainText('1');
  // セット（2 枚）は作れない
  await page.getByTestId('studio-target-set').click();
  await page.getByTestId('studio-theme').fill('うみ');
  await expect(page.getByTestId('studio-make')).toBeDisabled();
  await expect(page.getByTestId('studio-hint')).toContainText('チケットが足りません');
  // くつ（できない設定）を 1 点: いったん 0 枚になり、できなかったので 1 枚に戻る
  await page.getByTestId('studio-target-くつ').click();
  await page.getByTestId('studio-make').click();
  await expect(candidates(page)).toHaveAttribute('data-status', 'failed', { timeout: 10_000 });
  await expect(candidates(page)).toContainText('チケットは戻しました');
  await expect(page.getByTestId('studio-tickets')).toContainText('1');
  await expect(candidates(page).getByTestId('studio-keep')).toHaveCount(0);
});

test('作っている間に閉じて、開き直しても、続きが見られる', async ({ page }) => {
  await open(page, FAKE, { delayMs: 2500 });
  await passGate(page);
  await make(page, 'トップス');
  await expect(candidates(page)).toHaveAttribute('data-status', 'working');
  await page.reload();
  await expect(page.locator('.palette-section button', { hasText: 'トップス' })).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('studio-button').click(); // 同じタブなので、入口はもう聞かない
  await expect(page.getByTestId('app-studio')).toBeVisible();
  await expect(candidates(page)).toHaveCount(1);
  await expect(candidates(page)).toHaveAttribute('data-status', 'done', { timeout: 15_000 });
  await expect(page.getByTestId('studio-tickets')).toContainText('4');
});

test('縦画面でも、ボタンの行から開けて、同じように作れる', async ({ page }) => {
  await open(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('portrait-tools').getByTestId('studio-button')).toBeVisible();
  await passGate(page);
  await make(page, 'トップス');
  await expect(candidates(page)).toHaveAttribute('data-status', 'done', { timeout: 10_000 });
  // 画面の幅からはみ出さない
  const studio = (await page.getByTestId('app-studio').boundingBox())!;
  expect(studio.width).toBeLessThanOrEqual(390.5);
  const keep = (await candidates(page).getByTestId('studio-keep').boundingBox())!;
  expect(keep.x + keep.width).toBeLessThanOrEqual(390.5);
});

test('スタジオの画面は、ゲームの最初の読み込みに入っていない（開いたときにだけ読み込む）', async () => {
  const dist = path.resolve('dist');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const entry = /src="([^"]*assets\/main-[^"]+\.js)"/.exec(html)?.[1] ?? /src="([^"]*assets\/index-[^"]+\.js)"/.exec(html)?.[1];
  expect(entry).toBeTruthy();
  const main = fs.readFileSync(path.join(dist, entry!.replace(/^\/DressUpGame\//, '')), 'utf8');
  expect(main).not.toContain('studio-make');
  expect(main).not.toContain('adult-question');
  // 別のファイルに入っている
  const assets = fs.readdirSync(path.join(dist, 'assets')).filter((f) => f.endsWith('.js'));
  expect(assets.some((f) => fs.readFileSync(path.join(dist, 'assets', f), 'utf8').includes('studio-make'))).toBe(true);
});
