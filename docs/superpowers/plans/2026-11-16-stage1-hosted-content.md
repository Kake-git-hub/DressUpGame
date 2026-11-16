# 段階 1: 配信方式への切り替え Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 服・ドール・背景の画像を別リポジトリ `DressUpGame-content` から配信し、iPad では開くだけで全アイテムが出るようにする。取り込み・IndexedDB・JSZip・設定画面・縦画面を削除する。

**Architecture:** 素材は「一覧ファイル（`manifest.json`）＋ハッシュ名の画像ファイル」。PC 側の移行スクリプトが今あるプリセットをこの形に変換する（縮小・背景の自動透過・切り抜き・サムネイル作成）。アプリは起動時に一覧ファイルを取得し、今の内部型（`DollData`・`ClothingItemData`・`BackgroundData`）に変換して既存の画面に渡す。描画は PixiJS のまま、切り抜き画像を元の位置に戻して描けるようにする。オフラインはサービスワーカーのキャッシュと起動後の先読みで支える。

**Tech Stack:** Vite 7、React 19、TypeScript（strict）、PixiJS 8、vite-plugin-pwa（Workbox）、sharp、tsx（スクリプト実行）、Vitest、Playwright

**Spec:** `docs/superpowers/specs/2026-11-15-lightweight-rework-design.md`（7.1、7.3、7.5 の横画面固定、10 章 3・4）

## Global Constraints

- 遊びを変えない。設計書 5 章「残す機能」が今までどおり動くこと（フォルダ取り込み・ZIP 取り込み・設定画面・縦画面は「なくなるもの」）。
- 今ある服の位置・大きさ・重なり順・メニューの並びを変えない。基準は今と同じ: 長辺が 1024px を超える画像だけ 1024px に縮小、ドールと服はキャンバスの中心合わせ、表示倍率は「表示高さ × 0.9 ÷ 1024」。
- 画質を落とさない。服とドールは WebP、背景は JPEG（品質 85）、サムネイルは長辺 192px の WebP。WebP は劣化なし（lossless）を既定とする。
- 配信 URL の既定は `https://kake-git-hub.github.io/DressUpGame-content/`。画像ファイル名には内容のハッシュを入れる。
- アイテムの ID は取り込み直しても変わらない（ドール・カテゴリ・名前から作る）。
- 端末に保存するのは小さな状態だけ（選択中のドール・背景、ドールの位置と倍率、着ている服の ID と調整値）。
- 旧データ（IndexedDB `DressUpAssets`、`localStorage` の `dressup_custom_*`・`dressup_doll_presets`）は新版の初回起動で削除する。着ていた服は引き継がない（ID が変わるため）。
- TypeScript strict、`any` を増やさない。API キーや秘密情報は扱わない。

## Review Focus

1. オフラインで初めて開く（キャッシュなし）→ 真っ白にせず、「インターネットにつないでね」と再試行ボタンを出す（Task 5）。
2. 一覧ファイルが壊れている・形が違う → 例外で落ちず、同じ案内を出す（Task 2、Task 5）。
3. 一覧にある画像 1 枚が 404 → その 1 枚だけ表示されず、他は遊べる（Task 5）。
4. 一覧が更新されて、着ていた服の ID が無くなった → その 1 枚だけ外れ、他は残る（段階 0 の動作を保つ。Task 5）。
5. 名前が同じ服が同じカテゴリに 2 つある（移行元の重複）→ ID が衝突せず、両方出る（Task 3）。

---

## File Structure

