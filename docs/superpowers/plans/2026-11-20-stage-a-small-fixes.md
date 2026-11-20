# 段階 A: 小さな直し（v0.22.0） Implementation Plan

> 進め方: このプロジェクトの決まり（HANDOFF 5 章）どおり、セッション内で順に実装し、最後に別の目の全体レビューを 1 回かける。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 絵柄に「マンガ」を足し、横画面の PWA で画面の上のバーに重ならないようにし、下の「ドラッグして…」を消し、版数を右上に小さく出す。

**Architecture:** 画面の上の「あけておく高さ」を CSS の変数 `--top-inset` 1 つにまとめ、上端に置くものは全部それを使う。ホーム画面から開いたとき（standalone）は、端末が教える高さと 24px の大きいほう。キャンバスの大きさ・位置の計算（`PixiEngine`・`placement.ts`）は、この段階では変えない（段階 C で扱う）。

**Tech Stack:** React 19、TypeScript、CSS、Vitest、Playwright。新しい依存は足さない。

**Spec:** `docs/superpowers/specs/2026-11-20-app-studio-portrait-sets-design.md` の 4 章

## Global Constraints

- テストを先に書き、失敗を見てから実装する。タスクごとにコミットする（作業ブランチ `claude/blissful-wozniak-9vofnl`）。
- 各タスクの終わりに `npx vitest run`・`npx tsc -b`・`npx eslint .` が通ること。E2E は `npm run build` のあと `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`。
- `.version-badge` という名前は残す（E2E と、公開サイトの確認が使う）。
- キャンバスの大きさ・ドールの位置・保存済みの服装は、1px も変えない。
- 画面の文言とコードのコメントは日本語（既存にそろえる）。
- 版数は `src/version.ts` の `APP_VERSION` と `README.md` を `0.22.0` に。
- 画像生成は使わない。`main` への取り込みは、作者に確かめてから。

## Review Focus

1. **覚えていた絵柄が、いまは無い ID**（`localStorage` の `studio.style`）: アニメに戻る → Task 1 のテスト。
2. **調整画面で、版数が右上のボタンに重なる**: 版数は押せない・ボタンの四角と重ならない → Task 2 のテスト。
3. **ブラウザで開いたとき（standalone でない）**: 上の余白は増えない（今までと同じ位置）→ Task 3 のテスト。
4. **下の文を消したあとのメニュー**: 下の ▼ ボタンが画面の中に収まっている → Task 2 のテスト。
5. **読み込み中・失敗の画面**: 版数が出る（どの版で止まっているかが分かる）→ Task 2 のテスト。

---

### Task 1: 絵柄「マンガ」

**Files:**
- Modify: `src/studio/stylePresets.ts`
- Test: `src/tests/stylePresets.test.ts`（新規）、`e2e/studio.spec.ts`（181 行目あたりの絵柄のテストに 1 行）

**Interfaces:**
- Produces: `STYLE_PRESETS` に `{ id: 'manga', label: 'マンガ', prompt: … }`。並びは「アニメ」のすぐ後ろ。

- [ ] **Step 1: 失敗するテストを書く**（`src/tests/stylePresets.test.ts`）

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_STYLE_ID, STYLE_PRESETS, findStyle } from '../studio/stylePresets';

