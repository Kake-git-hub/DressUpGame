# 段階 ④ PC スタジオの「ならべかえ」画面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC スタジオの「一覧」に「ならべかえ」の表示を足し、カテゴリ・服・セットの順番を、つかんで動かすだけで決められるようにする（v0.39.0）。

**Architecture:** 順番の計算（カテゴリの並べ方・振り直し）は `src/studio/order.ts` の純粋な関数にする。画面は新しい部品 `src/studio/SortView.tsx` で、`Library`（`src/studio/Panels.tsx`）が「くわしく｜ならべかえ」で切り替える。保存は、いまある口（`api.reorderCategories`（新しく画面側に足す）・`api.reorderItems`・`api.reorderSets`）だけを使う。ゲームとサーバーは変えない。

**Tech Stack:** React + TypeScript、Vitest、Playwright（スタジオの E2E は `e2e/studio.spec.ts`、ポート 4174 のスタジオ）。

**Spec:** `docs/superpowers/specs/2026-11-25-stage4-order-design.md`

## Global Constraints

- アプリ（ゲーム・`src/cloud/`・`src/appStudio/` など）とサーバー（`functions/`・`tools/cloud/`）は変えない。
- 順番は数字で入れない。「くわしく」から、カテゴリの「並び順」の数字の欄を外す。「重ね順」の欄は残す。
- ならべかえの絵は 64px。
- 動かしたカテゴリの順番は、そのドールの全部のカテゴリの `menuOrder` を 0, 1, 2… と振り直して保存する。`layer` はいまの値のまま送る。
- 服はカテゴリをまたいで動かさない。
- 切り替えの覚えは `localStorage` のキー `dressup_studio_library_view`（値 `'detail'`／`'sort'`）。読み書きは try/catch で包み、読めなければ `'detail'`。
- 画面の文言は、いまのスタジオと同じく、やさしい日本語。
- 版は v0.39.0（`src/version.ts`・`README.md`）。

## Review Focus

1. **同じ `menuOrder` のカテゴリ**（いまの素材で、てぶくろ・ソックスが 3）: ならべかえの最初の並びは、ゲームのメニューと同じ（`menuOrder` → カテゴリの `layer` → 一覧の順）であること。1 つ動かしたら、全部が 0..n-1 に振り直されること → Task 1 のユニットテスト。
2. **公開されている素材を取り込んだあと**: PC で振り直したカテゴリの `menuOrder` が、取り込みで戻らないこと（公開の側が変えていなければ）→ Task 1 の `merge3` のテスト。
3. **ドラッグを、動かさずに離した／同じ場所に落とした**: 何も保存しない（無駄な書き込みが無い）→ Task 2 の E2E（押すと「くわしく」へ移るだけで、一覧ファイルは変わらない）。
4. **ほかのカテゴリの段へ服を落とした**: 何も変わらない → Task 2 の E2E。
5. **保存に失敗した**（スタジオの API がエラー）: いままでの `guard` と同じく、エラーの文を出し、画面は読み直した順番に戻る → `guard` を使うことで満たす（新しいテストは作らない）。

---

### Task 1: 順番の計算（カテゴリの並べ方・振り直し）

**Files:**
- Modify: `src/studio/order.ts`
- Modify: `src/studio/api.ts`（`reorderCategories` を足す）
- Test: `src/tests/studioOrder.test.ts`、`tools/content/merge3.test.ts`

**Interfaces:**
- Produces:
  - `sortCategories<T extends { menuOrder: number; layer: number }>(categories: T[]): T[]` — ゲームのメニューと同じ並び（`menuOrder` の小さい順 → 同じなら `layer` の小さい順 → 同じなら元の並びの順）。元の配列は変えない。
  - `renumberCategories<T extends { id: string; layer: number }>(ordered: T[]): { id: string; layer: number; menuOrder: number }[]` — 並びの順に `menuOrder` = 0, 1, 2…。
  - `api.reorderCategories(dollId: string, order: { id: string; layer: number; menuOrder: number }[]): Promise<{ ok: true }>` — `POST /categories/order` に `{ dollId, order }`（サーバーの口は、もうある: `tools/studio/api.ts` の `POST /api/categories/order`）。

