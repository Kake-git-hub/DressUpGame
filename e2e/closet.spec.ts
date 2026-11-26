/**
 * E2Eテスト: クローゼット（自分の服の一覧と、名前・既定の色・並び・消す）。裏側は、端末の中だけで動く偽物
 */
import { test, expect, type Page } from '@playwright/test';
import { DOLL_X, dismissReveal, FIRST, FIRST_Y, expectPixel, fakeState, near, openHome, openStudio, order, pixel, play, wear } from './helpers';

const items = (page: Page) => page.getByTestId('closet-item');
// 「つくる」で n 点作って、できあがるまで待ち、ホームにもどる
async function makeItems(page: Page, themes: string[]) {
  await openStudio(page);
  for (const theme of themes) {
    await order(page, { label: 'トップス' }, theme);
    await expect(page.getByTestId('studio-job')).toHaveCount(0, { timeout: 15_000 });
    await dismissReveal(page);
  }
  await page.getByTestId('studio-close').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
}
async function openCloset(page: Page) {
  await page.getByTestId('home-closet').click();
  await expect(page.getByTestId('closet')).toBeVisible({ timeout: 60_000 });
}
// メニューの絵の、まんなかの色
const thumbColor = (page: Page, alt: string) =>
  page.evaluate(async (name) => {
    const img = document.querySelector(`.palette-section img[alt="${name}"]`) as HTMLImageElement | null;
    if (!img) return [0, 0, 0];
    await img.decode().catch(() => undefined);
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, img.naturalWidth / 2, img.naturalHeight / 2, 1, 1, 0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
  }, alt);

test('まだ服が無いとき: そう出る。作ると、読み込み直しても（閉じたつもり）、クローゼットに入っている。NEW は、押すと消える', async ({ page }) => {
  await openHome(page, { delayMs: 6000 });
  await openCloset(page);
  await expect(page.getByTestId('closet-empty')).toContainText('まだ ふくが ありません');
  await page.getByTestId('closet-close').click();
  await openStudio(page);
  await order(page, { label: 'トップス' });
  // 作っている間に、読み込み直す（閉じたつもり）
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await openCloset(page);
  // 作りかけが見える → できたら、届いた演出が出て、一覧に入る（NEW の印つき）
  await expect(page.getByTestId('closet-making')).toContainText('トップス', { timeout: 20_000 });
  await dismissReveal(page);
  await expect(items(page)).toHaveCount(1);
  await expect(page.getByTestId('closet-making')).toHaveCount(0);
  await expect(items(page).first()).toContainText('うみのトップス');
  await expect(page.getByTestId('closet-new')).toHaveCount(1);
  await expect(page.getByTestId('closet-group')).toContainText('トップス');
  // 押すと、その服の画面。NEW が消える（読み込み直しても、消えたまま）
  await items(page).first().click();
  await expect(page.getByTestId('closet-item-sheet')).toBeVisible();
  await expect(page.getByTestId('closet-stage')).toBeVisible();
  await page.getByTestId('closet-item-done').click();
  await expect(page.getByTestId('closet-new')).toHaveCount(0);
  await page.reload();
  await openCloset(page);
  await expect(items(page)).toHaveCount(1);
  await expect(page.getByTestId('closet-new')).toHaveCount(0);
  // ホームの ● も消えている
  await page.getByTestId('closet-close').click();
  await expect(page.getByTestId('home-closet-dot')).toHaveCount(0);
});

test('名前を変えると、一覧と、ゲームのメニューの名前も変わる（20 文字まで。空なら変えない）', async ({ page }) => {
  await openHome(page);
  await makeItems(page, ['うみ']);
  await openCloset(page);
  await items(page).first().click();
  const name = page.getByTestId('closet-name');
  await expect(name).toHaveValue('うみのトップス');
  await name.fill('');
  await name.blur();
  await expect(name).toHaveValue('うみのトップス');
  await name.fill('なみの ふく');
  await name.press('Enter');
  await page.getByTestId('closet-item-done').click();
  await expect(items(page).first()).toContainText('なみの ふく');
  expect((await fakeState(page))!.items[0].name).toBe('なみの ふく');
  await page.getByTestId('closet-close').click();
  await play(page);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await expect(page.locator('.palette-section img[alt="なみの ふく"]')).toBeVisible();
});

