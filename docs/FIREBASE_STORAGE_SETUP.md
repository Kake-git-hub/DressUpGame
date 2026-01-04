# Firebase Storage 画像アップロード手順

## Firebase Consoleでの設定

### 1. Storage Rules を設定
Firebase Console で **Storage** → **Rules** を開き、以下のルールを設定：

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // 全員が読み取り可能（公開）
    match /{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

**注意**: 上記は読み取りを全公開にしています。書き込みは認証ユーザーのみ。

### 2. 画像をアップロード

Firebase Console → **Storage** → **Files** タブで画像をアップロード：

#### フォルダ構造：
```
dolls/
  ├── doll-base.png      (ちびドール - 512x1024)
  └── doll-base-2.png    (スリムドール - 400x800)

clothing/
  ├── underwear-top.png
  ├── underwear-bottom.png
  ├── top-1.png
  ├── top-2.png
  ├── bottom-1.png
  ├── bottom-2.png
  ├── dress-1.png
  ├── shoes-1.png
  └── accessory-1.png

backgrounds/
  ├── room.png
  ├── park.png
  └── beach.png
```

### 3. 画像のアップロード方法

1. Firebase Console の **Storage** を開く
2. 「フォルダを作成」で `dolls`, `clothing`, `backgrounds` を作成
3. 各フォルダを開いて「ファイルをアップロード」

### 4. 確認

アップロード後、画像URLは以下の形式でアクセス可能：
```
https://firebasestorage.googleapis.com/v0/b/bboardgames-a5488.firebasestorage.app/o/dolls%2Fdoll-base.png?alt=media
```

## ローカルの既存画像

既存の画像ファイルは以下にあります：

- `public/assets/dolls/doll-base.png` → Firebase `dolls/doll-base.png`
- `public/images/*.png` → Firebase `clothing/` フォルダへ

## 新しい画像の追加

### ドールを追加する場合
1. Firebase Storage の `dolls/` フォルダに画像をアップロード
2. `src/App.tsx` の `AVAILABLE_DOLLS` 配列に追加

### 服を追加する場合
1. Firebase Storage の `clothing/` フォルダに画像をアップロード
2. `src/App.tsx` の `defaultClothingItems` 配列に追加

### 背景を追加する場合
1. Firebase Storage の `backgrounds/` フォルダに画像をアップロード
2. `src/App.tsx` の `AVAILABLE_BACKGROUNDS` 配列に追加

## 画像サイズの推奨

| 種類 | 推奨サイズ | 形式 |
|------|-----------|------|
| ドール | 512x1024 または 400x800 | PNG（透過） |
| 服 | 200x200 程度 | PNG（透過） |
| 背景 | 800x600 以上 | PNG または JPG |
