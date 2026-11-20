# 髪と靴を「違いで取り出す」方式にする Implementation Plan

> 進め方: このプロジェクトの決まり（HANDOFF 4 章）どおり、セッション内で順に実装し、最後に別の目の全体レビューを 1 回かける。
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 髪と靴を、本物のドールの拡大図に描かせて元の図との違いで取り出す方式に替え、後ろ髪の汚い塗りつぶし・ズレ・足首の継ぎ目・靴下の切れ・汚いサムネイルを無くす。

**Architecture:** 画像処理は `src/pipeline/` の純粋関数（ブラウザでも動く）に置き、sharp を使う組み立てを `tools/studio/` に置く（いままでどおり）。髪は 1 枚の絵から「髪の全体」と「前の範囲」を作り、保存のときに前髪・後ろ髪・体の裏の塗りつぶしにする。靴は 1 枚の絵から「靴」「肌」「隠す所」を作り、ゲームは肌をドールのすぐ上に描き、隠す所を靴より下の服にも効かせる。

**Tech Stack:** TypeScript、sharp、Vitest、Playwright、PixiJS、React。新しい依存は足さない。

**Spec:** `docs/superpowers/specs/2026-11-20-hair-and-shoes-by-difference-design.md`（試作: `docs/superpowers/specs/2026-11-20-spike/`）

## Global Constraints

- テストを先に書き、失敗を見てから実装する。タスクごとにコミットする（作業ブランチ `claude/festive-brahmagupta-vpdsx2`）。
- 各タスクの終わりに `npx vitest run`・`npx tsc -b`・`npx eslint .` が通ること。E2E は Task 8・9・13 で回す（`npm run build` のあと `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`）。
- 画像生成は 1 品目 1 枚のまま。このセッションの合計は 25 枚まで（試作で 6 枚使用済み。残り 19 枚）。
- 2 倍の細かさでの保存はしない。ぼうし・てぶくろ・顔・服の作り方は変えない。
- 既存の品目の ID・保存済みの服装・一覧ファイルの既存の項目は変えない（新しい項目は、無くても読めること）。
- 新しい方式の髪で、体の外に、AI が描いていない色を足さない。
- コードのコメントと画面の文言は日本語（既存にそろえる）。版数は `src/App.tsx` の `APP_VERSION` と `README.md` を v0.20.0 に。
- 素材リポジトリへの書き込み・公開と、`main` への取り込みは、作者に確かめてから。
- 画像生成を呼ぶときは `NODE_USE_ENV_PROXY=1 GEMINI_API_KEY=dummy`。

## Review Focus

1. **肌に近い色の髪・靴**（うすいピンク、ベージュ）: 取り出しが欠けたら、黙って欠けた品目を出さず、警告（`color-too-close`）を出す → Task 3・5 のテスト。
2. **AI が絵をずらした・拡大した**: 位置合わせで戻し、戻せない大きさなら `poor-fit` を出す → Task 4・5 のテスト（固定素材を 20px ずらした入力）。
3. **髪が体の横にしか無い・頭の上にしか無い**（ショート、ポニーテール）: 塗りつぶしが体の外に出ない、前の層が空でも落ちない → Task 3 のテスト。
4. **古い一覧ファイル・古い品目**（`under`・`backThumb` が無い、四角い `hide`）: ゲームもスタジオもいままでどおり動く → Task 7・8 のテスト。
5. **靴・靴下を動かした、調整中**: 隠す所の決まり（設計書 5.3）どおりで、靴下が欠けたまま動かない → Task 8 のテスト。

---

## File Structure

| ファイル | 役割 |
|---|---|
| `src/pipeline/morph.ts`（新） | 2 値の絵の太らせ・細らせ・かたまり分け |
| `src/pipeline/smoothFill.ts`（新） | まわりの色をなめらかに広げて、範囲を塗る |
| `src/pipeline/edgeClean.ts`（新） | ふちに残った背景色の混ざりを取る |
| `src/pipeline/hairLayers.ts`（新） | 髪の取り出し、前後の分け、体の裏の塗りつぶし、サムネイル用の絵 |
| `src/pipeline/shoeLayers.ts`（新） | 靴・肌・隠す所の取り出し |
| `src/pipeline/hairSplit.ts`（変更） | 取り込んだ髪の塗りつぶしをなめらかな色に。`capeHair`・`paint` を削除 |
| `tools/studio/processHair.ts`（新） | 髪 1 枚の処理（位置合わせ → 取り出し → キャンバスへ戻す → 警告） |
| `tools/studio/processShoe.ts`（新） | 靴 1 枚の処理（同上） |
| `tools/studio/generate.ts`（変更） | 髪・靴の生成を新しい道へ。v0.19.0 のうしろがみの道を削除 |
| `tools/studio/api.ts`・`src/studio/api.ts`・`src/studio/ItemCard.tsx`（変更） | 候補の「前の範囲」「肌」の受け渡しと保存 |
| `tools/content/encode.ts`・`manifestEdit.ts`、`src/content/manifest.ts`・`loadContent.ts`、`src/types/index.ts`（変更） | 一覧ファイルの `under`・`backThumb` |
| `src/engine/hides.ts`・`PixiEngine.ts`、`src/components/PlacedItem.tsx`・`AvatarCanvas.tsx`（変更） | 肌の層、隠す所を下の服にも |
| `tools/studio/makeDoll.ts`（変更）、`tools/content/fixContent.ts`（新） | 輪郭線の緑、既存の素材への 1 回きりの処理 |
| `tools/studio/tryItems.ts`（変更） | 本物の生成の確認（肌・前の範囲・靴下つきの絵） |
| `tools/studio/fixtures/diff/`（新） | 試作の 6 組（`docs/.../2026-11-20-spike/*-gen.webp`・`*-ref.webp` を `git mv`） |

共通の型（Task をまたいで使う）:

```ts
// src/pipeline/alpha.ts に既存: Box, Pixels
// src/pipeline/keyColors.ts に既存: Rgb
export interface HairExtract {
  rgba: Uint8ClampedArray; // 髪の全体（塗りつぶしなし）。ふちの背景色は取ってある
  front: Uint8Array; // 前の範囲（0 / 255）
  unlike: number; // 後ろ髪 → ドール → 前髪と重ね直した絵が、AI の絵と違う画素の割合（0〜1）
  stray: number; // 髪から離れた所で、ドールが描き変えられた画素の割合（ドールの画素に対して）
  closeToSkin: number; // 髪に囲まれた「変わっていない」穴の割合（髪の画素に対して）
}
export interface ShoeExtract {
  shoe: Uint8ClampedArray; // 靴（ほかの服と同じ重なり）
  under: Uint8ClampedArray; // 肌（ドールのすぐ上）
  hide: Uint8Array; // 隠す所（0 / 255）
  drawn: number; changed: number; body: number; close: number; kept: number; cutOff: boolean; // 警告の材料（processSwap と同じ意味）
}
```

---

### Task 1: 共通の部品（かたまり分け、なめらかな塗り、ふちの色取り）

**Files:**
- Create: `src/pipeline/morph.ts`, `src/pipeline/smoothFill.ts`, `src/pipeline/edgeClean.ts`
- Test: `src/pipeline/morph.test.ts`, `src/pipeline/smoothFill.test.ts`, `src/pipeline/edgeClean.test.ts`
- Move: `docs/superpowers/specs/2026-11-20-spike/{h1-pink,h2-brown,h3-braids,s1-pumps,s2-sandals,s3-boots}-{gen,ref}.webp` → `tools/studio/fixtures/diff/`（`git mv`。設計書 2 章の置き場所の記述を直す）

**Interfaces:**
- Produces:
  - `dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array`、`erode(...)` 同じ引数（正方形の近傍。値は 0 / 1）
  - `components(mask: Uint8Array, width: number, height: number, visit: (pixels: Int32Array, count: number, touchesBorder: boolean) => void): void`（4 近傍）
  - `smoothField(rgba: Pixels, source: Uint8Array, width: number, height: number): Float32Array`（`source` が 1 の画素の色を、全画素へなめらかに広げた RGB。長さ `width*height*3`）
  - `fillSmooth(rgba: Uint8ClampedArray, region: Uint8Array, source: Uint8Array, width: number, height: number): void`（`region` の画素を、広げた色・不透明度 255 で上書きする）
  - `cleanKeyEdge(rgba: Uint8ClampedArray, width: number, height: number, key: Rgb, reach: number): void`

- [ ] **Step 1: テストを書く**（合成の小さな絵で）
  - `morph`: 1 点を `dilate(…, 2)` すると 5×5 になる。`erode(dilate(m,2),2)` は 1 点に戻る。`components` が 2 つのかたまりを別々に返し、端に触れるほうだけ `touchesBorder` が真。
  - `smoothFill`: 左半分が赤 (200,0,0)、右半分が青 (0,0,200) の 64×64 で、中央 16 列を `region` にして塗ると、(a) `region` の外の画素は 1 つも変わらない (b) `region` の各行で、R が左から右へ単調に減る (c) **縦にとなり合う画素の差が 3 以下**（横じまが無い）(d) 不透明度が 255。
  - `smoothFill`: `source` が 0 個でも例外を出さず、`region` を変えない。
  - `edgeClean`: 透明の右に、(82,84,28,255)（緑のまざった線）、(82,60,27,255)、肌 (254,214,190,255) が並ぶ行で、`cleanKeyEdge(…, [0,255,0], 3)` のあと、1 つ目の G が `(R+B)/2+8` 以下になり、肌と不透明度は変わらない。半透明の画素 (199,196,145,135) は、となりの不透明な線の色になり、不透明度は 135 のまま。
  - `edgeClean`: `key` が白 [255,255,255] のときは何も変えない。ふちから `reach` より遠い緑の画素（服の緑）は変えない。
- [ ] **Step 2: 失敗を見る** — `npx vitest run src/pipeline/morph.test.ts src/pipeline/smoothFill.test.ts src/pipeline/edgeClean.test.ts` → 関数が無くて FAIL
- [ ] **Step 3: 実装する**
  - `smoothField` は「重みつきで半分に縮めることを 1×1 までくり返し、戻りながら、色の無い所を粗い段の色（線形補間）で埋める」方法（試作 `lib.mts` の `pushPull`）。
  - `cleanKeyEdge` の決まり: 対象は、不透明度 128 未満の画素から `reach` px 以内で、不透明度が 0 でない画素。`key` の成分が 128 以上のチャンネルを「高」、未満を「低」とし、低が 1 つも無ければ何もしない。**暗い画素（最大の成分が 140 未満）か半透明の画素だけ**、高の各チャンネルを「低の平均 + 8」以下に切り下げる。そのあと、不透明度が 250 未満の対象の画素は、3 px 以内でいちばん近い不透明度 250 以上の画素の色にする（不透明度は変えない）。
- [ ] **Step 4: 通るのを見る** — 同じコマンドで PASS。`npx tsc -b` と `npx eslint .` も通す
- [ ] **Step 5: コミット** — `git commit -m "Pipeline: morphology, smooth fill and key-edge cleanup helpers; move spike images to fixtures"`

---

### Task 2: 取り込んだ髪の塗りつぶしを、なめらかな色に（v0.19.0 の 2 枚目の絵の道を外す・前半）

**Files:**
- Modify: `src/pipeline/hairSplit.ts`（`fillBehindBody` の、2 枚目の絵を使わないときの色）
- Test: `src/pipeline/hairSplit.test.ts`

**Interfaces:**
- Consumes: `fillSmooth`（Task 1）
- Produces: `splitHair` の引数と戻り値は変えない。`paint`（2 枚目の絵）を使う枝と `capeHair` は、このタスクでは触らない（Task 6 で、使っている `generate.ts` の側と一緒に消す）