- [ ] **Step 1: 失敗するテストを書く**（`src/tests/studioOrder.test.ts` に足す）

```ts
describe('sortCategories', () => {
  it('menuOrder → layer → 元の順で並べる（ゲームのメニューと同じ）', () => {
    const cats = [
      { id: 'ソックス', menuOrder: 3, layer: 1 },
      { id: 'かお', menuOrder: 0, layer: 6 },
      { id: 'てぶくろ', menuOrder: 3, layer: 0 },
      { id: 'A', menuOrder: 5, layer: 2 },
      { id: 'B', menuOrder: 5, layer: 2 },
    ];
    expect(sortCategories(cats).map((c) => c.id)).toEqual(['かお', 'てぶくろ', 'ソックス', 'A', 'B']);
    expect(cats[0].id).toBe('ソックス'); // 元は変えない
  });
});
describe('renumberCategories', () => {
  it('並びの順に 0 から振り直し、layer はそのまま', () => {
    expect(renumberCategories([{ id: 'x', layer: 4 }, { id: 'y', layer: 9 }])).toEqual([
      { id: 'x', layer: 4, menuOrder: 0 },
      { id: 'y', layer: 9, menuOrder: 1 },
    ]);
  });
});
```

`tools/content/merge3.test.ts` に足す: `it('手元で振り直したカテゴリの menuOrder は、公開が変えていなければ残る')` — base と remote は同じ一覧（カテゴリ 2 つ、`menuOrder` 3 と 3）、local は同じ一覧で `menuOrder` を 1 と 0 にしたもの。`mergeManifest(base, local, remote)` のカテゴリの `menuOrder` が 1 と 0 であること。

- [ ] **Step 2: 走らせて、失敗を確かめる**

Run: `npx vitest run src/tests/studioOrder.test.ts tools/content/merge3.test.ts`
Expected: `sortCategories`・`renumberCategories` が無いので FAIL（merge3 のテストは、いまの作りで通るはず。通らなければ、`merge3.ts` を直す）

- [ ] **Step 3: `src/studio/order.ts` に 2 つの関数、`src/studio/api.ts` に `reorderCategories` を足す**

並べ替えは `[...categories].map((c, i) => [c, i])` で元の番号を持って比べる（`Array.prototype.sort` の安定性に頼ってもよいが、番号で比べると読みやすい）。

- [ ] **Step 4: 走らせて、通るのを確かめる**

Run: `npx vitest run src/tests/studioOrder.test.ts tools/content/merge3.test.ts`
Expected: PASS

- [ ] **Step 5: `Library` と `Panels.tsx` のほかの所で、カテゴリの並べ方を `sortCategories` にそろえる**

`src/studio/Panels.tsx` の `[...doll.categories].sort((a, b) => a.menuOrder - b.menuOrder)`（2 か所。161 行目あたり・567 行目あたり）を `sortCategories(doll.categories)` に。

- [ ] **Step 6: コミット**

```bash
git add src/studio/order.ts src/studio/api.ts src/studio/Panels.tsx src/tests/studioOrder.test.ts tools/content/merge3.test.ts
git commit -m "スタジオ: カテゴリの並べ方をゲームと同じに・振り直しの計算"
```

---

### Task 2: 「ならべかえ」の画面と切り替え

**Files:**
- Create: `src/studio/SortView.tsx`
- Modify: `src/studio/Panels.tsx`（`Library`）
- Modify: `src/studio/studio.css`
- Test: `e2e/studio.spec.ts`（`describe('一覧での並べ替え・位置の直し、…')` の中に足す）

**Interfaces:**
- Consumes: Task 1 の `sortCategories`・`renumberCategories`・`api.reorderCategories`。いまある `moveInList`・`dropIndex`・`api.reorderItems`・`api.reorderSets`・`contentUrl`。
- Produces: `export function SortView(props: { doll: ManifestDoll; onChanged: () => Promise<void>; onOpenItem: (itemId: string) => void }): JSX.Element`

