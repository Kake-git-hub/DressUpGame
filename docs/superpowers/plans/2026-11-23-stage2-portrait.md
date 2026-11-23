# 段階 ②: 縦画面の作り直し（v0.36.0） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 縦画面で、服の絵を大きく・2 段までにし、調整画面の色のスライダーを「その服がなる色」の太い帯にし、編集の枠をいちばん手前に出して、角のつまみを服に重ねない。

**Architecture:** 配置の計算（`src/components/layout.ts`）が、段の数に加えて服の絵の大きさと「スマホか」を返し、メニューと CSS がそれに従う。帯の色は、純粋な関数（`src/pipeline/hueTrack.ts`）が「代表の色」と `recolor` から出し、調整画面がスライダーの背景にする。枠は、服の絵の子をやめて、同じ置き方の別の層（`PlacedFrame`）として、服の重なりより上に描く。

**Tech Stack:** React 19 + TypeScript (strict)、Vite 7、Vitest（jsdom）、Playwright（Chromium）。新しい部品は足さない。

**Spec:** `docs/superpowers/specs/2026-11-23-portrait-rework-design.md`（必ず読む。絵は `specs/2026-11-23-portrait-rework/`。この計画は、そこに無い「名前・形・値」だけを決める）

## Global Constraints

- 服は、どの画面でも **3 段にしない**（2 段まで）。
- 横画面の見た目は変えない（変わるのは、帯の色・枠が手前に来ること・つまみが枠の外側に出ること、だけ）。
- 服を引っぱって着せる・横に流す、の判定（`DressUpMenu.tsx` の `startRowGesture`・`advanceRowGesture`）は変えない。
- スライダーの値の意味は変えない（元の絵からの角度、−180〜180。0 = 元の色）。「色をもどす」は `defaultHue` へ。
- スマホ = 縦で、幅 600px 未満。機種の名前は見ない。
- テストを先に書き、失敗を見てから実装する。既存のテスト id（`portrait-items`・`sticker-frame`・`sticker-remove`・`sticker-reset`・`sticker-rotate`・`adjust-preview`・`hue-reset`）は変えない。
- 版数: `src/version.ts` の `APP_VERSION` と `README.md` を `0.36.0` に（いまは 0.35.1）。
- コミットメッセージ・コード・文書に、AI のモデル名を書かない。コミットの末尾は、セッションの決まりの 2 行。
- 画像生成は使わない。
- 確かめるコマンド: `npx vitest run`（`tools/studio/processSwap.test.ts` の 1 件は、この作業環境では時間切れで落ちることがある。前からある）、`npx tsc -b`、`npx eslint .`、`npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`。

## Review Focus

設計書が言っていないが、使う人が当たりそうな所。それぞれ、持ち主のタスクにテストを足してある。

1. **とても狭い・低い画面**（240×480、iPad の分割表示の幅 320、Safari の中の 390×664）: 絵は決めた範囲に収まり、メニューは画面からはみ出さず、ドールは 120px より小さくならない（Task 1）。
2. **服が 1〜2 点しか無いカテゴリ・背景・セットのタイル**: 絵が大きくなっても、タイルの中身（セットは 4 つの絵 + 名前、着ている印）が崩れない。行が流れないときは、どの向きに動かしても着せられる（Task 1）。
3. **色味の無い服・絵を読めない服**（白い服、読み込み失敗、別の場所の絵で画素が読めない）: 帯は灰色か、決まった虹色になり、色の値が `NaN` や空にならない（Task 2）。
4. **髪（前髪 + うしろがみ）で、片方だけ黒っぽい**: 帯は、服の表示と同じ判定（`pairDark`）で色を出す（Task 2）。
5. **調整画面を開いたまま、縦と横を持ち替える・服を大きく回す**: 枠とつまみは服に付いてきて、画面の外に出て押せなくならない（Task 3）。

---

### Task 1: 服の行（絵の大きさ・2 段まで・スマホとタブレット）

