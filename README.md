# 🎀 きせかえゲーム (Dress-Up Game)

子供向け2D着せ替えWebゲーム MVP版

## ✨ 特徴

- 🎨 かわいいドールに服を着せ替え
- 👆 タップ/クリックで簡単操作
- 📱 iPad/タブレット対応（タッチ操作）
- 🔄 リセットボタンで全部脱がせる

## 🛠️ 技術スタック

- **Framework**: Vite + React 19 + TypeScript
- **Graphics**: PixiJS 8
- **Testing**: Vitest + Playwright
- **Code Quality**: ESLint + Prettier

## 🚀 セットアップ

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev

# ブラウザで開く
# http://localhost:5173
```

## 📋 コマンド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルドプレビュー |
| `npm run test` | ユニットテスト (watch) |
| `npm run test:run` | ユニットテスト (1回) |
| `npm run test:e2e` | E2Eテスト |
| `npm run lint` | ESLintチェック |
| `npm run format` | Prettierフォーマット |

## 📁 プロジェクト構成

```
src/
├── components/          # Reactコンポーネント
│   ├── AvatarCanvas.tsx   # PixiJSキャンバス
│   ├── ClothingItem.tsx   # 服アイテム
│   └── ClothingPalette.tsx # 服パレット
├── engine/              # 描画エンジン
│   └── PixiEngine.ts      # PixiJS制御
├── hooks/               # カスタムフック
│   └── useDressUp.ts      # 着せ替え状態管理
├── types/               # 型定義
│   └── index.ts
└── tests/               # ユニットテスト
e2e/                     # E2Eテスト
```

## 🎮 遊び方

1. 画面下部の服パレットから好きな服をタップ
2. ドールに服が着せられます
3. 同じ部位の服は自動で入れ替わります
4. 「リセット」ボタンで全部脱がせます

## 📝 ライセンス

MIT License
