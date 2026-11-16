# 段階 0: 安全網と即効修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 遊びを変えずに、ドラッグ中の無駄な再描画と保存データの肥大を止め、以後の改修を守るテストを用意する。

**Architecture:** 描画（PixiJS）と取り込み（IndexedDB）は段階 0 では触らない。React 側の 3 点だけを直す: 着ている服の配列を安定させる、保存を ID と調整値だけにする、ドラッグ中のプレビューを `App` の state から外す。先に E2E テストを現状の画面に合わせて作り直し、それを通したまま修正する。

**Tech Stack:** Vite 7、React 19、TypeScript（strict）、PixiJS 8、Vitest 4 + Testing Library、Playwright、sharp（テスト用画像の生成）、JSZip（テスト用 ZIP の生成）

**Spec:** `docs/superpowers/specs/2026-11-15-lightweight-rework-design.md`（2 章の実測、8 章の段階 0）

## Global Constraints

- 遊びを変えない。設計書 5 章「残す機能」がすべて今までどおり動くこと。
- 段階 0 では `src/engine/PixiEngine.ts` の描画方法、`src/services/assetStorage.ts` の取り込み処理、縦画面レイアウトを変更しない（段階 1・4 で置き換える）。
- 着ている服の保存データは 1 枚あたり 300 バイト以下。画像の URL・data URL を含めない。
- ドラッグ中、服の再描画は 0 回、`localStorage.setItem` は 0 回。
- TypeScript strict を保つ。`any` を新たに増やさない。
- コミットメッセージは英語、既存の履歴と同じ命令形。
- `main` には push しない。作業ブランチは `claude/peaceful-curie-f9y7n0`。

## Review Focus

1. 保存済みの服の ID が、取り込み直しで存在しなくなっている → その 1 枚だけ黙って外し、他は復元される（Task 3）。
2. 旧形式（画像 URL 入りの配列）の保存データが残っている端末で新版を開く → 例外を出さず、ID と調整値を引き継いで復元する（Task 3）。
3. `localStorage` の内容が壊れた JSON、または配列でない → 空の服装で起動する（Task 3）。
4. ドラッグが `pointercancel`（着信、システムジェスチャー）で終わる → 指に付いていたプレビューが消える（Task 4）。
5. 服の読み込み（IndexedDB）が終わる前の描画 → 空の服装が保存されて、復元前の保存データを上書きしてしまわない（Task 3）。

---

## File Structure

| ファイル | 変更 | 役割 |
|---|---|---|
| `e2e/fixtures/makePreset.ts` | 新規 | テスト用の小さなプリセット ZIP を生成する |
| `e2e/dressup.spec.ts` | 全面書き換え | 取り込み → 着せる → 調整 → 再読み込み → 写真、の通しテストと計測テスト |
| `playwright.config.ts` | 変更 | ビルド済みを `vite preview` で配信、Chromium のみ、WebGL をソフトウェア描画で有効化 |
| `src/hooks/useDressUp.ts` | 変更 | 並べ替え済みの配列を安定した参照で返す。復元用の関数を追加 |
| `src/services/outfitStorage.ts` | 新規 | 着ている服の保存形式（ID と調整値）の変換と読み書き |
| `src/services/stateStorage.ts` | 変更 | 服の保存・読み込み関数を削除（`outfitStorage.ts` に移す） |
| `src/components/DragPreviewLayer.tsx` | 新規 | 指に付いてくるサムネイル。React の state を使わず DOM を直接動かす |
| `src/App.tsx` | 変更 | 上記 3 点の接続、未使用コンポーネントの取り外し |
| `src/tests/*.test.ts(x)` | 変更・追加 | 上記のユニットテスト |
| 削除対象（Task 5 に一覧） | 削除 | 到達できないコンポーネント・サービス・画像 |

---

### Task 1: E2E テストを現状の画面に合わせて作り直す

**Files:**
- Create: `e2e/fixtures/makePreset.ts`
- Modify: `e2e/dressup.spec.ts`（全面書き換え）, `playwright.config.ts`, `package.json`（`test:e2e` を `npm run build && playwright test` に）