**Files:**
- Modify: `src/components/layout.ts`、`src/components/DressUpMenu.tsx`（`PORTRAIT_TILE` を使っている所）、`src/App.tsx`（`layout.itemRows` を渡している所、`.app` の属性）、`src/App.css`（`.portrait-items`・`.portrait-none`）
- Test: `src/tests/layout.test.ts`、`e2e/dressup.spec.ts`（`縦画面` の describe）

**Interfaces:**
- Produces:
  - `export function portraitTile(width: number): number` — 縦の、服の絵の一辺（px）。
  - `Layout` に `itemTile: number`（縦の絵の一辺。横は 0）と `phone: boolean`（縦で幅 600 未満。横は false）。`itemRows` は 1〜2（横は 0）。
  - `DressUpMenu` の props に `itemTile?: number`（既定 72）。`App` が `layout.itemTile` を渡す。
  - `.app` に `data-phone="true|false"`（Task 3 が使う）。
- 決めた値: `CATEGORY_ROW = 84`・`TOOL_ROW = 56` はそのまま。行の高さ = `itemTile + 12`。`PHONE_MAX_WIDTH = 600`。正方形の下限の割合 = スマホ 0.9、タブレット 0.75。

- [ ] **Step 1: `layout.test.ts` を書き直す（失敗させる）**

`portraitTile` の表（どれも、右端に次の服が 3〜7 割のぞく）:

```ts
it.each([
  [390, 104], [375, 100], [360, 96], [430, 115], [820, 120], [810, 115], [768, 130], [1024, 127], [320, 84], [240, 84],
])('幅 %i → 絵 %i', (w, tile) => {
  expect(portraitTile(w)).toBe(tile);
  const seen = (w - 8) / (tile + 8); // 見える点数
  expect(seen - Math.floor(seen)).toBeGreaterThanOrEqual(0.3);
  expect(seen - Math.floor(seen)).toBeLessThanOrEqual(0.7);
});
```

`computeLayout` の期待（`none` = あき 0）:

| 入力 | canvas | itemRows | itemTile | menuHeight | phone |
|---|---|---|---|---|---|
| 820×1180 | top 0, 820×776 | 2 | 120 | 404 | false |
| 390×844 | 390×390 | 2 | 104 | 372 | true |
| 390×2000 | 390×390 | 2 | 104 | 372 | true |
| 390×664 | 390×390 | 1 | 104 | 256 | true |
| 375×667 | 375×375 | 1 | 100 | 252 | true |
| 768×1024、top 24 | top 24, 768×576 | 2 | 130 | 424 | false |
| 360×640 | 360×360 | 1 | 96 | 248 | true |
| 600×610 | 600×338 | 1 | 120 | 272 | false |
| 600×610、bottom 20 | 高さ 318 | 1 | | | |
| 200×250 | 高さ 120 | 1 | | | |
| 1180×820（横） | 今のまま | 0 | 0 | 0 | false |

「どの大きさでも、正方形 + メニュー + あき は画面の高さを越えない」のテストは、大きさに `[390, 664]`・`[375, 667]`・`[320, 700]`・`[240, 480]` を足して残す。`itemRows` が 2 を越えないことも、同じ繰り返しで見る。

- [ ] **Step 2: 失敗を見る** — `npx vitest run src/tests/layout.test.ts` → `portraitTile` が無い・期待が合わない。

- [ ] **Step 3: `layout.ts` を実装する**

`portraitTile` は、この決め方（テストの表を決めるのは、この式）:

```ts
const GAP = 8; // タイルの間
const PAD = 8; // 行の左のあき
export function portraitTile(width: number): number {
  const base = Math.min(120, Math.max(96, Math.round(width * 0.267)));
  const seen = (t: number) => (width - PAD) / (t + GAP);
  const frac = seen(base) - Math.floor(seen(base));
  if (frac >= 0.3 && frac <= 0.7) return base;
  // n 点がまるごと見えて、次が半分のぞく大きさ。base の ±12% まで
  const n = Math.max(1, Math.round(seen(base) - 0.5));
  const fitted = Math.floor((width - PAD) / (n + 0.5)) - GAP;
  return Math.round(Math.min(base * 1.12, Math.max(base * 0.88, fitted)));
}
```