**画面の決まり（spec 4 章、写真 `specs/2026-11-25-stage4-order/B-sort-view.png`）**

- `Library` のいちばん上に、切り替えの 2 つのボタン「くわしく」（`data-testid="library-view-detail"`）「ならべかえ」（`data-testid="library-view-sort"`）。選んでいるほうに `aria-pressed="true"`。
- ならべかえ（`data-testid="sort-view"`）:
  - 説明の 1 行: 「カテゴリも服もセットも、つかんで動かすと、その順番がゲームのメニューの順番になります。服を押すと「くわしく」でその服が開きます。」
  - カテゴリの帯: チップ（`data-testid="sort-category"`、`data-id` にカテゴリの ID）に「名前 + 点数」。`sortCategories` の順。チップを別のチップの左半分／右半分に落とすと、その前／後ろへ（`dropIndex`）。動いたら `api.reorderCategories(doll.id, renumberCategories(新しい並び))`。
  - セットの段（セットがあるときだけ。`data-testid="sort-set"`、`title` にセットの名前。パーツの絵を 4 つまで 2×2 に）。落とすと `api.reorderSets`。
  - カテゴリごとの段（`data-testid="sort-row-{カテゴリの ID}"`）に、服の絵（`data-testid="sort-item"`、`data-id` に服の ID、64px、左上に順番の数字）。同じ段の中でだけ落とせる（ほかの段の上では `preventDefault` しない）。落とす先の絵の前／後ろに縦の線を出す。動いたら `api.reorderItems`。
  - 動かさずに離した・同じ所に落とした（`dropIndex` が元と同じ）ときは、何も送らない。
  - 服の絵を押す（`click`）と `onOpenItem(服の ID)`。
  - 保存は、いままでと同じ `guard`（エラーの文を出して、`onChanged` で読み直す）。
- `onOpenItem`: 表示を「くわしく」にし、描かれたあと、その服の `figure`（`data-item-id` を足す）を `scrollIntoView({ block: 'center' })`、2 秒だけ `className` に `flash` を付けて目立たせる。
- 「くわしく」: カテゴリの行の「並び順」の数字の欄を消す。下の説明文から「「並び順」はメニューでの順番（小さいほど先）。」を消し、「メニューでの順番は「ならべかえ」で変えられます。」を足す。

- [ ] **Step 1: 失敗する E2E を書く**（`e2e/studio.spec.ts`）

```ts
test('ならべかえ: カテゴリ・服をつかんで動かすと順番が変わり、押すと「くわしく」のその服へ', async ({ page }) => {
  await page.getByTestId('tab-library').click();
  await page.getByTestId('library-view-sort').click();
  await expect(page.getByTestId('sort-view')).toBeVisible();
  // カテゴリ: 最後のチップを最初のチップの左半分へ
  const chips = page.getByTestId('sort-category');
  const ids = await chips.evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  await chips.last().dragTo(chips.first(), { targetPosition: { x: 2, y: 5 } });
  const cats = () => [...manifestNow().dolls[0].categories].sort((a, b) => a.menuOrder - b.menuOrder).map((c) => c.id);
  await expect.poll(cats).toEqual([ids.at(-1), ...ids.slice(0, -1)]);
  expect(manifestNow().dolls[0].categories.map((c) => c.menuOrder).sort((a, b) => a - b)).toEqual(ids.map((_, i) => i));
  // 服: トップスの 1 点めを 2 点めの右半分へ
  const row = page.getByTestId('sort-row-トップス').getByTestId('sort-item');
  const before = tops().map((i) => i.id);
  const box = (await row.nth(1).boundingBox())!;
  await row.first().dragTo(row.nth(1), { targetPosition: { x: box.width - 2, y: 5 } });
  await expect.poll(() => tops().map((i) => i.id)).toEqual([before[1], before[0], ...before.slice(2)]);
  // ほかの段へ落としても、何も変わらない
  const other = page.locator('[data-testid^="sort-row-"]:not([data-testid="sort-row-トップス"])').first().getByTestId('sort-item').first();
  const snapshot = fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8');
  await row.first().dragTo(other);
  await page.waitForTimeout(500);
  expect(fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8')).toBe(snapshot);
  // 押すと、くわしくのその服へ（一覧ファイルは変わらない）
  await row.first().click();
  await expect(page.getByTestId('library-view-detail')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(`[data-item-id="${tops()[0].id}"]`)).toBeInViewport();
  expect(fs.readFileSync(path.join(CONTENT, 'manifest.json'), 'utf8')).toBe(snapshot);
  // 読み込み直すと、さっき選んだ表示（くわしく）で開く。並び順の数字の欄は無い
  await page.reload();
  await page.getByTestId('tab-library').click();
  await expect(page.getByTestId('library-view-detail')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('並び順')).toHaveCount(0);
});
```