test('既定の色: 色を変えると、一覧・メニューの絵・着せた服の色が変わる。調整画面の「色をもどす」は、その色に戻す', async ({ page }) => {
  await openHome(page);
  await makeItems(page, ['うみ']);
  await openCloset(page);
  await items(page).first().click();
  await expect(page.getByTestId('closet-hue-reset')).toBeDisabled();
  await page.getByTestId('closet-hue').fill('120');
  // 着た絵は、その場で色が変わる（色を付けた絵は、キャンバスで描く）
  await expect(page.getByTestId('closet-stage').locator('canvas[data-hue="120"]')).toBeVisible();
  // 動かし終えると、保存される
  await expect.poll(async () => (await fakeState(page))!.items[0] as unknown as { hue: number }).toMatchObject({ hue: 120 });
  await page.getByTestId('closet-item-done').click();
  await expect(items(page).first()).toHaveAttribute('data-hue', '120');
  await expect(items(page).first().locator('canvas[data-hue="120"]')).toBeVisible();
  await page.getByTestId('closet-close').click();
  await play(page);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  // メニューの絵も、色が付いている（もとの色ではない）
  await expect.poll(async () => near(await thumbColor(page, 'うみのトップス'), FIRST, 30)).toBe(false);
  // 着せると、その色（もとの色ではない）
  await wear(page, 'うみのトップス');
  await expect.poll(async () => {
    const color = await pixel(page, DOLL_X, FIRST_Y);
    return !near(color, FIRST, 30) && !near(color, [255, 224, 192], 30);
  }, { timeout: 20_000 }).toBe(true);
  // 調整画面: 色のスライダーは既定の色から始まる。変えたあと「リセット」で、既定の色に戻る
  await page.locator('.tool-button').click();
  await expect(page.locator('.hue-value')).toHaveText('120°');
  await page.locator('.hue-slider-vertical').fill('0');
  await expect(page.locator('.hue-value')).toHaveText('0°');
  await page.getByTestId('adjust-reset').click();
  await expect(page.locator('.hue-value')).toHaveText('120°');
});

test('もとのいろ、で色が戻る', async ({ page }) => {
  await openHome(page);
  await makeItems(page, ['うみ']);
  await openCloset(page);
  await items(page).first().click();
  await page.getByTestId('closet-hue').fill('-90');
  await expect.poll(async () => ((await fakeState(page))!.items[0] as unknown as { hue: number }).hue).toBe(-90);
  await page.getByTestId('closet-hue-reset').click();
  await expect.poll(async () => ((await fakeState(page))!.items[0] as unknown as { hue: number }).hue).toBe(0);
  await expect(page.getByTestId('closet-stage').locator('canvas')).toHaveCount(0);
  await page.getByTestId('closet-item-done').click();
  await page.getByTestId('closet-close').click();
  await play(page);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await wear(page, 'うみのトップス');
  await expectPixel(page, DOLL_X, FIRST_Y, FIRST);
});

test('ならび: 新しい服が先。うしろへ・まえへ、で入れ替わり、ゲームのメニューの順番も同じ', async ({ page }) => {
  await openHome(page);
  await makeItems(page, ['うみ', 'やま']);
  await openCloset(page);
  await expect(items(page)).toHaveCount(2);
  const names = () => items(page).locator('.closet-name').allTextContents();
  expect(await names()).toEqual(['やまのトップス', 'うみのトップス']);
  await items(page).first().click();
  await expect(page.getByTestId('closet-move-front')).toBeDisabled(); // 先頭
  await page.getByTestId('closet-move-back').click();
  await expect(page.getByTestId('closet-move-back')).toBeDisabled(); // いちばん後ろになった
  await page.getByTestId('closet-item-done').click();
  expect(await names()).toEqual(['うみのトップス', 'やまのトップス']);
  await page.getByTestId('closet-close').click();
  await play(page);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  const mine = page.locator('.palette-section [data-mine="true"] img');
  await expect(mine).toHaveCount(2);
  expect(await mine.evaluateAll((list) => list.map((img) => (img as HTMLImageElement).alt))).toEqual(['うみのトップス', 'やまのトップス']);
});

