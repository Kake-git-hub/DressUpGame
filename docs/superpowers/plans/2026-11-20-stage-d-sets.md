# 段階 D: セット（v0.25.0） Implementation Plan

> 進め方: このプロジェクトの決まり（HANDOFF 5 章）どおり、セッション内で順に実装し、最後に別の目の全体レビューを 1 回かける。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 同じテーマで複数パーツを一括で作り（スタジオ）、ゲームでは「セット」を選ぶと全パーツが一度に着く。パーツは、ふつうの服として 1 点ずつ着られ、1 点ずつ消せる。Claude のキーが無くても、Gemini のキーだけで「テーマから作る」が使える。

**Architecture:** セットは素材の一覧の上の「印」だけ（ドールに `sets`、服に `set`）。絵・位置・重なりは、ふつうの服と同じ。企画は文章の AI に「カテゴリごとに 1 点、そろえた 1 組」を作らせ、画像は今までどおり 1 点ずつ作る。文章の AI は `TextAi` の形のまま、Gemini 版を足す。

**Tech Stack:** TypeScript、React 19、sharp、Vitest、Playwright、Gemini Interactions API（文章: `response_format` に `type: "text"`・`mime_type: "application/json"`・`schema`。2026-11-20 に本物で 1 回呼んで、返答の形を確かめた）。新しい依存は足さない。

**Spec:** `docs/superpowers/specs/2026-11-20-app-studio-portrait-sets-design.md` の 7 章

## Global Constraints

- テストを先に書き、失敗を見てから実装する。タスクごとにコミットする（作業ブランチ `claude/blissful-wozniak-9vofnl`）。
- 各タスクの終わりに `npx vitest run`・`npx tsc -b`・`npx eslint .`。E2E は `npm run build` のあと `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`。
- 一覧ファイルの新しい項目（`sets`・`set`）は、無くても読める。古い版のアプリは、知らない項目を読み飛ばす。いまある項目・ID・保存済みの服装は変えない。
- パーツが 1 点も残っていないセットは、一覧から消す。パーツが 1 点だけのセットは、そのまま出す。
- Claude のキーがあれば、文章の AI は今までどおり Claude。無ければ Gemini（既定のモデル `gemini-3.8-flash`、`STUDIO_GEMINI_TEXT_MODEL` で変えられる）。
- 画像生成は、最後の確認でセットを 1 組だけ（4 パーツ、最大 8 枚）。枚数を報告する。素材リポジトリへの書き込み・公開はしない。
- 画面の文言とコードのコメントは日本語。版数は `src/version.ts` と `README.md` を `0.25.0` に。

## Review Focus

1. **古い版のアプリ・古い一覧**: `sets`・`set` の無い一覧はそのまま読める。`set` が、`sets` に無い ID を指していても落ちない（その印を捨てる）→ Task 1 のテスト。
2. **パーツを消す・カテゴリを移す・セットから外す**: 最後の 1 点が無くなったら、セットも消える。ほかのドールの同じ名前のセットには触らない → Task 2 のテスト。
3. **企画が、頼んだカテゴリを落とす・同じカテゴリを 2 点返す**: 1 カテゴリ 1 点にそろえ、足りないカテゴリは注記して進む（落ちない）→ Task 4 のテスト。
4. **セットを着せるとき、すでに着ている服・髪（前髪とうしろがみ）・重ね着できるカテゴリ**: 1 点ずつ着せたのと同じ結果になる（同じカテゴリは入れ替わり、髪はうしろがみも付く）→ Task 6 のテスト。
5. **Gemini の文章の返答が JSON でない・断られた・上限**: 日本語の分かるエラーになる（落ちない）→ Task 3 のテスト。

---

### Task 1: 一覧ファイルに `sets` と `set`

**Files:** `src/content/manifest.ts`、`src/tests/manifest.test.ts`、`src/content/loadContent.ts`、`src/tests/loadContent.test.ts`、`src/types/index.ts`

