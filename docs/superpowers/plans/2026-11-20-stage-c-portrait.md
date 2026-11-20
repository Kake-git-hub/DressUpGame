# 段階 C: 縦画面（v0.24.0） Implementation Plan

> 進め方: このプロジェクトの決まり（HANDOFF 5 章）どおり、セッション内で順に実装し、最後に別の目の全体レビューを 1 回かける。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 縦に持っても遊べる（メニュー類は下）。持ち替えても、着ている服の位置がずれない。

**Architecture:** 描画の計算（`PixiEngine`・`placement.ts`・調整画面）は変えない。縦では、**キャンバスそのものを「画面の幅 × 正方形の一辺」にして上に置き**、メニューの幅・右のボタンの幅を 0 として渡す（描画は「キャンバスの高さ = 背景の正方形の一辺」で計算しているので、そのまま縦でも正しく描ける）。服の位置の調整値は、アプリの状態と保存では「ドールの絵の px」で持ち、描画・調整画面へ渡す直前に「キャンバスの px」に直す（`App.tsx` の 1 か所）。

**Tech Stack:** React 19、TypeScript、CSS、Vitest、Playwright。新しい依存は足さない。

**Spec:** `docs/superpowers/specs/2026-11-20-app-studio-portrait-sets-design.md` の 6 章

## Global Constraints

- テストを先に書き、失敗を見てから実装する。タスクごとにコミットする（作業ブランチ `claude/blissful-wozniak-9vofnl`）。
- 各タスクの終わりに `npx vitest run`・`npx tsc -b`・`npx eslint .`。E2E は `npm run build` のあと `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`。
- **横画面の見た目と操作は変えない**（いまある E2E は、テストを書き換えずに全部通ること。「よこにしてね」のテストだけは置き換える）。
- いま保存されている服装は、更新のあとも同じ見た目で復元される。
- 対象は iPad の縦と、スマホの縦（幅 360px から）。スマホの横は、いまの横画面のまま。
- 縦の配置の値: カテゴリの行 84px、服の行 1 段 84px（余裕があれば 2 段、最大 3 段）、ボタンの行 56px。背景の正方形の一辺 = min(画面の幅, 画面の高さ − 上のあき − メニューの高さ − 下のあき)。
- 画面の文言とコードのコメントは日本語。版数は `src/version.ts` と `README.md` を `0.24.0` に。
- 画像生成は使わない。`main` への取り込みは、テストとレビューのあと（作者の了承「公開してよい、どんどん進めて」2026-11-20）。

## Review Focus

1. **持ち替え（縦 ⇄ 横）・画面の大きさが変わる**: 調整した服が、ドールに対して同じ位置にある → Task 1 のテスト。
2. **更新の前に保存した服装**（調整値が画面の px）: 更新のあと、縦で最初に開いても、横のときと同じ位置 → Task 1 のテスト。
3. **縦で、メニューから上へドラッグして着せる／横に流す**: 上へ動かせば着せられ、横へなぞれば一覧が流れる。途中でメニューの上に戻して離せば、着ない → Task 3 のテスト。
4. **調整の途中で持ち替える**: 落ちない。調整画面が新しい向きで開き直り、確定済みの値は残る → Task 4 のテスト。
5. **せまい・低い画面**（幅 360px、高さ 640px）: メニューとボタンが画面の中に収まり、重ならない → Task 3 のテスト。

---

### Task 1: 調整値を「ドールの絵の px」で持つ

**Files:**
- Create: `src/engine/units.ts`、`src/tests/units.test.ts`
- Modify: `src/services/outfitStorage.ts`（版の目印と、古い保存の変換）、`src/tests/outfitStorage.test.ts`
- Modify: `src/App.tsx`（渡す直前に直す・受け取ったら戻す）
- Test: `e2e/dressup.spec.ts`

**Interfaces:**
- Produces（`src/engine/units.ts`）:

```ts
// ドールの絵の 1px が、キャンバスの論理座標で何 px か（PixiEngine: キャンバスの高さ × 0.9 ÷ 1024）
export const stageUnit = (canvasHeight: number): number;
// 状態（ドールの絵の px）→ 描画・調整画面に渡す値（キャンバスの px）。adjustOffsetX / adjustOffsetY だけを直す
export function toCanvasOffsets<T extends { adjustOffsetX?: number; adjustOffsetY?: number }>(item: T, unit: number): T;
// 調整画面から受け取った値（キャンバスの px）→ 状態（ドールの絵の px）
export function toDollOffsets<T extends { adjustOffsetX?: number; adjustOffsetY?: number }>(adjustment: T, unit: number): T;
```

- Produces（`src/services/outfitStorage.ts`）: `loadOutfit(legacyUnit: number): SavedOutfitEntry[]`。目印 `dressup_outfit_units`（値 `doll`）が無ければ、`adjustOffsetX`・`adjustOffsetY` を `legacyUnit` で割ってから返し、変換した内容と目印を書き戻す。`saveOutfit` は目印も書く。`legacyUnit` は、横にしたときの縮尺 = `stageUnit(Math.min(画面の幅, 画面の高さ))`。
- `App.tsx`: `unit = stageUnit(canvasSize.height)`。`AvatarCanvas`・`ItemAdjustPanel`（`item` と `equippedItems`）・`EquipFlash` には `toCanvasOffsets` をかけた服を渡す（`useMemo`）。`handleItemAdjust` は `toDollOffsets` をかけてから `updateItemAdjustment`。調整画面の `key` に `unit` を含める（大きさが変わったら開き直す）。

- [ ] **Step 1: ユニットテスト**（`units.test.ts`）: `stageUnit(820)` は `0.720703125`。`toCanvasOffsets({ adjustOffsetX: 100, adjustOffsetY: -50, adjustScale: 2 }, 0.5)` は `{ adjustOffsetX: 50, adjustOffsetY: -25, adjustScale: 2 }`。値が無い項目は足さない。`toDollOffsets(toCanvasOffsets(x, u), u)` は `x` に戻る。
- [ ] **Step 2: 保存のテスト**（`outfitStorage.test.ts`）: 目印なしで `[{ id: 'a', equipOrder: 0, adjustOffsetX: 144, adjustOffsetY: -72, adjustScale: 1.5 }]` を置いて `loadOutfit(0.72)` → `adjustOffsetX` 200、`adjustOffsetY` -100、`adjustScale` 1.5。保存し直されて目印が付き、もう一度 `loadOutfit(0.5)` しても 200 のまま。`saveOutfit` のあとは目印がある。保存が無いときは、目印を付けて空を返す。
- [ ] **Step 3: E2E**

```ts
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
  await expectPixel(page, DOLL_X + ADJUST_DX * k, y2, RED);
  await expectPixel(page, DOLL_X - 100 * k, y2, SKIN); // もとの位置の左側には、服が無い
  // 元の大きさに戻すと、元の位置
  await page.setViewportSize({ width: VIEW_W, height: VIEW_H });
  await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, RED);
});

test('更新の前に保存した服装（調整値が画面の px）は、同じ位置で復元され、新しい形で保存し直される', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('dressup_outfit')!)[0].id as string);
  await page.evaluate(([itemId, dx]) => {
    localStorage.setItem('dressup_outfit', JSON.stringify([{ id: itemId, equipOrder: 0, adjustOffsetX: dx }]));
    localStorage.removeItem('dressup_outfit_units');
  }, [id, ADJUST_DX] as const);
  await page.reload();
  await expectPixel(page, DOLL_X + ADJUST_DX, TOP_Y, RED);
  const saved = await page.evaluate(() => ({ units: localStorage.getItem('dressup_outfit_units'), x: JSON.parse(localStorage.getItem('dressup_outfit')!)[0].adjustOffsetX as number }));
  expect(saved.units).toBe('doll');
  expect(saved.x).toBeCloseTo(ADJUST_DX / BASE_SCALE, 3);
});
```

