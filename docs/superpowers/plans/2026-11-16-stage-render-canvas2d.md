# 描画の Canvas 2D 置き換え（旧・段階 4）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PixiJS をやめ、画面表示・調整中のプレビュー・写真を 1 つの Canvas 2D 描画関数で描く。遊びと見た目は変えない。

**Architecture:** 「場面（背景・ドール・着ている服・ドールの位置と倍率）をキャンバスに描く」状態を持たない関数を作り、3 か所で使う。レイアウト計算と色相変換は画面なしでテストできる純粋な関数に分ける。描くのは場面が変わったときだけで、常時ループは持たない。画像は「元キャンバス内の位置と大きさ（box）」付きで描けるようにし、次の段階（配信方式）の切り抜き済み画像をそのまま受けられるようにする。

**Tech Stack:** React 19、TypeScript（strict）、Canvas 2D、Vitest、Playwright。PixiJS は削除する。

**Spec:** `docs/superpowers/specs/2026-11-15-lightweight-rework-design.md`（7.4 描画、7.1 の「調整値はドール基準の単位」、5 章の目標と残す機能）

## なぜこの段階を先に行うか

- 作者の報告 2 件（調整を確定すると位置がずれる、着る枚数が増えるとドラッグが重い）は、どちらも描画が原因である可能性が高い。前者は二重実装、後者は WebGL のテクスチャと焼き込みバッファが枚数ぶん GPU メモリを使うこと。開発環境では後者を再現できなかった（0・1・8 枚でドラッグ中のフレーム時間は 16.7ms、描画命令 0 回）ため、iPad 実機での確認が必要。
- 段階 1（配信方式）は切り抜き済み画像を使う。先に描画を box 対応にしておけば、PixiJS と CSS プレビューを切り抜き対応に直す無駄な作業が要らない。
- 画像用リポジトリがまだ無くても進められる。

## Global Constraints

- 遊びを変えない。設計書 5 章「残す機能」がすべて今までどおり動くこと。
- レイアウトは今と同じ: 背景は高さを一辺とする正方形で、メニュー（160px）と右ボタン領域（60px）を除いた領域の中央。ドールの位置は背景に対する %。表示倍率は「表示高さ × 0.9（縦画面は 0.75）÷ 1024」。画像はキャンバスの中心をドールの中心に合わせる。
- 既存の保存データ（服の ID・調整値、ドールの位置）は引き継ぐ。
- 高精細表示は `devicePixelRatio`、上限 2。
- 色相は PixiJS の `ColorMatrixFilter.hue(deg, false)` と同じ行列を使い、同じ値で同じ色になること。
- 調整中の服は一番手前に描く。完了で本来の重ね順に戻る。
- 縦画面レイアウト・取り込み処理・設定画面は、この段階では削除しない（段階 1 で削除）。
- TypeScript strict、`any` を増やさない。`main` には push しない。

## Review Focus

1. 着ている服のうち 1 枚の画像が読めない → その 1 枚だけ描かず、他は描く。例外で画面全体が空にならない（Task 3）。
2. 画像の読み込み中に次の着せ替えが起きる → 後から始まった描画が必ず最後に残る。古い描画が上書きしない（Task 4）。
3. 旧形式の調整値（画面ピクセル単位）が保存されている → 起動時に一度だけドール基準の単位に変換し、位置が変わらない（Task 5）。
4. 色相スライダーを端から端まで動かす → 色相ごとの変換結果を溜め込みすぎない（保持は 1 アイテムにつき 1 つ）（Task 2）。
5. 画像がまだ読み込み中に写真を撮る → 読み込みを待ってから描く。服の欠けた写真にならない（Task 6）。

---

## File Structure

| ファイル | 変更 | 役割 |
|---|---|---|
| `src/render/layout.ts` | 新規 | レイアウト計算（背景の正方形、表示倍率、ドールと服の位置）。純粋関数 |
| `src/render/hue.ts` | 新規 | 色相の行列と、画素への適用。純粋関数 |
| `src/render/scene.ts` | 新規 | 場面の型と `drawScene`（Canvas に描く唯一の関数） |
| `src/render/imageStore.ts` | 新規 | URL → 画像の読み込みと保持、色相適用済み画像の保持 |
| `src/components/StageCanvas.tsx` | 新規 | 画面のキャンバス。場面を組み立てて描く。調整中の下書きと写真の入口 |
| `src/components/ItemAdjustPanel.tsx` | 変更 | CSS プレビューを削除し、下書きを `StageCanvas` に渡すだけにする |
| `src/services/outfitStorage.ts` | 変更 | 調整値の単位を記録し、旧形式を変換する |
| `src/App.tsx` | 変更 | `AvatarCanvas` → `StageCanvas`、Ticker の停止・再開を削除 |
| `src/components/AvatarCanvas.tsx`, `src/engine/PixiEngine.ts`, `src/tests/AvatarCanvas.test.tsx` | 削除 | |
| `src/tests/setup.ts` | 変更 | PixiJS のモックを削除 |
| `package.json` | 変更 | `pixi.js` を依存から削除 |

