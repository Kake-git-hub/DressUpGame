# 段階 B: 重なりをドラッグで並べ替える（v0.23.0） Implementation Plan

> 進め方: このプロジェクトの決まり（HANDOFF 5 章）どおり、セッション内で順に実装し、最後に別の目の全体レビューを 1 回かける。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 調整画面の左の一覧（上が手前、まんなかにドール）で、服の絵をつかんで上下に動かすと、その位置に重なりが入れ替わる。

**Architecture:** 重なりの値の計算は純粋関数 `reorderLayer`（`src/engine/layers.ts`）。画面は、一覧の行の Pointer Events でドラッグを見て、離したときにその関数の結果を着ている服に入れる。ドラッグの見た目（行が指に付いてくる・ほかの行が場所をあける）は CSS の `transform` だけで行い、React の状態は「いま動かしている行と、入れる位置」だけ。

**Tech Stack:** React 19、TypeScript、Vitest、Playwright。新しい依存は足さない。

**Spec:** `docs/superpowers/specs/2026-11-20-app-studio-portrait-sets-design.md` の 5 章

## Global Constraints

- テストを先に書き、失敗を見てから実装する。タスクごとにコミットする（作業ブランチ `claude/blissful-wozniak-9vofnl`）。
- 各タスクの終わりに `npx vitest run`・`npx tsc -b`・`npx eslint .`。E2E は `npm run build` のあと `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`。
- ▲▼ ボタンと、その動き（`moveLayer`）は変えない。軽く押す（6px 未満しか動かさない）と、今までどおり、その服の調整に切り替わる。
- 髪は、前髪とうしろがみが別々の行のまま（重なりだけは 1 枚ずつ）。ドールの行は動かせない。
- 保存の形（`layerAdjust`）は変えない。いま保存されている服装は、そのまま読める。
- 画面の文言とコードのコメントは日本語。版数は `src/version.ts` と `README.md` を `0.23.0` に。
- 画像生成は使わない。`main` への取り込みは、作者に確かめてから。

## Review Focus

1. **同じ重なりの値の服が並んでいる所に入れる**（重ね着できるカテゴリの 2 点など）: 入れた位置どおりの順番になる → Task 1 のテスト。
2. **少しだけ動かして離す・元の位置で離す**: 何も変わらない。6px 未満なら「押した」として調整する服が切り替わる → Task 1・2 のテスト。
3. **ドラッグの途中で操作が取り消される**（`pointercancel`。iPad のシステムの操作など）: 何も変わらず、行が元に戻る → Task 2 のテスト。
4. **ドールの行をまたぐ**: 下へまたぐとドールの後ろ、上へまたぐとドールの前。再読み込みしても同じ → Task 2 のテスト。
5. **調整中の服そのものを動かす／ほかの服を動かす**: どちらも、調整中の表示（プレビュー）とキャンバスが、その場で同じ重なりになる → Task 2 のテスト。

---

### Task 1: 並べ替えの計算 `reorderLayer`

**Files:**
- Modify: `src/engine/layers.ts`
- Test: `src/tests/layers.test.ts`

**Interfaces:**
- Produces:

```ts
export interface LayerChange { id: string; layerAdjust: number }
/**
 * 「着ている服とドール」を下から並べた一覧から id の服を抜き、残りの一覧の index 番目（0 = いちばん下）に入れたときに、
 * 変えるべき layerAdjust。いまと同じ位置なら空の配列。id が無ければ null。
 * ふつうは id の 1 件だけ。入れる所の上下が同じ重なりの値のときは、すぐ上に続く同じ値の服も少しずつ上へずらす（返す配列に入る）。
 */
export function reorderLayer(items: EquippedItem[], id: string, index: number): LayerChange[] | null;
```

- 値の決め方（`moveLayer` と同じ考え方）。`lo` = すぐ下の値、`hi` = すぐ上の値。
  - ドールより上の側: すぐ下がドールなら `lo = 0`。上が無ければ `hi = lo + 1`。
  - ドールより下の側: すぐ上がドールなら `hi = 0`。下が無ければ `lo = hi - 1`。
  - `hi > lo` なら `(lo + hi) / 2`。
  - `hi <= lo`（同じ値が続く）なら、すぐ上に続く「`lo` と同じ値の服」k 件をまとめ、その先の値（無ければ `lo + 1`、ドールなら 0）までの間を k + 2 等分して、下から「入れる服、同じ値だった服…」の順に置く。
  - `index` は 0 〜（残りの行の数）に丸める。