- [ ] **Step 4:** それぞれ失敗を見てから実装する。
- [ ] **Step 5:** ビルドして E2E 全体（いまあるテストは書き換えない）。`npx vitest run`・`npx tsc -b`・`npx eslint .`。コミット。

### Task 2: 配置の計算と、縦のキャンバス

**Files:**
- Create: `src/components/layout.ts`、`src/tests/layout.test.ts`
- Modify: `src/App.tsx`（配置を使う。`.app` に `data-orientation`。キャンバスの大きさ・メニューの幅を配置から）、`src/App.css`（縦の `.avatar-section`）、`vite.config.ts`（`orientation: 'any'`）
- Modify: `e2e/dressup.spec.ts`（「よこにしてね」のテストを置き換える）

**Interfaces:**
- Produces:

```ts
export interface Layout {
  orientation: 'landscape' | 'portrait';
  canvas: { top: number; width: number; height: number }; // 縦: 上のあきの下に、幅いっぱい × 正方形の一辺。横: 画面いっぱい（top は使わない）
  menuOffset: number; // 横 160、縦 0
  rightOffset: number; // 横 60、縦 0
  itemRows: number; // 縦の、服の行の段数（1〜3）。横は 0
  menuHeight: number; // 縦の、下のメニュー全体の高さ（下のあきを除く）。横は 0
}
export const CATEGORY_ROW = 84, ITEM_ROW = 84, TOOL_ROW = 56;
export function computeLayout(width: number, height: number, insets: { top: number; bottom: number }): Layout;
```

  - 縦 = `height > width`。
  - 縦: まず 1 段（メニュー 224px）で一辺 `S = min(width, height − top − bottom − 224)`（下限 120）。残りの高さ（`height − top − bottom − S − 224`）が 84px 以上あるごとに段を足す（最大 3 段）。
  - 例: `computeLayout(820, 1180, {top: 0, bottom: 0})` → `S = 820`、残り 136 → 2 段、`menuHeight` 308。`computeLayout(390, 844, {0,0})` → `S = 390`、残り 230 → 3 段、`menuHeight` 392。`computeLayout(768, 1024, {top: 24, bottom: 0})` → `S = 768`、残り 8 → 1 段。`computeLayout(360, 640, {0,0})` → `S = 360`、残り 56 → 1 段。`computeLayout(600, 610, {0,0})` → `S = 386`、1 段。`computeLayout(1180, 820, …)` → 横、`canvas` は `{ top: 0, width: 1180, height: 820 }`、160 / 60。
- 上と下のあきは、画面に置いた見えない目印（`--top-inset` と `env(safe-area-inset-bottom)` の高さを持つ要素）を測って得る（`App.tsx` の中の小さなフック）。
- 縦のとき、`.avatar-section` は `top: canvas.top`、高さ `canvas.height`（インラインの style）。`.rotate-notice` と、その CSS・テストは消す。

- [ ] **Step 1:** `layout.test.ts` に上の例を書く（失敗を見る）。
- [ ] **Step 2:** `computeLayout` を実装。
- [ ] **Step 3: E2E**（「よこにしてね」のテストの置き換え）: 820×1180 にすると、`rotate-notice` は無く、`.app` の `data-orientation` が `portrait`、キャンバスは上端 0・幅 820・高さ 820、ドールの肌の色がキャンバスの中央（410, 410 のあたり、ドールの胴）に出る。1180×820 に戻すと `landscape` で、`expectPixel(page, DOLL_X, TOP_Y, SKIN)`。
- [ ] **Step 4:** 実装。ビルドして E2E 全体。コミット。

### Task 3: 縦のメニューとボタン

**Files:**
- Modify: `src/components/DressUpMenu.tsx`（`layout?: 'landscape' | 'portrait'` と `itemRows`。縦の描き分けは新しいコンポーネント `PortraitMenu` を同じファイルに置く。`DraggableItem`・`DraggableBackground` に `axis` を足す）
- Modify: `src/App.tsx`、`src/App.css`
- Test: `e2e/dressup.spec.ts`

