# 🎀 きせかえゲーム (Dress-Up Game)

子供向け2D着せ替えWebゲーム（iPad 横向き用）

## 📌 現在のバージョン: v0.10.0

- 遊ぶ: https://kake-git-hub.github.io/DressUpGame/
- 素材（ドール・服・背景）: [DressUpGame-content](https://github.com/Kake-git-hub/DressUpGame-content) から配信

---

## 🎮 遊び方

1. アプリを開く（服や背景は自動で読み込まれます。取り込み操作は不要です）
2. **カテゴリ** をタップしてアイテム一覧を表示
3. **アイテム** をドラッグしてドールにドロップ
4. **👗ボタン** で、最後に着せた服の位置・サイズ・傾き・色を調整（服を着ていないときはドールを調整）
5. **🖼️はいけい** で背景を変更
6. **📷ボタン** で写真を保存
7. **🔄ボタン** で服と背景をリセット

一度開けば、オフラインでも遊べます。アプリは開いたとき・戻ってきたときに新しい版を確認し、あれば自動で更新します。

---

## 🛠️ 技術スタック

| カテゴリ | 技術 |
|----------|------|
| Build Tool | Vite 7 |
| Framework | React 19 + TypeScript (strict) |
| Graphics | PixiJS 8 |
| PWA | vite-plugin-pwa (Workbox) |
| Testing | Vitest + Playwright |
| 素材の変換 | sharp（`tools/content/`） |

## 📁 プロジェクト構成

```
src/
├── App.tsx                  # メインアプリ（状態管理の中心）
├── components/
│   ├── AvatarCanvas.tsx     # PixiJSキャンバス表示
│   ├── DressUpMenu.tsx      # カテゴリ・アイテム選択UI
│   ├── ItemAdjustPanel.tsx  # アイテム/ドール調整
│   └── DragPreviewLayer.tsx # ドラッグ中のサムネイル
├── content/                 # 配信された素材の読み込み・先読み・一覧ファイルの型
├── pipeline/                # 画像処理の純粋関数（切り抜き・背景の透過など）
├── engine/PixiEngine.ts     # 描画エンジン
├── hooks/useDressUp.ts      # 着せ替え状態管理
├── services/                # 端末に保存する小さな状態（服装・ドール位置など）
└── tests/                   # ユニットテスト
tools/content/               # プリセットのフォルダ → 配信用の一覧と画像
e2e/                         # E2Eテスト
docs/superpowers/            # 設計書と実装計画
```

## 🚀 セットアップ

```bash
npm install
```

```bash
npm run dev
```

ブラウザで http://localhost:5173/DressUpGame/ を開きます。

## 📋 コマンド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run test:run` | ユニットテスト |
| `npm run test:e2e` | ビルドして E2E テスト |
| `npm run lint` | ESLint |
| `npm run content:migrate -- <プリセットのフォルダ> <出力先>` | プリセットを配信用の形に変換 |

`main` に push すると GitHub Actions が GitHub Pages に配信します。

## 🧵 素材について

素材は別リポジトリ [DressUpGame-content](https://github.com/Kake-git-hub/DressUpGame-content) にあり、`manifest.json`（一覧）と `files/`（画像）で構成されます。服とドールは、透明でない部分で切り抜いて保存し、元の位置は一覧ファイルに持たせています。

素材の作り方の説明書と制作ツール（素材スタジオ）は、今後の段階で用意します。進め方は `docs/superpowers/plans/2026-11-16-roadmap.md` を参照してください。

## 📝 更新履歴

- **v0.10.0** - 素材を別リポジトリから配信する方式に変更（取り込み・設定画面を廃止）、iPad 横向き専用に、オフライン対応、サムネイルの自動作成、緑背景の自動透過
- **v0.9.7** - ドラッグ中の動作を軽量化、着ている服の保存を小さく安全に、未使用コードの削除、PWAを開いたときに自動で更新を確認
- **v0.9.6** - アイテム調整リアルタイムプレビュー、`_overlap`重複装備、iPad復帰対応
- **v0.9.0** - アイテム調整機能追加
- **v0.6.0** - movableアイテム、レイヤー順制御

## 📝 ライセンス

MIT License