- [ ] **Step 1: 失敗するテストを書く**（`src/tests/layers.test.ts` に足す。`make`・`names` は既存のものを使う）

```ts
const reorder = (items: EquippedItem[], id: string, index: number) => {
  const changes = reorderLayer(items, id, index)!;
  return items.map((i) => {
    const c = changes.find((x) => x.id === i.id);
    return c ? { ...i, layerAdjust: c.layerAdjust } : i;
  });
};

describe('重なりの並べ替え（ドラッグ）', () => {
  const base = () => [make('socks', 1), make('dress', 4), make('hair', 11)]; // 下から DOLL, socks, dress, hair
  it('いちばん上へ・まんなかへ・ドールのすぐ上へ入れられる', () => {
    expect(names(reorder(base(), 'socks', 3))).toEqual(['DOLL', 'dress:front', 'hair:front', 'socks:front']);
    expect(names(reorder(base(), 'hair', 2))).toEqual(['DOLL', 'socks:front', 'hair:front', 'dress:front']);
    expect(names(reorder(base(), 'hair', 1))).toEqual(['DOLL', 'hair:front', 'socks:front', 'dress:front']);
  });
  it('ドールより下へ入れると、ドールの後ろに回る。上へ戻すと前に出る', () => {
    const behind = reorder(base(), 'dress', 0);
    expect(names(behind)).toEqual(['dress:front', 'DOLL', 'socks:front', 'hair:front']);
    expect(isBehindDoll(behind.find((i) => i.id === 'dress')!)).toBe(true);
    expect(names(reorder(behind, 'dress', 1))).toEqual(['DOLL', 'dress:front', 'socks:front', 'hair:front']);
  });
  it('ドールの後ろどうしでも、位置どおりに入る', () => {
    const items = [make('a', 5, { layerAdjust: -7 }), make('b', 5, { layerAdjust: -6 }), make('c', 3)]; // a, b, DOLL, c
    expect(names(reorder(items, 'c', 1))).toEqual(['a:front', 'c:front', 'b:front', 'DOLL']);
    expect(names(reorder(items, 'c', 0))).toEqual(['c:front', 'a:front', 'b:front', 'DOLL']);
  });
  it('同じ重なりの値の服のあいだにも、位置どおりに入る（動かすのは、入れる服と、その上に続く同じ値の服だけ）', () => {
    const items = [make('p', 11, { equipOrder: 1 }), make('q', 11, { equipOrder: 2 }), make('r', 11, { equipOrder: 3 }), make('x', 4)];
    // 下から DOLL, x, p, q, r。x を p と q のあいだへ
    const changes = reorderLayer(items, 'x', 2)!;
    expect(changes.map((c) => c.id).sort()).toEqual(['q', 'r', 'x']);
    expect(names(reorder(items, 'x', 2))).toEqual(['DOLL', 'p:front', 'x:front', 'q:front', 'r:front']);
  });
  it('重なりの値がドールと同じ（0）服の下、ドールのすぐ上にも入る', () => {
    const items = [make('z', 0), make('y', 5)]; // DOLL, z, y
    expect(names(reorder(items, 'y', 1))).toEqual(['DOLL', 'y:front', 'z:front']);
  });
  it('いまと同じ位置なら何も変えない。範囲の外は端に丸める。知らない id は null', () => {
    expect(reorderLayer(base(), 'dress', 2)).toEqual([]);
    expect(names(reorder(base(), 'socks', 99))).toEqual(['DOLL', 'dress:front', 'hair:front', 'socks:front']);
    expect(names(reorder(base(), 'hair', -5))).toEqual(['hair:front', 'DOLL', 'socks:front', 'dress:front']);
    expect(reorderLayer(base(), 'nope', 0)).toBeNull();
  });
  it('▲▼ で動かしたあとの値からでも、続けて並べ替えられる', () => {
    let items = base();
    items = items.map((i) => (i.id === 'socks' ? { ...i, layerAdjust: moveLayer(items, 'socks', 1)! } : i)); // DOLL, dress, socks, hair
    expect(names(reorder(items, 'hair', 1))).toEqual(['DOLL', 'hair:front', 'dress:front', 'socks:front']);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/tests/layers.test.ts` → `reorderLayer` が無いので失敗する。
