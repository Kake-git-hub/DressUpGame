# 引き継ぎ（2026-11-19 時点）

次のセッションは、まずこの文書を読み、続けて「設計書」と「ロードマップ」を読んでから始める。

- 設計書: `docs/superpowers/specs/2026-11-15-lightweight-rework-design.md`
- ロードマップ: `docs/superpowers/plans/2026-11-16-roadmap.md`
- 各段階の計画と結果: `docs/superpowers/plans/`

## 0. 最新（2026-11-19、v0.18.0）: 新ドールと部位の差し替え式生成

設計と結果: `docs/superpowers/specs/2026-11-19-new-doll-and-part-swap-design.md`（9 章が結果）。計画: `docs/superpowers/plans/2026-11-19-new-doll-and-part-swap.md`。

- 髪・帽子は上半身の拡大図、くつ・てぶくろは本物の脚・腕の拡大図に描かせる。くつ・てぶくろは足首・手首から先を絵ごと差し替える（`tools/studio/processSwap.ts`、枠は `src/pipeline/frames.ts`）。
- 新ドールは、作者が選んだ「候補 2」の手を、作者の提案で手のひらが見える「パー」の形に直したもの（`docs/superpowers/specs/2026-11-19-spike/doll_chosen_2_open_hands.webp`、2048px・緑の背景）。
- 上限額の変更後、このドールで 25 点（靴 5・髪 5・手袋 3・顔 3・帽子 1・服 8）を生成し、すべて 1 回目で使える出来だった（設計書 10 章）。
- **残り: 素材リポジトリへの公開。** 作者の了承と、ドールの名前（仮「アニメ2」）待ち。登録済みの素材（ドール + 25 点）は、作業ブランチ `claude/admiring-bell-zy5l08` の `docs/superpowers/specs/2026-11-19-spike/content-delta.tgz` に残してある（`main` には入れていない）。素材リポジトリの最上位で展開すると、`manifest.json`・`files/`・`studio/` が入る。公開は、セッションに `Kake-git-hub/DressUpGame-content` を追加して push する。
- クラウド環境で画像生成を呼ぶとき: `NODE_USE_ENV_PROXY=1 GEMINI_API_KEY=dummy`（中継がキーを差し込む）。Claude API のキーは無いので、企画と見た目の検品は人が代わる（`tryItems.ts`）。
- 以下の 1〜2 章は 2026-11-16 時点の記録（スタジオはその後 `main` に入り、公開中の版は v0.17.1 → v0.18.0）。

## 1. いまの状態

| 項目 | 状態 |
|---|---|
| 公開中の版 | v0.10.1（`main` = コミット `352d416`）。https://kake-git-hub.github.io/DressUpGame/ |
| 作業ブランチ | `claude/friendly-fermi-pgp3jg`（v0.11.0。スタジオを追加。**`main` には未マージ**） |
| 素材 | 別リポジトリ `Kake-git-hub/DressUpGame-content`（`main`）。ドール 2 体・服 91 点・背景 20 枚、15 MB。https://kake-git-hub.github.io/DressUpGame-content/manifest.json |
| テスト | ユニット 241 件、E2E 29 件。すべて通過。ESLint エラー 0 |

完了した段階:

- **段階 0**（v0.9.7）: ドラッグ中の無駄な再描画の解消、服装の保存を ID と調整値だけに、未使用コードの削除、PWA の自動更新。
- **段階 1**（v0.10.0）: 素材を別リポジトリから配信。取り込み・IndexedDB・JSZip・設定画面・縦画面を削除。オフライン対応。作者が iPad で確認済み。
- **v0.10.1**: 色スライダーのプレビューを、画素を直接変換する方式に変更（`src/components/HueCanvas.tsx`）。
- **スタジオ**（v0.11.0、作業ブランチ）: 切り抜き・位置合わせ・型紙・自動生成・背景・一覧の管理・公開。計画と結果は `docs/superpowers/plans/2026-11-16-studio.md`。**AI を実際に呼ぶ部分は未確認。**