`manifestNow` の型に `categories: { id: string; menuOrder: number }[]` を足す。テストの素材にカテゴリが 2 つ未満なら、`page.request.put('/api/categories', …)` で 1 つ足してから始める（同じファイルの 251 行目あたりの書き方）。セットのドラッグは、素材にセットが 2 つ以上あるときだけ、同じ形で `reorderSets` の結果（`manifestNow().dolls[0].sets` の順）を確かめる。

- [ ] **Step 2: 走らせて、失敗を確かめる**

Run: `npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/studio.spec.ts -g ならべかえ --trace off`
Expected: `library-view-sort` が無いので FAIL

- [ ] **Step 3: `SortView.tsx` を作り、`Library` に切り替えと `onOpenItem` を入れ、CSS を足す**

CSS（`studio.css`）: `.sort-view` の段は白い背景・角丸 10px、服の絵は `64px × 64px`・`object-fit: contain`・間 4px で折り返し、チップは丸い枠。ドラッグ中は半透明、落とす先は紫（`#6a4fd0`）の縦線、`.flash` は紫の枠を 2 秒。

- [ ] **Step 4: 走らせて、通るのを確かめる**

Run: `npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/studio.spec.ts --trace off`
Expected: スタジオの E2E が全部 PASS（いまの「◀ ▶」のテストも通る）

- [ ] **Step 5: コミット**

```bash
git add src/studio/SortView.tsx src/studio/Panels.tsx src/studio/studio.css e2e/studio.spec.ts
git commit -m "スタジオ: 一覧に「ならべかえ」（カテゴリ・服・セットをつかんで並べる）"
```

---

### Task 3: 版・説明・全部のテスト・写真

**Files:**
- Modify: `src/version.ts`（`'0.39.0'`）、`README.md`（版数・更新履歴の先頭に v0.39.0・素材スタジオの「一覧」の説明）、`docs/superpowers/HANDOFF.md`（0 章と 0-1 の表の ④）

- [ ] **Step 1: 版と README を書く**

更新履歴の文（例）: 「**v0.39.0** - 素材スタジオ: 「一覧」に「ならべかえ」。カテゴリ・服・セットの絵（小さめ）を、つかんで動かすだけで、ゲームのメニューの順番を決められる（数字は入れない。カテゴリの「並び順」の数字の欄は外した）。服の絵を押すと「くわしく」のその服へ。ゲームとサーバーの動きは変わらない（載せ直し不要。並べたら「公開」）」

- [ ] **Step 2: 全部のテスト**

Run: `npx vitest run` → 1 件（`processSwap` の時間切れ、前からある）を除いて PASS
Run: `npm run firebase:test` → PASS
Run: `npx tsc -b && npx eslint .` → エラー 0
Run: `npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off` → 全部 PASS

- [ ] **Step 3: 写真**（作者に見せる。`docs/superpowers/specs/2026-11-25-stage4-order/` に `result-sort.png`・`result-detail.png`）

素材フォルダの写し（`git clone ../DressUpGame-content <scratchpad>/content`）を `CONTENT_DIR` にしてスタジオを起動し、おんなのこの「一覧」の「ならべかえ」と「くわしく」を 1440×900・画素の細かさ 2 で撮る。

- [ ] **Step 4: コミット**

```bash
git add -A src/version.ts README.md docs
git commit -m "v0.39.0: 素材スタジオの「ならべかえ」"
```
