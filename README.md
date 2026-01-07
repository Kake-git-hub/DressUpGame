# 🎀 きせかえゲーム (Dress-Up Game)

子供向け2D着せ替えWebゲーム MVP版

## ✨ 特徴

- 🎨 かわいいドールに服を着せ替え
- 👆 ドラッグ&ドロップで簡単操作
- 📱 iPad/タブレット対応（タッチ操作・ピンチズーム）
- 🔄 リセットボタンで全部脱がせる
- 🖼️ 背景切り替え機能
- 📐 ドール位置・サイズ調整機能
- 📦 ZIPプリセットインポート対応

## 🎯 現在のバージョン: v0.6.0

### 実装済み機能

1. **ドール表示・操作**
   - PixiJS 8による高品質レンダリング
   - ドラッグで位置調整（-50%〜150%の広範囲移動可能）
   - ピンチズームでサイズ調整（0.3〜2.0倍）
   - 縮小時の画質改善（リニア補間）
   - 背景は画面全体の最背面に表示

2. **着せ替え機能**
   - カテゴリ別アイテム選択（2列グリッド、サムネイル表示）
   - ドラッグ&ドロップでアイテム装着
   - **ドラッグ中のプレビュー表示**（タッチ位置にサムネイル）
   - movableアイテムの自由配置（ドロップ位置に表示）
   - 「なし」選択で脱がせる（誤操作防止のため画面下部に配置）
   - **レイヤー順制御**（フォルダ名の番号で重ね順を決定）

3. **プリセット管理**
   - ZIPファイルからドール・背景・服を一括インポート
   - IndexedDB + LocalStorageでデータ永続化
   - サムネイル画像対応（`_thumb`サフィックス）

4. **UI/UX**
   - 140px幅の縦長メニュー（2列グリッド、サムネイル表示）
   - 設定パネル（⚙️ボタン）
   - ドール調整モード（📐ボタン）
   - 背景選択をカテゴリリスト上部に配置
   - 大きな戻るボタンとなしボタン（誤操作防止）

### 既知の課題・未実装

- [ ] ブラウザ拡大率変更時のクラッシュ（try-catch追加で軽減済み）
- [ ] 縮小時の画質は元画像サイズに依存（小さい画像を拡大推奨）
- [ ] サムネイル用画像の自動生成機能

## 🛠️ 技術スタック

- **Build Tool**: Vite 7.x
- **Framework**: React 19 + TypeScript (strict mode)
- **Graphics**: PixiJS 8 (`Assets.load`, `Sprite`, `Container`)
- **Storage**: IndexedDB (画像) + LocalStorage (メタデータ)
- **Archive**: JSZip (プリセットZIP処理)
- **Testing**: Vitest + Playwright

## 📁 プロジェクト構成

```
src/
├── App.tsx              # メインアプリ（状態管理の中心）
├── App.css              # グローバルスタイル
├── components/          # Reactコンポーネント
│   ├── AvatarCanvas.tsx     # PixiJSキャンバス表示
│   ├── DressUpMenu.tsx      # カテゴリ・アイテム選択UI
│   ├── DollControlPanel.tsx # ドール位置・サイズ調整
│   ├── SettingsPanel.tsx    # 設定パネル（プリセット管理等）
│   ├── ItemManager.tsx      # アイテム管理UI
│   └── ItemImporter.tsx     # ZIPインポートUI
├── engine/
│   └── PixiEngine.ts        # PixiJS描画エンジン
├── hooks/
│   └── useDressUp.ts        # 着せ替え状態管理フック
├── services/
│   └── assetStorage.ts      # IndexedDB/LocalStorage管理
├── types/
│   └── index.ts             # 型定義・カテゴリマッピング
└── tests/                   # ユニットテスト
```

## 📦 プリセットZIPフォルダ構成

```
preset.zip/
├── doll/                    # ドール画像
│   └── ドール名/
│       └── body.png         # ボディ画像（推奨: 800x1600px）
├── background/              # 背景画像
│   └── 背景名.png           # 背景画像（推奨: 1920x1080px）
├── clothing/                # 服アイテム
│   └── カテゴリ名/          # top, bottom, dress, shoes, accessory等
│       ├── アイテム名.png   # アイテム画像
│       └── アイテム名_thumb.png  # サムネイル画像（オプション、64x64px推奨）
```

### サムネイル画像

メニューでのアイテム表示を高速化するため、サムネイル画像（`_thumb`サフィックス）を使用できます：
- 本体画像: `dress01.png`
- サムネイル: `dress01_thumb.png`

サムネイルがない場合は本体画像がそのまま表示されます。

### カテゴリ名マッピング

| フォルダ名 | 表示名 | emoji | movable |
|-----------|--------|-------|---------|
| top | トップス | 👚 | - |
| bottom | ボトムス | 👖 | - |
| dress | ワンピース | 👗 | - |
| shoes | くつ | 👟 | - |
| accessory | アクセサリー | 🎀 | ✓ |
| hat | ぼうし | 🎩 | - |
| socks | くつした | 🧦 | - |
| bag | かばん | 👜 | ✓ |
| face | 顔パーツ | 😊 | ✓ |
| underwear_top | したぎ(うえ) | 🩱 | - |
| underwear_bottom | したぎ(した) | 🩲 | - |

※ フォルダ名に`_movable`サフィックスを付けると自由配置可能

### レイヤー順（重ね順制御）

フォルダ名の先頭に番号を付けると、その番号順にレイヤーが決まります：