共通の型（`src/render/scene.ts`）:

```ts
export interface Box { x: number; y: number; w: number; h: number }   // 元キャンバス内の位置（px）
export interface Drawable {
  image: CanvasImageSource;
  canvasW: number;   // 元キャンバスの大きさ（切り抜き前）
  canvasH: number;
  box: Box;          // 切り抜いていない画像は { x: 0, y: 0, w: canvasW, h: canvasH }
}
export interface SceneItem extends Drawable {
  id: string;
  offsetX: number;   // ドール基準の単位（基準 1024 に対する px）
  offsetY: number;
  scale: number;     // 1.0 が等倍
  rotation: number;  // 度
}
export interface Scene {
  background: { image: CanvasImageSource; width: number; height: number } | null;
  doll: Drawable | null;
  items: SceneItem[];             // 描く順（下から上）
  dollTransform: DollTransform;   // x, y は背景に対する %、scale
}
```

---

### Task 1: レイアウト計算

**Files:**
- Create: `src/render/layout.ts`
- Test: `src/tests/layout.test.ts`

**Interfaces:**
- Produces:

```ts
export const REFERENCE_HEIGHT = 1024;
export interface Viewport { width: number; height: number; menuOffset: number; rightOffset: number; isPortrait: boolean }
export interface Layout {
  bg: { x: number; y: number; size: number };  // 背景の正方形（CSS px）
  baseScale: number;                           // 表示高さ × (縦 0.75 / 横 0.9) ÷ 1024
}
export function computeLayout(v: Viewport): Layout;
export function dollCenter(layout: Layout, t: DollTransform): { x: number; y: number };
// 画像の「元キャンバスの中心」を置く位置と、掛ける倍率・回転
export function itemPlacement(layout: Layout, t: DollTransform, item: { offsetX: number; offsetY: number; scale: number; rotation: number }):
  { x: number; y: number; scale: number; rotationRad: number };
// 旧形式（画面 px）の調整量 → ドール基準の単位
export function pxToDollUnits(px: number, layout: Layout, t: DollTransform): number;
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
const landscape = { width: 1180, height: 820, menuOffset: 160, rightOffset: 60, isPortrait: false };
it('横画面: 背景は高さを一辺とする正方形で、利用領域の中央', () => {
  expect(computeLayout(landscape).bg).toEqual({ x: 640 - 410, y: 0, size: 820 });
});
it('横画面の表示倍率は 高さ×0.9÷1024、縦画面は ×0.75', () => {
  expect(computeLayout(landscape).baseScale).toBeCloseTo((820 * 0.9) / 1024, 10);
  expect(computeLayout({ width: 390, height: 704, menuOffset: 0, rightOffset: 0, isPortrait: true }).baseScale).toBeCloseTo((704 * 0.75) / 1024, 10);
});
it('ドールの中心は背景に対する % で決まる', () => {
  const l = computeLayout(landscape);
  expect(dollCenter(l, { x: 50, y: 50, scale: 1 })).toEqual({ x: 640, y: 410 });
  expect(dollCenter(l, { x: 60, y: 40, scale: 1.5 })).toEqual({ x: 640 + 82, y: 410 - 82 });
});
it('服の位置: 調整量は表示倍率とドールの倍率を掛けて足す', () => {
  const l = computeLayout(landscape);
  const p = itemPlacement(l, { x: 50, y: 50, scale: 2 }, { offsetX: 100, offsetY: -50, scale: 1.2, rotation: 90 });
  expect(p.x).toBeCloseTo(640 + 100 * l.baseScale * 2, 10);
  expect(p.y).toBeCloseTo(410 - 50 * l.baseScale * 2, 10);
  expect(p.scale).toBeCloseTo(l.baseScale * 2 * 1.2, 10);
  expect(p.rotationRad).toBeCloseTo(Math.PI / 2, 10);
});
it('pxToDollUnits は itemPlacement の逆', () => {
  const l = computeLayout(landscape); const t = { x: 50, y: 50, scale: 1.3 };
  const u = pxToDollUnits(37, l, t);
  expect(itemPlacement(l, t, { offsetX: u, offsetY: 0, scale: 1, rotation: 0 }).x).toBeCloseTo(640 + 37, 10);
});
it('幅が足りない画面でも背景の大きさは負にならない', ...);  // width: 100 で size は 820 のまま、例外なし
```

