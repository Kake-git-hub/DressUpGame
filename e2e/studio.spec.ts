/**
 * スタジオの通しテスト
 * 空の素材フォルダから: ドールを追加 → サンプル画像を入れる → 保存 → 一覧に出る
 * （自動生成は API キーが要るので、ここでは「使えない」と表示されることだけ確かめる）
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
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

  test('版数と、素材の取り込みの結果が、いつも画面に出る', async ({ page }) => {
    // ドールが出てこないときに、スタジオが新しいか・素材を取り込めたかを、作者が画面で確かめられる
    await expect(page.getByTestId('studio-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
    // テストの素材フォルダは git の作業フォルダではない
    await expect(page.getByTestId('sync-note')).toContainText('素材の取り込み');
    await expect(page.getByTestId('sync-note')).toContainText('git の作業フォルダではない');
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

  test('調整の枠: 絵をつかんで動かし、角のつまみで大きさを変え、↺ で元に戻せる', async ({ page }) => {
    await upload(page, 'sample-green-set.webp');
    const nudge = page.getByTestId('card-nudge');
    const read = async () => {
      const m = /\((-?\d+), (-?\d+)\)・倍率 ([\d.]+)%/.exec((await nudge.textContent()) ?? '')!;
      return { dx: Number(m[1]), dy: Number(m[2]), scale: Number(m[3]) };
    };
    await expect(nudge).toContainText('(0, 0)');
    const frame = page.getByTestId('card-frame');
    await expect(frame).toBeVisible();
    const before = (await frame.boundingBox())!;
    // 絵をつかんで、右へ 44px・下へ 22px（画面上）動かす
    const cx = before.x + before.width / 2;
    const cy = before.y + before.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 44, cy + 22, { steps: 5 });
    await page.mouse.up();
    const moved = await read();
    expect(moved.dx).toBeGreaterThan(90); // 440px の表示で 44px = キャンバスの 1/10
    expect(moved.dy).toBeGreaterThan(45);
    expect(moved.scale).toBe(100);
    const afterMove = (await frame.boundingBox())!;
    expect(afterMove.x - before.x).toBeGreaterThan(40);
    expect(afterMove.x - before.x).toBeLessThan(48);
    // 右下のつまみを外へ引っぱると大きくなる。服の中心は動かない
    const handle = (await page.getByTestId('card-frame-scale').boundingBox())!;
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 30, hy + 30, { steps: 5 });
    await page.mouse.up();
    expect((await read()).scale).toBeGreaterThan(110);
    const afterScale = (await frame.boundingBox())!;
    expect(afterScale.width).toBeGreaterThan(afterMove.width * 1.1);
    expect(Math.abs(afterScale.x + afterScale.width / 2 - (afterMove.x + afterMove.width / 2))).toBeLessThan(2);
    // ↺ で元に戻る
    await page.getByTestId('card-frame-reset').click();
    await expect(nudge).toContainText('(0, 0)・倍率 100.0%');
    await page.getByRole('button', { name: '捨てる' }).click();
    await expect(page.getByTestId('item-card')).toHaveCount(0);
  });

  test('自動生成はキーが無いと使えないと表示され、公開は理由を表示する。ゲームから素材を読める', async ({ page, request }) => {
    await expect(page.getByTestId('ai-status')).toContainText('キーが未設定');
    await page.getByTestId('tab-generate').click();
    await expect(page.getByTestId('generate-unavailable')).toContainText('ANTHROPIC_API_KEY');
    // テーマ + 絵柄 + 作るもの（カテゴリか背景）+ 枚数。選んだ絵柄は次に開いたときも残る
    await expect(page.getByTestId('count')).toHaveValue('1');
    await expect(page.getByTestId('style-manga')).toHaveText('マンガ');
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

  // 自動生成の候補（髪の前の範囲・くつの中の肌）を、カードで見て保存する。
  // この環境には AI のキーが無いので、生成の API だけを画面の側で差し替え、保存は本物のサーバーに送る
  test.describe('自動生成の候補（差し替えた API）', () => {
    const W = 1228; // 作業用のキャンバス（ドールの 1024 のまわりに 102 の余白）
    const layer = async (rects: { x: number; y: number; w: number; h: number; color: string }[], holes: { x: number; y: number; w: number; h: number }[] = []) => {
      const base = await sharp({ create: { width: W, height: W, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite(await Promise.all(rects.map(async (r) => ({ input: await sharp({ create: { width: r.w, height: r.h, channels: 4, background: r.color } }).png().toBuffer(), left: r.x, top: r.y }))))
        .raw()
        .toBuffer();
      for (const h of holes) for (let y = h.y; y < h.y + h.h; y++) for (let x = h.x; x < h.x + h.w; x++) base[(y * W + x) * 4 + 3] = 0;
      return sharp(base, { raw: { width: W, height: W, channels: 4 } }).png().toBuffer();
    };
    // 生成の API を差し替える。images: kind → PNG
    async function fakeJob(page: Page, category: string, name: string, images: Record<string, Buffer>, flags: Record<string, boolean>) {
      await page.route('**/api/status', async (route) => {
        try {
          const real = await (await route.fetch()).json();
          await route.fulfill({ json: { ...real, ai: { text: true, image: true } } });
        } catch {
          // ページを閉じる・読み込み直すのと重なった問い合わせは捨てる（テストを落とさない）
        }
      });
      const item = { category, name, description: 'test', colors: [] };
      await page.route('**/api/plan', (route) => route.fulfill({ json: { items: [item], maxImages: 2 } }));
      await page.route('**/api/jobs', (route) => route.fulfill({ json: { id: 'fake' } }));
      await page.route('**/api/jobs?id=fake', (route) =>
        route.fulfill({ json: { id: 'fake', kind: 'items', dollId: 'アニメ', done: true, error: null, candidates: [{ item, status: 'passed', attempts: 1, notes: [], warnings: [], hasImage: true, hasShape: false, hasHide: false, hasFront: false, hasUnder: false, ...flags }] } }),
      );
      await page.route('**/api/jobs/image?**', (route) => {
        const kind = new URL(route.request().url()).searchParams.get('kind') ?? 'png';
        const body = images[kind];
        return body ? route.fulfill({ body, contentType: 'image/png' }) : route.fulfill({ status: 404, json: { error: 'ない' } });
      });
      await page.reload();
      await page.getByTestId('tab-generate').click();
      await page.getByTestId('theme').fill('てすと');
      await page.getByTestId(`target-${category}`).click();
      await page.getByTestId('make').click();
      await expect(page.getByTestId('item-card')).toHaveCount(1);
    }
    const canvasPixel = (page: Page, x: number, y: number) =>
      page.getByTestId('card-canvas').evaluate((c: HTMLCanvasElement, [px, py]) => Array.from(c.getContext('2d')!.getImageData(px, py, 1, 1).data), [x, y]);
    const near = (a: number[], b: number[], tolerance = 10) => b.every((v, i) => Math.abs(a[i] - v) <= tolerance);
    // 保存のときに送った中身を控えてから、本物のサーバーに送る
    async function captureSave(page: Page) {
      const sent: Record<string, unknown>[] = [];
      await page.route('**/api/items', async (route) => {
        if (route.request().method() === 'POST') sent.push(route.request().postDataJSON() as Record<string, unknown>);
        await route.continue();
      });
      return sent;
    }

    test('髪: 前の範囲で前髪と後ろ髪に分けて見せ、前の範囲と一緒に保存する', async ({ page, request }) => {
      expect((await request.put('http://127.0.0.1:4174/api/categories', { data: { dollId: 'アニメ', category: { label: 'ヘアスタイル', layer: 11, menuOrder: 11, overlap: false, movable: false } } })).ok()).toBe(true);
      const BROWN = '#5a3214';
      const cap = { x: 540, y: 110, w: 150, h: 80 }; // 頭の上（前）
      const long = { x: 500, y: 150, w: 230, h: 350 }; // 体の後ろにたれる髪
      const png = await layer([{ ...long, color: BROWN }, { ...cap, color: BROWN }]);
      const front = await layer([{ ...cap, color: '#ffffff' }]);
      await fakeJob(page, 'ヘアスタイル', 'まえとうしろ', { png, source: png, front }, { hasFront: true });
      // 頭の横（ドールの外）は後ろ髪の色、顔のまん中はドールの肌（後ろ髪はドールの後ろ）
      await expect.poll(async () => near(await canvasPixel(page, 550, 220), [90, 50, 20, 255])).toBe(true);
      await expect.poll(async () => (await canvasPixel(page, 615, 230))[0]).toBeGreaterThan(200);
      const sent = await captureSave(page);
      await page.getByTestId('card-save').click();
      await expect(page.getByTestId('item-card')).toHaveCount(0);
      expect(typeof sent[0]?.front).toBe('string');
      expect(sent[0]?.shape).toBeUndefined();
      const saved = items().find((i) => i.name === 'まえとうしろ') as Item & { back?: { box: { h: number } }; backThumb?: string };
      expect(saved.back).toBeDefined();
      expect(saved.backThumb).toBeDefined();
      expect(saved.image.box.h).toBeLessThanOrEqual(cap.h + 2);
    });

    test('くつ: 靴の開きに肌を見せ、肌の絵と一緒に保存する', async ({ page }) => {
      const shoeBox = { x: 540, y: 1030, w: 150, h: 80 };
      const hole = { x: 590, y: 1040, w: 50, h: 30 };
      const png = await layer([{ ...shoeBox, color: '#804000' }], [hole]);
      const under = await layer([{ x: 585, y: 1035, w: 60, h: 40, color: '#ff80c0' }]);
      const hide = await layer([{ x: 530, y: 1020, w: 170, h: 100, color: '#ffffff' }]);
      await fakeJob(page, 'くつ', 'ひらいたくつ', { png, source: png, under, hide }, { hasUnder: true, hasHide: true });
      await expect.poll(async () => near(await canvasPixel(page, 615, 1055), [255, 128, 192, 255])).toBe(true);
      const sent = await captureSave(page);
      await page.getByTestId('card-save').click();
      await expect(page.getByTestId('item-card')).toHaveCount(0);
      expect(typeof sent[0]?.under).toBe('string');
      expect(typeof sent[0]?.hide).toBe('string');
      const saved = items().find((i) => i.name === 'ひらいたくつ') as Item & { under?: { box: { x: number; y: number } } };
      expect(saved.under?.box).toMatchObject({ x: 585, y: 1035 });
    });

    test('セット: カテゴリを選んで一括で作り、ぜんぶ保存すると、どの服にもセットの印が付く。一覧で外せて、最後の 1 点を消すとセットも消える', async ({ page }) => {
      page.on('dialog', (d) => void d.accept());
      const set = { id: 'アニメ/セット/うみのセット', name: 'うみのセット' };
      const parts = [
        { category: 'トップス', name: 'うみのシャツ', png: await layer([{ x: 500, y: 350, w: 230, h: 200, color: '#2060c0' }]) },
        { category: 'アクセサリー', name: 'うみのかざり', png: await layer([{ x: 560, y: 300, w: 110, h: 40, color: '#40c0c0' }]) },
      ];
      const planItems = parts.map((p) => ({ category: p.category, name: p.name, description: 'test', colors: [] }));
      let planBody: Record<string, unknown> | null = null;
      let jobBody: Record<string, unknown> | null = null;
      await page.route('**/api/status', async (route) => {
        try {
          const real = await (await route.fetch()).json();
          await route.fulfill({ json: { ...real, ai: { text: true, image: true } } });
        } catch {
          // ページを閉じる・読み込み直すのと重なった問い合わせは捨てる
        }
      });
      await page.route('**/api/plan', (route) => {
        planBody = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ json: { items: planItems, set, missing: ['くつ'], maxImages: 4 } });
      });
      await page.route('**/api/jobs', (route) => {
        jobBody = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ json: { id: 'fakeset' } });
      });
      await page.route('**/api/jobs?id=fakeset', (route) =>
        route.fulfill({
          json: {
            id: 'fakeset', kind: 'items', dollId: 'アニメ', done: true, error: null, set,
            candidates: planItems.map((item) => ({ item, status: 'passed', attempts: 1, notes: [], warnings: [], hasImage: true, hasShape: false, hasHide: false, hasFront: false, hasUnder: false })),
          },
        }),
      );
      await page.route('**/api/jobs/image?**', (route) => {
        const q = new URL(route.request().url()).searchParams;
        const part = parts[Number(q.get('index'))];
        const kind = q.get('kind') ?? 'png';
        return part && (kind === 'png' || kind === 'source') ? route.fulfill({ body: part.png, contentType: 'image/png' }) : route.fulfill({ status: 404, json: { error: 'ない' } });
      });
      await page.reload();
      await page.getByTestId('tab-generate').click();
      await page.getByTestId('theme').fill('うみ');
      // 「セット」を選ぶと、入れるカテゴリのチェック欄が出る。枚数の欄は出ない
      await page.getByTestId('target-set').click();
      const boxes = page.getByTestId('set-categories');
      await expect(boxes).toBeVisible();
      await expect(page.getByTestId('count')).toHaveCount(0);
      // かお は最初は入っていない。ほかは入っている
      await expect(boxes.getByLabel('トップス')).toBeChecked();
      await expect(boxes.getByLabel('かお')).not.toBeChecked();
      // トップスとアクセサリーとくつ、だけにする
      for (const label of await boxes.locator('label').allTextContents()) {
        const name = label.trim();
        const box = boxes.getByLabel(name, { exact: true });
        const want = ['トップス', 'アクセサリー', 'くつ'].includes(name);
        if ((await box.isChecked()) !== want) await box.click();
      }
      await page.getByTestId('make').click();
      await expect(page.getByTestId('item-card')).toHaveCount(2);
      expect(planBody!.set).toBe(true);
      expect((planBody!.categories as string[]).sort()).toEqual(['アクセサリー', 'くつ', 'トップス'].sort());
      expect(jobBody!.set).toEqual(set);
      // 企画が返さなかったカテゴリを知らせる。カードにセットの名前が出る
      await expect(page.getByTestId('set-missing')).toContainText('くつ');
      await expect(page.getByTestId('card-set').first()).toContainText('うみのセット');
      // ぜんぶ保存
      await page.getByTestId('save-all').click();
      await expect(page.getByTestId('item-card')).toHaveCount(0);
      const manifest = () => JSON.parse(fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8')).dolls[0] as { sets?: { id: string; name: string }[]; items: { id: string; name: string; set?: string }[] };
      await expect.poll(() => manifest().items.filter((i) => i.set === set.id).map((i) => i.name).sort()).toEqual(['うみのかざり', 'うみのシャツ']);
      expect(manifest().sets).toEqual([set]);
      // 一覧: セットの名前の欄と、服ごとの「セットから外す」
      await page.getByTestId('tab-library').click();
      const setRow = page.getByTestId('library-set');
      await expect(setRow).toHaveCount(1);
      await expect(setRow.locator('input')).toHaveValue('うみのセット');
      await expect(setRow).toContainText('2 点');
      // 名前を変える
      await setRow.locator('input').fill('なつのうみ');
      await setRow.locator('input').blur();
      await expect.poll(() => manifest().sets?.[0]?.name).toBe('なつのうみ');
      // 1 点を外す → セットは残る（1 点）
      await page.locator('[data-testid="library-item"]', { has: page.locator('input[value="うみのシャツ"]') }).getByTestId('leave-set').click();
      await expect.poll(() => manifest().items.find((i) => i.name === 'うみのシャツ')?.set).toBeUndefined();
      await expect(page.getByTestId('library-set')).toContainText('1 点');
      // 残りの 1 点を消す → セットも消える
      await page.locator('[data-testid="library-item"]', { has: page.locator('input[value="うみのかざり"]') }).getByRole('button', { name: '消す' }).click();
      await expect(page.getByTestId('library-set')).toHaveCount(0);
      expect(manifest().sets).toBeUndefined();
    });
  });
});