**Interfaces:**
- Consumes: `Layout`（Task 2）
- 縦の画面（下から）: ボタンの行（👗/📐・📷・🔄。`data-testid` は `portrait-tools`。ボタンのクラスは今までと同じ `tool-button`・`screenshot-button`・`reset-button-fixed`）、服の行（`data-testid="portrait-items"`。横に流す。`itemRows` 段）、カテゴリの行（`data-testid="portrait-categories"`。先頭にドールの選択、次に「はいけい」、あとはカテゴリ。選んでいるカテゴリに `aria-pressed="true"`）。
- カテゴリの行はいつも出ている。最初は先頭のカテゴリが選ばれている。「はいけい」を選ぶと、服の行に背景と「なし」が並ぶ。
- ドラッグ: 縦では、動き始めの 10px が「上下のほうが大きい」ならドラッグ（着せる操作）、「左右のほうが大きい」なら一覧を流す（`touch-action: pan-x`。ブラウザが流し始めると `pointercancel` が来るので、何もしない）。マウスは、今までどおりすぐドラッグ。
- 離した場所がメニュー（`.palette-section`）の上なら着ない（今までと同じ決まり）。

- [ ] **Step 1: E2E を書く**（820×1180 で）: カテゴリの行にトップス・ボトムスが並ぶ／トップスを選んで `red` を上へドラッグするとドールが着る（キャンバスの画素）／メニューの上で離すと着ない／ボタンの行の 👗 で調整画面が開く／📷 と 🔄 が押せる位置にある／360×640 で、3 つの行とキャンバスが重ならず、全部が画面の中にある。指（CDP のタッチ）で服の行を横になぞると `scrollLeft` が増え、服は着ない。
- [ ] **Step 2:** 失敗を見てから実装。
- [ ] **Step 3:** ビルドして E2E 全体。コミット。

### Task 4: 縦の調整画面

**Files:**
- Modify: `src/components/ItemAdjustPanel.tsx`（`orientation` を受け取る。一覧の並べ替えを、縦では左右の向きで行う）、`src/App.css`
- Test: `e2e/dressup.spec.ts`

**Interfaces:**
- 縦では、下のメニューと同じ場所に: 重なりの一覧（横並び。左が手前。両端に「まえへ」「うしろへ」）、色のスライダー（横）、↺ と ✓。`data-testid` は横と同じ。
- 一覧のドラッグは、縦では左右に動かす（つかんだ行は指に付いてきて、となりは場所をあける。長い一覧の「なぞって流す・長く押して並べ替え・端で流れ続ける」も左右で同じ）。計算（`reorderLayer` に渡す番号）は横と同じ。

- [ ] **Step 1: E2E を書く**（820×1180 で）: 服を 2 点着て調整を開く → 一覧が横並びで画面の下にある → 行を左右にドラッグして並べ替わる → 服を動かして ✓ → その位置に描かれる → 横（1180×820）にしても、ドールに対して同じ位置。調整画面を開いたまま横にしても落ちず、調整画面が出ている。
- [ ] **Step 2:** 失敗を見てから実装。
- [ ] **Step 3:** ビルドして E2E 全体。コミット。

### Task 5: 版数・説明書・全体の確認

- [ ] **Step 1:** `src/version.ts`（`0.24.0`）、`README.md`（「iPad 横向き用」の記述、遊び方、更新履歴）、`index.html` はそのまま、`HANDOFF.md`、設計書 6 章の末尾に「結果」。
- [ ] **Step 2:** `npx vitest run`・`npx tsc -b`・`npx eslint .`・`npm run build`・E2E 全体（3 回）。
- [ ] **Step 3:** 実物の素材で、iPad の縦（820×1180）・スマホの縦（390×844）・横（1180×820）の写真（ふつうの画面と調整画面）を撮って、目で確かめる。
- [ ] **Step 4:** 別の目（サブエージェント）の全体レビューを 1 回。指摘を直す。
- [ ] **Step 5:** コミットして push、`main` に取り込む。公開サイトの版数を確かめる。作者に、iPad とスマホでの確認項目を渡す。