- [ ] **Step 3:** `reorderLayer` を実装する（`moveLayer` と同じ「行」の作り方を、小さな関数にして共有する）。
- [ ] **Step 4:** `npx vitest run`・`npx tsc -b`・`npx eslint .`。コミット。

### Task 2: 一覧をドラッグで並べ替える

**Files:**
- Modify: `src/components/ItemAdjustPanel.tsx`（一覧の行に Pointer Events。新しい prop `onLayerChange`）
- Modify: `src/App.tsx`（`onLayerChange={(id, layerAdjust) => updateItemAdjustment(id, { layerAdjust })}`）
- Modify: `src/App.css`（行の `touch-action: none`、動かしている行の見た目、場所をあける動き）
- Test: `e2e/dressup.spec.ts`

**Interfaces:**
- Consumes: `reorderLayer(items, id, index): LayerChange[] | null`（Task 1）
- Produces: `ItemAdjustPanelProps.onLayerChange?: (itemId: string, layerAdjust: number) => void`（調整中でない服の重なりを変える。調整中の服は、今までどおり `setLayerAdjust` + `onAdjust({ layerAdjust })`）。
- 画面の決まり:
  - 行（`data-testid="adjust-picker-item"`）で `pointerdown` → 縦に 6px 以上動いたらドラッグ開始。行に `dragging` クラスと `data-dragging="true"`。行は指に付いてくる（`translateY`）。
  - 入れる位置は、指の縦の位置と、ドラッグ開始時に測った各行（ドールの行を含む）の中心で決める。ほかの行は、1 行分（行の高さ + すき間）だけ上下にずれて場所をあける。
  - `pointerup` で `reorderLayer` の結果を入れる。`pointercancel` では何もしない。どちらも行は元に戻る。
  - ドラッグしたあとの `click` では、調整する服を切り替えない。
  - 一覧が長くてスクロールしているとき、指が一覧の上端・下端から 24px 以内にあれば、一覧を少しずつ流す。

- [ ] **Step 1: 失敗するテストを書く**（`e2e/dressup.spec.ts`。既存の `dragItemToDoll`・`screenPixel`・`expectPixel` を使う）