describe('絵柄の選択肢', () => {
  it('「マンガ」がアニメのすぐ後ろにある', () => {
    expect(STYLE_PRESETS.map((s) => s.id).slice(0, 2)).toEqual(['anime', 'manga']);
    expect(findStyle('manga').label).toBe('マンガ');
  });
  it('マンガの指示は、線とトーンと「色つき」を言う', () => {
    const p = findStyle('manga').prompt;
    expect(p).toMatch(/manga/i);
    expect(p).toMatch(/screentone/i);
    expect(p).toMatch(/full colou?r/i);
  });
  it('ID は重ならない。知らない ID・空は既定（アニメ）に戻る', () => {
    expect(new Set(STYLE_PRESETS.map((s) => s.id)).size).toBe(STYLE_PRESETS.length);
    expect(findStyle('no-such-style').id).toBe(DEFAULT_STYLE_ID);
    expect(findStyle(null).id).toBe('anime');
  });
});
```

- [ ] **Step 2:** `npx vitest run src/tests/stylePresets.test.ts` → 「マンガ」の 2 件が失敗する。
- [ ] **Step 3: 実装**。`STYLE_PRESETS` の 2 番目に足す。指示文（このまま使う）:

```
Japanese manga illustration in full colour: expressive black ink line art with varied line weight, screentone-style dot shading and fine hatching for shadows, flat clean colours with crisp white highlights.
```

- [ ] **Step 4:** `e2e/studio.spec.ts` の絵柄のテストに `await expect(page.getByTestId('style-manga')).toHaveText('マンガ');` を足す。
- [ ] **Step 5:** `npx vitest run`・`npx tsc -b`・`npx eslint .` が通る。コミット。

### Task 2: 下の文を消す・版数を右上に

**Files:**
- Modify: `src/App.tsx`（`app-footer` を消す。`version-badge` を `palette-section` の外、`.app` の直下へ。読み込み中・失敗の画面にも出す）
- Modify: `src/App.css`（`.app-footer` の 2 か所を消す。`.version-badge` を書き換える）
- Test: `e2e/dressup.spec.ts`

**Interfaces:**
- Consumes: Task 3 の `--top-inset`（Task 3 より先に実装するので、ここでは `var(--top-inset, 0px)` と書く）。
- Produces: `.version-badge` は `position: fixed`、`top: calc(var(--top-inset, 0px) + 2px)`、`right: 6px`、`font-size: 10px`、`line-height: 12px`、`pointer-events: none`、`z-index: 400`（調整画面の 300 より上）。

- [ ] **Step 1: 失敗するテストを書く**（`e2e/dressup.spec.ts`。既存の `openApp` を使う）

```ts
test('下の案内の文は無く、版数は右上に小さく出る（調整中も、読み込み失敗の画面でも）', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('.app-footer')).toHaveCount(0);
  await expect(page.getByText('ドラッグしてドールにきせてね')).toHaveCount(0);
  const badge = page.locator('.version-badge');
  await expect(badge).toHaveText(/^v\d+\.\d+\.\d+$/);
  const viewport = page.viewportSize()!;
  const box = (await badge.boundingBox())!;
  expect(box.y).toBeLessThan(20);
  expect(viewport.width - (box.x + box.width)).toBeLessThan(12);
  expect(box.height).toBeLessThanOrEqual(14);
  // メニューの下の ▼ は画面の中
  const down = (await page.getByTestId('menu-scroll-down').boundingBox())!;
  expect(down.y + down.height).toBeLessThanOrEqual(viewport.height);
  // 調整中も出ていて、右上のボタンと重ならない・押せない
  await page.locator('.tool-button').click();
  await expect(badge).toBeVisible();
  const b = (await badge.boundingBox())!;
  const top = (await page.locator('.item-adjust-top-buttons').boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual(top.y);
  expect(await badge.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe('none');
});
```

読み込み失敗の画面の分は、既存の `test.describe('素材の取得に失敗したとき')` の最初のテストに `await expect(page.locator('.version-badge')).toBeVisible();` を足す。

- [ ] **Step 2:** `npm run build` のあと、このテストだけ回して失敗を見る（`-g '下の案内の文'`）。
- [ ] **Step 3: 実装**。`App.tsx` は、`<div className="version-badge">v{APP_VERSION}</div>` を 1 つの変数にして、読み込み中・失敗の画面と、ふつうの画面の両方の `.app` の直下に置く。`.item-adjust-top-buttons` の `top` は Task 3 で変える。
- [ ] **Step 4:** ビルドして E2E 全体を回す。`npx vitest run`・`npx tsc -b`・`npx eslint .`。コミット。

### Task 3: 画面の上のバーに重ならない

**Files:**
- Modify: `index.html`（早い段階で、ホーム画面から開いたかを `<html>` に印として付ける）
- Modify: `src/App.css`
- Test: `e2e/dressup.spec.ts`

**Interfaces:**
- Produces: CSS の変数 `--top-inset`。
  - 既定: `env(safe-area-inset-top, 0px)`
  - `@media (display-mode: standalone)` と `html.standalone`（`navigator.standalone === true` のとき、`index.html` の最初のスクリプトが付ける。古い iPadOS 用）: `max(env(safe-area-inset-top, 0px), 24px)`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// ホーム画面から開いたとき（standalone）をまねる
async function emulateStandalone(page: Page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] });
}

test('ホーム画面から開いたときは、上のバーの分（24px 以上）をあける。ブラウザでは今までどおり', async ({ page }) => {
  await openApp(page);
  const tops = async () => ({
    menu: (await page.locator('.palette-section select').boundingBox())!.y,
    tool: (await page.locator('.tool-buttons').boundingBox())!.y,
    badge: (await page.locator('.version-badge').boundingBox())!.y,
  });
  const browser = await tops();
  expect(browser.menu).toBeLessThan(24);
  expect(browser.tool).toBe(72);
  await emulateStandalone(page);
  await expect.poll(async () => (await tops()).menu).toBe(browser.menu + 24);
  const standalone = await tops();
  expect(standalone.tool).toBe(96);
  expect(standalone.badge).toBeGreaterThanOrEqual(24);
  // 調整画面の上のボタンと見出しも下がる
  await page.locator('.tool-button').click();
  expect((await page.locator('.item-adjust-top-buttons').boundingBox())!.y).toBe(40);
  expect((await page.locator('.item-adjust-header').boundingBox())!.y).toBe(40);
  // キャンバスは動かない（この段階では、描く位置を変えない）
  expect((await page.getByTestId('avatar-canvas').boundingBox())!.y).toBe(0);
});
```