- [ ] **Step 2: 失敗を確かめる** — Run: `npx vitest run src/tests/layout.test.ts` / Expected: FAIL（モジュールが無い）
- [ ] **Step 3: `src/render/layout.ts` を実装する**（式は `src/engine/PixiEngine.ts` の `getAvailableArea`・`getBackgroundCenter`・`drawDoll`・`drawClothing` と同じ）
- [ ] **Step 4: 通ることを確かめる** — Run: `npx vitest run src/tests/layout.test.ts` / Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "Add pure layout math for the stage"`

---

### Task 2: 色相変換

**Files:**
- Create: `src/render/hue.ts`
- Test: `src/tests/hue.test.ts`

**Interfaces:**
- Produces:

```ts
// PixiJS ColorMatrixFilter.hue(deg, false) と同じ 3x3 行列（行優先、9 要素）
export function hueMatrix(degrees: number): number[];
// RGBA 配列をその場で変換する。アルファは変えない
export function applyHue(pixels: Uint8ClampedArray, degrees: number): void;
```

  行列の式は `src/components/ItemAdjustPanel.tsx:19-44`（`createPixiHueMatrix`）の a00〜a22 をそのまま使う。

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('0 度は何も変えない', () => { /* [10,200,30,128] → 同じ */ });
it('アルファは変えない', () => { /* 任意の角度で 4 要素目が同じ */ });
it('120 度で赤が緑寄りになる（行列どおりの値）', () => {
  const m = hueMatrix(120);
  const px = new Uint8ClampedArray([255, 0, 0, 255]);
  applyHue(px, 120);
  expect(Array.from(px.slice(0, 3))).toEqual([m[0], m[3], m[6]].map((v) => Math.max(0, Math.min(255, Math.round(v * 255)))));
});
it('360 度は 0 度と同じ（誤差 1 以内）', ...);
it('結果は 0〜255 に収まる', ...);   // [255,255,0,255] を -90 度
it('グレーは色相を回しても変わらない（誤差 1 以内）', ...);  // [128,128,128,255]
```