- [ ] **Step 1: テストを書く** — `hairSplit.test.ts` に追加: 左の髪が赤、右の髪が青、あいだに体がある合成の絵で `splitHair` した `back` の、体の裏の範囲が (a) すべて不透明 (b) **縦にとなり合う画素の差が 3 以下**。既存の「埋める範囲」のテスト（体の外のすき間、腕と胴のあいだは埋めない、など）は、そのまま通ること。
- [ ] **Step 2: 失敗を見る** — `npx vitest run src/pipeline/hairSplit.test.ts` → 新しいテストが FAIL（行ごとの補間で、縦の差が出る）
- [ ] **Step 3: 実装する** — `fillBehindBody` の「どこを埋めるか」（体の下＋細いすき間、行ごとの区間）は変えず、「何色で埋めるか」だけを替える: 埋める画素を 1 枚の `region` に集め、`fillSmooth(back, region, source, …)` を 1 回呼ぶ。`source` は、不透明な髪のうち、ふちから `inset` px 内側で、髪の明るさの中央値 × 0.85 より明るい画素（輪郭線を除く）。該当が無ければ、不透明な髪の全部。
- [ ] **Step 4: 通るのを見る** — `npx vitest run` 全体（`api.test.ts`・`generate` 関連を含む）、`npx tsc -b`、`npx eslint .`
- [ ] **Step 5: コミット** — `git commit -m "Hair split: fill behind the body with a smooth colour field instead of row-wise smears"`

---

### Task 3: 髪の取り出し（純粋関数）

**Files:**
- Create: `src/pipeline/hairLayers.ts`
- Test: `src/pipeline/hairLayers.test.ts`（合成の絵）、`tools/studio/hairLayersReal.test.ts`（固定素材。`// @vitest-environment node`）

**Interfaces:**
- Consumes: Task 1 の全部、`cutOutClothing`（`src/pipeline/cutout.ts`）
- Produces:
  - `extractHair(image: Pixels, reference: Pixels, dollAlpha: ArrayLike<number>, width: number, height: number, background: Rgb): HairExtract`（`image` は位置合わせ済み・不透明。`dollAlpha` は同じ大きさのドールの不透明度 0〜255）
  - `fillUnderDoll(hair: Pixels, dollAlpha: ArrayLike<number>, width: number, height: number): Uint8ClampedArray`（髪の全体 → 体の裏を塗った後ろ髪）
  - `hairFromMask(hair: Pixels, front: ArrayLike<number>, dollAlpha: ArrayLike<number>, width: number, height: number): { front: Uint8ClampedArray; back: Uint8ClampedArray }`
  - `hairThumbs(front: Pixels, back: Pixels, dollAlpha: ArrayLike<number>, width: number, height: number): { hair: Uint8ClampedArray; back: Uint8ClampedArray }`
  - 定数（`export`）: `HAIR_SAME = 16`（これ以下の色の差は「変わっていない」）、`THUMB_BODY: Rgb = [226, 222, 236]`

- [ ] **Step 1: テストを書く（合成）** — 64×64、緑の背景、中央に肌色の四角（ドール）。
  - 「ドールの上に描いた髪は前、外の髪は後ろ」: ドールの上半分と、その左右の外に茶色を描いた `image` で、`front` はドールの上の茶色の所が 255、ドールから 6 px より遠い外の茶色は 0。`rgba` は茶色の所すべてで不透明、背景と変わっていない肌は透明。
  - 「体のふちの細い線は前にしない」: ドールの左のふちに幅 2 px の茶色がかかっただけの絵で、`front` がすべて 0。
  - 「`fillUnderDoll` は体の外に出ない」: 左右の外に髪がある絵で、戻り値の不透明な画素は「髪」か「`dollAlpha >= 128` の画素」だけ。左右の髪にはさまれた体の画素は不透明。髪の無い行の体は透明のまま。
  - 「髪が頭の上にしか無い」「髪が 1 つも無い」: 例外を出さない。後者は `rgba` が全部透明、`unlike` は 0。
  - 「肌に近い色」: ドールの上に、肌との色の差が 10 の四角（髪に囲まれていない）を描いても髪にならない。髪に囲まれた 80 画素以下の穴は髪になる。
  - `hairFromMask`: `front` が 255 の所だけが前に入り、`back` は `fillUnderDoll(hair)` と同じ。
  - `hairThumbs`: `back` の絵は、髪の外接矩形の中でドールの所が `THUMB_BODY` の不透明、外接矩形の外のドールは透明。`hair` はその上に前髪が重なる。
- [ ] **Step 2: テストを書く（固定素材）** — `fixtures/diff/h{1,2,3}-*`（背景: h1・h2 は [0,255,0]、h3 は [0,0,255]）。ドールの不透明度は、元の図（`-ref`）で背景色から遠い画素（`pixelDistance >= 70`）を 255 として作る。
  - 3 点とも `unlike < 0.02`、`stray < 0.01`。
  - 3 点とも、`fillUnderDoll` の結果で「髪でもドールでもない不透明な画素」が 0。
  - h3（三つ編み）: `front` の画素のうち、あごより下（y > 高さ × 0.32）にあるものが 5000 画素以上（三つ編みが前）。h1（ツインテール）: `front` は y < 高さ × 0.3 に 90% 以上。
  - h1（うすいピンク）: 前髪の帯（x 0.44〜0.56、y 0.24〜0.29）の 95% 以上が `rgba` で不透明。
- [ ] **Step 3: 失敗を見る** — `npx vitest run src/pipeline/hairLayers.test.ts tools/studio/hairLayersReal.test.ts` → FAIL
- [ ] **Step 4: 実装する** — 試作 `hair.mts` の手順を、テストに合わせて作り直す。決めてあること:
  - 色の差は、まわり 1 px の元の図のうち、いちばん近い色との距離。`HAIR_SAME` より大きければ「変わった」。
  - 外の髪は `cutOutClothing(…, { background, silhouette: null })` の結果。芯（半径 2）を持たないかたまりは捨てる。そのあと `cleanKeyEdge(rgba, …, background, 3)`。
  - ドールの上の髪: 40 画素未満のかたまりは捨てる。髪に囲まれた 80 画素以下の穴は埋める。
  - 前 = ドールの上の髪を「3 細らせて 6 太らせた」範囲と重なる所。150 画素未満のかたまりは捨てる。そこから 6 px 以内の外の髪も前に入れる。肌と接する前髪の画素は、色の差 12〜36 を不透明度 0.5〜1 に対応させる。
  - 塗る範囲 = ドール（不透明度 128 以上）で髪でない画素のうち、「同じ行で左右に髪がある」か「髪から 8 px 以内」。
  - これらの px は幅 1024 の絵での値。幅に比例させる（`Math.max(1, Math.round(v * width / 1024))`）。