`computeLayout`（縦）: `tile = portraitTile(w)`、`row = tile + 12`、`fixed = CATEGORY_ROW + TOOL_ROW`。2 段のときの正方形 `min(w, available − fixed − 2 × row)` が `w × (phone ? 0.9 : 0.75)` 以上なら 2 段、そうでなければ 1 段。正方形は `max(120, min(w, available − fixed − rows × row))`。`menuHeight = fixed + rows × row`。`ITEM_ROW`・`MAX_ITEM_ROWS` の定数は消す（ほかで使っていないことを `grep` で確かめる）。

- [ ] **Step 4: 通るのを見る** — `npx vitest run src/tests/layout.test.ts`

- [ ] **Step 5: E2E を書き直す・足す（失敗させる）**（`e2e/dressup.spec.ts` の `縦画面`）

- 定数: 820×1180 の正方形は 776。`const PS = 776; const P_UNIT = (PS * 0.9) / 1024; const pY = (y) => PS / 2 + (y - IMG / 2) * P_UNIT;`（`P_DOLL_X = PW / 2` はそのまま）。「キャンバスの下にメニュー」を `PW` で見ている所は `PS` に。
- 足すテスト:
  - `'服の絵は大きく、2 段まで: スマホ 390×844 は 104px・2 段、375×667 は 100px・1 段、iPad 820×1180 は 120px・2 段'` — `portrait-items` の最初のタイルの `boundingBox()` の幅・高さと、`getComputedStyle(el).gridTemplateRows` の段の数。どの大きさでも、タイルの下の端が `portrait-tools` の上の端より上。
  - `'服が行に収まらないとき、右端に次の服がのぞく'` — 240×480（1 段・絵 84）でトップス（3 点）: 3 点めの左の端が画面の中、右の端が画面の外。
  - `'背景・セットのタイルも同じ大きさで、中身がはみ出さない'` — 390×844 で、`set-tile` の幅が 104、中の `img` が全部タイルの箱の中。
- 残すテスト（値だけ直す）: 「服の行が画面に収まらないとき」（240×480: 絵 84・1 段・正方形 240 のまま）、「収まっているとき、横に動かし始めても着る」。

- [ ] **Step 6: 失敗を見る** — `npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test e2e/dressup.spec.ts -g "縦画面" --trace off`

- [ ] **Step 7: メニューと CSS を実装する**

`PortraitMenu` は `itemTile` を受け取り、`gridTemplateRows: repeat(rows, ${tile}px)`・`gridAutoColumns: ${tile}px` を行の style に付け、3 種のタイル（服・セット・背景）の `size` と、`.portrait-none`（「✕ なし」）の幅・高さに使う。`.portrait-items` の CSS から `grid-auto-columns: 72px` を消し、`gap` は `12px 8px` のまま。`.app` に `data-phone={layout.phone}` を付ける。

- [ ] **Step 8: 通るのを見る** — Step 6 のコマンド。続けて `npx tsc -b`・`npx eslint .`。

- [ ] **Step 9: 写真で見る** — 390×844・375×667・820×1180・768×1024 の、ゲームの画面（本物の素材。`http://localhost:4173/DressUpGame/?home=0`、トップスを開いた所）。重なり・はみ出し・着ている印の位置を見る。

- [ ] **Step 10: Commit** — `縦画面: 服の絵を大きく・2 段まで（スマホとタブレットで段の決め方を分ける）`

---

### Task 2: 色の帯（調整画面）と、開発モードで色が付いてこない不具合

**Files:**
- Create: `src/pipeline/hueTrack.ts`
- Modify: `src/components/HueCanvas.tsx`、`src/components/PlacedItem.tsx`（`onPixels` を通す）、`src/components/ItemAdjustPanel.tsx`、`src/App.css`
- Test: `src/tests/hueTrack.test.ts`（新）、`src/tests/hueCanvas.test.tsx`（新）、`e2e/dressup.spec.ts`