```
clothing/
├── 1_くつした/     # レイヤー1（最背面）
├── 2_くつ/           # レイヤー2
├── 3_bottom/         # レイヤー3
├── 4_top/            # レイヤー4
└── 5_accessory_movable/  # レイヤー5（最前面、自由配置可）
```

- **番号が小さいほど下（奥）**に表示
- **番号が大きいほど上（手前）**に表示
- メニューのカテゴリ名は番号を除いたラベル（例: `1_くつした` → `くつした`）
- 同じレイヤー番号のアイテムは着せた順に重なる

### 画像サイズ推奨（容量最適化版）

| 種類 | 推奨サイズ | 最小サイズ | 備考 |
|------|-----------|-----------|------|
| ドールボディ | 400x800px | 300x600px | 中心配置、縦長、PNG |
| 背景 | 1280x720px | 960x540px | 横長、JPEG可（80%品質） |
| 服アイテム | 400x800px | 300x600px | ドールと同サイズ、中心基準、PNG |
| サムネイル | 64x64px | 48x48px | 正方形、透過PNG |

**容量削減のコツ:**
- ドール・服は**中心に配置**すれば余白を削減可能
- 背景はJPEG（品質80%）で大幅に容量削減
- 服アイテムは必要な部分のみ描画（全身分の余白不要）

### 画像生成プロンプト例（AI画像生成用）

**ドールボディ:**
```
full body character, anime style, simple pose, arms slightly spread, 
front view, transparent background, centered composition, 
high resolution, clean lineart, 400x800 pixels
```

**服アイテム:**
```
[服の種類] clothing item, flat lay style, transparent background, 
centered, same proportions as character body, 
high resolution, clean edges, 400x800 pixels
```

**サムネイル:**
```
[アイテム名] icon, 64x64 pixels, centered, transparent background, 
simple design, recognizable silhouette, clean edges
```

**背景:**
```
[シーン説明] background, anime style, no characters, 
1280x720 pixels, vibrant colors, detailed environment
```

## 🚀 セットアップ

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev

# ブラウザで開く
# http://localhost:5173/DressUpGame/
```

## 📋 コマンド

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発サーバー起動 |
| `npm run build` | 本番ビルド |
| `npm run preview` | ビルドプレビュー |
| `npm run test` | ユニットテスト |
| `npm run test:e2e` | E2Eテスト |
| `npm run lint` | ESLintチェック |
| `npm run deploy` | GitHub Pagesデプロイ |

## 🎮 遊び方

1. **設定（⚙️）** からプリセットZIPをインポート
2. **ドール選択** でドールを選ぶ
3. **カテゴリ** をタップしてアイテム一覧を表示
4. **アイテム** をドラッグしてドールエリアにドロップ
5. **📐ボタン** でドールの位置・サイズを調整
6. **🖼️はいけい** ボタンで背景を変更

## 🔧 開発者向け情報

### 状態管理

- `App.tsx`: グローバル状態（ドール、背景、服、設定）
- `useDressUp.ts`: 着せ替え状態（装備アイテム、zIndex管理）
- `assetStorage.ts`: 永続化（IndexedDB + LocalStorage）

### PixiJS描画フロー

1. `AvatarCanvas` マウント時に `PixiEngine.init()` 
2. `dollTransform` 変更で `drawDoll()` + `drawClothing()` 再描画
3. `equippedItems` 変更で `drawClothing()` 再描画
4. アンマウント時に `destroy()` でリソース解放

### movableアイテムの仕組み

1. `ClothingItemData.movable = true` のアイテムは自由配置可能
2. ドラッグ中は `App.tsx` の `draggingPreview` で位置追跡
3. ドロップ時に `offsetX`, `offsetY` をアイテムに保存
4. PixiEngineで `offsetX`, `offsetY` を考慮して描画

### 重要な型定義

```typescript
// 服アイテム
interface ClothingItemData {
  id: string;
  name: string;
  type: ClothingType; // カテゴリ名
  imageUrl: string;
  position: Position;
  baseZIndex: number;
  movable?: boolean;      // 自由配置可能か
  offsetX?: number;       // 自由配置時のオフセット
  offsetY?: number;
  dollId?: string;        // 紐付けドールID
}

// ドール変形
interface DollTransform {
  x: number;  // 0-100% (中央=50)
  y: number;  // 0-100%
  scale: number; // 0.3-2.0
}
```

## 📝 次の開発予定

1. サムネイル自動生成機能
2. ブラウザ拡大率変更への対応強化
3. アンドゥ/リドゥ機能
4. 保存/読み込み機能（着せ替え状態の保存）
5. 複数アイテム同時装着の改善

## 💡 画質に関する質問への回答

**Q: 縮小すると画質が荒れます。元の画像を小さくして拡大するほうが荒れませんか？**

A: **はい、その通りです。** 画像処理の原則として：

- **縮小時**: 情報が失われ、エイリアシング（ギザギザ）が発生しやすい
- **拡大時**: 補間処理でスムーズに拡大可能（特にリニア/バイリニア補間）

**推奨アプローチ:**
1. **元画像を小さめに作成**（400x800px程度）
2. **アプリ内で拡大表示**（scale > 1.0）
3. PixiJSの`scaleMode: 'linear'`で滑らかに拡大

これにより：
- ファイルサイズが小さくなる
- 読み込みが高速化
- 拡大時も滑らかな表示

## 📝 ライセンス

MIT License