- [ ] **Step 5: 通るのを見る** — 同じコマンドで PASS、`npx tsc -b`、`npx eslint .`
- [ ] **Step 6: コミット** — `git commit -m "Pipeline: extract hair by difference from the real doll; front mask, fill under the doll, thumbnails"`

---

### Task 4: 髪 1 枚の処理（位置合わせ → 取り出し → キャンバスへ → 警告）

**Files:**
- Create: `tools/studio/processHair.ts`
- Test: `tools/studio/processHair.test.ts`
- Modify: `tools/studio/processGenerated.ts`（`ProcessResult` に `front?: Uint8Array | null` を足す）

**Interfaces:**
- Consumes: `extractHair`（Task 3）、`matchToReference`、`pasteTile`・`pasteTileAlpha`・`tileTemplate`（`tools/studio/frame.ts`）
- Produces: `processHair(generated: Buffer, reference: Buffer, tileDoll: DollTemplate, tile: Tile, canvasW: number, canvasH: number, background: Rgb): Promise<ProcessResult & { front: Uint8Array }>`
  - `rgba` = 髪の全体（作業用キャンバス大）、`source` = 位置合わせ済みの AI の絵、`front` = 前の範囲（キャンバス大、不透明度）、`shape` = null、`alignment` = 位置合わせの結果。

- [ ] **Step 1: テストを書く** — 固定素材 h1 で（`tile` は 1024→1024 の恒等、`tileDoll` は元の図から作る）:
  - 警告が空。`rgba` に髪があり、`front` が `rgba` の不透明な所の内側にある。
  - **ずらした入力**: h1 の絵を右へ 20 px・下へ 12 px ずらして（空いた所は緑）渡すと、`alignment.dx`・`dy` が -20・-12 の ±2、取り出した髪の外接矩形が、ずらさない場合と ±3 px で一致。警告は空。
  - **拡大しすぎ**: h1 を 1.12 倍に拡大して中央を切り出した絵で `poor-fit` が出る。
  - **何も描かれていない**: 元の図そのものを渡すと `empty`。
  - **端に届く**: 絵の下の端まで茶色の帯を描き足すと `touches-edge`。
  - **描き直し**: 絵の下半分（髪から離れた腹のあたり）の肌に 60×60 の青い四角を描き足すと `repainted`。
- [ ] **Step 2: 失敗を見る** — `npx vitest run tools/studio/processHair.test.ts` → FAIL
- [ ] **Step 3: 実装する** — 警告の決まり: `empty`（髪の画素が枠の 1/1500 未満）、`poor-fit`（位置合わせの倍率が 0.93 以下か 1.07 以上。`processSwap` と同じ値）、`touches-edge`（髪が枠の左右・下の端から 1% 以内に届く）、`repainted`（`stray > 0.03` か `unlike > 0.05`）、`color-too-close`（`closeToSkin > 0.05`）。メッセージは日本語で、`processSwap.ts` の言い回しにそろえる。
- [ ] **Step 4: 通るのを見る** — PASS、`npx tsc -b`、`npx eslint .`
- [ ] **Step 5: コミット** — `git commit -m "Studio: process one hair picture drawn on the real doll"`

---

### Task 5: 靴の取り出しと、靴 1 枚の処理

**Files:**
- Create: `src/pipeline/shoeLayers.ts`, `tools/studio/processShoe.ts`
- Test: `src/pipeline/shoeLayers.test.ts`（合成）、`tools/studio/processShoe.test.ts`（固定素材 s1〜s3 と、既存の `swap-pumps.webp`・`swap-boots.webp`）

**Interfaces:**
- Consumes: Task 1、`cutOutClothing`、`matchToReference`、`pasteTile`、`toTile`、`ProcessWarning`
- Produces:
  - `extractShoe(image: Pixels, reference: Pixels, dollAlpha: ArrayLike<number>, width: number, height: number, background: Rgb, zoneTop: number): ShoeExtract`（`zoneTop` = 足首の線の y。それより下が差し替える範囲）
  - `processShoe(generated: Buffer, reference: Buffer, doll: DollTemplate, tiles: Tile[], zones: Box[], background: Rgb): Promise<SwapResult & { under: Uint8ClampedArray }>`（引数は `processSwap` と同じ。`rgba` = 靴、`under` = 肌（キャンバス大）、`hide` = 隠す所）
  - 定数: `SKIN_NEAR = 22`

- [ ] **Step 1: テストを書く（合成）** — 緑の背景、肌色の縦の帯（脚）と、その下に広がる肌色の四角（足）。`image` は、線より下を「赤い靴＋まん中に肌の開き」に描き替えたもの。
  - 開きの画素は `under` で不透明、`shoe` で透明。赤の画素は `shoe` で不透明、`under` で透明。
  - 線より上の、変わっていない脚は、`shoe` にも `under` にも入らない。線より上に描き足した赤い帯（ストラップ）は `shoe` に入る。
  - `hide` は、線より下で「靴＋肌」の外になる所だけ 255（元の足が靴より広かった所を含む）。靴＋肌の内側（ふちから 2 px より中）は 0。
  - `under` の上の端: 線の所で不透明度 0、10 px 下（幅 1024 換算）で元の不透明度。
  - 肌の色合わせ: `image` の肌を全体に (−1,−3,−5) ずらして渡すと、`under` の色が元の図の肌に ±1 で戻る。
  - 肌に囲まれた幅 2 px の暗い線（指の線）は `under` に入る。
- [ ] **Step 2: テストを書く（固定素材）** — s1（緑）・s2（青）・s3（緑）。ドールは元の図から。`zones` は `[{ x: 0, y: 760, w: 1024, h: 264 }]`（s 系の足首。画像を見て合わせる）、`tile` は恒等。
  - 3 点とも警告が空。位置合わせのずれ 0。
  - s1: `under` の不透明な画素が 3000 以上（甲の肌）。s3（ブーツ）: `under` の不透明な画素が 300 未満。
  - 3 点とも: 靴下に見立てた白い絵（ドールの不透明度 × 白）を「ドール（`hide` を消す）→ `under` →  白（`hide` を消す）→ `rgba`」と重ねた結果で、(a) 靴＋肌の外に白が無い (b) s1 の開きの中央の画素が白（靴下が靴の中に見える）。
  - 既存の `swap-pumps.webp`・`swap-boots.webp`（`swap-feet-ref.webp`、線 y=666）でも警告が空。
  - **肌色の靴**: s1 の赤い画素を肌の色に塗り替えた絵で `color-too-close` が出る。
  - **ずらした入力**（15 px）と **何も描かれていない**（`empty`）、**脚ごと描き直し**（`repainted`）は `processSwap.test.ts` の同名のテストを写して、新しい関数に向ける。
