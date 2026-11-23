# 演出の絵: 洋服屋の店員とお店（2026-11-23）

注文・チケットを切る・服が届く、の 3 つの演出に使う絵。設計書 `../2026-11-23-closet-and-unstoppable-generation-design.md` の 5.5。

- 作る道具: `tools/art/shopArt.ts`（指示文は、その中の `PROMPTS`。キャラクター名・作品名・ブランド名を書かない、文字を入れない、の決まりつき）
- 絵柄の見本: `style-reference.png`（ドール「おんなのこ」に、公開の素材の 髪「なみなみロング」・顔「にこにこえがお」・服「アイドルドレス」を着せた絵）
- 画像生成: **5 枚**（Gemini `gemini-nano-banana-2.1`、1K）
  1. `work/order-raw-mwt04qre.png` — 注文を取る店員の候補 A（**採用**。ポニーテール）
  2. `work/order-raw-mwt059k0.png` — 候補 B（おだんご。使っていない）
  3. `work/ticket-raw-mwt06qfi.png` — チケットを切る店員（見本 + 候補 A を渡して、同じ人に）
  4. `work/deliver-raw-mwt072o6.png` — 服を届ける店員（同上）
  5. `work/shop-raw-mwt07ec2.png` — お店の中（人なし。まんなかは、文字を載せるために空けてある）
- 使っている絵: `src/assets/shop/order.webp`・`ticket.webp`・`deliver.webp`・`shop.webp`（長い辺 768px。店員は、緑の背景を抜いたもの。4 枚で約 206 KB）
- アプリでの読み込み: 「つくる」・届いた演出を開いたときだけ（最初の読み込みにも、オフライン用の先読みにも入れない）
- 一覧: `sheet.jpg`

## 作り直すとき

```bash
# 絵柄の見本（素材リポジトリは、先に pull しておく）
npx tsx tools/art/shopArt.ts ref ../DressUpGame-content 'アニメ　その２' docs/superpowers/specs/2026-11-23-shop-art/style-reference.png
# 注文を取る店員（1 回の実行で 1 枚）
NODE_USE_ENV_PROXY=1 GEMINI_API_KEY=dummy npx tsx tools/art/shopArt.ts order <出力フォルダ> <見本>
# 同じ人で、ほかの場面（えらんだ order の raw も渡す）
NODE_USE_ENV_PROXY=1 GEMINI_API_KEY=dummy npx tsx tools/art/shopArt.ts ticket <出力フォルダ> <見本> <order の raw>
# 背景の抜き方だけをやり直す（画像生成なし）
npx tsx tools/art/shopArt.ts cut order <raw> <出力の WebP>
```

## 分かったこと

- 店員の絵は、ひざの所で下の端まで届くので、「まわりが単色」を前提にしたドール用の切り抜き（`cutOutDoll`）が、そのままでは使えなかった。背景の色でまわりに余白を足してから切り抜く（`framed`）。
- 見本 + 1 枚目の絵を渡すと、2 枚目・3 枚目も、同じ人（顔・髪・エプロン・ポケットの中身まで）になった。