```ts
/** 調整画面の一覧で、from 番目の行（上から、ドールの行も数える）を to 番目の行の位置までドラッグする */
async function dragPickerRow(page: Page, from: number, to: number, end: 'up' | 'cancel' = 'up'): Promise<void> {
  const rows = page.locator('[data-testid="adjust-picker-items"] > *');
  const a = (await rows.nth(from).boundingBox())!;
  const b = (await rows.nth(to).boundingBox())!;
  const x = a.x + a.width / 2;
  const fromY = a.y + a.height / 2;
  // 相手の行の中心を少し越えた所まで
  const toY = b.y + b.height / 2 + (to > from ? 6 : -6);
  await page.mouse.move(x, fromY);
  await page.mouse.down();
  await page.mouse.move(x, (fromY + toY) / 2, { steps: 4 });
  await page.mouse.move(x, toY, { steps: 4 });
  if (end === 'cancel') {
    await rows.nth(from).dispatchEvent('pointercancel', { pointerId: 1, bubbles: true });
    await page.mouse.up();
  } else {
    await page.mouse.up();
  }
}

test('調整画面の一覧をドラッグして、重なりを並べ替えられる', async ({ page }) => {
  await openApp(page);
  await dragItemToDoll(page, 'トップス', 'red');
  await dragItemToDoll(page, 'ボトムス', 'green');
  // ボトムスを上に動かして、トップスに重ねる（トップスが手前）
  await page.locator('.tool-button').first().click();
  const OVERLAP_Y = imgY(480);
  await page.mouse.move(DOLL_X, BOTTOM_Y);
  await page.mouse.down();
  await page.mouse.move(DOLL_X, BOTTOM_Y - 120 * BASE_SCALE, { steps: 6 });
  await page.mouse.up();
  const rows = page.locator('[data-testid="adjust-picker-items"] > *');
  const names = () => rows.evaluateAll((els) => els.map((el) => el.getAttribute('title') ?? ''));
  await expect.poll(names).toEqual(['red', 'green', expect.stringContaining('ドール')]);
  // 調整中の服（ボトムス）を、いちばん上へ: その場でボトムスが手前になる
  await dragPickerRow(page, 1, 0);
  await expect.poll(names).toEqual(['green', 'red', expect.stringContaining('ドール')]);
  await expect.poll(async () => near(await screenPixel(page, DOLL_X, OVERLAP_Y), GREEN, 12)).toBe(true);
  // 調整中でない服（トップス）を、いちばん上へ戻す: 調整する服は変わらない
  await dragPickerRow(page, 1, 0);
  await expect.poll(names).toEqual(['red', 'green', expect.stringContaining('ドール')]);
  await expect(page.getByTestId('adjust-picker-item').nth(1)).toHaveClass(/on/);
  await expect.poll(async () => near(await screenPixel(page, DOLL_X, OVERLAP_Y), RED, 12)).toBe(true);
  // 少しだけ動かして離すと、並びは変わらず、その服の調整に切り替わる
  const top = (await rows.nth(0).boundingBox())!;
  await page.mouse.move(top.x + 20, top.y + 20);
  await page.mouse.down();
  await page.mouse.move(top.x + 20, top.y + 23);
  await page.mouse.up();
  await expect.poll(names).toEqual(['red', 'green', expect.stringContaining('ドール')]);
  await expect(page.getByTestId('adjust-picker-item').nth(0)).toHaveClass(/on/);
  // 途中で取り消されたら、何も変わらない
  await dragPickerRow(page, 0, 1, 'cancel');
  await expect.poll(names).toEqual(['red', 'green', expect.stringContaining('ドール')]);
  await expect(page.locator('[data-dragging="true"]')).toHaveCount(0);
  // トップスをドールの行より下へ: ドールの後ろに回る。確定して読み込み直しても同じ
  await dragPickerRow(page, 0, 2);
  await expect.poll(names).toEqual(['green', expect.stringContaining('ドール'), 'red']);
  await page.locator('.item-adjust-done-btn-small').click();
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
  await page.reload();
  await expectPixel(page, DOLL_X, TOP_Y, SKIN);
  await expectPixel(page, DOLL_X, OVERLAP_Y, GREEN);
});
```

（テスト用の素材の服の名前・色は `e2e/globalSetup.ts` のもの。行の `title` は服の名前、ドールの行は「ドール（…）」。）

- [ ] **Step 2:** ビルドして、このテストだけ回して失敗を見る（並びが変わらない）。
- [ ] **Step 3:** 実装する。ドラッグの状態は `useRef`（開始位置・行の四角）と `useState`（動かしている id・ずれ・入れる位置）で持つ。行を取り消したとき・離したときに必ず空に戻す。
- [ ] **Step 4:** ビルドして E2E 全体。`npx vitest run`・`npx tsc -b`・`npx eslint .`。コミット。

### Task 3: 版数・説明書・全体の確認

**Files:**
- Modify: `src/version.ts`（`0.23.0`）、`README.md`（現在の版、遊び方の 4、更新履歴）、`docs/superpowers/HANDOFF.md`、設計書 5 章の末尾に「結果」

- [ ] **Step 1:** 版数と説明書を直す。
- [ ] **Step 2:** `npx vitest run`・`npx tsc -b`・`npx eslint .`・`npm run build`・E2E 全体（3 回）。
- [ ] **Step 3:** 実物の素材で調整画面を開き、ドラッグの途中と離したあとの写真を撮って、目で確かめる。
- [ ] **Step 4:** 別の目（サブエージェント）の全体レビューを 1 回。指摘を直す。
- [ ] **Step 5:** コミットして push。作者に、iPad での確認項目（指でのドラッグの手ざわり、服が多いときの一覧）を渡す。