- [ ] **Step 3: 失敗を見る** — `npx vitest run src/pipeline/shoeLayers.test.ts tools/studio/processShoe.test.ts` → FAIL
- [ ] **Step 4: 実装する** — 試作 `shoes.mts` の手順を作り直す。決めてあること:
  - 肌の色 = 元の図のドールの画素の中央値。肌に近い = その色の 0.78〜1.03 倍のどれかとの距離が `SKIN_NEAR` 未満。
  - 肌 = 線より下で、背景でなく、肌に近い画素（60 画素未満のかたまりは捨てる）と、それを「3 太らせて 3 細らせた」中に入る線。
  - 靴 = 背景でなく、肌でなく、「線より下」か「線より上で、元の図と変わった」画素。芯（半径 2）の無いかたまりは捨てる。`cleanKeyEdge(…, background, 3)` をかける。
  - 色の差（`drift`）= 変わっていないドールの画素で、AI の絵 − 元の図 の中央値。`under` から引く。
  - `color-too-close` は、いまの条件に加えて「線より下の肌の画素が、線より下の前景の 85% 以上を占め、靴の画素がその 15% 未満」のときにも出す（靴が肌と見分けられなかった）。
  - 警告のしきい値と文言は `processSwap.ts` のものをそのまま使う（`REPAINT_LIMIT` など）。共通の定数は `processSwap.ts` から `export` して使う。
- [ ] **Step 5: 通るのを見る** — PASS、`npx tsc -b`、`npx eslint .`
- [ ] **Step 6: コミット** — `git commit -m "Studio: split a shoe picture into shoe, skin and a shaped hide mask"`

---

### Task 6: 生成の組みこみ（髪・靴を新しい道へ。v0.19.0 のうしろがみの道を削除）

**Files:**
- Modify: `tools/studio/generate.ts`, `src/pipeline/hairSplit.ts`（`capeHair`・`paint` の枝・`SEAM_WIDTH` を削除）, `src/pipeline/hairSplit.test.ts`（`paint`・`capeHair` のテストを削除）, `tools/studio/silhouette.ts`（`renderPreview` の `behind` はそのまま使う）, `src/pipeline/frames.ts`
- Test: `tools/studio/generate.test.ts`, `tools/studio/generateFrames.test.ts`, `tools/studio/hairCloseup.test.ts`, `tools/studio/api.test.ts`（v0.19.0 で足した、うしろがみのテストを直す）

**Interfaces:**
- Consumes: `processHair`（Task 4）、`processShoe`（Task 5）、`hairFromMask`（Task 3）
- Produces:
  - `Candidate` に `front?: Buffer`（前の範囲、PNG・不透明度）と `under?: Buffer`（肌、PNG）を足す
  - `frameKind(label)` の戻り値を `'hair' | 'upper' | 'feet' | 'hands' | null` に（髪は `'hair'`、ぼうしは `'upper'` のまま。`frameTiles` は `'hair'` を `'upper'` と同じ枠にする）
  - `hairPrompt(item, categoryLabel, style, background, feedback): string`（`export`。本文は `docs/superpowers/specs/2026-11-20-spike/h1-pink-prompt.txt` を元に、背景色の名前を差しこむ）

- [ ] **Step 1: テストを書く**（偽の画像 AI で。`generateFrames.test.ts` の作りにならう）
  - 髪の品目: AI に渡る画像が 1 枚で、ドールの肌の色を含む（単色の人形型ではない）。指示文に `blank face` と背景色の名前が入る。固定素材 h1 を返す偽の AI で、候補に `png`・`front` があり、`hide`・`under`・`shape` は無い。使った枚数は 1。
  - 靴の品目: 固定素材 s1 を返す偽の AI で、候補に `png`・`hide`・`under` がある。使った枚数は 1。
  - てぶくろ・ぼうし・顔・トップスの既存のテストは、変えずに通る。
  - うしろがみのカテゴリ: `planItems` の「使えるカテゴリ」に入らない。`generateCandidate` に渡すと、画像を作らずに `failed`、注記が「うしろがみは、髪型と一緒に作られます」。枚数は 0。
  - 見た目の検品に渡す絵（偽のテキスト AI が受け取る画像）は、後ろ髪 → ドール → 前髪で重ねたもの（画像の頭の横の画素が髪の色）。
  - 警告が出たら、`WARNING_FIX` の文を添えて 1 回だけ作り直す（既存の流れ。髪でも同じ）。
- [ ] **Step 2: 失敗を見る** — `npx vitest run tools/studio` → FAIL
- [ ] **Step 3: 実装する**
  - 髪の枝: `frameTiles('hair', …)` → `chooseBackground([...planned, ...avoid, skin, [255,255,255]])` → `renderFrame(hi.template, hi.scale, tiles, background, null)` → 生成 → `processHair(generated, reference, await tileTemplate(hi.template, hi.scale, tile), tile, canvasW, canvasH, background)`。`color-too-close` なら `avoid.push(background)`。
  - 靴の枝: `processSwap` を `processShoe` に替える（てぶくろは `processSwap` のまま）。
  - 見た目の検品の絵: 髪は `hairFromMask` で分けて `renderPreview(template, [front], undefined, [back])`。靴は、`hide` を消したドールに `under`、`rgba` の順。
  - 削除: `kind === 'backhair'` の枝、`completeBackHair`、`backHairRevealPrompt`、`withoutKeyColors`、`KEY_DISTANCE`、`frontOnly` の引数と文、`categoryRules` の `'backhair'`、髪の `itemPrompt` の文（`isHairCategory`・`isBackHairCategory` の枝）、`capeHair`。`categoryKind` の `'backhair'` は残し、上の「作らない」判定に使う。`isBackHairCategory`・`splitsHair` は残す（保存とカードが使う）。
  - 企画の指示（`planItems`）: 髪の注記は「hairstyle only: hair and bangs, no longer than the hips. Never any facial features.」の 1 種類に戻す。靴のカテゴリに「Shoes must not be skin-coloured (no beige, nude or peach shoes).」を足す。