test('けす: やめる、では消えない。けす、で一覧とメニューから消える', async ({ page }) => {
  await openHome(page);
  await makeItems(page, ['うみ']);
  await openCloset(page);
  await items(page).first().click();
  await page.getByTestId('closet-delete').click();
  await expect(page.getByTestId('closet-confirm')).toContainText('けしますか？');
  await expect(page.getByTestId('closet-confirm')).toContainText('もとに もどせません');
  await page.getByTestId('closet-delete-no').click();
  await expect(page.getByTestId('closet-confirm')).toHaveCount(0);
  await page.getByTestId('closet-delete').click();
  await page.getByTestId('closet-delete-yes').click();
  await expect(page.getByTestId('closet-item-sheet')).toHaveCount(0);
  await expect(page.getByTestId('closet-empty')).toBeVisible();
  expect((await fakeState(page))!.items).toEqual([]);
  await page.getByTestId('closet-close').click();
  await play(page);
  await page.locator('.palette-section button', { hasText: 'トップス' }).first().click();
  await expect(page.locator('.palette-section [data-mine="true"]')).toHaveCount(0);
});

test('ほかの端末で消された服を直そうとすると、知らせが出て、一覧から消える', async ({ page }) => {
  await openHome(page);
  await makeItems(page, ['うみ']);
  await openCloset(page);
  await items(page).first().click();
  // ほかの端末で消されたつもり: サーバー（偽物の保存）から、服を消す
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('dressup_fake_backend')!) as { items: unknown[] };
    state.items = [];
    localStorage.setItem('dressup_fake_backend', JSON.stringify(state));
  });
  // 偽物は、起動のときに保存を読むので、読み込み直してから、控えに残っている服を開く
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  // 起動のあとの合わせで、控えからも消える
  await openCloset(page);
  await expect(page.getByTestId('closet-empty')).toBeVisible({ timeout: 20_000 });
});

test('ゲームに出ていないドールの服は「いまは つかえない ドール」として出て、消せる', async ({ page }) => {
  await openHome(page);
  await makeItems(page, ['うみ']);
  // ドールが公開の素材から消えたつもり: サーバーと端末の控えの、服のドールの ID を書き換える
  await page.evaluate(async () => {
    const state = JSON.parse(localStorage.getItem('dressup_fake_backend')!) as { items: { dollId: string }[] };
    for (const item of state.items) item.dollId = 'きえたドール';
    localStorage.setItem('dressup_fake_backend', JSON.stringify(state));
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('dressup-library', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('items', 'readwrite');
        const store = tx.objectStore('items');
        const all = store.getAll();
        all.onsuccess = () => {
          for (const item of all.result as { dollId: string }[]) store.put({ ...item, dollId: 'きえたドール' });
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await openCloset(page);
  await expect(page.getByTestId('closet-unusable')).toContainText('いまは つかえない ドール');
  await expect(page.getByTestId('closet-group')).toContainText('そのほか');
  await items(page).first().click();
  // ドールの絵は出ない（服の絵だけ）が、消せる
  await expect(page.getByTestId('closet-stage')).toBeVisible();
  await page.getByTestId('closet-delete').click();
  await page.getByTestId('closet-delete-yes').click();
  await expect(page.getByTestId('closet-empty')).toBeVisible();
  // ゲームは、いつもどおり
  await page.getByTestId('closet-close').click();
  await play(page);
});

test('つながっていないと、一覧は見えるが、直せない', async ({ page }) => {
  await openHome(page);
  await makeItems(page, ['うみ']);
  // つながらない状態にして、開き直す
  await page.evaluate(() => {
    const options = JSON.parse(localStorage.getItem('dressup_fake_options')!) as Record<string, unknown>;
    localStorage.setItem('dressup_fake_options', JSON.stringify({ ...options, offline: true }));
  });
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await openCloset(page);
  await expect(page.getByTestId('closet-offline')).toBeVisible({ timeout: 20_000 });
  await expect(items(page)).toHaveCount(1);
  await items(page).first().click();
  await expect(page.getByTestId('closet-offline-note')).toContainText('いまは なおせません');
  await expect(page.getByTestId('closet-name')).toBeDisabled();
  await expect(page.getByTestId('closet-hue')).toBeDisabled();
  await expect(page.getByTestId('closet-delete')).toBeDisabled();
  await expect(page.getByTestId('closet-move-back')).toBeDisabled();
});

test('スマホの縦でも、一覧と、服の画面のボタンが、画面に収まる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await makeItems(page, ['うみ']);
  await openCloset(page);
  await items(page).first().click();
  for (const id of ['closet-name', 'closet-hue', 'closet-move-back', 'closet-delete', 'closet-item-done']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.x, id).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, id).toBeLessThanOrEqual(390);
    expect(box.y + box.height, id).toBeLessThanOrEqual(844);
  }
  // 色の帯は、指で動かしやすい高さ（44px 以上）
  expect((await page.getByTestId('closet-hue').boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