**Interfaces:**
- Produces:
  - `makePreset(outPath: string): Promise<void>` — 次の内容の ZIP を書き出す。画像はすべて 256×256 の PNG。
    - `doll-test/dolls/doll.png`: 中央に 96×200 の不透明な肌色 `#ffe0c0` の矩形、他は透明
    - `doll-test/clothing/04_1_トップス/red.png`: 中央上寄り（y=60〜130）に 110×70 の `#ff0000` の矩形
    - `doll-test/clothing/04_1_トップス/blue.png`: 同じ位置に `#0000ff`
    - `doll-test/clothing/03_2_ボトムス/green.png`: y=130〜200 に 110×70 の `#00a000`
    - `doll-test/backgrounds/bg.png`: 全面 `#ffff80`
  - E2E 共通ヘルパー（`e2e/dressup.spec.ts` 内）:
    - `importPreset(page): Promise<void>` — 設定ボタン → ZIP 入力に `makePreset` の出力を渡し、メニューにカテゴリが出るまで待つ
    - `dragItemToDoll(page, category: string, index: number): Promise<void>`
    - `canvasPixel(page, xRatio: number, yRatio: number): Promise<[number, number, number, number]>` — `#avatar-canvas` を 2D キャンバスに描き写して 1 画素を読む。座標はキャンバスに対する割合

- [ ] **Step 1: `playwright.config.ts` を書き換える**

  決定事項: `testDir: './e2e'`、`fullyParallel: false`、`workers: 1`、`reporter: 'list'`、`use.baseURL: 'http://localhost:4173'`、`use.viewport: { width: 1180, height: 820 }`、`use.launchOptions.args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader']`、projects は `chromium` のみ、`webServer: { command: 'npx vite preview --port 4173 --strictPort', url: 'http://localhost:4173/DressUpGame/', reuseExistingServer: true }`。

- [ ] **Step 2: `e2e/fixtures/makePreset.ts` を実装する**

  画像は `sharp({ create: { width: 256, height: 256, channels: 4, background: 透明 } }).composite([...])` で作り、`JSZip` で固める。

- [ ] **Step 3: 通しテストを書く**

```ts
test('取り込み → 着せる → 着替え → 再読み込みで復元', async ({ page }) => {
  await page.goto('/DressUpGame/');
  await importPreset(page);
  const before = await canvasPixel(page, DOLL_X, TOP_Y);      // 肌色
  await dragItemToDoll(page, 'トップス', 0);                    // red
  await expect.poll(() => canvasPixel(page, DOLL_X, TOP_Y)).toEqual([255, 0, 0, 255]);
  await dragItemToDoll(page, 'トップス', 1);                    // blue に着替え（同カテゴリは入れ替え）
  await expect.poll(() => canvasPixel(page, DOLL_X, TOP_Y)).toEqual([0, 0, 255, 255]);
  await dragItemToDoll(page, 'ボトムス', 0);
  await page.reload();
  await expect.poll(() => canvasPixel(page, DOLL_X, TOP_Y)).toEqual([0, 0, 255, 255]);
  await expect.poll(() => canvasPixel(page, DOLL_X, BOTTOM_Y)).toEqual([0, 160, 0, 255]);
  expect(before).not.toEqual([0, 0, 255, 255]);
});

test('タップだけでは着ない（現状の動作）', ...);            // タップ後 TOP_Y が肌色のまま
test('「なし」で脱げる', ...);                              // 着た後「✕ なし」→ TOP_Y が肌色に戻る
test('調整: 動かして完了すると位置が変わり、再読み込み後も保たれる', ...);
  // 調整ボタン → オーバーレイを右へ 120px ドラッグ → ✓ → 元の TOP_Y 位置が赤でなくなり、右へ 120px の位置が赤
test('背景を選ぶと背景色が出て、リセットで服と背景が外れる', ...);
test('写真: ダウンロードされる PNG が空でない', ...);       // download イベントを待ち、sharp で読み、中央付近の画素が透明でない
```

  `DOLL_X`・`TOP_Y`・`BOTTOM_Y` は、ドール中心（メニュー 160px・右 60px を除いた領域の中央、高さ 50%）と表示倍率（高さ × 0.9 ÷ 1024 … 256px 画像なので実寸は小さい）から計算した定数として、テスト冒頭に式で書く。色の比較は各成分 ±8 の許容で行うヘルパーにする。

- [ ] **Step 4: 計測テストを書く（今は失敗する）**