- [ ] **Step 4: 通るのを見る** — `npx vitest run`、`npx tsc -b`、`npx eslint .`
- [ ] **Step 5: コミット** — `git commit -m "Studio: generate hair and shoes on the real doll and take them by difference; drop the separate back-hair path"`

---

### Task 7: 一覧ファイルと保存（`under`、`backThumb`）

**Files:**
- Modify: `src/content/manifest.ts`, `tools/content/encode.ts`, `tools/content/manifestEdit.ts`, `tools/studio/api.ts`, `src/studio/api.ts`
- Test: `src/tests/manifest.test.ts`, `tools/content/manifestEdit.test.ts`, `tools/studio/api.test.ts`

**Interfaces:**
- Consumes: `hairFromMask`・`hairThumbs`（Task 3）、`Candidate.front`・`under`（Task 6）
- Produces:
  - `ManifestItem.under?: ManifestImage`（ドールのすぐ上に描く分）、`ManifestItem.backThumb?: string`（うしろがみのサムネイル）
  - `encodeThumb(rgba: Pixels, width: number, height: number, writer: FileWriter): Promise<string | null>`
  - `ItemInput.under?: Pixels | null`、`ItemInput.backThumbFrom?: Pixels`
  - `GET /api/jobs` の候補に `hasFront`・`hasUnder`。`GET /api/jobs/image?kind=front|under`
  - `POST /api/items` の本文に `front?: string`・`under?: string`（base64 の PNG。`png` と同じ大きさ）
  - `src/studio/api.ts` の `addItem` の引数と、候補の型に同じ項目

- [ ] **Step 1: テストを書く**
  - `manifest`: `under`（画像）と `backThumb`（文字列）を読める。無くても読める。`under` の箱がキャンバスからはみ出すと断る。`backThumb` が空文字だと断る。
  - `manifestEdit.addItem`: `under` を渡すと項目が付き、`replaceId` で `under` なしを渡すと項目が消える（`hide`・`back` と同じ決まり）。`backThumbFrom` を渡すと `backThumb` が付き、192 px 以内。`back` が無いのに `backThumbFrom` だけ渡しても `backThumb` は付かない。
  - `api` POST `/api/items`（髪）: `front` を渡すと、保存された `image` は前の範囲だけ、`back` は髪の全体＋体の裏、`thumb` と `backThumb` があり、`backThumb` の絵で体の所が `THUMB_BODY` の色。`front` が無い髪は、いままでどおり `splitHair` で分かれ、その場合も `backThumb` が付く。
  - `api` POST `/api/items`（靴）: `under` を渡すと `under` が保存され、`thumb` は靴＋肌の絵から作られる（開きの所が透明でない）。`under` の大きさが `png` と違うと 400。
  - `api` GET `/api/jobs/image?kind=front`・`under` が候補の絵を返し、無ければ 404。
- [ ] **Step 2: 失敗を見る** — `npx vitest run src/tests/manifest.test.ts tools/content tools/studio/api.test.ts` → FAIL
- [ ] **Step 3: 実装する** — 保存のときの髪: `front` があれば `hairFromMask`、無ければ既存の `hairLayers`。どちらも、前髪・後ろ髪ができたら `hairThumbs` で `thumbFrom`・`backThumbFrom` を作る（ドールの不透明度は、画像の大きさに合う型から。既存の `hairLayers` と同じ選び方）。
- [ ] **Step 4: 通るのを見る** — `npx vitest run`、`npx tsc -b`、`npx eslint .`
- [ ] **Step 5: コミット** — `git commit -m "Content: items can carry an under-layer and a back-hair thumbnail; save them from the studio"`

---

### Task 8: ゲーム（肌の層、隠す所を下の服にも、うしろがみのサムネイル）

**Files:**
- Modify: `src/types/index.ts`, `src/content/loadContent.ts`, `src/engine/hides.ts`, `src/engine/PixiEngine.ts`, `src/components/AvatarCanvas.tsx`, `src/components/PlacedItem.tsx`, `src/components/ItemAdjustPanel.tsx`（必要なら）, `e2e/globalSetup.ts`, `tools/content/buildContent.ts`（E2E 用の素材に `under`・`hide` を足すため。必要なら）
- Test: `src/tests/loadContent.test.ts`, `src/engine/hides.test.ts`（新）, `src/tests/AvatarCanvas.test.tsx`, `e2e/dressup.spec.ts`

**Interfaces:**
- Consumes: `ManifestItem.under`・`backThumb`（Task 7）
- Produces:
  - `ClothingItemData.under?: { url: string; canvasW: number; canvasH: number; box: Box }`
  - `hidesFor(items: EquippedItem[], adjustingItemId: string | null, dollCanvas: { w: number; h: number }): { doll: Hide[]; items: Map<string, Hide[]> }`（`items` の箱は、その服のキャンバス上の位置に直してある。既存の `activeHides` は `hidesFor(...).doll` を返すよう残す）

- [ ] **Step 1: テストを書く（ユニット）**
  - `loadContent`: `under` が `ClothingItemData.under` になる。`backThumb` があれば、うしろがみの `thumbnailUrl` がそれになり、無ければ絵そのもの（いままでどおり）。
  - `hidesFor`: 靴（重なり 2、`hide` あり）と靴下（重なり 1）を着ていると、`items` に靴下の ID があり、箱は靴下のキャンバス（1228）に合わせて (1228−1024)/2 = 102 ずれている。同じ重なりの服（インナー、2）と上の服（トップス、4）、ドールの後ろの服（うしろがみ、−1）は入らない。
  - `hidesFor`: 靴を動かした・大きさや傾きを変えた・調整中 → `doll` も `items` も空。靴下を動かした・調整中 → `doll` には靴の `hide` があり、`items` に靴下が無い。
  - `hidesFor`: `hide` を持つ服が 1 つも無ければ、どちらも空（古い素材）。
