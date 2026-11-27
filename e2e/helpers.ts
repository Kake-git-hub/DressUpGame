/**
 * E2E の共通の道具: 「つくる」を教えた端末（偽物の裏側 ?studio=fake）で開く・注文する・画素を読む
 */
import { expect, type Page } from '@playwright/test';

export const APP = '/DressUpGame/?content=e2e-content/';
export const FAKE = `${APP}&studio=fake`;
export const VIEW_W = 1180;
export const VIEW_H = 820;
const BASE_SCALE = (VIEW_H * 0.9) / 1024;
export const DOLL_X = 160 + (VIEW_W - 160 - 60) / 2;
export const imgY = (y: number) => VIEW_H / 2 + (y - 512) * BASE_SCALE;
// 偽物が作る絵の色（1 点目・2 点目）と、ドールのキャンバスの上の位置（中心）
export const FIRST = [224, 64, 160];
export const SECOND = [64, 160, 224];
export const FIRST_Y = imgY(400);
export const SECOND_Y = imgY(550);

export interface FakeOptions {
  delayMs?: number;
  planMs?: number;
  failCategories?: string[];
  tickets?: number;
  offline?: boolean;
  oldServer?: boolean;
  admin?: boolean;
  loginFail?: string;
  googleTaken?: boolean;
  noTrade?: boolean;
  noFit?: boolean;
  noBackground?: boolean;
  shop?: { open?: boolean; packs?: string };
  paySlowMs?: number;
  payResult?: 'paid' | 'cancel' | 'slow';
  welcome?: number;
  anonymous?: boolean;
  fakeLots?: { count: number; daysLeft: number }[];
  partner?: { claimAfterMs?: number; chooseMs?: number; acceptAfterMs?: number; refuse?: string; cancelAfterMs?: number };
}

export async function pixel(page: Page, x: number, y: number): Promise<number[]> {
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
export const near = (a: number[], b: number[], tolerance = 10) => a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
export const expectPixel = (page: Page, x: number, y: number, color: number[]) => expect.poll(async () => near(await pixel(page, x, y), color), { timeout: 20_000 }).toBe(true);

// 偽物の速さなどを決めて、ホームを開く（偽物の設定は、端末の保存から読まれる。最初の 1 回だけ書く）
export async function openHome(page: Page, options: FakeOptions = {}, url = FAKE) {
  await page.addInitScript((o) => {
    if (!localStorage.getItem('dressup_fake_options')) localStorage.setItem('dressup_fake_options', JSON.stringify(o));
  }, { delayMs: 300, planMs: 200, ...options });
  await page.goto(url);
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 60_000 });
}
export const gameReady = (page: Page) => expect(page.locator('.palette-section button', { hasText: 'トップス' }).first()).toBeVisible({ timeout: 60_000 });
// ホーム → あそぶ
export async function play(page: Page) {
  await page.getByTestId('home-play').click();
  await gameReady(page);
}
// ホーム → つくる（つながるまで待つ）
export async function openStudio(page: Page) {
  await page.getByTestId('home-create').click();
  await expect(page.getByTestId('app-studio')).toBeVisible({ timeout: 60_000 });
}
// 「つくる」の段: 何を作るか（カテゴリの絵をタップ。テーマの段へ進む）。ドールの段にいれば、先に進める
export async function chooseTarget(page: Page, label: string) {
  await expect(page.getByTestId('studio-tickets')).toContainText(/枚|管理者/);
  const step = page.getByTestId('studio-step');
  if ((await step.getAttribute('data-step')) !== 'what') {
    // 最初の段（ドール）から、なにを の段へ
    while ((await step.getAttribute('data-step')) !== 'what' && (await page.getByTestId('studio-back').count()) > 0) await page.getByTestId('studio-back').click();
    if ((await step.getAttribute('data-step')) === 'doll') await page.getByTestId('studio-next').click();
  }
  await page.getByTestId('studio-target').getByRole('button', { name: label, exact: true }).click();
}
// セットにして、入れるものを labels だけにする（なにを の段のまま）
export async function chooseSet(page: Page, labels: string[]) {
  await chooseTarget(page, 'セット');
  const box = page.getByTestId('studio-set-categories');
  const on = box.locator('button[aria-pressed="true"]');
  while ((await on.count()) > 0) await on.first().click();
  for (const label of labels) await box.getByRole('button', { name: label, exact: true }).click();
}
// テーマを入れて、絵柄の段（そのまま）を通って、さいごの段へ
export async function themeAndCheck(page: Page, theme = 'うみ') {
  await expect(page.getByTestId('studio-step')).toHaveAttribute('data-step', 'theme');
  await page.getByTestId('studio-theme').fill(theme);
  await page.getByTestId('studio-next').click();
  await page.getByTestId('studio-next').click();
  await expect(page.getByTestId('studio-step')).toHaveAttribute('data-step', 'check');
}
// 何を作るか・テーマを入れて「作る」を押す（注文の演出が出る所まで）
export async function pressMake(page: Page, target: { label: string }, theme = 'うみ') {
  await chooseTarget(page, target.label);
  await themeAndCheck(page, theme);
  await page.getByTestId('studio-make').click();
}
// 注文して、チケットの演出の OK まで
export async function order(page: Page, target: { label: string } = { label: 'トップス' }, theme = 'うみ') {
  await pressMake(page, target, theme);
  await expect(page.getByTestId('order-show')).toHaveAttribute('data-phase', 'ticket', { timeout: 15_000 });
  await page.getByTestId('order-ok').click();
  await expect(page.getByTestId('order-show')).toHaveCount(0);
}
// メニューの服を、ドールへドラッグして着せる
export async function wear(page: Page, alt: string) {
  const tile = page.locator(`.palette-section img[alt="${alt}"]`).first();
  await expect(tile).toBeVisible();
  const box = (await tile.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, VIEW_H / 2, { steps: 4 });
  await page.mouse.up();
}
// 偽物の裏側の中身（端末の保存）を読む
export const fakeState = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('dressup_fake_backend') ?? 'null') as { user: { tickets: number }; jobs: { id: string; done: boolean }[]; items: { id: string; name: string }[]; seen: string[] } | null);

// 服が届いた演出（クローゼットが開く）が出るのを待って、閉じる
export async function dismissReveal(page: Page) {
  await expect(page.getByTestId('reveal')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('reveal-close').click();
  await expect(page.getByTestId('reveal')).toHaveCount(0);
}