**Interfaces:**
- Produces:
  - `export function mainColor(rgba: Uint8ClampedArray | Uint8Array): [number, number, number] | null` — 代表の色。不透明（アルファ 128 以上）で色味のはっきりした画素（色の幅 ÷ 255 が `0.32` 以上 = `recolor.ts` の `CHROMA_TO`）の平均。そういう画素が不透明な画素の 1% 未満なら、不透明な画素ぜんぶの平均。不透明な画素が無ければ `null`。
  - `export function hueTrack(rgba: Uint8ClampedArray | Uint8Array, dark: boolean): string[] | null` — −180° から +180° まで 30° きざみ、13 個の `rgb(r, g, b)`。代表の色 1 画素を `recolor(…, 度, dark)` に通した色。`mainColor` が `null` なら `null`。
  - `export const RAINBOW_TRACK: string[]` — 読めないときの 13 色（見本の絵の虹）。
  - `export function trackCss(stops: string[], to: 'right' | 'top'): string` — `linear-gradient(to right, …)`。
  - `HueCanvas` の props に `onPixels?: (pixels: Uint8ClampedArray | null) => void`（元の画素を読めたとき・読めなかったときに 1 回）。`PlacedItem` も同じ名前で通す。
- 決めた値: 帯の高さ 48px、つまみ 44px、「色をもどす」48px、色だけの行の高さ 60px（下の行は 64px のまま）。

- [ ] **Step 1: `hueTrack.test.ts` を書く（失敗させる）**

```ts
const solid = (r: number, g: number, b: number, n = 16) => new Uint8ClampedArray(Array.from({ length: n }, () => [r, g, b, 255]).flat());
it('赤い服: まん中（0°）が赤、+120° は緑が強く、−120° は青が強い。13 個', …);       // stops[6] ≈ rgb(255, 0, 0)
it('まん中の色は、recolor を 0° で通した色 = 代表の色そのもの', …);
it('黒っぽい絵: 0° 以外は tintFor の色あい（recolor(…, dark = true) と同じ）', …);
it('色味の無い服（白・灰）: 13 個とも、ほぼ同じ灰色（色の幅 8 以下）', …);
it('白い服に赤いリボン（赤が 5%）: 代表の色は赤（白に引っぱられない）', …);
it('透明な絵・空の配列: null（NaN の文字を作らない）', …);
it('trackCss: "linear-gradient(to right, rgb(…), …)" で、色が 13 個', …);
```

- [ ] **Step 2: 失敗を見る** → **Step 3: `hueTrack.ts` を実装** → **Step 4: 通るのを見る**（`npx vitest run src/tests/hueTrack.test.ts`）

- [ ] **Step 5: `hueCanvas.test.tsx` を書く（失敗させる）** — 開発モード（`<StrictMode>`）で描いたあと、`hue` を変えると、描き直しがもう一度予約される。

```tsx
vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
const raf = vi.spyOn(window, 'requestAnimationFrame');
const { rerender } = render(<StrictMode><HueCanvas src="a.png" hue={0} /></StrictMode>);
vi.runAllTimers();
const before = raf.mock.calls.length;
rerender(<StrictMode><HueCanvas src="a.png" hue={90} /></StrictMode>);
expect(raf.mock.calls.length).toBe(before + 1);
```

- [ ] **Step 6: 失敗を見る**（いまは `before` のまま）→ **Step 7: 直す** — `HueCanvas.tsx` の後始末で、予約を取り消したら `frameRef.current = null` にする。あわせて、画素を読んだ所（`image.onload`）で `onPixels` を呼ぶ（読めなければ `null`）。→ **Step 8: 通るのを見る**

- [ ] **Step 9: E2E を足す（失敗させる）**（`縦画面` の describe。390×844 と 820×1180）

