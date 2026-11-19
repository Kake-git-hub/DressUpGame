# 新ドールと部位の差し替え式生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 髪・帽子・靴・手袋を「ドールの一部の拡大図」に描かせ、靴と手袋は部位ごと差し替える方式にし、作りやすい姿勢の新ドールを 3 体目として用意する。

**Architecture:** 型紙の部位から「枠」（キャンバス上の範囲 → 生成画像の中の位置、の組）を作る。シルエット方式の品目（髪・帽子）は、枠の中だけの小さな型（DollTemplate）を作って既存の `processGenerated` に通し、結果を元のキャンバスに貼り戻す。差し替え式（靴・手袋）は、本物のドールの拡大図に描かせ、新しい `processSwap` で取り出す。ゲーム本体は既存の `hide`（ドールを隠すマスク）だけで足りる。

**Tech Stack:** TypeScript、sharp、vitest、Vite（スタジオ）、Gemini Interactions API（`tools/studio/ai.ts`）。

**Spec:** `docs/superpowers/specs/2026-11-19-new-doll-and-part-swap-design.md`（試行の素材: `docs/superpowers/specs/2026-11-19-spike/`）

## Global Constraints

- 既存のドール 2 体と服 102 点の画像・ID・保存済みの服装を変えない。
- 生成は 1 品目 1 枚（1K）。手袋を片手ずつにする場合だけ 2 枚（作者に報告）。
- 本物の画像生成は、このセッションで合計 50 枚まで（計画時点で 9 枚使用）。
- 配信画像は 1024px のキャンバスのまま。
- テストを先に書く。完了条件は `npx vitest run`・`npx tsc -b`・`npx eslint .`・E2E がすべて通ること。
- 本物の生成は `NODE_USE_ENV_PROXY=1`、`GEMINI_API_KEY=dummy` で呼ぶ。Claude API のキーは無い（企画と見た目の検品は人が代わる）。
- 報告と文書は日本語。版数は `src/App.tsx` の `APP_VERSION` と `README.md`。
- 素材リポジトリの公開は、作者が出来を見てから。

## Review Focus