**Interfaces（Produces）:**
- `ManifestSet { id: string; name: string }`、`ManifestDoll.sets?: ManifestSet[]`、`ManifestItem.set?: string`。
- `parseManifest`: `sets` は省略可（ID は重ならない）。`set` が `sets` に無い ID なら、その服の `set` を捨てる。空の `sets` は出さない。
- `ClothingItemData.setId?: string`・`setName?: string`（`loadContent` が付ける。うしろがみの分には付けない）。

- [ ] テスト（失敗を見る）→ 実装 → `vitest`・`tsc`・`eslint` → コミット。

### Task 2: 素材フォルダの編集（`ContentStore`）

**Files:** `tools/content/manifestEdit.ts`、`tools/content/manifestEdit.test.ts`

**Interfaces（Produces）:**
- `ItemInput.set?: { id: string; name: string }`: `addItem` は、その ID のセットがドールに無ければ作り、服に `set` を付ける。`replaceId` で差し替えるときは、指定があれば付け替え、無ければ今の `set` を残す。
- `updateItem(itemId, { …, set?: null })`: `null` でセットから外す。
- `renameSet(dollId: string, setId: string, name: string): Promise<ManifestSet>`（名前の決まりは服と同じ `checkPlainName`）。
- `newSetId(doll: ManifestDoll, name: string): string`（`<ドールの ID>/セット/<名前>`。重なれば `-2`…）。
- どの変更のあとでも、パーツの無いセットは `sets` から消す（`sets` が空になったら、項目ごと消す）。

- [ ] テスト → 実装 → コミット。

### Task 3: 文章の AI を Gemini でも

**Files:** `tools/studio/ai.ts`、`tools/studio/ai.test.ts`、`.env.example`

**Interfaces（Produces）:**
- `createGeminiText(apiKey: string, model: string, fetchImpl?: typeof fetch): TextAi`。`POST https://generativelanguage.googleapis.com/v1beta/interactions`、ヘッダーは画像と同じ（`x-goog-api-key`・`api-revision: 2026-05-20`）、本文は `{ model, system_instruction, input: [画像…, { type: 'text', text }], response_format: { type: 'text', mime_type: 'application/json', schema } }`。`schema` からは `additionalProperties` を取り除く（Gemini が受け付ける JSON Schema は一部だけ）。返答は、最後の `model_output` の `text` を JSON として読む。
- エラー: 401/403 → キー、429 → 利用制限（月の上限額は画像と同じ文）、内容の決まりで断られた → 422、JSON でない → 「読み取れませんでした」、文章が無い → 「返答がありませんでした」。どれも `AiError`。
- `createAiFromEnv`: `text` は `ANTHROPIC_API_KEY` があれば Claude、無くて `GEMINI_API_KEY` があれば Gemini の文章。

- [ ] テスト（偽の `fetch`）→ 実装 → 本物を 1 回（`planItems` を「アニメ　その２」で 2 点。画像は作らない）→ コミット。

### Task 4: セットの企画と API

**Files:** `tools/studio/generate.ts`、`tools/studio/generate.test.ts`、`tools/studio/api.ts`、`tools/studio/api.test.ts`、`src/studio/api.ts`

**Interfaces（Produces）:**
- `planSet(text: TextAi, doll: ManifestDoll, input: { theme: string; categories: string[]; style: string }): Promise<{ name: string; items: PlannedItem[]; missing: string[] }>`。頼んだカテゴリごとに 1 点（同じカテゴリの 2 点目は捨てる。カテゴリの順は頼んだ順）。`missing` は、返ってこなかったカテゴリのラベル。うしろがみのカテゴリは頼めない（除く）。セットの名前は、ひらがな・カタカナ 12 文字まで。
- `POST /api/plan`: `set: true` のとき、`categories`（2〜10 個）が必須で `count` は見ない。返すのは `{ items, set: { id, name }, missing, maxImages }`（`id` は `ContentStore.newSetId`）。
- `POST /api/jobs`: `set?: { id, name }` を受け取り、`GET /api/jobs` の返答に `set` として返す。
- `POST /api/items`: `set?: { id, name }` → `addItem`。`PATCH /api/items`: `set: null` → 外す。`PATCH /api/sets`: `{ dollId, id, name }` → `renameSet`。
- 画面側（`src/studio/api.ts`）: `planSet`、`startJob(dollId, items, styleId, set?)`、`Job.set?`、`addItem` に `set?`、`updateItem` に `set?: null`、`renameSet`。

