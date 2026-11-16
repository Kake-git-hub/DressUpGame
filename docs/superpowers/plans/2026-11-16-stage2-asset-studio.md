# 段階 2: 素材スタジオ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PC で `npm run studio` を実行すると開く制作画面を作る。AI が作った画像を入れると、切り抜き・ドールへの位置合わせ・サムネイル作成まで自動で行い、カテゴリと名前を決めて保存・公開できる。

**Architecture:** 画像処理の本体は、画面を持たない純粋関数（`src/pipeline/`）にして、テストで固める。重い処理と書き込みは、PC 上の小さなサーバー（Vite の開発サーバーに API を足す）が sharp で行う。画面（React）は、結果のプレビュー・手直し・登録内容の入力だけを担当する。素材リポジトリのローカルの作業フォルダに直接書き込み、公開は git の commit と push で行う。ゲーム本体のビルドにはスタジオを含めない。

**Tech Stack:** Vite 7（開発サーバー＋API 用プラグイン）、React 19、TypeScript（strict）、sharp、Vitest、Playwright

**Spec:** `docs/superpowers/specs/2026-11-15-lightweight-rework-design.md`（4 章の試作結果、7.2 素材スタジオ、10 章 1・2）

## Global Constraints

- ゲーム本体（`npm run build` の出力）にスタジオのコードを含めない。本体の動作・見た目を変えない。
- 書き込み先は、指定された素材フォルダ（既定 `../DressUpGame-content`）の `manifest.json` と `files/` だけ。それ以外の場所を書き換えない。
- 書き出す一覧ファイルは、必ず `parseManifest` を通す（アプリが読めないものを書き出さない）。
- 画像の形式・基準は段階 1 と同じ: ドールのキャンバス基準（長辺 1024px）、服は切り抜いて WebP（劣化なし）、サムネイルは長辺 192px、背景は JPEG 品質 85、ファイル名は内容のハッシュ。
- すでにあるアイテムの ID を変えない。新しい ID は `<ドール ID>/<カテゴリ ID>/<名前>`、重複したら `-2`、`-3`。
- シルエットと背景の色は固定しない。画像から自動で検出する。服と色が近くて欠けが疑われるときは警告する（設計書 10 章 1）。
- API は `localhost` からの接続だけ受け付ける。ファイル名・ID に `..` や絶対パスを使った書き込みを拒否する。
- 公開（git push）は、画面のボタンを押したときだけ行う。
- TypeScript strict、`any` を増やさない。API キーや秘密情報は扱わない（自動生成は段階 3）。

## Review Focus