- [ ] **Step 2: テストを書く（E2E）** — `e2e/globalSetup.ts` の素材に、`under`（肌色の四角）と形のある `hide` を持つ靴と、同じ所にかかる靴下を足す。
  - 靴だけ: 肌の四角の画素が肌色。色スライダーを動かしても、その画素は肌色のまま。靴の画素は色が変わる。
  - 靴＋靴下: `hide` の所の靴下の画素が、背景の色（消えている）。`hide` の外の靴下は見える。肌の四角の所は靴下の色（靴下が肌の上）。
  - 靴を調整モードで動かす: 靴下の消えていた所が戻る。肌の絵は靴と一緒に動く。
  - 再読み込みしても同じ。写真にも同じ絵が写る（既存の写真のテストにならう）。
- [ ] **Step 3: 失敗を見る** — `npx vitest run src/tests/loadContent.test.ts src/engine/hides.test.ts` → FAIL。`npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off e2e/dressup.spec.ts` → 新しいテストが FAIL
- [ ] **Step 4: 実装する**
  - 描く順: ドールの前の服は、まず全部の `under` を（服の重なり順で）描き、その上に服を描く。ドールの後ろに回した服の `under` は、その服のすぐ下。`under` には色のフィルターをかけず、位置・大きさ・傾きは服と同じ（服の中心を軸にする計算を、`under` の箱ではなく**服の箱**で行う）。
  - 隠す所: `hidesFor(...).items` にある服は、`eraseHides` で消したテクスチャで描く。作ったテクスチャは、次の描画で破棄する（ドールの `hiddenDollTexture` と同じ扱い）。
  - 調整モードの重ね絵（`PlacedItem.tsx`）にも、`under` と、消した服を入れる。
  - `AvatarCanvas.tsx`: 服を描き直すきっかけに、隠す所の変化を足す（靴を着ける・脱ぐで、靴下が描き直される）。
- [ ] **Step 5: 通るのを見る** — `npx vitest run`、`npx tsc -b`、`npx eslint .`、E2E 全体
- [ ] **Step 6: コミット** — `git commit -m "Game: under-layer for items, hide masks also clip the clothes beneath, back-hair thumbnails"`

---

### Task 9: スタジオの候補カード（前の範囲、肌）

**Files:**
- Modify: `src/studio/ItemCard.tsx`, `src/studio/Panels.tsx`（候補の型の受け渡し）, `src/studio/partsCache.ts`（必要なら）
- Test: `e2e/studio.spec.ts`

**Interfaces:**
- Consumes: Task 7 の API、`hairFromMask`（Task 3。ブラウザで使う）

- [ ] **Step 1: テストを書く（E2E）** — `e2e/studio.spec.ts` の、偽の AI で候補を作る流れにならう（偽の AI が固定素材 h1・s1 を返すようにする）。
  - 髪の候補カード: 「きせた絵」で、頭の横の画素が髪の色、顔の画素がドールの肌の色（後ろ髪がドールの後ろ、前髪が前）。保存すると、一覧ファイルの品目に `back`・`backThumb` があり、`image` の箱が `back` の箱より小さい。
  - 靴の候補カード: 「きせた絵」で、靴の開きの画素が肌の色、元の足がはみ出していた所が背景の色。保存すると、品目に `under`・`hide` がある。
  - 髪のカードで「うごかす」を 10 px 使ってから保存すると、`image` と `back` の箱が両方 10 px 動く。
- [ ] **Step 2: 失敗を見る** — E2E の新しいテストが FAIL
- [ ] **Step 3: 実装する**
  - 候補に `front` があれば、`refreshSplit` は `splitHair` の代わりに `hairFromMask`（`front` の絵は、`shape` と同じように微調整に合わせて動かして読む）。保存では `front` を一緒に送る（`shape` は送らない）。
  - 候補に `under` があれば、読みこんで、ドール（隠す所を消したもの）と品目のあいだに、微調整と同じ動きで描く。保存では、動かした `under` を送る。
  - `front`・`under` の無い候補（取り込み、ぼうし、てぶくろ、服）の動きは変えない。
- [ ] **Step 4: 通るのを見る** — `npx vitest run`、`npx tsc -b`、`npx eslint .`、E2E 全体
- [ ] **Step 5: コミット** — `git commit -m "Studio card: preview and save hair by its front mask and shoes with their skin layer"`

---

### Task 10: ドールの輪郭線の緑と、既存の素材への 1 回きりの処理

**Files:**
- Modify: `tools/studio/makeDoll.ts`
- Create: `tools/content/fixContent.ts`
- Test: `tools/studio/makeDoll.test.ts`, `tools/content/fixContent.test.ts`
- Modify: `package.json`（`"content:fix": "tsx tools/content/fixContent.ts"`）

**Interfaces:**
- Consumes: `cleanKeyEdge`（Task 1）、`hairThumbs`（Task 3）、`ContentStore`、`encodeThumb`（Task 7）
- Produces:
  - `cleanDollOutline(contentDir: string, dollId: string, faceCategory?: string): Promise<{ doll: string; master: string | null; faces: number }>`（ドールの画像、`studio/masters/` の同名の元画像、顔の品目の画像を書き直す。ファイル名（中身のハッシュ）が変わるので、一覧ファイルと元画像の名前を付け替える）
  - `addBackThumbs(contentDir: string): Promise<number>`（`back` があって `backThumb` が無い品目に足す。足した数を返す）
  - コマンド: `npm run content:fix -- outline <素材フォルダ> <ドールの ID>`、`npm run content:fix -- back-thumbs <素材フォルダ>`

- [ ] **Step 1: テストを書く**
  - `makeDoll`: 緑の背景に、こげ茶の線で囲んだ肌色の丸を描いた絵を取り込むと、できたドールのふち 3 px の画素で「G が R と B の両方より大きい」ものが無い。不透明度は、処理を入れる前と 1 画素も変わらない（`cutOutDoll` の結果と比べる）。
  - `cleanDollOutline`: 一時の素材フォルダ（ドール 1 体、元画像、顔 1 点、服 1 点）で、(a) ドール・元画像・顔のファイルが変わり、一覧ファイルが新しい名前を指す (b) 元画像が、新しいドールのファイルと同じ基本名で置かれる (c) 3 つとも不透明度は変わらない (d) 服のファイルは変わらない (e) 2 回目に実行しても何も変わらない (f) 品目の ID・箱・`studio/templates.json` は変わらない。
  - `addBackThumbs`: `back` を持つ髪 1 点と、持たない服 1 点で、髪にだけ `backThumb` が付き、戻り値 1。2 回目は 0。絵の体の所が `THUMB_BODY` の色。