```ts
test('ドラッグ中に服の再描画と保存が起きない', async ({ page }) => {
  // 取り込み → red を着せる → blue を掴んで 40 回 move（まだ離さない）
  // 計測: move の間の console メッセージ「服コンテナをキャッシュしました」の件数、
  //       Storage.prototype.setItem を差し替えて数えた呼び出し回数
  expect(redraws).toBe(0);
  expect(setItemCalls).toBe(0);
});

test('着ている服の保存は 1 枚 300 バイト以下', async ({ page }) => {
  // 2 枚着せる → localStorage['dressup_outfit'] の長さ ÷ 2 <= 300
});
```

- [ ] **Step 5: 実行して、通しテストが通り、計測テスト 2 件が失敗することを確かめる**

Run: `npm run test:e2e`
Expected: 通しテスト 6 件 PASS、計測テスト 2 件 FAIL（再描画 39 回前後、キー `dressup_outfit` が無い）

- [ ] **Step 6: Commit**

```bash
git add e2e playwright.config.ts package.json
git commit -m "Rebuild e2e suite against the current UI with a generated preset"
```

---

### Task 2: 着ている服の配列を安定させる

**Files:**
- Modify: `src/hooks/useDressUp.ts`, `src/App.tsx:280-283`
- Test: `src/tests/useDressUp.test.ts`

**Interfaces:**
- Produces: `UseDressUpReturn.equippedItems: EquippedItem[]` — 重ね順に並べ替え済み。`state.equippedItems` が変わらない限り同じ配列参照を返す。`getEquippedItems()` は削除する。

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('再レンダリングしても equippedItems の参照が変わらない', () => {
  const { result, rerender } = renderHook(() => useDressUp(items));
  act(() => result.current.equipItem(items[0]));
  const first = result.current.equippedItems;
  rerender();
  expect(result.current.equippedItems).toBe(first);
});

it('equippedItems は layerOrder + layerAdjust、同値なら equipOrder の順', () => {
  // layerOrder 4 → 3 の順に着せ、結果が [3, 4]。3 側に layerAdjust: 100 を与えると [4, 3]
});
```

  既存テストの `getEquippedItems()` 呼び出しは `equippedItems` に置き換える。

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/tests/useDressUp.test.ts`
Expected: FAIL（`equippedItems` が undefined）

- [ ] **Step 3: `useDressUp` を直す**

  `const equippedItems = useMemo(() => [...state.equippedItems].sort(比較関数は現行と同じ), [state.equippedItems])` を返り値に加え、`getEquippedItems` を削除する。`App.tsx` は `const { equipItem, unequipItem, equippedItems, resetAll, updateItemAdjustment } = useDressUp(...)` に変える。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/tests/useDressUp.test.ts && npx tsc -b`
Expected: PASS、型エラーなし

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useDressUp.ts src/App.tsx src/tests/useDressUp.test.ts
git commit -m "Return a stable sorted equippedItems array from useDressUp"
```

---

### Task 3: 着ている服の保存を ID と調整値だけにする

**Files:**
- Create: `src/services/outfitStorage.ts`
- Modify: `src/services/stateStorage.ts`（`saveEquippedItems`・`loadEquippedItems`・`EQUIPPED_ITEMS` キーを削除）, `src/hooks/useDressUp.ts`, `src/App.tsx:276-288`
- Test: `src/tests/outfitStorage.test.ts`, `src/tests/useDressUp.test.ts`

**Interfaces:**
- Consumes: Task 2 の `equippedItems`
- Produces（`src/services/outfitStorage.ts`）:

```ts
export interface SavedOutfitEntry {
  id: string;
  equipOrder: number;
  adjustOffsetX?: number;
  adjustOffsetY?: number;
  adjustScale?: number;
  adjustRotation?: number;
  layerAdjust?: number;
  colorHue?: number;
}
export const OUTFIT_KEY = 'dressup_outfit';
export const LEGACY_OUTFIT_KEY = 'dressup_equipped_items';
export function toSavedOutfit(items: EquippedItem[]): SavedOutfitEntry[];
export function fromSavedOutfit(saved: SavedOutfitEntry[], available: ClothingItemData[]): EquippedItem[];
export function saveOutfit(items: EquippedItem[]): void;
export function loadOutfit(): SavedOutfitEntry[];
```

- Produces（`useDressUp`）: `restoreEquipped(items: EquippedItem[]): void` — 着ている服を丸ごと置き換え、`equipCounter` を最大の `equipOrder` + 1 にする。`useDressUp` の第 3 引数 `savedEquipped` は削除する。