1. AI が拡大図の枠をずらして・拡大して返す → 位置合わせ（`matchToReference`）で戻し、戻せないほど違えば警告（Task 3 のテスト「ずらした画像」）。
2. 靴の色が背景の単色に近い → 背景色は、品目の色・ドールの肌・下着の白から遠い色を選ぶ（Task 4 のテスト）。
3. 型紙の部位がキャンバスの端にあり、枠がはみ出す → 枠は作業用キャンバスの中に収める（Task 1 のテスト）。
4. 高解像度の元画像が無いドール（既存の 2 体） → 1024px から拡大して同じ道を通る（Task 2 のテスト）。
5. 差し替え式の候補を、スタジオで位置を微調整して保存 → 隠すマスクも同じだけ動く（Task 5 で画面の動きを確認）。

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/pipeline/frames.ts`（新） | 枠の計算（純粋関数）。`Tile`、`frameKind`、`frameTiles`、`swapZones` |
| `tools/studio/frame.ts`（新） | 枠の描画と貼り戻し（sharp）。`renderFrame`、`tileTemplate`、`pasteTile` |
| `tools/studio/processSwap.ts`（新） | 差し替え式の取り出し |
| `tools/studio/generate.ts` | 種類ごとの振り分け、指示文、検品。閉じた靴の決まりと `closeup` を外す |
| `tools/studio/api.ts` | 高解像度の型の読み込み、候補の `hide` の配信 |
| `src/studio/ItemCard.tsx`、`src/studio/api.ts` | 候補に `hide` があれば、それを使う |
| `tools/studio/dollPrompt.ts`、`tools/studio/makeDoll.ts`（新） | ドールの指示文と、候補生成・取り込みのスクリプト |
| `tools/studio/tryItems.ts`（新） | 品目を JSON で渡して本物の生成を回し、着せた画像を書き出すスクリプト（検品は人） |
| `tools/studio/fixtures/` | `swap-feet-ref.webp`、`swap-pumps.webp`、`swap-boots.webp`（試行の画像） |

削除: `src/pipeline/fillInside.ts`（とテスト）、`processGenerated` の `fillInside` オプション、`renderCloseups` と `GenerateContext.closeup`。

---

### Task 1: 枠の計算（`src/pipeline/frames.ts`）

**Interfaces — Produces:**

```ts
export interface Tile { from: Box; to: Box } // from: 作業用キャンバス上（正方形とは限らない）。to: 生成画像（1 辺 FRAME_SIZE）の中
export const FRAME_SIZE = 1024;
export type FrameKind = 'upper' | 'feet' | 'hands';
export function frameKind(label: string): FrameKind | null; // ヘア・ぼうし → upper、くつ → feet、てぶくろ → hands、ほかは null（顔は別扱い）
export function frameTiles(kind: FrameKind, parts: BodyParts, canvasW: number, canvasH: number): Tile[];
export function swapZones(kind: 'feet' | 'hands', parts: BodyParts): Box[]; // 差し替える範囲（足: feet の箱、手: handLeft / handRight の箱）
```

- upper: 1 枚。正方形。上端 = キャンバスの上端、下端 = `hips` の下端、頭の中心に左右をそろえる。
- feet: 1 枚。正方形。下端 = `feet` の下端 + ドールの高さの 6%、上端 = そこから `legs` の高さの 55% + `feet` の高さぶん上。左右は `feet` の中心。
- hands: 2 枚。各 `to` は 512×1024（左右に並べる）。`from` は縦横比 1:2 で、`arm` の下 55% と `hand` を含む。
- どの `from` もキャンバスの中に収める（はみ出すぶんはずらす）。

- [ ] テスト（`src/pipeline/frames.test.ts`）: 「アニメ」の型紙の値（`DressUpGame-content/studio/templates.json` の parts を 102px ずらしたもの、キャンバス 1228）で、各枠が (a) キャンバスの中、(b) `from` と `to` の縦横比が同じ（誤差 1%）、(c) upper が頭と腰を含む、feet が `feet` を含む、hands の 2 枚がそれぞれ左右の手を含む。部位が端にあるとき（`feet.y + feet.h === canvasH`）も (a) を満たす。`frameKind('くつした')` と `frameKind('ソックス')` は null。
- [ ] 失敗を確認 → 実装 → 通過を確認 → commit

### Task 2: 枠の描画と貼り戻し（`tools/studio/frame.ts`）

**Interfaces — Consumes:** `Tile`、`DollTemplate`。**Produces:**

```ts
// hi: 高解像度の型（無ければ doll と同じものを渡す）。scale = hi.canvasW / doll.canvasW
export function renderFrame(hi: DollTemplate, scale: number, tiles: Tile[], background: Rgb, silhouette: Rgb | null): Promise<Buffer>; // silhouette が null なら本物のドール
export function tileTemplate(hi: DollTemplate, scale: number, tile: Tile): Promise<DollTemplate>; // 枠の中だけの型（to の大きさ）
export function pasteTile(target: Uint8ClampedArray, canvasW: number, canvasH: number, tileRgba: Uint8ClampedArray, tile: Tile): Promise<void>; // to の大きさの絵を from の位置へ縮めて置く（上書きではなくアルファで重ねる）
export function toTile(box: Box, tile: Tile): Box; // キャンバス上の箱 → 枠の中の箱
```

- [ ] テスト（`tools/studio/frame.test.ts`）: 作った小さなドール（四角い胴と頭）で、`renderFrame` → 画像の大きさが 1024、枠の外に当たる画素が背景色、シルエット指定で前景が単色。`tileTemplate` の `mask` が `from` の範囲のドールと一致（面積の誤差 2%）。`pasteTile(tileTemplate.rgba)` が元の位置に戻る（外接矩形の誤差 2px）。scale 2 の型でも 1 の型でも同じ結果の大きさ。
- [ ] 失敗を確認 → 実装 → 通過を確認 → commit

### Task 3: 差し替え式の取り出し（`tools/studio/processSwap.ts`）

**Interfaces — Produces:**

```ts
export interface SwapResult extends ProcessResult { hide: Uint8Array } // hide: 作業用キャンバス大の不透明度。着ているあいだドールを隠す所
export function processSwap(generated: Buffer, reference: Buffer, doll: DollTemplate /* 作業用 */, tiles: Tile[], zones: Box[], background: Rgb): Promise<SwapResult>;
```

枠ごとに: 両方を `to` の大きさに読む → `matchToReference` で生成画像を元の図に合わせる → 背景（`background` に近い色）を透明に（ふちの色残りは `cutOutClothing` を `silhouette: null` で使う）→ zone の中は前景をすべて残し、zone の外は `diffMatte` の不透明度を掛ける → zone の境目から外側へ数 px は、肌の色を元のドールに合わせる（`matchSkin` と同じ比の直し）→ `pasteTile`。`hide` = zone の中のドールの不透明度。警告: 前景が無い → `empty`、zone の外で変わった画素の割合が上限（まず 0.5、本物で合わせる）を超える → `repainted`、位置合わせの倍率が 0.9〜1.1 の外 → `poor-fit`。

- [ ] 固定素材を置く: `docs/superpowers/specs/2026-11-19-spike/{feet_ref,shoe1,shoe2}.webp` → `tools/studio/fixtures/swap-feet-ref.webp`、`swap-pumps.webp`、`swap-boots.webp`。
- [ ] テスト（`tools/studio/processSwap.test.ts`）。固定素材のドールは、`feet_ref` を緑で抜いたものを枠 1 枚（`from` = キャンバス全体）として扱う:
  - パンプス: zone（下 35%）より上の、すねの画素のうちアイテムに入るのが 3% 未満。zone の中のアイテムは、生成画像の前景の 97% 以上。緑に近い画素（g − max(r, b) > 60）が不透明な所の 0.5% 未満。警告なし。
  - ブーツ: zone より上にもアイテムがある（ファーの高さの行に不透明な画素が 2000 以上）。警告なし。
  - `hide` が、zone の中のドールの画素を 99% 以上覆い、zone の外では 0。
  - 生成画像を 12px ずらして渡しても、アイテムの外接矩形が 3px 以内で一致（Review Focus 1）。
  - 元の図をそのまま渡す → `empty`。まったく別の絵（上下反転）→ `repainted` か `poor-fit`。
- [ ] 失敗を確認 → 実装 → 通過を確認 → commit

### Task 4: 生成への組み込み（`tools/studio/generate.ts`、`api.ts`）

**Interfaces — Consumes:** Task 1〜3。**Produces:** `Candidate.hide?: Buffer`（PNG、作業用キャンバス大）、`GenerateContext.hi: { template: DollTemplate; scale: number }`、`GET /api/jobs/image?kind=hide`、`GET /api/jobs` の `hasHide`。

- `generateCandidate` の振り分け: 顔 → いまのまま。`frameKind` が `feet` / `hands` → 本物の拡大図（`renderFrame(…, silhouette: null)`）+ `swapPrompt` + `processSwap`。`upper` → シルエットの拡大図 + いまの `itemPrompt`（「the upper half of」を足す）+ `tileTemplate` に対する `processGenerated`（`anchor` は `toTile(parts.head)`、`parts` は渡さない）→ `pasteTile` で `rgba`・`source`・`shape` を作業用キャンバスへ。ほか → いまのまま。
- 差し替え式の背景色: `chooseKeyColors([...品目の色, 肌の色, 白]).background`（Review Focus 2。`generate.test.ts` に、肌色と白と品目の色のどれからも遠い色が選ばれるテスト）。
- `swapPrompt(item, label, style, background, kind, feedback)`: 設計書 8 章の文を元にする。手袋は「左右 2 つの腕の拡大図が並んでいる。両方に同じ手袋を」と書く。
- 靴の「閉じた靴だけ」を 3 か所（`planItems`、`categoryRules`、検品）から外す。企画に「髪は腰まで」を足す。`WARNING_FIX.repainted` を差し替え式でも通じる文に。
- 高解像度の型: `studio/masters/<ドールの画像ファイル名の拡張子なし>.webp` があれば読む（ドールの `box` を整数倍した大きさ）。`api.ts` に `hiTemplate(doll)`。無ければ作業用の型をそのまま（scale 1）。
- 削除: `fillInside`、`closeup`、`renderCloseups`、`touchesHandsOrFeet`。
- 範囲の検品（`shareInsideRegion`）は、差し替え式では行わない（枠の中にしか描けない）。

- [ ] テスト（`generate.test.ts`、`api.test.ts`）: 偽の画像 AI が (a) 靴のカテゴリで受け取る画像が 1 枚・1024px 四方で、緑の背景に肌色がある（本物の拡大図）、(b) 固定素材のパンプスを返すと、候補が `hide` を持ち `passed` になる、(c) 髪のカテゴリで受け取る画像が 1024px 四方のシルエットで、候補の画像が作業用キャンバスの大きさ、(d) 既存のトップスの流れは変わらない（既存のテストが通る）。企画の指示文に `No sandals` が無い。
- [ ] 失敗を確認 → 実装 → 既存のテストの直し → 通過を確認 → commit

### Task 5: スタジオの画面

- `ItemSource.hideUrl` を足す。あれば、`ItemCard` は「手足の先を合わせる」の計算の代わりにその画像を `hideRef` に使い（微調整と一緒に動かす）、チェック欄は「足（手）を差し替える」1 つにする。
- [ ] E2E（`e2e/studio.spec.ts`）は既存が通ること。差し替え式の候補の保存は `api.test.ts` で、保存した品目に `hide` が付き、その外接矩形が足の範囲にあることを確かめる。
- [ ] 実装 → `npm run studio` を偽の素材で開き、候補のカードで隠す所が出ること、微調整で一緒に動くことを画面で確認 → commit

### Task 6: ドールづくりの道具（`tools/studio/dollPrompt.ts`、`makeDoll.ts`）

```ts
export function dollPrompt(background: Rgb): string; // 設計書 5.1 の条件（docs/…/2026-11-19-spike/doll-prompt.txt の改良版）
// npx tsx tools/studio/makeDoll.ts generate <見本画像> <出力フォルダ> <枚数>
// npx tsx tools/studio/makeDoll.ts import <候補画像> <素材フォルダ> <名前> [カテゴリを写すドールの ID]
```

`import`: 背景を抜く（`cutOutClothing`、`silhouette: null`）→ 外接矩形を、既存のドールと同じ余白（上 27px、下 19px 相当、高さ 978/1024）でキャンバスに収める → 1024 版を `ContentStore.addDoll`、整数倍（2 倍）版を `studio/masters/` に → カテゴリを写す。

- [ ] テスト（`tools/studio/makeDoll.test.ts`）: 試行のドール（`doll_new1.webp`）を一時フォルダへ `import` → manifest にドールが増え、`box` の高さが 978±2、master が 2 倍の大きさ、緑の画素が残らない（0.2% 未満）、カテゴリが 11 個。指示文に `#00FF00` と `5.5 heads` が入る。
- [ ] 失敗を確認 → 実装 → 通過を確認 → commit