- `'調整画面の色: 色だけの行に、太い帯。動かすと服の色が変わり、「色をもどす」で戻る'`
  - 帯（`.hue-slider-vertical`）の高さが 48 以上、幅が画面の幅の 0.6 以上。角度の数字（`.hue-value`）は見えない。
  - 帯の `background-image` が `linear-gradient` で、赤い服（`red`）なら、まん中の色が赤（`rgb(255, 0, 0)` に近い）。
  - 値を 120 にすると、`adjust-preview` の `data-hue` が `120`。`hue-reset` で `0` に戻る。
  - 帯・重なりの一覧（`adjust-picker`）・↺・✓ が、互いに重ならず、画面の中にある。枠のつまみ 3 つとも重ならない。
  - ドールの調整（一覧のドールを選ぶ）では、色だけの行が無く、一覧がそのぶん下がる。
- 横（1180×820）: `'横の色の帯も、その服がなる色になる（大きさは今のまま 36×280）'`。

- [ ] **Step 10: 失敗を見る** → **Step 11: 調整画面と CSS を実装する**

`ItemAdjustPanel`: 調整中の服の `PlacedItem` に `onPixels` を付け、`useState<Uint8ClampedArray | null>` に覚える（服を切り替えたら `null` に戻す）。`stops = pixels ? hueTrack(pixels, pairDark ?? darkById[item.id] ?? false) : null`、帯の style に `background: trackCss(stops ?? RAINBOW_TRACK, 縦なら 'right'、横なら 'top')`。縦か横かは、いまの `layout`（props に `orientation` が無ければ足す）で決める。`.item-adjust-overlay` に `data-mode="item" | "doll"` を付ける。

CSS（`.app[data-orientation='portrait']` の下だけ）: `.item-adjust-top-buttons` を折り返し（`flex-wrap`）にして、`.item-adjust-hue-slider` を上の行いっぱい（`order: 0; flex: 0 0 100%`）、↺ と ✓ を下の行に。高さは「服」のとき 124px、「ドール」のとき 64px。`.item-adjust-picker` の `bottom` は、その高さ + 8px（`[data-mode]` で分ける）。帯は高さ 48px・角丸 24px・白い縁、つまみ 44px、`.hue-value` は出さない、`.hue-reset-btn` は 48px。横の帯は、`background` 以外そのまま。

- [ ] **Step 12: 通るのを見る** — E2E（Step 9）、`npx vitest run src/tests`、`npx tsc -b`、`npx eslint .`

- [ ] **Step 13: 写真と、開発モードで見る** — 390×844・375×667・820×1180 の調整画面（本物の素材。緑のパーカー・白いセーラー・黒い髪）。375×667 で一覧と枠が重なるなら、一覧の行の高さを詰める（設計書 7 章）。`npx vite` で開き、帯を動かすと `adjust-preview` の色が変わること（前は変わらなかった）。

- [ ] **Step 14: Commit** — `調整画面: 色の帯を、その服がなる色の太い帯に（縦は色だけの行）。開発モードで色が付いてこないのを直す`

---

### Task 3: 編集の枠をいちばん手前に・角のつまみを枠の外へ

**Files:**
- Modify: `src/components/PlacedItem.tsx`、`src/components/ItemAdjustPanel.tsx`、`src/App.css`（`.sticker-*`）
- Test: `e2e/dressup.spec.ts`

**Interfaces:**
- Consumes: `.app[data-phone]`（Task 1）。
- Produces: `export function PlacedFrame(props: { item: EquippedItem; look: ItemLook; geometry: CanvasGeometry; dollTransform: DollTransform; zIndex: number; children: ReactNode })` — `PlacedItem` と同じ位置・大きさ・傾きの、絵の無い層（`PlacedItem` と置き方の部分を共有する。写しは作らない）。
- 決めた値: 枠の層の `zIndex = 190`（服の重なりは `50 + i`、一覧・ボタンは 300）。つまみの大きさ `--sticker-size`: 40px、スマホ（`.app[data-phone='true']`）は 34px。つまみの中心は、角から外へ、縦横それぞれ大きさの 26%（`translate(±76%, ±76%)`。今は ±50%）。

- [ ] **Step 1: E2E を足す（失敗させる）**

