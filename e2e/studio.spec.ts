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

    // セットの生成の API を差し替える。返すのは、企画と生成に送られた中身の控え
    const SET = { id: 'アニメ/セット/うみのセット', name: 'うみのセット' };
    async function fakeSetJob(page: Page) {
      const parts = [
        { category: 'トップス', name: 'うみのシャツ', png: await layer([{ x: 500, y: 350, w: 230, h: 200, color: '#2060c0' }]) },
        { category: 'アクセサリー', name: 'うみのかざり', png: await layer([{ x: 560, y: 300, w: 110, h: 40, color: '#40c0c0' }]) },
      ];
      const planItems = parts.map((p) => ({ category: p.category, name: p.name, description: 'test', colors: [] }));
      const sent: { plan: Record<string, unknown> | null; job: Record<string, unknown> | null } = { plan: null, job: null };
      await page.route('**/api/status', async (route) => {
        try {
          const real = await (await route.fetch()).json();
          await route.fulfill({ json: { ...real, ai: { text: true, image: true } } });
        } catch {
          // ページを閉じる・読み込み直すのと重なった問い合わせは捨てる
        }
      });
      await page.route('**/api/plan', (route) => {
        sent.plan = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ json: { items: planItems, set: SET, missing: ['くつ'], maxImages: 4 } });
      });
      await page.route('**/api/jobs', (route) => {
        sent.job = route.request().postDataJSON() as Record<string, unknown>;
        return route.fulfill({ json: { id: 'fakeset' } });
      });
      await page.route('**/api/jobs?id=fakeset', (route) =>
        route.fulfill({
          json: {
            id: 'fakeset', kind: 'items', dollId: 'アニメ', done: true, error: null, set: SET,
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
      return sent;
    }
    const dollNow = () => JSON.parse(fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8')).dolls[0] as { sets?: { id: string; name: string }[]; items: { id: string; name: string; set?: string }[] };

    test('セット: カテゴリを選んで一括で作り、ぜんぶ保存すると、どの服にもセットの印が付く。一覧で外せて、最後の 1 点を消すとセットも消える', async ({ page }) => {
      page.on('dialog', (d) => void d.accept());
      const set = SET;
      const sent = await fakeSetJob(page);
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
      expect(sent.plan!.set).toBe(true);
      expect((sent.plan!.categories as string[]).sort()).toEqual(['アクセサリー', 'くつ', 'トップス'].sort());
      expect(sent.job!.set).toEqual(set);
      // 企画が返さなかったカテゴリを知らせる。カードにセットの名前が出る
      await expect(page.getByTestId('set-missing')).toContainText('くつ');
      await expect(page.getByTestId('card-set').first()).toContainText('うみのセット');
      // ぜんぶ保存（絵の読み込みが終わるまでは押せない）
      await expect(page.getByTestId('save-all')).toBeEnabled();
      await expect(page.getByTestId('save-all')).toContainText('ぜんぶ保存（2 点）');
      await page.getByTestId('save-all').click();
      await expect(page.getByTestId('item-card')).toHaveCount(0);
      const manifest = dollNow;
      await expect.poll(() => manifest().items.filter((i) => i.set === set.id).map((i) => i.name).sort()).toEqual(['うみのかざり', 'うみのシャツ']);
      expect(manifest().sets).toEqual([set]);
      // 一覧: セットの名前の欄と、服ごとの「セットから外す」
      await page.getByTestId('tab-library').click();
      const setRow = page.getByTestId('library-set');
      await expect(setRow).toHaveCount(1);
      await expect(setRow.getByLabel('セットのなまえ')).toHaveValue('うみのセット');
      await expect(setRow).toContainText('2 点');
      // 名前を変える（Enter で決まる）
      await setRow.getByLabel('セットのなまえ').fill('なつのうみ');
      await setRow.getByLabel('セットのなまえ').press('Enter');
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

    test('セット: 「ぜんぶ保存」は、同じ名前の服があるカードを飛ばして知らせる。そのカードは、あとから自分で保存でき、セットの印も付く', async ({ page }) => {
      // 前のテストで、セットから外した「うみのシャツ」が残っている
      expect(dollNow().items.some((i) => i.name === 'うみのシャツ' && !i.set)).toBe(true);
      await fakeSetJob(page);
      await page.reload();
      await page.getByTestId('tab-generate').click();
      await page.getByTestId('theme').fill('うみ');
      await page.getByTestId('target-set').click();
      await page.getByTestId('make').click();
      await expect(page.getByTestId('item-card')).toHaveCount(2);
      await expect(page.getByTestId('save-all')).toBeEnabled();
      await page.getByTestId('save-all').click();
      // かざりは保存され、シャツのカードは残って、知らせが出る
      await expect(page.getByTestId('item-card')).toHaveCount(1);
      await expect(page.getByTestId('card-name')).toHaveValue('うみのシャツ');
      await expect(page.getByTestId('card-skipped')).toBeVisible();
      await expect.poll(() => dollNow().items.filter((i) => i.set === SET.id).map((i) => i.name)).toEqual(['うみのかざり']);
      // 自分で保存する（別の服として追加）: セットの印が付く
      await page.getByTestId('card-save').click();
      await page.getByTestId('card-conflict').getByRole('button', { name: '別の服として追加' }).click();
      await expect(page.getByTestId('item-card')).toHaveCount(0);
      await expect.poll(() => dollNow().items.filter((i) => i.set === SET.id).map((i) => i.name).sort()).toEqual(['うみのかざり', 'うみのシャツ']);
      expect(dollNow().items.filter((i) => i.name === 'うみのシャツ')).toHaveLength(2);
    });
  });
  test.describe('一覧での並べ替え・位置の直し、ドールの設定、作りかけの候補', () => {
    const manifestNow = () => JSON.parse(fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8')) as { dolls: { id: string; name: string; hidden?: boolean; items: Item[]; categories: { id: string; menuOrder: number }[]; sets?: { id: string }[] }[] };
    const tops = () => manifestNow().dolls[0].items.filter((i) => i.category === 'トップス');

    test('一覧: ◀ ▶ でメニューでの順番が変わり、「位置・大きさ」で動かして保存すると、位置が変わる', async ({ page }) => {
      expect(tops().length).toBeGreaterThanOrEqual(2);
      const before = tops().map((i) => i.id);
      await page.getByTestId('tab-library').click();
      const list = page.getByTestId('category-トップス').getByTestId('library-item');
      await list.first().getByTestId('item-later').click();
      await expect.poll(() => tops().map((i) => i.id)).toEqual([before[1], before[0], ...before.slice(2)]);
      // 画面が読み直した並びで続ける（同じ絵の服があるので、絵では見分けられない）
      await page.reload();
      await page.getByTestId('tab-library').click();
      // 位置・大きさ: 矢印キーで右へ 3px、Shift+↓ で下へ 10px
      const target = tops()[0];
      await list.first().getByTestId('item-place').click();
      await expect(page.getByTestId('placer')).toBeVisible();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Shift+ArrowDown');
      await expect(page.getByTestId('placer-values')).toContainText('(3, 10)');
      await page.getByTestId('placer-save').click();
      await expect(page.getByTestId('placer')).toHaveCount(0);
      const after = tops()[0];
      expect(after.id).toBe(target.id);
      expect(after.image.box).toMatchObject({ x: target.image.box.x + 3, y: target.image.box.y + 10, w: target.image.box.w, h: target.image.box.h });
      // ドラッグでも動かせる（画面の 1px より大きく動く）
      await list.first().getByTestId('item-place').click();
      const view = (await page.getByTestId('placer-view').boundingBox())!;
      await page.mouse.move(view.x + view.width / 2, view.y + view.height / 2);
      await page.mouse.down();
      await page.mouse.move(view.x + view.width / 2 + 40, view.y + view.height / 2, { steps: 4 });
      await page.mouse.up();
      await expect(page.getByTestId('placer-values')).not.toContainText('(0, 0)');
      await page.getByRole('button', { name: 'やめる' }).click();
      await expect(page.getByTestId('placer')).toHaveCount(0);
      expect(tops()[0].image.box).toEqual(after.image.box);
    });

    test('ならべかえ: カテゴリ・服をつかんで動かすと順番が変わり、押すと「くわしく」のその服へ', async ({ page }) => {
      const manifestText = () => fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8');
      await page.getByTestId('tab-library').click();
      await page.getByTestId('library-view-sort').click();
      await expect(page.getByTestId('sort-view')).toBeVisible();
      // カテゴリ: 最後のチップを、最初のチップの左半分へ
      const chips = page.getByTestId('sort-category');
      const ids = await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
      expect(ids.length).toBeGreaterThanOrEqual(2);
      await chips.last().dragTo(chips.first(), { targetPosition: { x: 2, y: 5 } });
      const cats = () => [...manifestNow().dolls[0].categories].sort((a, b) => a.menuOrder - b.menuOrder).map((c) => c.id);
      await expect.poll(cats).toEqual([ids.at(-1), ...ids.slice(0, -1)]);
      expect(manifestNow().dolls[0].categories.map((c) => c.menuOrder).sort((a, b) => a - b)).toEqual(ids.map((_, i) => i));
      await expect.poll(() => chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).toEqual([ids.at(-1), ...ids.slice(0, -1)]);
      // 服: トップスの 1 点めを、2 点めの右半分へ
      const row = page.getByTestId('sort-row-トップス').getByTestId('sort-item');
      const before = tops().map((i) => i.id);
      const box = (await row.nth(1).boundingBox())!;
      await row.first().dragTo(row.nth(1), { targetPosition: { x: box.width - 2, y: 5 } });
      await expect.poll(() => tops().map((i) => i.id)).toEqual([before[1], before[0], ...before.slice(2)]);
      await expect(row.first()).toHaveAttribute('data-id', before[1]);
      // セット: 一時のセットを足して 2 組以上にし、最後を最初の前へ。終わったら一時のセットを消す
      const extra = tops()[0].id;
      expect((await page.request.patch('http://127.0.0.1:4174/api/items', { data: { id: extra, set: { name: 'ならべかえのためし' } } })).ok()).toBe(true);
      await page.reload();
      await page.getByTestId('tab-library').click();
      const setIds = (manifestNow().dolls[0].sets ?? []).map((x) => x.id);
      expect(setIds.length).toBeGreaterThanOrEqual(2);
      const setThumbs = page.getByTestId('sort-set');
      await expect(setThumbs).toHaveCount(setIds.length);
      await setThumbs.last().dragTo(setThumbs.first(), { targetPosition: { x: 2, y: 5 } });
      await expect.poll(() => (manifestNow().dolls[0].sets ?? []).map((x) => x.id)).toEqual([setIds.at(-1), ...setIds.slice(0, -1)]);
      expect((await page.request.patch('http://127.0.0.1:4174/api/items', { data: { id: extra, leaveSet: setIds.at(-1) } })).ok()).toBe(true);
      await page.reload();
      await page.getByTestId('tab-library').click();
      await expect(page.getByTestId('sort-set')).toHaveCount(setIds.length - 1);
      // ほかの段へ落としても、同じ所に落としても、何も変わらない
      const snapshot = manifestText();
      const other = page.locator('[data-testid^="sort-row-"]:not([data-testid="sort-row-トップス"])').first().getByTestId('sort-item').first();
      await row.first().dragTo(other);
      await row.first().dragTo(row.first(), { targetPosition: { x: 2, y: 5 } }); // 動かして、元の所に落とす
      await page.waitForTimeout(500);
      expect(manifestText()).toBe(snapshot);
      // 押すと、くわしくのその服へ（一覧ファイルは変わらない）
      await row.first().click();
      await expect(page.getByTestId('library-view-detail')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`[data-item-id="${tops()[0].id}"]`)).toBeInViewport();
      expect(manifestText()).toBe(snapshot);
      // 読み込み直すと、さっき選んだ表示（くわしく）で開く。並び順の数字の欄は無い
      await page.reload();
      await page.getByTestId('tab-library').click();
      await expect(page.getByTestId('library-view-detail')).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByLabel('並び順')).toHaveCount(0);
      // ならべかえを選ぶと、読み込み直してもならべかえで開く
      await page.getByTestId('library-view-sort').click();
      await page.reload();
      await page.getByTestId('tab-library').click();
      await expect(page.getByTestId('sort-view')).toBeVisible();
      await page.getByTestId('library-view-detail').click();
    });

    test('ならべかえ: 保存している間に落としたものは、無視する（前の並べ替えを戻さない）', async ({ page }) => {
      await page.getByTestId('tab-library').click();
      await page.getByTestId('library-view-sort').click();
      const chips = page.getByTestId('sort-category');
      const ids = await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
      expect(ids.length).toBeGreaterThanOrEqual(3);
      // 保存の返事を 1.5 秒遅らせる
      await page.route('**/api/categories/order', async (route) => {
        await new Promise((r) => setTimeout(r, 1500));
        await route.continue();
      });
      await chips.last().dragTo(chips.first(), { targetPosition: { x: 2, y: 5 } });
      // 返事が来る前に、もう 1 つ動かす（画面は、まだ前の並び）
      await chips.nth(1).dragTo(chips.first(), { targetPosition: { x: 2, y: 5 } });
      const cats = () => [...manifestNow().dolls[0].categories].sort((a, b) => a.menuOrder - b.menuOrder).map((c) => c.id);
      const first = [ids.at(-1), ...ids.slice(0, -1)];
      await expect.poll(cats).toEqual(first);
      await page.waitForTimeout(2500);
      expect(cats()).toEqual(first);
      await expect.poll(() => chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')))).toEqual(first);
      await page.unroute('**/api/categories/order');
      await page.getByTestId('library-view-detail').click();
    });

    test('一覧のセット: パーツが並び、重ね順を決められ、外したり、ほかの服を足したりできる', async ({ page }) => {
      const setItems = () => manifestNow().dolls[0].items.filter((i) => (i as Item & { set?: string }).set === 'アニメ/セット/うみのセット') as (Item & { layer?: number })[];
      expect(setItems().map((i) => i.name).sort()).toEqual(['うみのかざり', 'うみのシャツ']);
      await page.getByTestId('tab-library').click();
      const box = page.getByTestId('library-set');
      await expect(box.getByTestId('set-member')).toHaveCount(2);
      // シャツを一番手前に（重ね順 30）。このセットだけの値で、服そのものの重ね順は変えない
      const shirt = box.getByTestId('set-member').filter({ hasText: 'うみのシャツ' });
      await shirt.getByTestId('set-member-layer').fill('30');
      await shirt.getByTestId('set-member-layer').press('Enter');
      const shirtId = () => setItems().find((i) => i.name === 'うみのシャツ')!.id;
      const umiLayers = () => ((manifestNow().dolls[0] as { sets?: { name: string; layers?: Record<string, number> }[] }).sets ?? []).find((x) => x.name === 'うみのセット')?.layers;
      await expect.poll(() => umiLayers()?.[shirtId()]).toBe(30);
      expect(setItems().find((i) => i.name === 'うみのシャツ')?.layer).toBeUndefined();
      await expect(box.getByTestId('set-member').first()).toContainText('うみのシャツ');
      // 外す → 1 点。ほかの服を足す → 2 点
      await box.getByTestId('set-member').filter({ hasText: 'うみのかざり' }).getByTestId('set-member-remove').click();
      await expect.poll(() => setItems().map((i) => i.name)).toEqual(['うみのシャツ']);
      const arabian = manifestNow().dolls[0].items.find((i) => i.name === 'アラビアン')!;
      await box.getByTestId('set-add-item').selectOption(arabian.id);
      await expect.poll(() => setItems().map((i) => i.name).sort()).toEqual(['うみのシャツ', 'アラビアン']);
      await expect(box.getByTestId('set-member')).toHaveCount(2);
      // 服の側からも入れられる
      const kazari = page.getByTestId('library-item').filter({ has: page.locator('input[value="うみのかざり"]') });
      await kazari.getByTestId('item-join-set').selectOption({ label: 'うみのセット' });
      await expect.poll(() => setItems().length).toBe(3);
      // 新しいセットを作り、▲ ▼ でセットの順番（ゲームのメニューでの順番）を変える
      const setNames = () => ((manifestNow().dolls[0] as { sets?: { name: string }[] }).sets ?? []).map((x) => x.name);
      // うみのセットに入っている かざり を、やまのセットにも入れる（1 点が 2 つのセットに入る）
      page.once('dialog', (dialog) => void dialog.accept('やまのセット'));
      await kazari.getByTestId('item-join-set').selectOption({ label: '＋ 新しいセット' });
      await expect.poll(setNames).toEqual(['うみのセット', 'やまのセット']);
      const kazariSets = () => (manifestNow().dolls[0].items.find((i) => i.name === 'うみのかざり') as Item & { set?: string | string[] }).set;
      await expect.poll(kazariSets).toEqual(['アニメ/セット/うみのセット', 'アニメ/セット/やまのセット']);
      await expect(kazari.getByTestId('item-set')).toHaveCount(2);
      await expect(page.getByTestId('library-set').nth(1).getByTestId('set-member')).toHaveCount(1);
      // やまのセットでの かざり の重ね順は、うみのセットとは別の値（連動しない）
      const yamaBox = page.getByTestId('library-set').filter({ has: page.locator('input[aria-label="セットのなまえ"][value="やまのセット"]') });
      const kazariId = manifestNow().dolls[0].items.find((i) => i.name === 'うみのかざり')!.id;
      const layersOf = (name: string) => ((manifestNow().dolls[0] as { sets?: { name: string; layers?: Record<string, number> }[] }).sets ?? []).find((x) => x.name === name)?.layers ?? {};
      await yamaBox.getByTestId('set-member-layer').fill('40');
      await yamaBox.getByTestId('set-member-layer').press('Enter');
      await expect.poll(() => layersOf('やまのセット')[kazariId]).toBe(40);
      expect(layersOf('うみのセット')[kazariId]).toBeUndefined();
      const boxes = page.getByTestId('library-set');
      await expect(boxes).toHaveCount(2);
      await expect(boxes.first().getByTestId('set-earlier')).toBeDisabled();
      await boxes.nth(1).getByTestId('set-earlier').click();
      await expect.poll(setNames).toEqual(['やまのセット', 'うみのセット']);
      await expect(boxes.first().locator('input[aria-label="セットのなまえ"]')).toHaveValue('やまのセット');
      await boxes.first().getByTestId('set-later').click();
      await expect.poll(setNames).toEqual(['うみのセット', 'やまのセット']);
      // やまのセットの欄から外す: うみのセットには残り、やまのセットは空になって消える
      await expect(yamaBox.getByTestId('set-member')).toHaveCount(1);
      await yamaBox.getByTestId('set-member-remove').click();
      await expect.poll(kazariSets).toBe('アニメ/セット/うみのセット');
      await expect.poll(setNames).toEqual(['うみのセット']);
    });

    test('ドールの範囲のタブで、ドールの名前を変え、ゲームに出さないようにできる', async ({ page }) => {
      await page.getByTestId('tab-doll').click();
      await page.getByTestId('doll-rename').fill('おんなのこ');
      await page.getByTestId('doll-rename').press('Enter');
      await expect.poll(() => manifestNow().dolls[0].name).toBe('おんなのこ');
      expect(manifestNow().dolls[0].id).toBe('アニメ');
      await page.getByTestId('doll-hidden').check();
      await expect.poll(() => manifestNow().dolls[0].hidden).toBe(true);
      await expect(page.getByTestId('doll-select')).toContainText('ゲームに出さない');
      await page.getByTestId('doll-hidden').uncheck();
      await expect.poll(() => manifestNow().dolls[0].hidden).toBeUndefined();
    });

    test('保存していない候補は、ほかのタブを開いても残り、ドールを変える前にたずねる。ページを閉じる前にもたずねる', async ({ page }) => {
      // 2 体目のドール
      await page.getByTestId('tab-doll').click();
      await page.getByText('ドールを追加').click();
      await page.getByTestId('doll-name').fill('ふたりめ');
      await page.getByTestId('doll-file').setInputFiles(fixture('doll-anime.webp'));
      await page.getByTestId('doll-add').click();
      await expect(page.getByTestId('doll-select')).toHaveValue('ふたりめ');
      await page.getByTestId('doll-select').selectOption('アニメ');
      await upload(page, 'sample-green-set.webp');
      await page.getByTestId('tab-library').click();
      await page.getByTestId('tab-add').click();
      await expect(page.getByTestId('item-card')).toHaveCount(1);
      // やめると、ドールは変わらず、候補も残る
      const asked: string[] = [];
      page.once('dialog', (d) => {
        asked.push(d.message());
        void d.dismiss();
      });
      await page.getByTestId('doll-select').selectOption('ふたりめ');
      await expect.poll(() => asked.length).toBe(1);
      expect(asked[0]).toContain('1 点');
      await expect(page.getByTestId('doll-select')).toHaveValue('アニメ');
      await expect(page.getByTestId('item-card')).toHaveCount(1);
      // ページを閉じる前にもたずねる
      const unload: string[] = [];
      page.once('dialog', (d) => {
        unload.push(d.type());
        void d.dismiss();
      });
      await page.close({ runBeforeUnload: true });
      await expect.poll(() => unload).toEqual(['beforeunload']);
    });
    test('背景: えらんだ背景だけを、ほかのドール・全部のドールにコピーできる', async ({ page }) => {
      await page.getByTestId('doll-select').selectOption('アニメ');
      await page.getByTestId('tab-backgrounds').click();
      await page.getByTestId('bg-files').setInputFiles([fixture('sample-green-set.webp'), fixture('sample-black-skirt.webp')]);
      await expect(page.getByTestId('bg-item')).toHaveCount(2, { timeout: 30_000 });
      const anime = () => manifestNow() as unknown as { backgrounds: { id: string; file: string }[]; dolls: { id: string; backgrounds: { id: string; file: string }[] }[] };
      const first = anime().dolls[0].backgrounds[0];
      await page.getByTestId('bg-pick').first().check();
      await page.getByTestId('bg-copy-to').selectOption('ふたりめ');
      await page.getByTestId('bg-copy-run').click();
      await expect(page.getByTestId('bg-copied')).toContainText('1 枚');
      await expect.poll(() => anime().dolls.find((d) => d.id === 'ふたりめ')?.backgrounds.map((b) => b.file)).toEqual([first.file]);
      await page.getByTestId('bg-pick').first().check();
      await page.getByTestId('bg-copy-to').selectOption({ label: '全部のドール（共通の背景）' });
      await page.getByTestId('bg-copy-run').click();
      await expect.poll(() => anime().backgrounds.map((b) => b.file)).toEqual([first.file]);
    });
  });
});
