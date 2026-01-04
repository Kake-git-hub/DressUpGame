# AI画像生成ガイド

このドキュメントでは、着せ替えゲーム用のドールやアイテムをAI画像生成ツール（Stable Diffusion、DALL-E、Midjourney等）で作成する際のプロンプトと仕様を説明します。

## 📋 画像仕様

### 共通仕様
| 項目 | 仕様 |
|------|------|
| ファイル形式 | PNG（透過必須） |
| 背景 | 透明 |
| スタイル | フラットデザイン、着せ替え人形風 |
| 向き | 正面向き |

### サイズ仕様

| アイテムタイプ | 推奨サイズ | 説明 |
|----------------|------------|------|
| ドール（全身） | 200x300px | 基本となる人形の体 |
| ドール（顔のみ） | 80x80px | 顔パーツ |
| トップス | 100x80px | Tシャツ、ブラウス等 |
| ボトムス | 80x60px | スカート、パンツ等 |
| ワンピース | 100x140px | ドレス、ワンピース |
| 靴 | 60x30px | くつ |
| アクセサリー | 40-80px | リボン、帽子等（サイズ可変） |
| 下着（上） | 80x50px | キャミソール等 |
| 下着（下） | 60x35px | ショーツ等 |

---

## 🎨 プロンプトテンプレート

### ドール（体）生成用

```
Simple paper doll body, [SKIN_TONE] skin, standing straight, 
arms slightly away from body, front view, flat design style, 
chibi proportions, cute kawaii style, 
transparent background, PNG, clean lines, no shading,
for dress-up game asset

Negative: realistic, 3D, shading, gradient, background, 
clothes, accessories, complex details
```

**[SKIN_TONE] の例:**
- `fair/light` - 色白
- `medium/tan` - 標準的な肌色
- `olive` - オリーブ肌
- `brown` - 褐色肌

### ドール（顔）生成用

```
Cute anime girl face, [EXPRESSION] expression, 
[HAIR_COLOR] [HAIR_STYLE] hair, [EYE_COLOR] eyes,
front view, flat design, kawaii style, 
circular crop area, transparent background, PNG,
for dress-up game, paper doll style

Negative: realistic, 3D, body, shoulders, complex shading
```

**パラメータ例:**
- **[EXPRESSION]**: happy, gentle smile, cool, surprised, sleepy
- **[HAIR_COLOR]**: black, brown, blonde, pink, blue, silver
- **[HAIR_STYLE]**: long straight, twin tails, short bob, ponytail, curly
- **[EYE_COLOR]**: brown, blue, green, purple, red

### 服（トップス）生成用

```
[CLOTHING_ITEM], [COLOR] color, flat design, 
paper doll clothing, front view, 
fits on chibi body, kawaii style,
transparent background, PNG, clean edges,
dress-up game asset

Negative: realistic, 3D, wrinkles, complex shading, 
person wearing it, mannequin
```

**[CLOTHING_ITEM] の例:**
- `cute t-shirt` - Tシャツ
- `frilly blouse` - フリルブラウス
- `hoodie` - パーカー
- `sailor uniform top` - セーラー服（上）
- `cardigan` - カーディガン

### 服（ボトムス）生成用

```
[CLOTHING_ITEM], [COLOR] color, flat design,
paper doll clothing, front view,
fits on chibi body, kawaii style,
transparent background, PNG, clean edges,
dress-up game asset

Negative: realistic, 3D, wrinkles, person, mannequin
```

**[CLOTHING_ITEM] の例:**
- `pleated skirt` - プリーツスカート
- `denim shorts` - デニムショートパンツ
- `long pants` - 長ズボン
- `tutu skirt` - チュチュスカート
- `overalls bottom` - オーバーオール（下）

### 服（ワンピース）生成用

```
[DRESS_TYPE], [COLOR] color with [PATTERN],
flat design, paper doll dress, front view,
covers torso and legs, kawaii style,
transparent background, PNG, clean edges,
dress-up game asset, cute chibi proportions

Negative: realistic, 3D, person wearing it, complex folds
```

**[DRESS_TYPE] の例:**
- `princess dress` - プリンセスドレス
- `summer sundress` - サマードレス
- `school uniform dress` - 制服ワンピース
- `maid outfit` - メイド服
- `kimono` - 着物

### アクセサリー生成用

```
[ACCESSORY_ITEM], [COLOR] color, cute kawaii style,
flat design, simple, transparent background, PNG,
paper doll accessory, dress-up game asset

Negative: realistic, 3D, complex details, person
```