| ファイル | 変更 | 役割 |
|---|---|---|
| `src/pipeline/alpha.ts` | 新規 | 透明でない部分の外接矩形。純粋関数 |
| `src/pipeline/removeBackground.ts` | 新規 | 不透明な画像の、縁からつながる背景色を透明にする。純粋関数 |
| `src/content/manifest.ts` | 新規 | 一覧ファイルの型と検証 |
| `src/content/loadContent.ts` | 新規 | 一覧ファイルの取得と、アプリの型への変換 |
| `src/content/prefetch.ts` | 新規 | 起動後の先読み |
| `src/content/legacyCleanup.ts` | 新規 | 旧データの削除 |
| `tools/content/buildContent.ts` | 新規 | プリセットのフォルダ → 配信用の一覧と画像（sharp 使用） |
| `tools/content/migrate-preset.ts` | 新規 | 上をコマンドとして呼ぶ入口 |
| `src/types/index.ts` | 変更 | `ClothingItemData`・`DollData` に `box`・`canvasW`・`canvasH` を追加 |
| `src/engine/PixiEngine.ts`、`src/components/ItemAdjustPanel.tsx` | 変更 | 切り抜き画像を元の位置に描く |
| `src/App.tsx`、`src/components/DressUpMenu.tsx`、`src/App.css`、`index.html`、`vite.config.ts` | 変更 | 読み込み元の切り替え、縦画面の削除、横向き固定、キャッシュ設定 |
| `src/services/assetStorage.ts`、`src/components/SettingsPanel.tsx`、`preset-original/`、`preset-template/`、`scripts/optimize-images.py` | 削除 | |

一覧ファイルの形（`src/content/manifest.ts`）:

```ts
export interface Box { x: number; y: number; w: number; h: number }
export interface ManifestImage { file: string; canvasW: number; canvasH: number; box: Box }   // file は一覧ファイルからの相対パス
export interface ManifestCategory { id: string; label: string; layer: number; menuOrder: number; overlap: boolean; movable: boolean }
export interface ManifestItem { id: string; name: string; category: string; image: ManifestImage; thumb: string }
export interface ManifestBackground { id: string; name: string; file: string; thumb: string }
export interface ManifestDoll {
  id: string; name: string; image: ManifestImage;
  categories: ManifestCategory[]; items: ManifestItem[]; backgrounds: ManifestBackground[];
}
export interface Manifest { version: 1; dolls: ManifestDoll[]; backgrounds: ManifestBackground[] }  // backgrounds は全ドール共通
export function parseManifest(value: unknown): Manifest;   // 形が違えば Error を投げる
```

---

### Task 1: 画像処理の純粋関数

**Files:** Create `src/pipeline/alpha.ts`, `src/pipeline/removeBackground.ts` / Test `src/tests/pipeline.test.ts`

**Interfaces — Produces:**

```ts
// 透明でない（alpha > 8）画素の外接矩形。全部透明なら null
export function alphaBBox(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Box | null;
export function isFullyOpaque(rgba: Uint8ClampedArray | Uint8Array): boolean;   // 全画素 alpha >= 250
// 四隅の色を背景色とみなし、画像の縁からつながっている「背景色に近い画素」だけを透明にする（その場で書き換え）。
// 四隅の色が互いに離れている（距離 > 40）場合は何もせず false を返す
export function removeBorderBackground(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, tolerance?: number): boolean;  // tolerance 既定 60（RGB の距離）
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('alphaBBox: 中央の矩形を返す', ...);                 // 10x10、(2..5, 3..7) が不透明 → {x:2,y:3,w:4,h:5}
it('alphaBBox: 全部透明なら null', ...);
it('alphaBBox: alpha 8 以下は透明扱い', ...);
it('removeBorderBackground: 緑背景の中の赤い矩形だけが残る', ...);
it('removeBorderBackground: 服の内側にある背景色の島は残す', ...);   // 赤い枠の内側の緑は alpha 255 のまま
it('removeBorderBackground: 背景色に近い色（距離 60 以内）も消す、遠い色は残す', ...);
it('removeBorderBackground: 四隅の色がばらばらなら何もしない', ...);  // false、画素は変わらない
it('isFullyOpaque', ...);
```

- [ ] **Step 2:** Run `npx vitest run src/tests/pipeline.test.ts` — Expected: FAIL
- [ ] **Step 3: 実装する**（縁からの塗りつぶしは、再帰を使わずスタック配列で行う）
- [ ] **Step 4:** Expected: PASS
- [ ] **Step 5:** `git commit -m "Add pure image pipeline helpers"`

### Task 2: 一覧ファイルの型と検証

**Files:** Create `src/content/manifest.ts` / Test `src/tests/manifest.test.ts`

