/**
 * スタジオの通しテスト
 * 空の素材フォルダから: ドールを追加 → サンプル画像を入れる → 保存 → 一覧に出る
 * （自動生成は API キーが要るので、ここでは「使えない」と表示されることだけ確かめる）
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

const STUDIO = 'http://127.0.0.1:4174/DressUpGame/studio.html';
const FIXTURES = path.join(import.meta.dirname, '../tools/studio/fixtures');
const CONTENT = path.join(import.meta.dirname, '../node_modules/.tmp/studio-e2e');
const fixture = (name: string) => path.join(FIXTURES, name);

interface Item {
  id: string;
  name: string;
  category: string;
  image: { box: { x: number; y: number; w: number; h: number } };
}
const items = (): Item[] => JSON.parse(fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8')).dolls[0]?.items ?? [];

async function upload(page: Page, file: string) {
  await page.getByTestId('tab-add').click();
  await page.getByTestId('add-files').setInputFiles(fixture(file));
  await expect(page.getByTestId('item-card')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.getByTestId('add-busy')).toHaveCount(0);
}

test.describe.configure({ mode: 'serial' });

test.describe('スタジオ', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(STUDIO);
    await expect(page.getByRole('heading', { name: 'きせかえスタジオ' })).toBeVisible();
  });

  test('ドールを追加すると、範囲ができる', async ({ page }) => {
    // ドールが無い間は、ほかのタブは使えない
    await expect(page.getByTestId('tab-add')).toBeDisabled();
    await page.getByTestId('doll-name').fill('アニメ');
    // 背景が透明でない画像は断る
    await page.getByTestId('doll-file').setInputFiles(fixture('sample-green-set.webp'));
    await page.getByTestId('doll-add').click();
    await expect(page.getByTestId('doll-error')).toContainText('透明');
    await page.getByTestId('doll-name').fill('アニメ');
    await page.getByTestId('doll-file').setInputFiles(fixture('doll-anime.webp'));
    await page.getByTestId('doll-add').click();
    await expect(page.getByTestId('template')).toBeVisible();
    await expect(page.getByTestId('doll-select')).toContainText('アニメ');
    // 範囲を保存できる（絵柄の項目はもう無い）
    await expect(page.getByTestId('template-style')).toHaveCount(0);
    await page.getByTestId('template-save').click();
    await expect(page.getByTestId('template-saved')).toBeVisible();
    // 基準画像は「画像から追加」でダウンロードできる
    await page.getByTestId('tab-add').click();
    await page.getByText('AI に渡す基準画像').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('silhouette-link').click()]);
    expect(await download.failure()).toBeNull();
    expect(fs.statSync(await download.path()).size).toBeGreaterThan(10_000);
  });

  test('緑シルエットのサンプル: 警告なしで保存でき、一覧に出る', async ({ page }) => {
    await upload(page, 'sample-green-set.webp');
    await expect(page.getByTestId('card-warnings')).toHaveCount(0);
    await page.getByTestId('card-category').selectOption('トップス');
    await page.getByTestId('card-name').fill('アラビアン');
    await page.getByTestId('card-save').click();
    await expect(page.getByTestId('item-card')).toHaveCount(0);
    const saved = items();
    expect(saved.map((i) => i.id)).toEqual(['アニメ/トップス/アラビアン']);
    expect(fs.existsSync(path.join(CONTENT, JSON.parse(fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8')).dolls[0].items[0].image.file))).toBe(true);
    await page.getByTestId('tab-library').click();
    await expect(page.getByTestId('category-トップス').getByTestId('library-item')).toHaveCount(1);
    await expect(page.getByTestId('publish-open')).toBeVisible();
  });

  test('黒シルエットに紺のスカート: 警告が出て、確かめるまで保存できない', async ({ page }) => {
    await upload(page, 'sample-black-skirt.webp');
    await expect(page.getByTestId('card-warnings')).toContainText('欠けて');
    await expect(page.getByTestId('card-save')).toBeDisabled();
    await page.getByTestId('card-confirm').check();
    await expect(page.getByTestId('card-save')).toBeEnabled();
  });

  test('同じ名前は、別の服として追加するか置き換えるかを選ぶ。矢印キーと消しゴムが保存結果に効く', async ({ page }) => {
    const before = items()[0];
    await upload(page, 'sample-green-set.webp');
    await page.getByTestId('card-category').selectOption('トップス');
    await page.getByTestId('card-name').fill('アラビアン');

    // 矢印キーで右に 10px、下に 1px
    await page.getByTestId('item-card').focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('card-nudge')).toContainText('(10, 1)');

    // 消しゴム（太）で、服のいちばん上の帯を消す
    await page.getByTestId('tool-erase').click();
    await page.getByRole('button', { name: '太' }).click();
    const canvas = page.getByTestId('card-canvas');
    const rect = (await canvas.boundingBox())!;
    const toScreen = (x: number, y: number) => [rect.x + (x / 1024) * rect.width, rect.y + (y / 1024) * rect.height] as const;
    const top = before.image.box.y + 1 + 10; // 微調整後の上端 + ブラシの半径の内側
    await page.mouse.move(...toScreen(before.image.box.x - 30, top));
    await page.mouse.down();
    await page.mouse.move(...toScreen(before.image.box.x + before.image.box.w + 50, top), { steps: 40 });
    await page.mouse.up();

    await page.getByTestId('card-save').click();
    await expect(page.getByTestId('card-conflict')).toContainText('すでにあります');
    await page.getByRole('button', { name: '置き換える' }).click();
    await expect(page.getByTestId('item-card')).toHaveCount(0);

    const after = items();
    expect(after).toHaveLength(1); // 置き換えたので増えない
    expect(after[0].id).toBe(before.id);
    expect(after[0].image.box.x).toBe(before.image.box.x + 10);
    // 上の帯を消したので、上端が 20px 以上さがっている
    expect(after[0].image.box.y).toBeGreaterThan(before.image.box.y + 20);
  });

  test('自動生成はキーが無いと使えないと表示され、公開は理由を表示する。ゲームから素材を読める', async ({ page, request }) => {
    await expect(page.getByTestId('ai-status')).toContainText('キーが未設定');
    await page.getByTestId('tab-generate').click();
    await expect(page.getByTestId('generate-unavailable')).toContainText('ANTHROPIC_API_KEY');
    // テーマ + 絵柄 + 作るもの（カテゴリか背景）+ 枚数。選んだ絵柄は次に開いたときも残る
    await expect(page.getByTestId('count')).toHaveValue('1');
    await page.getByTestId('style-pastel').click();
    await page.getByTestId('target-background').click();
    await expect(page.getByText('全部のドールで使う背景にする')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('style-pastel')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('target-background')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('make')).toBeDisabled();
    await page.getByTestId('publish-open').click();
    await expect(page.getByTestId('publish-dialog')).toContainText('git の作業フォルダではない');
    const manifest = await request.get('http://127.0.0.1:4174/DressUpGame/local-content/manifest.json');
    expect((await manifest.json()).dolls[0].items).toHaveLength(1);
  });
});