**[ACCESSORY_ITEM] の例:**
- `hair ribbon bow` - リボン
- `small crown tiara` - ティアラ
- `witch hat` - 魔女帽子
- `cat ears headband` - 猫耳カチューシャ
- `flower hair clip` - 花のヘアクリップ
- `necklace` - ネックレス
- `cute handbag` - ハンドバッグ

### 靴生成用

```
Pair of [SHOE_TYPE], [COLOR] color, top-down front view,
flat design, paper doll shoes, kawaii style,
transparent background, PNG, dress-up game asset

Negative: realistic, 3D, worn on feet, complex shading
```

**[SHOE_TYPE] の例:**
- `mary jane shoes` - メリージェーン
- `sneakers` - スニーカー
- `ballet flats` - バレエシューズ
- `boots` - ブーツ
- `sandals` - サンダル
- `high heels` - ハイヒール

---

## 📁 メタデータJSON形式

生成した画像と一緒に、以下の形式でJSONファイルを作成してください。

### アイテムデータ（items.json）

```json
{
  "version": "1.0",
  "items": [
    {
      "id": "top-custom-001",
      "name": "ピンクのフリルブラウス",
      "type": "top",
      "imageFile": "top-custom-001.png",
      "position": { "x": 0, "y": -30 },
      "baseZIndex": 20,
      "tags": ["ピンク", "フリル", "かわいい"],
      "author": "作者名",
      "createdAt": "2026-01-04"
    }
  ]
}
```

### ドールデータ（dolls.json）

```json
{
  "version": "1.0",
  "dolls": [
    {
      "id": "doll-001",
      "name": "さくらちゃん",
      "bodyImageFile": "doll-001-body.png",
      "faceImageFile": "doll-001-face.png",
      "skinTone": "fair",
      "defaultUnderwear": {
        "top": "underwear-white-top",
        "bottom": "underwear-white-bottom"
      },
      "tags": ["基本", "色白"],
      "author": "作者名",
      "createdAt": "2026-01-04"
    }
  ]
}
```

### フィールド説明

| フィールド | 必須 | 説明 |
|------------|------|------|
| id | ✅ | 一意のID（英数字とハイフン） |
| name | ✅ | 表示名（日本語OK） |
| type | ✅ | アイテムタイプ |
| imageFile | ✅ | 画像ファイル名 |
| position | ✅ | ドール上での配置位置 |
| baseZIndex | ✅ | 重ね順の基本値 |
| tags | ❌ | 検索/フィルタ用タグ |
| author | ❌ | 作者名 |
| createdAt | ❌ | 作成日 |

### baseZIndex 推奨値

| タイプ | 推奨値 | 説明 |
|--------|--------|------|
| underwear_top | 0 | 下着（上） |
| underwear_bottom | 1 | 下着（下） |
| shoes | 5 | 靴 |
| bottom | 10 | ボトムス |
| dress | 15 | ワンピース |
| top | 20 | トップス |
| accessory | 30 | アクセサリー |

### position 推奨値

| タイプ | 推奨position | 説明 |
|--------|--------------|------|
| underwear_top | { x: 0, y: -30 } | 胴体上部 |
| underwear_bottom | { x: 0, y: 30 } | 胴体下部 |
| top | { x: 0, y: -30 } | 胴体上部 |
| bottom | { x: 0, y: 30 } | 胴体下部 |
| dress | { x: 0, y: 0 } | 胴体中央 |
| shoes | { x: 0, y: 135 } | 足元 |
| accessory（頭） | { x: 0, y: -125 } | 頭上 |
| accessory（首） | { x: 0, y: -50 } | 首元 |

---

## 🔧 インポート手順

1. AI画像生成ツールでPNG画像を作成
2. 画像を適切なサイズにリサイズ・トリミング
3. 背景を透過処理
4. メタデータJSONを作成
5. アプリの「インポート」機能で読み込み

---

## 💡 Tips

### 良い結果を得るためのコツ

1. **シンプルに保つ**: フラットデザイン、少ない色数
2. **一貫性**: 同じスタイルでセットを作成
3. **透過確認**: 背景が完全に透明か確認
4. **サイズ調整**: 他のアイテムとバランスを確認
5. **アンカーポイント**: positionは中心基準で指定

### よく使う追加プロンプト

- `simple color palette` - シンプルな配色
- `bold outlines` - はっきりした輪郭線
- `no gradients` - グラデーションなし
- `cel shaded` - セルシェーディング風
- `vector art style` - ベクターアート風

### NG例

- 複雑なテクスチャや模様
- リアルな陰影
- 斜め向きや横向き
- 背景付き画像
- 解像度が低すぎる画像