作者の確認待ち:

- v0.10.1 で、色スライダーが調整中にその場で変わるか（iPad Safari）。開発環境の Chromium では元の実装でも再現せず、原因（服の ID に日本語と `/` が入り、Safari が SVG フィルターの参照を解釈できない）は推測。直っていなければ、ここから調べ直す。
- スタジオを PC で動かした結果（`2026-11-16-studio.md` の 5 章の 1〜5）。

## 2. 次にやること

作者から「決めることはすべておすすめで進めてよい」と指示があり（2026-11-16）、スタジオは `2026-11-16-studio.md` の 1 章のとおり決めて実装した。

1. **作者に PC で動かしてもらう**（`npm run studio`）。手持ちの画像で切り抜きの出来を見てもらい、公開まで通す。
2. **API キーを置いて、最初の試行（10〜20 点）で合格率を測る**。Gemini の呼び出し（`tools/studio/ai.ts`）は、公式の説明（Interactions API）に合わせて書き直したが、本物のキーでは未確認。Claude API を触るときは `claude-api` スキルを読む。
3. 合格率を見て、指示文（`tools/studio/generate.ts` の `itemPrompt`）・作り直し回数（`MAX_ATTEMPTS`）・部分拡大の要否を決める。
4. 問題が無ければ、作者の「マージして」で `main` へ。
5. そのあと: サーバーへの設置と有料化の設計（別の設計書。置き場所は `2026-11-16-studio.md` の 1 章に候補）。ロードマップの残り（描画の Canvas 2D 置き換え → 操作の改善 → 説明書の統合）。

まだ決まっていないこと（作者に確認が要るもの）:

- サーバーをどこに置くか。
- 有料化の範囲（利用者ごとに素材を分けるか、ログインと課金の方法）。
- サンプル画像 3 枚（`tools/studio/fixtures/`）を公開リポジトリに置いたままでよいか（いまは置いたまま。テストが使う）。

## 3. コードの地図

| 場所 | 役割 |
|---|---|
| `src/App.tsx` | 画面全体と状態。素材の読み込み、服装の復元と保存、先読み |
| `src/content/` | 一覧ファイルの型と検証（`manifest.ts`）、読み込み（`loadContent.ts`）、起動時の状態（`startState.ts`）、先読み（`prefetch.ts`）、旧データの削除（`legacyCleanup.ts`） |
| `src/pipeline/` | 画像処理の純粋関数: 外接矩形（`alpha.ts`）、縁からの背景除去（`removeBackground.ts`）、右下の小片除去（`removeCornerSpeck.ts`）、色相（`hue.ts`）、背景色とシルエット色（`keyColors.ts`）、切り抜き（`cutout.ts`）、位置合わせ（`align.ts`）、体の部位（`bodyParts.ts`） |
| `src/engine/PixiEngine.ts`、`src/components/AvatarCanvas.tsx` | 描画（PixiJS）。切り抜き画像は、元キャンバスの中心を原点にして描く |
| `src/components/ItemAdjustPanel.tsx`、`HueCanvas.tsx` | 調整モード。プレビューは CSS で重ねている（描画と二重実装。「描画」の段階で一本化する予定） |
| `src/services/outfitStorage.ts`、`stateStorage.ts` | 端末に保存する小さな状態 |
| `studio.html`、`src/studio/` | スタジオの画面（別ページ）。`Studio.tsx`（枠と公開）、`Panels.tsx`（各タブ）、`ItemCard.tsx`（候補 1 点の編集と保存）、`api.ts`（API の呼び出し） |
| `tools/studio/` | スタジオの API（`api.ts`）、開発サーバーへの組み込み（`vitePlugin.ts`）、1 枚の処理（`processGenerated.ts`）、自動生成（`generate.ts`）、AI の呼び出し（`ai.ts`）、枚数の上限（`budget.ts`）、テスト用のサンプル（`fixtures/`） |
| `tools/content/encode.ts`、`manifestEdit.ts` | 画像の書き出しと、素材フォルダの編集（`ContentStore`） |
| `tools/content/buildContent.ts` | プリセットのフォルダ → 配信用の一覧と画像。`npm run content:migrate -- <入力> <出力>` |
| `e2e/` | E2E。`e2e/globalSetup.ts` がテスト用の素材を `dist/e2e-content` に作り、アプリを `?content=e2e-content/` で開く。`studio.spec.ts` は、空の素材フォルダ（`node_modules/.tmp/studio-e2e`）でスタジオの開発サーバーを起動して確かめる |