- [ ] **Step 1: 失敗するテストを書く** — 正しい一覧は同じ内容で返る／`version` が 1 でない・`dolls` が配列でない・アイテムの `id` が無い・`box` の数値が負や NaN・アイテムの `category` がそのドールの `categories` に無い、のそれぞれで Error／余分なキーは無視する／同じドール内で `id` が重複していたら Error。
- [ ] **Step 2:** Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Expected: PASS
- [ ] **Step 5:** `git commit -m "Add content manifest types and validation"`

### Task 3: 移行スクリプト

**Files:** Create `tools/content/buildContent.ts`, `tools/content/migrate-preset.ts` / Modify `package.json`（devDependency `tsx`、script `"content:migrate": "tsx tools/content/migrate-preset.ts"`）, `tsconfig.node.json`（`tools` を含める）/ Test `src/tests/buildContent.test.ts`（先頭に `// @vitest-environment node`）

**Interfaces — Produces:**

```ts
export interface BuildReport { dolls: number; items: number; backgrounds: number; warnings: string[] }
// presetDir: `doll-*/` を含むフォルダ。outDir に manifest.json と files/ を書く（outDir の manifest.json と files/ は作り直す）
export async function buildContent(presetDir: string, outDir: string): Promise<BuildReport>;
```

  決まり:
  - フォルダとファイル名の解釈は `src/types/index.ts` の `parseFolderName`・`parseClothingFileName`・`isMovableCategory`・`isOverlapCategory` を使う（今の取り込みと同じ規則。フォルダ方式とファイル名方式の両方）。どちらでも解釈できない服は、カテゴリ「アクセサリー」・重ね順 20 に入れ、警告に出す（今の動作と同じ）。
  - `_サムネ`・`_thumb`・`_thumbnail` で終わるファイルと `*.png~` は無視する（サムネイルは自動で作る）。
  - 1 枚の処理: 読む → 長辺が 1024 を超えるなら 1024 に縮小 → 服・ドールで全画素が不透明なら `removeBorderBackground`（成功したら警告に「背景を自動で透明にした」）→ `alphaBBox` で切り抜き → WebP（lossless）で書く → 切り抜いた画像から長辺 192px のサムネイル（WebP、品質 85）。全部透明な画像は飛ばして警告。
  - 今の取り込みが行う「右下 160px を消す」処理は、右下隅の近くに本体とつながっていない小さな塊（外接矩形の一辺が 80px 以下、かつ右下隅から 120px 以内に収まる）があるときだけ、その塊を消す。
  - 背景: 長辺 1024 に縮小、JPEG 品質 85、サムネイルは長辺 192px の JPEG。`doll-*/backgrounds/` はそのドール専用、ルートの `backgrounds/` は共通。
  - ファイル名: `files/<内容の SHA-1 の先頭 16 文字>.<拡張子>`。
  - ID: ドールは `doll-` を除いたフォルダ名。カテゴリはラベル。アイテムは `<ドール ID>/<カテゴリ ID>/<名前>`。同じ ID が出たら 2 つ目以降に `-2`、`-3` を付ける。
  - カテゴリの `layer`・`menuOrder` はフォルダ名（またはファイル名）の番号。`menuOrder` が無い場合は `layer` と同じ値。
  - 1 枚の失敗は、その 1 枚を飛ばして警告に出し、続行する。

- [ ] **Step 1: 失敗するテストを書く**

  テスト内で sharp で小さなプリセットを作り（`e2e/fixtures/makePreset.ts` と同じ絵柄を、フォルダとして書き出す関数 `writePresetDir(dir)` を `e2e/fixtures/makePreset.ts` に追加して共用する）、`buildContent` を実行して確かめる:

```ts
it('一覧ファイルが検証を通り、ドール 1・服 3・背景 1 が入る', ...);
it('服は切り抜かれ、box が元の位置を指す', ...);      // red: box {x:292,y:240,w:440,h:280}、canvasW/H 1024、書き出した画像は 440x280
it('カテゴリの重ね順・並び順がフォルダ名どおり', ...);  // トップス layer 4 menuOrder 1、ボトムス layer 3 menuOrder 2
it('不透明な緑背景の服は自動で透明になり、警告に出る', ...);
it('サムネイルは長辺 192px', ...);
it('同じ名前の服が 2 つあっても ID が衝突しない', ...);
it('壊れた画像は飛ばして警告に出し、他は処理する', ...);
it('同じ入力で 2 回実行すると同じ一覧ファイルになる', ...);  // ハッシュ名が安定
it('右下の小さな離れた塊は消え、右下まで続く絵柄は残る', ...);
```