- [ ] **Step 2: 失敗を確かめる** — Run: `npx vitest run src/tests/hue.test.ts` / Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確かめる** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "Add hue rotation matching the previous filter"`

---

### Task 3: 場面を描く関数

**Files:**
- Create: `src/render/scene.ts`
- Test: `src/tests/scene.test.ts`

**Interfaces:**
- Consumes: Task 1 の `Layout`・`dollCenter`・`itemPlacement`
- Produces: File Structure の型と

```ts
// ctx は CSS px の座標系に合わせ済み（呼び出し側が devicePixelRatio を setTransform する）
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene, layout: Layout, viewW: number, viewH: number): void;
```

  描く順: 全体を消去 → 背景（正方形に収まるよう `size ÷ max(幅, 高さ)` で拡縮、中央、正方形でクリップ）→ ドール → 服（配列の順）。各画像は `translate(中心)` → `rotate` → `scale` → `drawImage(image, box.x − canvasW/2, box.y − canvasH/2, box.w, box.h)`。`imageSmoothingQuality = 'high'`。1 枚の `drawImage` が例外を投げても、残りを描き続ける。

- [ ] **Step 1: 失敗するテストを書く**

  jsdom には Canvas が無いので、呼び出しを記録する偽の `ctx`（`save`/`restore`/`translate`/`rotate`/`scale`/`drawImage`/`clearRect`/`beginPath`/`rect`/`clip` を記録）を使う。

```ts
it('背景 → ドール → 服の順に描く', ...);            // drawImage に渡った image の順
it('切り抜き画像は元の位置に戻して描く', () => {
  // canvas 1024x1024、box {x:100,y:200,w:300,h:400} → drawImage(img, 100-512, 200-512, 300, 400)
});
it('ドールと服は同じ中心・同じ倍率で描く（調整なしのとき）', ...);  // translate と scale の引数が一致
it('服の調整（位置・拡大・回転）が反映される', ...);   // itemPlacement と同じ値で translate/scale/rotate
it('背景なし・ドールなし・服なしでも例外を出さない', ...);
it('1 枚の drawImage が失敗しても残りを描く', ...);  // 2 枚目で throw、3 枚目の drawImage が呼ばれる
it('save と restore の回数が一致する', ...);
```

- [ ] **Step 2: 失敗を確かめる** — Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確かめる** — Expected: PASS
- [ ] **Step 5: Commit** — `git commit -m "Add drawScene, the single stage renderer"`

---

### Task 4: 画像の読み込みと StageCanvas、App の切り替え

**Files:**
- Create: `src/render/imageStore.ts`, `src/components/StageCanvas.tsx`
- Modify: `src/App.tsx`（`AvatarCanvas` → `StageCanvas`、`pauseTimerRef` の effect を削除）, `src/components/index.ts`, `e2e/dressup.spec.ts`
- Delete: `src/components/AvatarCanvas.tsx`, `src/engine/PixiEngine.ts`, `src/tests/AvatarCanvas.test.tsx`
- Modify: `src/tests/setup.ts`（PixiJS のモックを削除）, `package.json`（`pixi.js` を削除）
- Test: `src/tests/imageStore.test.ts`, `e2e/dressup.spec.ts`

**Interfaces:**
- Consumes: Task 1〜3
- Produces（`src/render/imageStore.ts`）:

```ts
export interface LoadedImage { image: CanvasImageSource; width: number; height: number }
export interface ImageStore {
  load(url: string): Promise<LoadedImage | null>;              // 失敗は null（例外にしない）。同じ URL は同じ Promise
  loadHued(id: string, url: string, hue: number): Promise<LoadedImage | null>;  // hue 0 は load と同じ。1 つの id につき最後の hue の結果だけ保持
  retain(urls: string[]): void;                                // 渡した URL と直近 8 件以外を手放す
}
export function createImageStore(loader?: (url: string) => Promise<LoadedImage>): ImageStore;  // loader はテスト用の差し替え口
```

- Produces（`src/components/StageCanvas.tsx`）:

```ts
export interface AdjustDraft {
  itemId: string | null;                       // null はドールの調整
  item?: { offsetX: number; offsetY: number; scale: number; rotation: number; colorHue: number };
  doll?: DollTransform;
}
export interface StageCanvasHandle {
  setAdjustDraft(draft: AdjustDraft | null): void;   // 再レンダリングなしで描き直す
  takeScreenshot(): Promise<string | null>;
}
// props: width, height, equippedItems, dollImageUrl, backgroundImageUrl, dollTransform, menuOffset, rightOffset, isPortrait
```

  決まり:
  - `<canvas id="avatar-canvas" data-testid="avatar-canvas">` を保つ（ドロップ先の判定と E2E がこの ID を使う）。
  - 描くたびに `canvas.dataset.draws` を 1 増やす（E2E の計測用）。
  - props か下書きが変わったら「描画要求」を出す。要求は `requestAnimationFrame` で 1 フレームに 1 回にまとめる。
  - 描画は「必要な画像を全部読む → 最新の要求か確かめる → `drawScene`」の順。読み込み中に新しい要求が来たら、古いほうは描かずに捨てる（通し番号で判定）。
  - 調整中（下書きあり）: 対象の服は下書きの値で、配列の最後（一番手前）に描く。
  - `EquippedItem` → `SceneItem` の変換: `box` と元キャンバスの大きさは、この段階では画像全体（`{0, 0, 幅, 高さ}`）。`offsetX/Y` は `adjustOffsetX/Y`（Task 5 でドール基準に変換済み）。

- [ ] **Step 1: `imageStore` の失敗するテストを書く**

```ts
it('同じ URL を 2 回読んでも loader は 1 回', ...);
it('読み込み失敗は null を返し、次の呼び出しで再試行できる', ...);
it('hue 0 は元画像と同じ結果を返す', ...);
it('同じ id で hue を変えると、前の hue の結果を手放す', ...);   // 内部の保持数が id あたり 1
it('retain に無い URL は、直近 8 件を超えた分から手放す', ...);
```

- [ ] **Step 2: E2E を新しい描画に合わせて直す（先に失敗させる）**

  - 「ドラッグ中に服の再描画と保存が起きない」: console の文言ではなく `canvas.dataset.draws` がドラッグの前後で変わらないことを確かめる。
  - 追加「後から着せた服が最後に残る」: red を着せた直後（待たずに）blue を着せ、最終的に `TOP_Y` が青。
  - 追加「調整中の表示と確定後の表示が同じ」: 調整モードで 73px・41px 動かした時点の赤の中心（`colorCenter`）と、✓ を押した後の赤の中心が 0.5px 以内で一致。既存の「プレビューで置いた位置と…」のテストはこれに置き換える（CSS プレビューが無くなるため）。
  - 追加「色相: スライダーで色が変わり、確定後も同じ色」: 赤を着せ、色相を 120 にし、`TOP_Y` の色が Task 2 の行列どおり（±8）。✓ の後も同じ。

Run: `npm run test:e2e` / Expected: 上の 4 件が FAIL（`dataset.draws` が無い、など）。他は PASS

- [ ] **Step 3: `imageStore`・`StageCanvas` を実装し、`App` を切り替え、PixiJS 関連を削除する**

  `App.tsx` から Ticker の停止・再開（`pauseTimerRef` の effect）と `AvatarCanvasHandle` の `pauseRendering`/`resumeRendering` を削除する。`npm uninstall pixi.js`。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx tsc -b && npx eslint . && npx vitest run && npm run test:e2e`