- `'調整中の服の枠は、手前の服より上に出る'`（横 1180×820）: ボトムス（`green`）とトップス（`red`）を着せ、重なりの下にあるほうを調整中にする。`sticker-frame` を含む層の `z-index`（`getComputedStyle`）が、`.adjust-front-item` と `adjust-preview` を含む層のどれよりも大きい。枠の四隅の位置は、`adjust-preview` の絵の箱と同じ（±1px）。
- `'枠は、服を動かす・回す・大きくしても、服に付いてくる'`: `sticker-rotate` を引っぱったあと、枠の箱の中心と、`adjust-preview` の箱の中心が同じ（±2px）。縦に持ち替えても同じ。
- `'角のつまみは、枠の外側にある。スマホは 34px、ほかは 40px'`: 3 つのつまみの箱の中心が、`sticker-frame` の箱の外。大きさは 390×844 で 34、820×1180 と 1180×820 で 40。
- `'画面の端の服でも、つまみを押せる'`（390×844、`くつ` を調整中）: `sticker-rotate` と `sticker-remove` の中心が、画面の中で、下の帯（`adjust-picker`・`.item-adjust-top-buttons`）に重ならない。重なるなら、そのつまみだけ内側へ寄せる（実装で決める）。
- いまある「つまみで回す・大きくする・脱がせる・位置を戻す」のテストは、そのまま通ること。

- [ ] **Step 2: 失敗を見る** → **Step 3: 実装する**

`ItemAdjustPanel`: 調整中の服の `PlacedItem` の子から `frame` を外し、重ねる層の並びの最後に `<PlacedFrame key="frame" … zIndex={190}>{frame}</PlacedFrame>` を足す。つまみの `transform` は、`translate(±76%, ±76%) scale(counter)`。CSS: `.sticker-handle { width: var(--sticker-size, 40px); height: var(--sticker-size, 40px); }`、`.app[data-phone='true'] { --sticker-size: 34px; }`（文字の大きさも、それに合わせて少し小さく）。

- [ ] **Step 4: 通るのを見る** — E2E（調整画面のテスト全部: `-g "調整|つまみ|枠|シール"`）、`npx tsc -b`、`npx eslint .`

- [ ] **Step 5: 写真で見る** — 本物の素材で、「ゆめふわマーメイド」を着せ、ソックス（ドレスの下）を調整中にした所（390×844・820×1180・1180×820）。枠とつまみが見えて、服がつまみに隠れていないこと。

- [ ] **Step 6: Commit** — `調整画面: 編集の枠をいちばん手前に。角のつまみは枠の外側へ（スマホは 34px）`

---

### Task 4: 版数・文書・全体の確かめ・最後のレビュー

**Files:**
- Modify: `src/version.ts`（`0.36.0`）、`README.md`（版数と、v0.36.0 の 1 行）、`docs/superpowers/HANDOFF.md`（0 章: 段階 ② を「実装済み」に、作者に見てもらうこと）、設計書（末尾に「結果」: できたこと・変えた所・残したこと）
- Create: `docs/superpowers/specs/2026-11-23-portrait-rework/after-*.jpg`（できあがりの写真: スマホ・iPad の、ゲームの画面と調整画面。「いま」と並べる）

- [ ] **Step 1: 版数と文書を直す。**
- [ ] **Step 2: 全部を流す** — Global Constraints の 4 つのコマンド。結果（件数）を記録する。
- [ ] **Step 3: できあがりの写真を作る**（v0.35.1 と v0.36.0 を並べる。スマホ 390×844・iPad 820×1180。ゲームの画面・調整画面・枠）。作者に送る。
- [ ] **Step 4: Commit・push**（作業ブランチ）。
- [ ] **Step 5: 最後のレビュー** — 新しい目（いちばん力のあるモデル）に、設計書・この計画・`git diff <段階 ② の最初のコミットの前>..HEAD` を渡す。出た指摘は、効き目で並べ直し、1 回でまとめて直す（直さないものは、理由を付けて設計書の「結果」に残す）。
- [ ] **Step 6: 作者に、写真と結果を見せて、公開してよいかをカードで聞く**（`main` へは、その場の了承なしに入れない）。