- [ ] **Step 2:** Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b` — Expected: PASS
- [ ] **Step 5:** `git commit -m "Add preset-to-content migration script"`

### Task 4: アプリ側の読み込み

**Files:** Create `src/content/loadContent.ts` / Modify `src/types/index.ts` / Test `src/tests/loadContent.test.ts`

**Interfaces — Produces:**

```ts
export const DEFAULT_CONTENT_URL = 'https://kake-git-hub.github.io/DressUpGame-content/';
// ?content=<相対パス> があれば、ページと同じ場所からの相対として使う（http: や // で始まる値は無視して既定を使う）
export function resolveContentUrl(search: string, pageUrl: string): string;
export interface LoadedContent { dolls: DollData[]; clothing: ClothingItemData[]; backgrounds: BackgroundData[] }
export async function loadContent(baseUrl: string, fetchImpl?: typeof fetch): Promise<LoadedContent>;  // 取得・検証に失敗したら Error
```

  変換の決まり: `ClothingItemData.type` はカテゴリのラベル、`layerOrder`・`categoryOrder`・`allowOverlap`・`movable` はカテゴリから、`dollId` はドール ID、`imageUrl`・`thumbnailUrl` は絶対 URL、`baseZIndex` は `layer`、`position` は `{x:0,y:0}`。`ClothingItemData` と `DollData` に `box: Box`・`canvasW: number`・`canvasH: number` を必須で追加する。ドール専用の背景は `dollId` 付き、共通の背景は `dollId` なし。

- [ ] **Step 1: 失敗するテストを書く** — 変換結果の各フィールド／画像 URL が `baseUrl` 基準の絶対 URL／`resolveContentUrl` の 4 通り（指定なし・相対・`http:` 始まり・`//` 始まり）／HTTP 404 で Error／壊れた JSON で Error。
- [ ] **Step 2:** Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Expected: PASS（`tsc` は Task 5 まで他ファイルでエラーになってよい）
- [ ] **Step 5:** `git commit -m "Load hosted content into the app's data model"`

### Task 5: アプリの切り替えと削除

**Files:** Modify `src/App.tsx`, `src/components/DressUpMenu.tsx`, `src/engine/PixiEngine.ts`, `src/components/AvatarCanvas.tsx`, `src/components/ItemAdjustPanel.tsx`, `src/App.css`, `index.html`, `vite.config.ts`, `e2e/dressup.spec.ts`, `playwright.config.ts`, `package.json` / Create `src/content/legacyCleanup.ts` / Delete `src/services/assetStorage.ts`, `src/components/SettingsPanel.tsx`、`jszip`・`@types/jszip` の依存

  決まり:
  - 起動: `loadContent(resolveContentUrl(...))` → 成功で画面表示。読み込み中は「よみこみちゅう…」。失敗は「インターネットにつないでね」と「もういちど」ボタン（押すと再試行）。
  - 切り抜き画像の描画（`PixiEngine`）: ドールも服も、スプライトの原点を「元キャンバスの中心」に置く（`anchor` は 0、`pivot` を `(canvasW/2 − box.x, canvasH/2 − box.y)`）。位置・倍率・回転の計算は今のまま。
  - 調整プレビュー（`ItemAdjustPanel`）: 元キャンバスの大きさ（× 表示倍率）の枠を中心に置き、その中の box の位置に画像を置く。透過処理済み画像の取得（`getTransparentImage`）は削除し、配信画像をそのまま使う。
  - 縦画面: `isPortrait` と縦画面用のメニュー・スタイルを削除する。PWA の `orientation` を `landscape` にする。画面が縦長のときは、全面に「よこにしてね」と表示する。
  - 設定ボタンと設定画面を削除する。バージョン表示は残す。
  - `legacyCleanup.ts`: `cleanupLegacyData(): void` — `localStorage` の `dressup_custom_dolls`・`dressup_custom_clothing`・`dressup_custom_backgrounds`・`dressup_doll_presets`・`dressup_current_doll_id`・`dressup_current_background_id`・`dressup_outfit` を、目印 `dressup_content_v1` が無いときだけ削除し、`indexedDB.deleteDatabase('DressUpAssets')` を呼び、目印を書く。起動時に 1 回呼ぶ。
  - E2E: 取り込み操作をやめる。Playwright の `globalSetup` で `writePresetDir` → `buildContent` を実行して `dist/e2e-content/` に書き、各テストは `/DressUpGame/?content=e2e-content/` を開く。既存のテストは同じ内容を保つ（取り込みの部分だけ置き換え）。