- [ ] テスト → 実装 → コミット。

### Task 5: スタジオの画面

**Files:** `src/studio/Panels.tsx`、`src/studio/ItemCard.tsx`、`src/studio/studio.css`、`e2e/studio.spec.ts`

- 「テーマから作る」の「作るもの」に「セット」（`data-testid="target-set"`）。選ぶと、カテゴリのチェック欄（`data-testid="set-categories"`。最初は、かお・うしろがみ以外の全部。ドールごとに覚える）と、画像の最大枚数（カテゴリの数 × 作り直しの回数）が出る。枚数の欄は出さない。
- 候補のカードは今までどおり 1 点ずつ。カードにセットの名前を出し、保存すると `set` が付く。候補の上に「ぜんぶ保存」（`data-testid="save-all"`。まだ保存していない候補を、いまの名前・カテゴリで順に保存する。同じ名前の服があるカードは飛ばして、そのカードに知らせを出す）。
- 「一覧」: セットのある服に、セットの名前と「セットから外す」（`data-testid="leave-set"`）。一覧の上に、セットごとの名前の欄（変えると `renameSet`）と点数。
- 自動生成が使えないときの文を「GEMINI_API_KEY を設定してください（ANTHROPIC_API_KEY は無くても動きます）」に直す。

- [ ] E2E（差し替えた API。いまある `fakeJob` の形にならう）: セットを選ぶ → チェック欄 → 作る → 候補 2 点 → ぜんぶ保存 → 一覧に 2 点ともセットの名前 → 1 点を外す → もう 1 点を消すと、セットの欄が消える。
- [ ] 実装 → コミット。

### Task 6: ゲームのセット

**Files:** `src/components/DressUpMenu.tsx`、`src/App.tsx`、`src/App.css`、`src/hooks/useDressUp.ts`（必要なら）、`e2e/globalSetup.ts`（テスト用の素材にセットを 1 つ: トップス `red` とボトムス `green`）、`e2e/dressup.spec.ts`

- メニューの先頭にカテゴリ「セット」（セットのあるドールだけ）。セットのタイルは、パーツのサムネイルを 4 つまで並べた絵と名前（`data-testid="set-tile"`、`title` はセットの名前）。全部着ているセットに ✓。
- セットをドールへドラッグすると、パーツが全部着る（重なりの小さい順に 1 点ずつ着せたのと同じ。髪は、うしろがみも一緒）。光るのは着せた全部の服、音は 1 回。縦画面でも同じ（カテゴリの行に「セット」）。
- 3 つのタイル（服・背景・セット）のドラッグの処理は、1 つのフック（`useTileDrag`）にまとめる。

- [ ] E2E: 横で、セットのタイルをドラッグ → トップスとボトムスの両方が着る（画素）→ 保存に 2 点 → `blue` を着せるとトップスだけ替わる → セットのタイルの ✓ が消える。縦でも、セットをドラッグして 2 点とも着る。メニューの並びのテスト（いまある）に「セット」が先頭にあることを足す。
- [ ] 実装 → いまある E2E 全体 → コミット。

### Task 7: 版数・説明書・本物での確認

- [ ] 版数（`0.25.0`）、`README.md`（素材スタジオの説明、環境変数の表、更新履歴）、`HANDOFF.md`、設計書 7 章の末尾に「結果」。
- [ ] `vitest`・`tsc`・`eslint`・ビルド・E2E 全体（3 回）。
- [ ] 本物で 1 組: 素材フォルダの写しでスタジオを起動（`NODE_USE_ENV_PROXY=1 GEMINI_API_KEY=dummy`、Claude のキーなし）→「アニメ　その２」で、セット（トップス・ボトムス・くつ・ぼうし）を 1 組作る → ぜんぶ保存 → ゲームでセットを着せた写真。画像の枚数と、Gemini の検品が言ったことを記録する。
- [ ] 別の目（サブエージェント）の全体レビューを 1 回。指摘を直す。
- [ ] コミットして push、`main` に取り込み、公開サイトの版数を確かめる。