残っている段階（ロードマップ参照）: スタジオの実地確認とサーバーへの設置 → 描画の Canvas 2D 置き換え（計画あり: `2026-11-16-stage-render-canvas2d.md`。JS の大半を占める PixiJS を外す）→ 操作の改善（タップで着脱、一覧のスクロール、調整対象の選択）→ 説明書の統合。

## 4. 作業の決まり（このプロジェクトで続けてきたやり方）

- **作者への報告は日本語**。専門用語を避け、数値と「確かめられていないこと」を必ず書く。
- **段階ごとに計画を書き、作者の了承を得てから実装する**。実装はセッション内で順に行い、最後に別の目（サブエージェント）の全体レビューを 1 回かける。
- **テストを先に書く**。失敗を見てから実装する。
- **作業が終わったら、毎回そのまま `main` にマージして push する**（作者の指示、2026-11-19。それまでは「マージして」と言われたときだけだった）。テスト（ユニット・E2E）・型・lint が通ってからマージする。`main` に入ると GitHub Actions が自動で公開する。
- **push 済みのコミットは書き換えない**（force push は拒否される）。
- 版数は `src/App.tsx` の `APP_VERSION` と `README.md` の両方を上げる。
- iPad 実機でしか確かめられないことは、確認項目として作者に渡す。

## 5. 開発環境の注意

- 依存の導入: `npm ci`
- ユニットテスト: `npx vitest run`　型: `npx tsc -b`　lint: `npx eslint .`
- E2E: `npm run build` のあと `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npx playwright test`（クラウド環境では、導入済みの Chromium を使うためにこの環境変数が必要。`npm run test:e2e` はビルドも行う）。
- 実物の素材でアプリを見る: 素材リポジトリを `dist/real-content` にコピーし、`npx vite preview --port 4173` で `/DressUpGame/?content=real-content/` を開く（`?content=` は同じオリジンの相対パスだけ受け付ける）。
- クラウド環境は、このリポジトリ用の環境「DressUpGame」を使う（公開サイト `kake-git-hub.github.io` と Gemini の説明 `ai.google.dev`・`aistudio.google.com` を開ける。開始時に `npm ci` と、隣への素材リポジトリの取得を自動で行う）。既定の環境では公開サイトを開けない。
- 公開サイトの確認: Playwright で `https://kake-git-hub.github.io/DressUpGame/` を開き、`.version-badge` の版数と画面を見る。
- 素材リポジトリを触るには、セッションに `Kake-git-hub/DressUpGame-content` を追加して取得する必要がある（読むだけなら、公開リポジトリなので `git clone` できる）。
- スタジオを実物の素材で見る: 素材リポジトリの `manifest.json` と `files/` を別のフォルダにコピーし、`CONTENT_DIR=<そのフォルダ> npx vite --config vite.studio.config.ts --port 5199 --open false` で `/DressUpGame/studio.html` を開く。
- API キーが無いので、自動生成はテスト用の偽物でしか動かしていない。キーを環境に保存してもらえば（安全な入力フォームを出せる）、クラウド環境で最初の試行ができる。
- コミットメッセージの訂正: コミット `0cfd7d9` の本文にある `e3f9d0f^` は誤り。削除した旧プリセットが最後に残っているのは `a3c7b62`。
