/**
 * 試しの道具（捨てる前提）: 本物の素材で着せ替えて、ゲームの「写真」ボタンの絵（PNG）を、ポーズの試しの入力として残す。画像生成 0 枚。
 *   先に: npx vite build && ln -sfn /home/user/DressUpGame-content dist/real && npx vite preview --port 4173 --strictPort
 *   リポジトリの上で: npx tsx docs/superpowers/specs/2026-11-28-pose-spike/capture.mts
 * セットをタップで着る（extra は、title の付いた品目だけ足せる。いまは使っていない）。
 */
import { chromium } from 'playwright';
import { copyFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'in');
const DOLL = 'アニメ　その２';
// 着せ方: セットの名前と、足す品目（カテゴリ / 名前）
const LOOKS: { id: string; set?: string; extra: [string, string][] }[] = [
  { id: 'cinderella', set: 'シンデレラセット', extra: [] },
  { id: 'idol', set: 'きらきらハートアイドル', extra: [] },
  { id: 'cheer', set: 'チアガール', extra: [] },
];
const only = process.argv.slice(2);

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
for (const look of LOOKS.filter((l) => only.length === 0 || only.includes(l.id))) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
  await context.addInitScript(() => {
    localStorage.setItem('dressup_guide_seen', '["play","worn","adjust","studio"]');
    localStorage.setItem('dressup_install_hint', '{"closed":0,"done":true}');
  });
  const page = await context.newPage();
  await page.goto('http://localhost:4173/DressUpGame/?content=real/&studio=0');
  await page.getByTestId('home-play').click();
  const section = page.locator('.palette-section');
  await section.locator('button', { hasText: 'トップス' }).first().waitFor({ timeout: 60_000 });
  const select = section.locator('select').first();
  if ((await select.inputValue()) !== DOLL) {
    await select.selectOption(DOLL);
    await page.waitForTimeout(2000);
  }
  const open = async (category: string) => {
    const back = section.locator('button', { hasText: 'もどる' });
    if (await back.isVisible()) await back.click();
    await section.locator('button', { hasText: category }).first().click();
    await back.waitFor();
  };
  const tap = async (title: string) => {
    const tile = section.locator(`[title="${title}"]`).first();
    await tile.scrollIntoViewIfNeeded();
    await tile.click();
    await page.waitForTimeout(700);
  };
  if (look.set) {
    await open('セット');
    await tap(look.set);
  }
  for (const [category, name] of look.extra) {
    await open(category);
    await tap(name);
  }
  await page.waitForTimeout(2500);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('screenshot-button').click()]);
  copyFileSync(await download.path(), path.join(OUT, `${look.id}.png`));
  await page.screenshot({ path: path.join(OUT, `${look.id}-screen.jpg`), quality: 70 });
  console.log(look.id, 'ok');
  await context.close();
}
await browser.close();