- [ ] **Step 2: 失敗を見る** — `npx vitest run tools/studio/makeDoll.test.ts tools/content/fixContent.test.ts` → FAIL
- [ ] **Step 3: 実装する** — 背景の色は緑 [0,255,0]（`makeDoll.ts` が使う色）。`reach` は、1024 の絵で 3 px、元画像（2 倍）で 6 px。古いファイルは消さない（公開のときの「使われていない画像を消す」に任せる）。
- [ ] **Step 4: 通るのを見る** — `npx vitest run`、`npx tsc -b`、`npx eslint .`
- [ ] **Step 5: コミット** — `git commit -m "Dolls: remove key-colour spill from the outline at import; one-off fixes for existing content"`

---

### Task 11: 本物の生成を回す道具

**Files:**
- Modify: `tools/studio/tryItems.ts`
- Test: 既存の `tools/studio/api.test.ts` が通ること（`tryItems.ts` 自体のテストは、いままでどおり無し）

**Interfaces:**
- Consumes: Task 6・7 の API

- [ ] **Step 1: 実装する**
  - 出力に `-front.png`・`-under.png` を足す。`-worn.jpg` は、髪なら「後ろ髪 → ドール → 前髪」、靴なら「ドール（隠す所を消す）→ 肌 → 靴」。
  - 4 つ目の引数のあとに `--with <品目の ID>` を付けると、その既存の品目（靴下など）を重ねた `-worn-with.jpg` も書く（靴では、肌の上・靴の下に置き、隠す所を消す）。
  - 髪は `-thumb.png`・`-backthumb.png`（`hairThumbs` の絵を 192 px に縮めたもの）も書く。
  - `save` は `front`・`under` も送る。
- [ ] **Step 2: 偽の AI で確かめる** — 一時の素材フォルダと、固定素材を返す偽の AI（環境変数 `STUDIO_FAKE_IMAGE=<ファイル>` があれば、それを返す。`tryItems.ts` の中だけの切り替え）で、髪 1 点・靴 1 点を出力し、上のファイルができること、`save` で `back`・`backThumb`・`under`・`hide` の付いた品目になることを見る。
- [ ] **Step 3: `npx vitest run`、`npx tsc -b`、`npx eslint .`**
- [ ] **Step 4: コミット** — `git commit -m "tryItems: write front, under, thumbnails and worn-with pictures; pass them on save"`

---

### Task 12: 本物の生成と、作者に見せる絵（素材フォルダの写しの上で）

**Files:**
- Create: `docs/superpowers/specs/2026-11-20-spike/items-hair.json`, `items-shoes.json`, `result-final-*.jpg`
- 素材: `../DressUpGame-content` を一時フォルダに写して使う（公開はしない）

- [ ] **Step 1: 写しを作り、輪郭線とサムネイルを直す** — `cp -r ../DressUpGame-content <一時>`、`npm run content:fix -- outline <一時> 'アニメ　その２'`、`npm run content:fix -- back-thumbs <一時>`。ドールの絵（前と後、拡大）を見て、線がこげ茶になり、形が変わっていないことを確かめる。
- [ ] **Step 2: 品目の JSON を書く** — 公開中の 10 点（髪: ピンクのツインテール、くろかみボブ、ちゃいろのロング、きんいろみつあみ、むらさきポニーテール。靴: あかいリボンのパンプス、そらいろスニーカー、ひまわりサンダル、きいろいながぐつ、リボンのバレエシューズ）を、公開中の絵を見て、同じ名前・同じ見た目になる英語の説明で書く。
- [ ] **Step 3: 生成する（10 枚）** — `NODE_USE_ENV_PROXY=1 GEMINI_API_KEY=dummy npx tsx tools/studio/tryItems.ts <一時> 'アニメ　その２' <JSON> <出力>`（靴は `--with 'アニメ　その２/ソックス/しろいハイソックス'`）。
- [ ] **Step 4: 見る** — 10 点の `-worn.jpg`・`-worn-with.jpg`・サムネイルを見て、設計書 3 章の目標（髪・靴それぞれ 4 点以上が手直しなしで使える）を判定する。警告や粗があれば原因を調べ、処理の直しはテストを足してから行う。作り直しは、残りの枚数（合計 25 枚まで）の中で。
- [ ] **Step 5: ゲームで見る** — 写しに `save … replace` で 10 点を入れ、`dist/real-content` に置いて、ビルドしたゲームで着せた画面（髪＋靴＋靴下＋服、うしろがみのメニュー）を撮る。
- [ ] **Step 6: 作者に見せる絵をまとめ、コミット** — 前（公開中）と後を並べた絵を `result-final-*.jpg` として置く。`git commit -m "Real generation run with the new method: results"`

---

### Task 13: 全体の確認、文書、版数

**Files:**
- Modify: `src/App.tsx`（`APP_VERSION = 'v0.20.0'`）, `README.md`, `docs/superpowers/HANDOFF.md`, `docs/superpowers/specs/2026-11-20-hair-and-shoes-by-difference-design.md`（結果の章を足す）

- [ ] **Step 1: 全部を回す** — `npx vitest run`、`npx tsc -b`、`npx eslint .`、`npm run build && PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test --trace off`。件数を控える。
- [ ] **Step 2: 別の目の全体レビュー** — サブエージェント 1 回（設計書・この計画・ブランチの差分を渡す）。重大・重要な指摘は、テストを足して直す。
- [ ] **Step 3: 文書** — 設計書に「結果」（できたこと、本物の画像で確かめたこと、数値、確かめられていないこと、使った枚数）。HANDOFF の「最新」を書き替える。README の版数と、スタジオの説明（髪・靴の作り方、`content:fix`）を直す。
- [ ] **Step 4: コミットして push** — `git commit -m "v0.20.0: hair and shoes by difference; docs and handoff"`、`git push -u origin claude/festive-brahmagupta-vpdsx2`
- [ ] **Step 5: 作者に報告** — 絵と数値、確かめられていないこと。決めてもらうこと: (1) `main` への取り込み (2) 素材の公開（ゲーム本体を先に公開してから。素材リポジトリをこのセッションに追加する必要がある）。