### Task 7: 本物で確かめる（`tools/studio/tryItems.ts`）

- [ ] ドール候補（計 5 枚、生成済み）から 1〜2 枚に絞り、作者に見せて選んでもらう。**返事を待つあいだは、試行のドールを一時フォルダに取り込んで先へ進む。**
- [ ] `tryItems.ts`: 品目の JSON と素材フォルダを受け取り、`generateCandidate` を回す（見た目の検品は「検品できなかった」扱いで通す）。候補ごとに、着せた画像・切り抜き・生成元を書き出す。
- [ ] 手袋 1 点で「左右を 1 枚に」を確かめる。だめなら片手ずつに切り替え、設計書に追記。
- [ ] 靴 5・髪 5・手袋 3・顔 3・服（トップス・ボトムス・ドレス・ソックス）各 2 を生成（計 24 枚。失敗の作り直しは残りの枠の中で）。着せた画像を見て、取り出しのしきい値・枠の割合・指示文を直す。直したらテストに反映。
- [ ] 目標の確認: 靴 5 点・髪 5 点のうち、手直しなしで使えるものが各 4 点以上。結果の一覧画像を作者に送る。
- [ ] ゲームで新ドールを開き（`?content=`）、大きさ・位置・メニューとの重なり、靴をはいたときに足が差し替わることを画面で確認。

### Task 8: 仕上げ

- [ ] `README.md`（スタジオの説明、ドールの作り方）、`HANDOFF.md`、設計書の「状態」と結果の数値、版数（0.18.0）。
- [ ] 全テスト・型・lint・E2E。
- [ ] 別の目（サブエージェント）の全体レビュー 1 回 → 指摘を直す。
- [ ] `main` にマージして push。素材リポジトリは、作者の了承後に公開（セッションへのリポジトリ追加が要る）。