（`.tool-buttons` の 72 と、調整画面の 16 は、いまの CSS の値。違っていたら、いまの値に合わせてから失敗を見る。）

- [ ] **Step 2:** ビルドして、このテストだけ回して失敗を見る。
- [ ] **Step 3: 実装**（`src/App.css`）。次の所を `--top-inset` に替える。
  - `.app` の `padding-top`。`@media (min-width: 1024px) and (orientation: landscape)` の `.app { padding: 4px 0 }` は、上の余白を消さないように `padding: calc(var(--top-inset) + 4px) 0 4px` にする。
  - `.palette-section` の `padding-top` は消す（`.app` の余白と二重にしない）。**ブラウザで開いたときのメニューの位置が、変える前と同じ**であること（Step 1 の `browser.menu` を、変える前の値と見比べる）。
  - `.tool-buttons` の `top`: `calc(72px + var(--top-inset))`
  - `.item-adjust-header`・`.item-adjust-top-buttons` の `top`: `calc(16px + var(--top-inset))`
  - `.item-adjust-picker` の `max-height`: `calc(var(--app-height, 100vh) - 32px - 2 * var(--top-inset))`
  - `.avatar-section` は変えない。
- [ ] **Step 4:** `index.html` の最初のスクリプトに、`if (window.navigator.standalone === true) document.documentElement.classList.add('standalone');` を足す。
- [ ] **Step 5:** ビルドして E2E 全体を回す。`npx vitest run`・`npx tsc -b`・`npx eslint .`。コミット。

### Task 4: 版数・説明書・全体の確認

**Files:**
- Modify: `src/version.ts`（`0.22.0`）、`README.md`（現在の版、遊び方、絵柄の並び、更新履歴）、`docs/superpowers/HANDOFF.md`（いまの状態、進行中の計画、作者に見てもらうこと）
- Modify: `docs/superpowers/specs/2026-11-20-app-studio-portrait-sets-design.md`（4 章の末尾に「結果」を足す）

- [ ] **Step 1:** 版数と説明書を直す。
- [ ] **Step 2:** `npx vitest run`・`npx tsc -b`・`npx eslint .`・`npm run build`・E2E 全体（3 回続けて通ること）。
- [ ] **Step 3:** ビルドしたものを Playwright で開き、ふつうの画面と、standalone をまねた画面の写真を撮って、目で確かめる（版数の位置、上の余白、下の文が無いこと）。
- [ ] **Step 4:** 別の目（サブエージェント）の全体レビューを 1 回。指摘を直す。
- [ ] **Step 5:** コミットして push。作者に、iPad での確認項目（上のバーとの重なりが直ったか。直っていなければ画面の写真）と、`main` へ取り込んでよいかを確かめる。