- [ ] **Step 1: 失敗するテストを書く（`src/tests/outfitStorage.test.ts`）**

```ts
it('toSavedOutfit は ID・着た順・調整値だけを残す', () => {
  const saved = toSavedOutfit([{ ...item('a'), imageUrl: 'data:image/png;base64,' + 'A'.repeat(100000), equipOrder: 3, adjustScale: 1.2 }]);
  expect(saved).toEqual([{ id: 'a', equipOrder: 3, adjustScale: 1.2 }]);
  expect(JSON.stringify(saved).length).toBeLessThanOrEqual(300);
});
it('fromSavedOutfit は存在しない ID を黙って外し、他は復元する', () => {
  const out = fromSavedOutfit([{ id: 'a', equipOrder: 0 }, { id: 'gone', equipOrder: 1 }], [item('a'), item('b')]);
  expect(out.map(i => i.id)).toEqual(['a']);
  expect(out[0].imageUrl).toBe(item('a').imageUrl);
});
it('fromSavedOutfit は調整値を引き継ぐ', ...);            // adjustOffsetX: 12, colorHue: -40 がそのまま入る
it('loadOutfit は旧形式（画像 URL 入り）を変換し、旧キーを消して新キーに書く', () => {
  localStorage.setItem(LEGACY_OUTFIT_KEY, JSON.stringify([{ id: 'a', name: 'x', imageUrl: 'data:...', equipOrder: 2, adjustRotation: 15 }]));
  expect(loadOutfit()).toEqual([{ id: 'a', equipOrder: 2, adjustRotation: 15 }]);
  expect(localStorage.getItem(LEGACY_OUTFIT_KEY)).toBeNull();
  expect(localStorage.getItem(OUTFIT_KEY)).not.toBeNull();
});
it.each(['{broken', '"text"', '{"a":1}', '[1, null, {"equipOrder":1}]'])('loadOutfit は壊れた内容 %s で [] を返す', (raw) => {
  localStorage.setItem(OUTFIT_KEY, raw);
  expect(loadOutfit()).toEqual([]);
});
```

  `useDressUp.test.ts` に追加:

```ts
it('restoreEquipped 後に着せた服は、復元した服より後の equipOrder になる', () => {
  // restoreEquipped([{...a, equipOrder: 7}]) → equipItem(b) → b.equipOrder === 8
});
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/tests/outfitStorage.test.ts src/tests/useDressUp.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: `outfitStorage.ts` と `restoreEquipped` を実装する**

  `loadOutfit` の決まり: 新キーがあればそれを読む。無く旧キーがあれば変換して新キーに書き、旧キーを消す。配列でない・要素に文字列の `id` と数値の `equipOrder` が無いものは捨てる（要素単位ではなく、1 つでも不正なら全体を `[]`）。値が `undefined` の調整値は出力に含めない。

- [ ] **Step 4: `App.tsx` を接続する**

  決まり:
  - 起動時に `loadOutfit()` を 1 回読む（`useRef` に保持）。
  - 服の読み込み（`loadCustomData`）が終わったことを示す state `assetsLoaded` を追加する。
  - `assetsLoaded` が true になった最初の 1 回だけ、`restoreEquipped(fromSavedOutfit(saved, scaledItems))` を呼ぶ。
  - `saveOutfit(equippedItems)` を呼ぶ effect は、この復元が済むまで実行しない（復元前の空の服装で保存データを上書きしないため）。復元済みかどうかは `useRef` のフラグで持つ。
  - 既存の「装備が変わったら Ticker を再開 → 1 秒後に停止」の effect はそのまま残す（Task 2 により、装備が本当に変わったときだけ動くようになる）。

- [ ] **Step 5: 通ることを確かめる**

Run: `npx vitest run && npx tsc -b && npm run test:e2e`
Expected: ユニット全件 PASS。E2E は通しテスト 6 件と「保存は 1 枚 300 バイト以下」が PASS、「ドラッグ中に再描画と保存が起きない」は保存 0 回・再描画 0 回になっていれば PASS（再描画が残る場合は Task 4 で解消する）

- [ ] **Step 6: Commit**

```bash
git add src/services src/hooks/useDressUp.ts src/App.tsx src/tests
git commit -m "Persist the outfit as item ids and adjustments only"
```

---

### Task 4: ドラッグ中のプレビューを App の再レンダリングから外す

**Files:**
- Create: `src/components/DragPreviewLayer.tsx`
- Modify: `src/App.tsx:428-447, 489-494, 616-639`, `src/components/index.ts`
- Test: `src/tests/DragPreviewLayer.test.tsx`

**Interfaces:**
- Produces:

```ts
export interface DragPreviewHandle {
  move(imageUrl: string, clientX: number, clientY: number): void;  // 表示して位置を更新
  hide(): void;
}
export const DragPreviewLayer: React.ForwardRefExoticComponent<React.RefAttributes<DragPreviewHandle>>;
```

  `position: fixed` の `<img data-testid="drag-preview">` を 1 つ描き、`move` で `src`・`style.transform`・`style.display` を直接書き換える。見た目は現行と同じ（最大 120px、不透明度 0.8、影付き、`pointer-events: none`、中心が指の位置）。React の state は使わない。

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('move で表示され、指の位置に置かれる', () => {
  const ref = createRef<DragPreviewHandle>();
  render(<DragPreviewLayer ref={ref} />);
  const img = screen.getByTestId('drag-preview');
  expect(img.style.display).toBe('none');
  ref.current!.move('thumb.png', 300, 200);
  expect(img.style.display).not.toBe('none');
  expect(img.getAttribute('src')).toBe('thumb.png');
  expect(img.style.transform).toContain('300px');
  expect(img.style.transform).toContain('200px');
});
it('hide で消える', ...);
it('move を繰り返しても再レンダリングされない', ...);   // React.Profiler の onRender が初回の 1 回だけ
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/tests/DragPreviewLayer.test.tsx`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装し、`App.tsx` を接続する**

  `App` から `draggingPreview` の state と、その `<img>` の描画を削除する。`handleDragMove` は「位置が `avatarSectionRef` の矩形内なら `previewRef.current.move(item.thumbnailUrl || item.imageUrl, x, y)`、外なら `hide()`」にし、`handleDragEnd` と `handleItemDrop` は `hide()` を呼ぶ。3 つとも依存配列が変わらない `useCallback` にする（`DressUpMenu` 内の `memo` 済みアイテムが再レンダリングされないようにする）。