- [ ] **Step 1: E2E を新しい起動方法に書き換え、追加のテストを書く（先に失敗させる）**

  追加: 「一覧ファイルが取れないとき、案内と『もういちど』が出て、押すと復帰する」（`page.route` で manifest を 1 回失敗させる）／「画像 1 枚が 404 でも他は遊べる」／「一覧から消えた服は、再読み込みでその 1 枚だけ外れる」／「旧データは初回起動で消える」（`dressup_custom_clothing` を置いて開く → 無くなる。2 回目の起動では `dressup_outfit` が消えない）／「縦長の画面では『よこにしてね』が出る」／「設定ボタンが無い」。

- [ ] **Step 2:** Run `npm run test:e2e` — Expected: FAIL
- [ ] **Step 3: 実装し、不要になったファイルと依存を削除する**
- [ ] **Step 4:** Run `npx tsc -b && npx eslint . && npx vitest run && npm run test:e2e` — Expected: すべて PASS、ESLint エラー 0
- [ ] **Step 5:** `git commit -m "Switch the app to hosted content; remove import, settings, and portrait layout"`

### Task 6: オフライン対応（キャッシュと先読み）

**Files:** Modify `vite.config.ts` / Create `src/content/prefetch.ts` / Modify `src/App.tsx` / Test `src/tests/prefetch.test.ts`, `e2e/dressup.spec.ts`

  決まり:
  - Workbox の `runtimeCaching`: URL が `/manifest.json` で終わる配信元のリクエストは `NetworkFirst`（タイムアウト 4 秒、キャッシュ名 `content-manifest`）。配信元の `files/` 以下は `CacheFirst`（キャッシュ名 `content-files`、`maxEntries` 3000、期限なし、`cacheableResponse` は status 0 と 200）。配信元の判定は「`/DressUpGame-content/` を含む、または同一オリジンの `e2e-content/` を含む」。既存の汎用画像キャッシュの設定は削除する。
  - `prefetchUrls(urls: string[], options?: { concurrency?: number; fetchImpl?: typeof fetch }): Promise<{ ok: number; failed: number }>` — 同時 4 本まで、失敗は数えるだけで例外にしない。
  - 起動して画面が出た 3 秒後に、現在のドールのドール画像・全アイテムの画像とサムネイル・背景を先読みする。ドールを切り替えたら、そのドールの分を先読みする。

- [ ] **Step 1: 失敗するテストを書く** — `prefetchUrls`: 同時実行が 4 を超えない／一部が失敗しても残りを取りに行き、件数を返す／空配列で即終了。E2E: 「一度開いた後は、オフラインでも開けて、まだ着ていない服も着られる」（開く → 先読みの完了を待つ（`window.__prefetchDone` を目印に公開）→ `context.setOffline(true)` → 再読み込み → 着せる → 色を確認）。
- [ ] **Step 2:** Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Run `npx vitest run && npm run test:e2e` — Expected: PASS
- [ ] **Step 5:** `git commit -m "Cache hosted content for offline play and prefetch the current doll"`

### Task 7: 本番の移行・比較・公開準備

**Files:** `DressUpGame-content` リポジトリ（`manifest.json`、`files/`、`.nojekyll`、`README.md`）/ Delete `preset-original/`, `preset-template/`, `scripts/optimize-images.py` / Modify `README.md`, `src/App.tsx`（`APP_VERSION` を `0.10.0`）, この文書（末尾に結果）