1. シルエットがドールと合わない画像（別のポーズ、切れている、シルエットが無い）→ 止まらずに「合い具合が悪い」と警告し、位置合わせなし（等倍・ずれなし）の結果を見せる（Task 2、Task 3）。
2. 服がシルエット色・背景色に近い（黒シルエットに紺の服）→ 欠けを警告する。黙って欠けた服を登録しない（Task 1、Task 3）。
3. 同じ名前の服がすでにある → 上書きせず、別の ID で登録する。上書きしたいときは明示的に選ぶ（Task 4、Task 6）。
4. 保存の途中で失敗する（ディスク、画像の破損）→ 一覧ファイルと画像が食い違った状態で残らない（一覧ファイルは最後に、一時ファイル経由で置き換える）（Task 4）。
5. 素材フォルダが git の作業フォルダでない・push に失敗する → 保存した内容は残り、何が起きたかを画面に出す（Task 8）。

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/pipeline/keyColors.ts` | 背景色とシルエット色の検出。純粋関数 |
| `src/pipeline/cutout.ts` | 背景とシルエットの除去、閉じ込められた背景の除去、ふちの色残りの除去、色の近さの判定。純粋関数 |
| `src/pipeline/align.ts` | シルエットの形でドールに位置・倍率を合わせる。純粋関数 |
| `tools/content/encode.ts` | RGBA → 切り抜き・WebP・サムネイル・ハッシュ名（`buildContent.ts` から切り出して共用） |
| `tools/content/manifestEdit.ts` | 一覧ファイルの編集（追加・改名・移動・削除・並び替え）と、使われなくなった画像の掃除。純粋関数＋ファイル操作 |
| `tools/studio/processGenerated.ts` | AI 画像 1 枚 → ドールのキャンバスに合わせた服（sharp ＋純粋関数） |
| `tools/studio/server.ts` | API（Vite プラグイン）。素材フォルダの読み書きと公開 |
| `tools/studio/fixtures/` | 作者のサンプル 3 枚（緑シルエット 2 枚、黒シルエット 1 枚）。テストの固定素材 |
| `studio/index.html`, `studio/src/*` | 制作画面（React） |
| `vite.studio.config.ts` | スタジオ用の開発サーバー設定 |
| `e2e/studio.spec.ts` | スタジオの通しテスト |

共通の型（`tools/studio/processGenerated.ts`）:

```ts
export interface KeyColors { background: [number, number, number]; silhouette: [number, number, number] | null }
export interface Alignment { scale: number; dx: number; dy: number; score: number }   // ドールのキャンバス（px）基準。score は 0〜1
export type WarningCode = 'no-silhouette' | 'poor-fit' | 'color-too-close' | 'empty' | 'touches-edge';
export interface ProcessResult {
  rgba: Uint8ClampedArray;      // ドールのキャンバスと同じ大きさ。服だけが残っている
  width: number; height: number;
  keyColors: KeyColors;
  alignment: Alignment;
  warnings: { code: WarningCode; message: string }[];   // message は日本語
}
```

---

### Task 1: 背景とシルエットの除去（純粋関数）

**Files:** Create `src/pipeline/keyColors.ts`, `src/pipeline/cutout.ts` / Test `src/tests/cutout.test.ts`

**Interfaces — Produces:**

```ts
// 背景色 = 画像の縁の画素の中央値。シルエット色 = 背景でない画素のうち、いちばん多い「ほぼ単色」のかたまりの色。
// そのかたまりが背景でない画素の 5% 未満なら silhouette は null
export function detectKeyColors(rgba: Pixels, width: number, height: number): KeyColors;

export interface CutoutMasks { background: Uint8Array; silhouette: Uint8Array }   // 1 = 該当。位置合わせに使う
// rgba をその場で書き換えて服だけを残す。消した領域のマスクを返す
export function cutOutClothing(rgba: Pixels, width: number, height: number, keys: KeyColors): CutoutMasks;

// 服として残った画素のうち、背景色またはシルエット色との距離が 45 未満のものの割合（0〜1）
export function closeColorRatio(rgba: Pixels, width: number, height: number, keys: KeyColors): number;
```

  `cutOutClothing` の決まり（設計書 4 章と 7.2 の「自動処理の決まり」）:
  1. 背景: 背景色との距離が 70 以下で、画像の縁からつながっている画素を消す。
  2. シルエット: シルエット色との距離が 28 以下の画素を消す。
  3. 閉じ込められた背景: 背景色との距離が 70 以下で、縁にはつながっていないが、消したシルエットに接しているかたまりを消す（首飾りの内側など）。服だけに囲まれたかたまりは残す（白いハイライト）。
  4. ふちの色残り: 消した領域から 2px 以内にあり、背景色またはシルエット色との距離が 110 以下の画素を消す。
  5. 最後にふちを 1px ぶん半透明にしてなじませる（alpha を近傍の平均にする）。

- [ ] **Step 1: 失敗するテストを書く**

  合成画像（白背景・緑シルエット・赤い服）で:

```ts
it('detectKeyColors: 白背景と緑シルエットを検出する', ...);          // background ≈ [255,255,255]、silhouette ≈ [0,255,0]
it('detectKeyColors: シルエットが無い画像（背景と服だけ）では null', ...);
it('detectKeyColors: マゼンタ背景・黒シルエットでも検出する', ...);
it('cutOutClothing: 背景とシルエットが消え、服だけが残る', ...);     // 服の中心は不透明で元の色、背景・シルエットの中心は alpha 0
it('cutOutClothing: 服の内側の白いハイライトは残る', ...);           // 服に囲まれた白い矩形 → alpha 255
it('cutOutClothing: シルエットに接する閉じた背景（首飾りの内側）は消える', ...);
it('cutOutClothing: ふちに混ざったシルエット色（中間色の 1px の帯）は消える', ...);
it('cutOutClothing: 服の中の、シルエットに近いが同じではない色（距離 60）は残る', ...);
it('closeColorRatio: 黒シルエットに紺（[20,25,45]）の服だと 0.5 を超える', ...);
it('closeColorRatio: 緑シルエットに赤い服だと 0', ...);
it('マスク: 消した背景とシルエットが 1 になっている', ...);
```

- [ ] **Step 2:** Run `npx vitest run src/tests/cutout.test.ts` — Expected: FAIL
- [ ] **Step 3: 実装する**（塗りつぶしは `removeBackground.ts` と同じく、再帰を使わない）
- [ ] **Step 4:** Expected: PASS
- [ ] **Step 5:** `git commit -m "Add key colour detection and silhouette cut-out"`

### Task 2: ドールへの位置合わせ（純粋関数）

**Files:** Create `src/pipeline/align.ts` / Test `src/tests/align.test.ts`

**Interfaces — Produces:**

```ts
export interface AlignInput {
  silhouette: Uint8Array; background: Uint8Array;   // 元画像の大きさ（Task 1 のマスク）
  width: number; height: number;
  doll: Uint8Array; dollWidth: number; dollHeight: number;   // ドールの不透明部分（1 = ドール）
}
// 元画像の点 p を、ドールのキャンバス上の p × (dollWidth / width) × scale + (dx, dy) に写す変換を探す。
// 探す範囲: scale 0.85〜1.15、ずれはドールのキャンバスの ±12%。
export function alignToDoll(input: AlignInput): Alignment;
```

  決まり:
  - 点数 = （ドールの内側にあるシルエット画素 − ドールの外側にあるシルエット画素 − ドールに重なる背景画素）÷ ドールの画素数。シルエットはドールの内側に、背景はドールの外側にあるべき、という条件。
  - まず長辺 128px に縮めたマスクで全体を探し、次に 512px で最良の近くを細かく探す。倍率は 0.002 刻み、ずれは 1024 基準で 1px 刻みまで詰める。
  - 等倍・ずれなしの点数と比べて改善が 0.01 未満なら、等倍・ずれなし（`scale: 1, dx: 0, dy: 0`）を返す（もともと合っている画像を動かさない）。
  - シルエットの画素数がドールの 3% 未満なら、探さずに等倍・ずれなしと `score: 0` を返す。

- [ ] **Step 1: 失敗するテストを書く**

  人型の合成マスク（頭・胴・腕・脚の矩形）をドールとし、それを服の矩形で一部隠したものをシルエットとする。

```ts
it('ずれていない画像は 等倍・ずれなし', ...);
it.each([[1.04, 23, -15], [0.96, -20, 12], [1.0, 30, 0], [1.08, 0, 0]])('倍率 %f・ずれ (%i, %i) を元に戻す', (s, dx, dy) => {
  // シルエットと背景を (s, dx, dy) で変形した画像を入力 → 返る変換で戻した位置が、倍率の誤差 1% 以内・位置 2px 以内
});
it('服が体の大半を隠していても（ドレス）、見えている頭と足で合わせる', ...);
it('シルエットが無ければ 等倍・ずれなし、score 0', ...);
it('別の形のシルエット（ドールと合わない）は score が 0.5 未満', ...);
it('元画像の大きさがドールの 2 倍でも同じ結果（2000px → 1024px）', ...);
it('1 回の位置合わせが 3 秒以内に終わる', ...);
```

- [ ] **Step 2:** Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Expected: PASS
- [ ] **Step 5:** `git commit -m "Add silhouette-based alignment to the doll"`

### Task 3: AI 画像 1 枚の処理（サンプルで確認）

**Files:** Create `tools/content/encode.ts`, `tools/studio/processGenerated.ts` / Modify `tools/content/buildContent.ts`（切り抜き・書き出しを `encode.ts` に移す。動作は変えない）/ Test `tools/studio/processGenerated.test.ts`

**Interfaces — Produces:**

```ts
// tools/content/encode.ts
export interface EncodedImage { image: ManifestImage; thumb: string }
// RGBA（キャンバス全体）を切り抜いて WebP とサムネイルを書く。全部透明なら null
export async function encodeCutout(rgba: Pixels, width: number, height: number, writer: FileWriter): Promise<EncodedImage | null>;

// tools/studio/processGenerated.ts
export interface DollTemplate { rgba: Uint8ClampedArray; canvasW: number; canvasH: number }   // ドールをキャンバス全体に戻した画像
export async function loadDollTemplate(contentDir: string, doll: ManifestDoll): Promise<DollTemplate>;
export interface ProcessOptions { nudge?: { scale: number; dx: number; dy: number } }   // 自動の位置合わせに重ねる手動の微調整
export async function processGenerated(input: Buffer, doll: DollTemplate, options?: ProcessOptions): Promise<ProcessResult>;
```

  `processGenerated` の流れ: 読む → `detectKeyColors` → `cutOutClothing` → `alignToDoll` → 元画像を変換してドールのキャンバス（`canvasW × canvasH`）に置く（sharp、lanczos）→ `removeCornerSpeck` → 警告を付ける。

  警告の決まり: シルエット色が null → `no-silhouette`（位置合わせなし。すでに切り抜き済みの透過 PNG はこの扱いで、警告は出さずにそのまま通す）／`alignment.score < 0.6` → `poor-fit`／`closeColorRatio > 0.05` → `color-too-close`／結果が全部透明 → `empty`／服の画素がキャンバスの端に接している → `touches-edge`。

- [ ] **Step 1: 失敗するテストを書く**

  ドールは `e2e` 用ではなく、サンプルに合う実物が必要なので、素材リポジトリの「アニメ」ドールの画像を `tools/studio/fixtures/doll-anime.webp` として置き、その位置情報をテスト内に書く。

```ts
it('緑シルエットの上下セット: 警告なし、服が残り、シルエットと背景が消える', ...);
  // 結果の不透明画素がドールの胴〜脚の範囲にあり、頭の位置（シルエットだった所）は透明。緑 [13,249,5] に近い不透明画素が 0.2% 未満
it('緑シルエットのドレス: 警告なし', ...);
it('ドレスを 4% 拡大して (46, -30) ずらした画像でも、ずらす前の結果とほぼ同じ位置になる', ...);  // 外接矩形の差が 4px 以内
it('黒シルエットに紺のスカート: color-too-close の警告が出る', ...);
it('すでに透過済みの PNG: 位置合わせなしでそのまま通り、警告なし', ...);
it('全面が単色の画像: empty の警告', ...);
it('nudge を渡すと、その分だけ結果が動く', ...);
it('壊れた入力は Error', ...);
```

  既存の `tools/content/buildContent.test.ts` が、切り出し後も全件通ること。

- [ ] **Step 2:** Expected: 追加分が FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Run `npx vitest run && npx tsc -b` — Expected: PASS。移行をやり直して、素材リポジトリの出力が変わらないこと（`git status` で差分なし）
- [ ] **Step 5: サンプル 3 枚の結果を、ドールに着せた画像として保存し、目で確かめる。** 設計書 4 章の「残った粗」（ふちの緑、首飾りの内側の白）が解消していること。解消していなければ Task 1 の決まりを調整し、テストに追加する
- [ ] **Step 6:** `git commit -m "Process a generated image into a doll-aligned clothing layer"`

### Task 4: 一覧ファイルの編集

**Files:** Create `tools/content/manifestEdit.ts` / Test `tools/content/manifestEdit.test.ts`

**Interfaces — Produces:**

```ts
export class ContentStore {
  constructor(contentDir: string);
  read(): Promise<Manifest>;
  addItem(dollId: string, input: { category: string; name: string; rgba: Pixels; width: number; height: number; replaceId?: string }): Promise<ManifestItem>;
  updateItem(itemId: string, change: { name?: string; category?: string; layer?: number | null; overlap?: boolean | null }): Promise<ManifestItem>;   // ID は変えない
  deleteItem(itemId: string): Promise<void>;
  upsertCategory(dollId: string, category: ManifestCategory): Promise<void>;
  reorderCategories(dollId: string, order: { id: string; layer: number; menuOrder: number }[]): Promise<void>;
  deleteCategory(dollId: string, categoryId: string): Promise<void>;   // 服が残っていれば Error
  addBackground(dollId: string | null, input: { name: string; data: Buffer }): Promise<ManifestBackground>;
  deleteBackground(id: string): Promise<void>;
  addDoll(input: { id: string; name: string; data: Buffer }): Promise<ManifestDoll>;
  removeUnusedFiles(): Promise<string[]>;   // 一覧から参照されていない files/ の画像を消す。消した名前を返す
}
```

  決まり: 変更のたびに `parseManifest` で検証し、`manifest.json.tmp` に書いてから置き換える。画像は一覧より先に書く。ID・ファイル名に `/` 以外の区切り（`..`、`\`、先頭の `/`）があれば Error。カテゴリの新規作成時、`id` はラベルを小文字にしたもの。

- [ ] **Step 1: 失敗するテストを書く** — 追加（新しい ID、box と画像、サムネイル）／同名の追加で `-2`／`replaceId` 指定で同じ ID のまま画像だけ差し替え／改名・カテゴリ移動で ID が変わらない／削除／服の残るカテゴリの削除は Error／並び替え／背景の追加（ドール専用・共通）と削除／ドールの追加／`removeUnusedFiles` が参照中の画像を消さない／不正な ID・名前（`../x`）は Error で何も書かれない／書き込み途中の失敗（検証エラー）で `manifest.json` が元のまま。
- [ ] **Step 2:** Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Expected: PASS
- [ ] **Step 5:** `git commit -m "Add manifest editing for the content store"`

### Task 5: スタジオのサーバー（API）

**Files:** Create `tools/studio/server.ts`, `vite.studio.config.ts` / Modify `package.json`（script `"studio": "vite --config vite.studio.config.ts"`）/ Test `tools/studio/server.test.ts`

**Interfaces — Produces（すべて `/api/` 以下、JSON。画像は `application/octet-stream` の本文または base64）:**

| メソッド・パス | 内容 |
|---|---|
| `GET /api/content` | `{ contentDir, manifest, git: { isRepo, branch, changedFiles } }` |
| `POST /api/process?doll=<id>[&scale=&dx=&dy=]` | 本文 = 画像。→ `{ png（base64、ドールのキャンバス大）, keyColors, alignment, warnings }` |
| `POST /api/items` | `{ dollId, category, name, png（base64）, replaceId? }` → 追加したアイテム |
| `PATCH /api/items` / `DELETE /api/items?id=` | 改名・移動・上書き設定 / 削除 |
| `PUT /api/categories` / `DELETE /api/categories` | 作成・更新・並び替え / 削除 |
| `POST /api/backgrounds` / `DELETE /api/backgrounds?id=` | 背景の追加 / 削除 |
| `POST /api/dolls` | ドールの追加（透過 PNG） |
| `GET /api/silhouette?doll=<id>&color=<rrggbb>&bg=<rrggbb>` | ドールの形を単色で塗った PNG（AI に渡す基準画像。2048×2048） |
| `POST /api/publish` | `{ message }` → 素材フォルダで `git add -A`・`git commit`・`git push` を実行し、出力を返す |
| `GET /content/*` | 素材フォルダの中身をそのまま返す（プレビューと、ゲーム本体での確認用） |

  決まり: 素材フォルダは環境変数 `CONTENT_DIR`、無ければ `../DressUpGame-content`。フォルダが無い・`manifest.json` が無い場合は、起動時に分かるメッセージを出して終了する。リクエストの `Host` が `localhost`・`127.0.0.1` 以外なら 403。エラーは `{ error: 日本語の説明 }` と 4xx/5xx。本文の上限は 30 MB。

- [ ] **Step 1: 失敗するテストを書く** — 一時フォルダに小さな素材を作り、API の関数を直接呼ぶ（HTTP サーバーを立てずに、リクエストとレスポンスを渡す形にする）: 各エンドポイントの正常系／存在しないドール・アイテムは 404／不正な入力は 400 で何も書かれない／`Host` が外部なら 403／`/content/../x` は 400／git の作業フォルダでない場合の `publish` は、保存内容を残したまま説明付きのエラー／`publish` 成功（一時的な bare リポジトリを push 先にして確かめる）。
- [ ] **Step 2:** Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Expected: PASS
- [ ] **Step 5:** `git commit -m "Add the studio API server"`

### Task 6: 画面 — 服を追加する

**Files:** Create `studio/index.html`, `studio/src/main.tsx`, `studio/src/App.tsx`, `studio/src/api.ts`, `studio/src/AddItems.tsx`, `studio/src/PreviewCanvas.tsx`, `studio/src/studio.css` / Test `e2e/studio.spec.ts`, `playwright.config.ts`（スタジオ用の project と webServer を追加）

  画面の決まり:
  - 上部: ドールの選択、「公開」ボタン、未公開の変更件数。
  - 「服を追加」: 画像を複数選ぶ（またはドロップ）と、1 枚ずつ処理して結果カードを並べる。
  - 結果カード: ドールに着せたプレビュー（ドール＋結果）、元画像との切り替え、警告の一覧、カテゴリの選択（既存から。新規作成も可）、名前（既定はファイル名）、「保存」「やり直す」「捨てる」。
  - 微調整: 矢印キーで 1px（Shift で 10px）、`+`/`-` で倍率 0.5%。変更すると `/api/process` を呼び直す。
  - 手直し: 消しゴムと復元ブラシ（太さ 3 段階）。復元は、切り抜き前の画像（位置合わせ済み）から戻す。微調整をやり直すと手直しは消える旨を表示する。
  - 警告のあるカードは、内容を確認するチェックを入れるまで保存できない。
  - 同じ名前の服がすでにある場合は「別の服として追加」「置き換える」を選ばせる。

- [ ] **Step 1: 失敗する E2E を書く** — テスト用の素材フォルダとサンプル画像でスタジオを起動し: 緑シルエットのサンプルを入れる → プレビューが出て警告なし → カテゴリと名前を入れて保存 → 一覧ファイルにアイテムが増え、画像ファイルがある／黒シルエットのサンプル → 警告が出て、確認するまで保存ボタンが押せない／同名の 2 回目は選択肢が出る／矢印キーでプレビューの位置が変わる／消しゴムで消した所が保存結果でも透明。
- [ ] **Step 2:** Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Run `npx tsc -b && npx eslint . && npm run test:e2e` — Expected: PASS。`npm run build` の出力にスタジオのコードが含まれないこと（`dist` に `studio` の文字列が無い）
- [ ] **Step 5:** `git commit -m "Add the studio screen for adding clothing"`

### Task 7: 画面 — 一覧の管理、背景、ドール、基準画像

**Files:** Create `studio/src/Library.tsx`, `studio/src/Categories.tsx`, `studio/src/Backgrounds.tsx`, `studio/src/Dolls.tsx` / Test `e2e/studio.spec.ts`

  決まり:
  - 一覧: カテゴリごとにサムネイルを並べる。服の改名・カテゴリ移動・削除（確認あり）。
  - カテゴリ: ドラッグで並び替え（メニューの順）。重ね順は数値で入力。重ね着可・自由配置の切り替え。
  - 背景: 画像を選んで追加（ドール専用か共通か）、削除。
  - ドール: 透過 PNG を選んで追加。追加後、基準画像（シルエット）を色を選んで書き出せる。色は「緑」「マゼンタ」「色を指定」。
  - 「ゲームで確認」: ゲーム本体を、ローカルの素材で開く（同じ開発サーバーで本体も配信し、`?content=content/` を付ける）。

- [ ] **Step 1: 失敗する E2E を書く** — 改名・移動・削除が一覧ファイルに反映される／カテゴリの並び替えと重ね着可の切り替え／背景の追加と削除／ドールの追加と基準画像のダウンロード（画像の中心が指定色）／「ゲームで確認」で開いたゲームに、追加した服が出る。
- [ ] **Step 2:** Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Expected: PASS
- [ ] **Step 5:** `git commit -m "Add library, category, background and doll management to the studio"`

### Task 8: 公開

**Files:** Modify `studio/src/App.tsx` / Create `studio/src/Publish.tsx` / Test `e2e/studio.spec.ts`

  決まり: 「公開」を押すと、未公開の変更（追加・変更・削除の件数）と、使われなくなった画像の数を表示する。「公開する」で、不要な画像の掃除 → commit → push。結果（成功、または git の出力そのまま）を表示する。push に失敗しても保存内容は残り、もう一度押せる。素材フォルダが git の作業フォルダでない場合は、ボタンを無効にして理由を出す。

- [ ] **Step 1: 失敗する E2E を書く** — 服を 1 つ追加 → 「公開」に変更 1 件と出る → 公開する → push 先（テスト用の bare リポジトリ）に commit が増える／push 先が無い場合は、エラーが表示され、追加した服は残っている。
- [ ] **Step 2:** Expected: FAIL
- [ ] **Step 3: 実装する**
- [ ] **Step 4:** Expected: PASS
- [ ] **Step 5:** `git commit -m "Publish content from the studio"`

### Task 9: 使い方の記載と記録

**Files:** Modify `README.md`（スタジオの起動方法と素材フォルダの置き方を 10 行程度）, この文書（末尾に結果）

- [ ] **Step 1:** サンプル 3 枚をスタジオで通し、結果の画像と、1 枚あたりの処理時間を記録する。
- [ ] **Step 2:** 全テスト・lint・ビルドを通し、ゲーム本体の JS の大きさが段階 1 と変わらないことを確かめる。
- [ ] **Step 3:** 作者に確認を依頼する — PC で `DressUpGame` と `DressUpGame-content` を同じ階層に置き、`npm run studio` で開く／手持ちの AI 画像を数枚入れて、切り抜きと位置合わせの出来を見る／1 点保存して「ゲームで確認」／公開して iPad に届くこと。

## 補足

- 削除した旧プリセット（`preset-original/`、`preset-template/` のプロンプト例を含む）は、コミット `a3c7b62` に残っている。説明書の段階でプロンプト例を移すときに参照する。
- テーマからの自動生成（段階 3）は、この段階の `processGenerated` と `ContentStore` をそのまま使う。