- [ ] **Step 4: `pointercancel` の E2E を追加して通す**

```ts
test('ドラッグが pointercancel で終わるとプレビューが消える', async ({ page }) => {
  // 取り込み → アイテムを掴んでドール上へ move → drag-preview が見える
  // → アイテム要素に dispatchEvent('pointercancel') → drag-preview が display: none、服は着ていない
});
```

Run: `npx vitest run && npm run test:e2e`
Expected: 全件 PASS（「ドラッグ中に服の再描画と保存が起きない」を含む）

- [ ] **Step 5: Commit**

```bash
git add src/components/DragPreviewLayer.tsx src/components/index.ts src/App.tsx src/tests e2e
git commit -m "Move the drag preview out of App state"
```

---

### Task 5: 到達できないコードと未使用の画像を削除する

**Files:**
- Delete:
  - `src/components/AIFaceGenerator.tsx`, `CategorySelector.tsx`, `ClothingItem.tsx`, `ClothingPalette.tsx`, `DollControlPanel.tsx`, `DraggableClothingItem.tsx`, `DrawingCanvas.tsx`, `EraserCanvas.tsx`, `ItemImporter.tsx`, `ItemManager.tsx`
  - `src/engine/ChromaKeyFilter.ts`, `src/engine/EdgeTrimFilter.ts`
  - `src/services/aiGenerator.ts`, `src/services/dataManager.ts`, `src/services/index.ts`
  - `src/tests/ClothingItem.test.tsx`
  - `public/assets/dolls/doll-base-1.png`, `public/assets/dolls/doll-base-2.png`, `public/vite.svg`, `public/pwa-192x192.svg`, `public/pwa-512x512.svg`, `src/assets/react.svg`
  - `preset-original/**/*.png~`（14 個）
- Modify: `src/components/index.ts`, `src/App.tsx`（`DrawingCanvas`・`EraserCanvas`・`isDrawingMode`・`isEraserMode`・`drawingCanvasRef`・`chromaKeyEnabled`・`DEFAULT_UNDERWEAR`・コメントアウトされた例を削除）, `src/components/AvatarCanvas.tsx`（`chromaKeyEnabled`・`setChromaKeyEnabled`・`isChromaKeyEnabled` を削除）, `src/engine/PixiEngine.ts:815-830`（空のメソッド 4 つを削除）, `vite.config.ts`（`includeAssets` から `assets/**/*` を外し、`globIgnores` に `**/app-icon.png` を残す）, `public/app-icon-512.png`・`public/app-icon-192.png`（再圧縮）