Expected: 型エラーなし、ESLint エラー 0・警告 0（`AvatarCanvas.tsx` の警告 3 件はファイルごと消える）、ユニット・E2E 全件 PASS（調整関連の 2 件は Task 5 まで FAIL でよい）

- [ ] **Step 5: Commit** — `git commit -m "Render the stage with Canvas 2D and remove PixiJS"`

---

### Task 5: 調整パネルを下書き方式にし、調整値をドール基準の単位にする

**Files:**
- Modify: `src/components/ItemAdjustPanel.tsx`, `src/App.tsx`, `src/services/outfitStorage.ts`, `src/services/assetStorage.ts`（`getTransparentImage` を削除。`processChromaKeyTransparent` は取り込みが使うので残す）
- Test: `src/tests/outfitStorage.test.ts`, `e2e/dressup.spec.ts`

**Interfaces:**
- Consumes: Task 4 の `StageCanvasHandle.setAdjustDraft`、Task 1 の `pxToDollUnits`
- Produces:
  - `SavedOutfitEntry` に `unit?: 'doll'` を追加。`toSavedOutfit` は調整量がある項目に必ず `unit: 'doll'` を付ける。
  - `fromSavedOutfit(saved, available, toDollUnits: (px: number) => number)` — `unit` が無い項目の `adjustOffsetX/Y` を `toDollUnits` で変換する。
  - `ItemAdjustPanel` の props: `onDraftChange(draft: AdjustDraft | null): void` を追加。`canvasWidth`・`canvasHeight`・`menuOffset`・`rightOffset`・`dollImageUrl`・`isPortrait` は、指の移動量を単位に直すための `layout: Layout` と `dollTransform` に置き換える。

  決まり:
  - パネルは見た目を持たない（ボタンと色相スライダーだけ）。指・マウス・ホイールの操作で下書きを更新し、`onDraftChange` で `StageCanvas` に渡す。`App` はそれを `stageRef.current.setAdjustDraft` に中継する（`App` の state にしない）。
  - 指の移動量（CSS px）→ 服の調整量: `Δ ÷ (baseScale × ドールの倍率)`。ドールの移動は今と同じ（背景の一辺に対する %）。
  - 範囲: 服の位置は ±512（ドール基準の単位）、服の倍率 0.5〜2.0、ドールの位置 −50〜150%、ドールの倍率 0.3〜2.0、回転 −180〜180 度。
  - ✓ で確定（`onAdjust` / `onDollTransformChange`）し、下書きを `null` にする。↺ は初期値に戻す。
  - 色相スライダーは値が変わるたびに下書きを更新する（描画は 1 フレームに 1 回にまとまる）。

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('toSavedOutfit は調整量に unit: doll を付ける', ...);
it('fromSavedOutfit は unit の無い調整量を変換し、unit: doll のものは変換しない', () => {
  const out = fromSavedOutfit(
    [{ id: 'a', equipOrder: 0, adjustOffsetX: 72, adjustOffsetY: -36 }, { id: 'b', equipOrder: 1, adjustOffsetX: 10, unit: 'doll' }],
    [item('a'), item('b')], (px) => px / 0.72);
  expect(out[0].adjustOffsetX).toBeCloseTo(100); expect(out[0].adjustOffsetY).toBeCloseTo(-50);
  expect(out[1].adjustOffsetX).toBe(10);
});
```

  E2E 追加「旧形式の調整値で起動しても位置が変わらない」: red を着せて保存データを `[{id, equipOrder: 0, adjustOffsetX: 73, adjustOffsetY: 41}]`（`unit` なし）に書き換えて再読み込み → 赤の中心が `DOLL_X + 73`・`TOP_Y + 41`（±1px）。

  E2E 追加「ドールを拡大しても、調整した服はドールに付いたまま」: red を 73px 右へ調整 → リセットせず、保存データのドール倍率を 1.5 に書き換えて再読み込み → 赤の中心がドール中心から `73 × 1.5` px 右（±1px）。

- [ ] **Step 2: 失敗を確かめる** — Run: `npx vitest run src/tests/outfitStorage.test.ts && npm run test:e2e` / Expected: 追加分が FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確かめる** — Run: `npx tsc -b && npx eslint . && npx vitest run && npm run test:e2e` / Expected: すべて PASS、ESLint 警告 0
- [ ] **Step 5: Commit** — `git commit -m "Drive adjust mode through the stage renderer with doll-relative offsets"`

---

### Task 6: 写真

**Files:**
- Modify: `src/components/StageCanvas.tsx`
- Test: `e2e/dressup.spec.ts`

**Interfaces:**
- Consumes: Task 3 の `drawScene`、Task 4 の `ImageStore`
- Produces: `takeScreenshot(): Promise<string | null>` — 画面外のキャンバス（表示サイズ × `devicePixelRatio`、上限 2）に、必要な画像をすべて読み終えてから `drawScene` で描き、PNG の data URL を返す。横画面は背景の正方形を切り出し、縦画面は全体。調整中の下書きは含めない。

- [ ] **Step 1: 失敗するテストを書く**

  既存の「写真: ダウンロードされる PNG が空でない」を強める:

```ts
// red を着せ、背景を選んでから撮る
expect(info.width).toBe(info.height);                 // 横画面は正方形
expect(info.width).toBe(820);                          // 表示高さ × DPR(1)
// 写真の中央上寄り（服の位置）が赤、四隅のひとつが背景色
```

  追加「着せた直後に撮っても服が写る」: ドロップ直後（待たずに）写真ボタンを押し、服の位置が赤。

- [ ] **Step 2: 失敗を確かめる** — Expected: 追加分が FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4: 通ることを確かめる** — Run: `npm run test:e2e` / Expected: 全件 PASS
- [ ] **Step 5: Commit** — `git commit -m "Take screenshots through the same renderer"`

---

### Task 7: 計測・版数・記録

**Files:**
- Modify: `src/App.tsx`（`APP_VERSION` を `0.10.0`）, `README.md`（版数と更新履歴、技術スタックの PixiJS の記述）, この文書（末尾に計測結果）, `docs/superpowers/plans/2026-11-16-roadmap.md`（段階の順番）

- [ ] **Step 1: 設計書 2 章と同じ条件で測る**

  項目: JS 合計（gzip）、事前キャッシュ、起動直後の JS ヒープ、8 枚着た状態で 60 回ぶんドラッグしたときのフレーム時間（中央値・95%）と描画回数、調整モードで 60 回ぶん動かしたときのフレーム時間、着せてから画面に出るまでの時間。

- [ ] **Step 2: 合格条件と照合する**

  合格: `pixi.js` が `package.json` と `dist` に無い。JS 合計 gzip 130 KB 以下（JSZip が残るため。設計書の 100 KB は段階 1 後の値）。事前キャッシュ 600 KiB 以下。ドラッグ中の描画 0 回。調整モードのフレーム時間の中央値 17ms 以下（開発環境）。

- [ ] **Step 3: 見た目の比較**

  `preset-original/preset-template/doll-アニメ` を取り込み、同じ 8 枚の組み合わせの写真を、置き換え前（コミット `e3b25e5` 以降の PixiJS 版）と置き換え後で撮って並べ、位置・重なり順・輪郭の品質が同等であることを目で確かめる。差があれば原因を直す。

- [ ] **Step 4: 記録して Commit、作者に iPad での確認を依頼する**

  確認項目: (1) 8 枚以上着た状態で別の服をドラッグしても重くならない、(2) 調整中に見えている位置のまま確定される、(3) 色を変えた服が確定後も同じ色、(4) ドールを拡大縮小しても調整した服がずれない、(5) 別のアプリから戻っても表示が消えない、(6) 写真が保存できる。