- [ ] **Step 1: 移行前の写真を撮る** — コミット `48078b1`（v0.9.7）をビルドし、`preset-original/preset-template/doll-アニメ` を取り込んで、決めた 3 通りの組み合わせ（ドレス 1 枚／顔・トップス・ボトムス・靴・帽子／重ね着可のアクセサリー 2 つを含む 8 枚）の写真を保存する。
- [ ] **Step 2: 本番の移行を実行する** — `npm run content:migrate -- preset-original/preset-template /home/user/dressupgame-content`。警告の一覧を記録する。
- [ ] **Step 3: 移行後の写真を撮り、並べて比べる** — 同じ 3 通りを新しいアプリ（`?content=` でローカルの出力を指定）で撮る。位置・大きさ・重なり順が一致し、輪郭の品質が同等であること。緑背景だった 4 点が透過されていること。差があれば原因を直してやり直す。
- [ ] **Step 4: 計測する** — 配信する画像の合計、JS 合計（gzip）、事前キャッシュ、起動直後の JS ヒープ、起動からメニュー表示までの時間。合格: 画像合計 40 MB 以下（lossless のため設計書の 25 MB より緩い。超える場合は品質を落とさない範囲で対策を検討し、作者に相談する）、IndexedDB を使っていない、`jszip` が依存に無い。
- [ ] **Step 5: 素材リポジトリに push し、アプリ側の不要物を削除して Commit**
- [ ] **Step 6: 作者に確認を依頼する** — 配信 URL で一覧ファイルが開けること、ブランチ版を iPad で開いて全アイテムが出ること、オフラインで開けること。確認後に `main` へマージする。

---

## 結果（2026-11-16）

条件: 本番ビルド、Chromium 1180×820、ソフトウェア描画。素材は `preset-original/preset-template`（ドール 2 体・服 91 点・背景 20 枚）を移行したもの。

| 項目 | 改修前（v0.9.6） | 段階 0 後 | 段階 1 後 |
|---|---|---|---|
| 素材の合計 | ZIP 61 MB → 端末内 83 MB | 同じ | 配信 15 MB（服・ドール 10.4 MB、背景 4.5 MB）。劣化なし |
| 端末内の IndexedDB | 83 MB | 83 MB | 使わない |
| 起動直後の JS ヒープ | 92 MB | 92 MB | 10 MB |
| 起動からメニュー表示まで（開発環境） | 1.4 秒 | 1.2 秒 | 0.2 秒 |
| JS 合計（gzip） | 272 KB | 272 KB | 約 239 KB（JSZip が無くなった分。残りは PixiJS） |
| PWA 事前キャッシュ | 3,844 KiB | 1,097 KiB | 968 KiB |
| テスト | — | ユニット 42・E2E 13 | ユニット 125・E2E 22 |

- **移行前後の比較**: 同じ組み合わせ 3 通りを v0.9.7 と新版で撮って重ねた。ドレス 1 枚、6 枚の組み合わせは、51 万画素中 2 画素の差（位置・大きさ・重なり順が一致）。8 枚の組み合わせは、緑背景のままだった「ショートヘア」「ショートパンツ」が透過された分だけが違い、他の服の位置は一致。
- **移行時の注意 15 件**: 緑背景の自動透過 4 点（ショートヘア、ショートパンツ、ロングスカート、赤いチェックのスカート）、右下の小さな塊の除去 11 点。
- **元画像に由来する粗**: 「ショートパンツ」のふちにマゼンタの細い線が残っている（元画像に描かれているもの。今回の処理では足していない）。
- **計画から変えた点**:
  - 同じカテゴリでも重ね順や重ね着可が服ごとに違うもの（ファイル名方式の服）があったため、一覧ファイルの服に `layer`・`overlap` の上書きを持てるようにした。
  - 「右下の小さな塊を消す」処理は独立した関数（`src/pipeline/removeCornerSpeck.ts`）にした。
  - 先読みは、サービスワーカーがページの通信を扱い始めるのを待ってから始める（待たないと、初回はキャッシュに入らないことがある）。
  - `preset-original/`・`preset-template/`・`scripts/optimize-images.py` の削除は、作者が iPad で新版を確認した後に行う（元画像を消す操作のため）。
- **未確認**: 配信 URL（`https://kake-git-hub.github.io/DressUpGame-content/manifest.json`）は、開発環境のネットワーク制限で開けなかった。iPad 実機での動作も未確認。