**Interfaces:**
- Consumes: Task 1 の E2E（削除後も全件通ることが合格条件）

- [ ] **Step 1: ファイルを削除し、参照を取り除く**

  `git rm` で上の一覧を削除する。`src/services/assetStorage.ts` の未使用部分は段階 1 でファイルごと置き換えるので、ここでは触らない。

- [ ] **Step 2: アイコンを再圧縮する**

  `sharp` で `public/app-icon-512.png` を 512×512・パレット PNG（`png({ palette: true, quality: 80 })`）に、`app-icon-192.png` を同様に書き直す。合格条件: 512 が 150 KB 以下、192 が 40 KB 以下。

- [ ] **Step 3: 確かめる**

Run: `npx tsc -b && npx vitest run && npm run test:e2e && npm run build`
Expected: すべて成功。ビルド出力の `precache` が 1000 KiB 未満

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Remove unreachable components, services, filters, and unused assets"
```

---

### Task 6: lint とテストの未処理エラーを解消する

**Files:**
- Modify: `src/tests/setup.ts`, `src/tests/AvatarCanvas.test.tsx`, `src/engine/PixiEngine.ts`, `src/services/assetStorage.ts`, `src/components/ItemAdjustPanel.tsx`, `src/App.tsx`

- [ ] **Step 1: 現状を記録する**

Run: `npx eslint . ; npx vitest run`
Expected（修正前）: ESLint のエラーが残る（Task 5 後は `setup.ts` の `any` 7 件、`PixiEngine.ts`、`assetStorage.ts`、`ItemAdjustPanel.tsx:264,267`、`App.tsx`）。Vitest は「Unhandled Rejection: this.app.render is not a function」を 1 件報告する

- [ ] **Step 2: 直す**

  決まり:
  - `src/tests/setup.ts` の PixiJS モックに `Application.render` を足し、`any` を具体的な型（`vi.fn()` の戻り値型やモック用インターフェース）に置き換える。
  - `ItemAdjustPanel.tsx:264,267` は「レンダリング中に ref へ代入」の指摘。`useEffect` 内での代入に変える（動作は変えない）。
  - 未使用変数・未使用引数は削除する。`eslint-disable` コメントで黙らせない。

- [ ] **Step 3: 確かめる**

Run: `npx eslint . && npx vitest run && npm run test:e2e`
Expected: ESLint エラー 0・警告 0、Vitest は Errors 行なしで全件 PASS、E2E 全件 PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Fix lint errors and the unhandled rejection in the canvas test"
```

---

### Task 7: 計測して記録する

**Files:**
- Modify: `docs/superpowers/plans/2026-11-16-stage0-quick-fixes.md`（末尾に結果を追記）

- [ ] **Step 1: 設計書 2 章と同じ条件で測る**

  本番ビルドを Chromium 1180×820（ソフトウェア描画）で開き、`preset-original/preset-template/doll-アニメ` を ZIP にして取り込む。測る項目: JS 合計（gzip）、PWA 事前キャッシュ、服を 1 枚着た状態で 40 回ぶんドラッグしたときの再描画回数と `localStorage` 書き込みバイト数、8 枚着たときの保存データの大きさ。

- [ ] **Step 2: 合格条件と照合する**

  合格: 再描画 0 回、書き込み 0 バイト、保存データ 8 枚で 2,400 バイト以下、事前キャッシュ 1 MB 未満。JS 合計と起動時メモリは段階 0 では変わらない見込みなので、数値の記録だけ行う。

- [ ] **Step 3: この文書の末尾に「計測結果」の表（設計書 2 章の値と今回の値）を追記し、Commit**

```bash
git add docs/superpowers/plans/2026-11-16-stage0-quick-fixes.md
git commit -m "Record stage 0 measurements"
```

- [ ] **Step 4: 作者に iPad での確認を依頼する**

  確認項目: (1) 服を着た状態で別の服をドラッグしても引っかからない、(2) 着せた服がアプリを閉じて開き直しても残る、(3) 調整した位置・大きさ・色が開き直しても残る、(4) リセットで服と背景が外れる、(5) 写真が保存できる。
