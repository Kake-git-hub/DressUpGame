# 6 番（テーマの細かさで、生成の幅を変える）: 文だけの比べ（2026-11-27）

画像は 0 枚。文の AI（gemini-3.8-flash）を 210 回（比べ）+ 30 回（下の日本語の要約）呼んだ。
ドールは「おんなのこ」、カテゴリは「ドレス」、絵柄は「アニメ」。テーマ 6 つ × 方法 5 つ × 各 5 回。

- **いまの方法**: いまの `planItems` そのまま。
- **「さっきと違うものに」だけ**: いまの方法に、同じ人が前に作った服の説明（この試しでは、同じテーマの前の回）を添えて「違うものに」と頼む。
- **くじのヒント**: 先に文の AI でテーマの「決まっていること」を数える（きっちり = 2 つ以上 → くじ 0 個／ふつう = 1 つ → 1〜2 個／ひろく = 0 → 2〜3 個）。決まっていない所から、こちらでくじを引いて添える。
- **くじのヒント + さっきと違うものに**: 上の 2 つを合わせる（きっちりのときは「違うものに」を添えない）。
- **1 回で頼む**: 測るのも選ぶのも、1 回の頼みの中で AI にさせる（くじは 7 つ全部わたす）+ さっきと違うものに。

数字の読み方: 「似ている度合い」= 5 回の説明どうしで、同じ単語がどのくらい重なるか（0〜100。小さいほど、ばらばら）。「色」= 5 回のうち、いちばん多く使う色が何種類あったか。
各行の 1 つめは日本語の要約（AI に訳させたもの。細かい所は英語の原文を見る）、2 つめが画像の AI に渡す説明（原文）。
「くじ」の表（色・柄・飾り・素材・形・丈とそで・ふんいき）は、試し用の仮のもの。

分かったこと:

- いまの方法は、同じテーマだと毎回ほぼ同じ（「ピンクの ドレス」は 5 回とも名前が「ぴんくのふりるどれす」、「はる」は 5 回とも桜色のフリル）。
- 細かさの判定は、テーマごとに 10 回とも同じ結果（細かい 2 つ = きっちり、「ピンクの ドレス」「うみのおひめさま」= ふつう、「はる」「ゆめ」= ひろく）。
- 「くじ + さっきと違うものに」は、細かいテーマではテーマどおり（くじ 0 個）、大きいテーマでは形・柄・色が散らばった。
- 「さっきと違うものに」だけでも散らばるが、細かいテーマでも毎回変える（セーラーえり・立ちえり・編み上げ などを足す）。また、その人の 1 着めは、だれでも同じになる。
- 「1 回で頼む」は待ち時間が短いが、細かいテーマでも飾りを足した。
- くじで、季節に合わない素材が出ることがある（「はる」にベルベット・コーデュロイ）。表から外すか、AI に捨てさせる決まりを強める。
- 待ち時間: いまの方法 9〜12 秒、くじ（2 回呼ぶ）は 12〜24 秒（この作業環境の中継ごしの数字。本物のサーバーでは測っていない）。

確かめられていないこと: 画像にしたときに、本当に散らばるか（文で散らばっても、画像の AI が似た絵にまとめることがある）。ドレス以外のカテゴリ（顔・髪・くつ など）とセット。

| テーマ | いまの方法 | 「さっきと違うものに」だけ | くじのヒント | くじのヒント + さっきと違うものに | 1 回で頼む（くじを全部わたす） |
|---|---|---|---|---|---|
| あかい リボンの ついた しろい ワンピース（細かい） | 29／1 色 | 17／1 色 | 36／1 色 | 44／1 色 | 16／1 色 |
| みずいろと しろの しましまで、すそに レースの ついた ながそでの ドレス（細かい） | 44／2 色 | 19／2 色 | 42／2 色 | 41／2 色 | 24／2 色 |
| ピンクの ドレス（ふつう） | 28／2 色 | 7／2 色 | 14／2 色 | 9／2 色 | 9／2 色 |
| うみのおひめさま（ふつう） | 22／1 色 | 8／5 色 | 20／2 色 | 9／4 色 | 10／4 色 |
| はる（大きい） | 26／1 色 | 14／5 色 | 17／2 色 | 13／4 色 | 13／5 色 |
| ゆめ（大きい） | 34／4 色 | 8／4 色 | 18／4 色 | 13／5 色 | 10／4 色 |

## 「あかい リボンの ついた しろい ワンピース」（細かい）

### いまの方法 — 似ている度合い 29、いちばん多い色の種類 1（白・白・白・白・白）、1 回 11.4 秒

1. **しろいリボンドレス**
   - 胸元に赤いリボンがあり丸首と裾にフリルが付いたパフ半袖の白いAラインドレス。
   - A bright white A-line dress with short puffed sleeves and delicate frills along the rounded neckline and hem, accented by a bold red ribbon bow tied at the center of the chest. The skirt has gentle gathered pleats that flare out softly.
2. **あかリボンのドレス**
   - 丸首にレースがあるパフ半袖の純白フレアドレスで、腰の大きな赤サテンリボンと裾の細い赤リボンが特徴。
   - A pure white flared one-piece dress with puffy short sleeves, featuring a large bright red satin bow at the waist and thin red ribbon trim along the hemline. The skirt has gentle folds and a soft frilled lace edge along the rounded neckline.
3. **しろいワンピース**
   - 丸襟と裾に繊細なレースを施したパフ半袖の白綿Aラインドレスで、ウエストに鮮やかな赤リボンを結ぶ。
   - A sweet white A-line cotton dress with puffy short sleeves, trimmed with delicate lace at the round collar and hem, highlighted by a bright red ribbon bow tied neatly at the waist.
4. **しろいわんぴーす**
   - 裾フリル付きのノースリーブ純白Aラインドレスで、ウエストに結ばれた鮮やかな赤サテンリボンが映える。
   - A sleeveless pure white A-line dress with a gently flared skirt and ruffled hem, adorned with a bright red satin bow ribbon tied prominently at the waist.
5. **あかりぼんワンピース**
   - 裾に白レースが付いたプリーツ入りの純白綿Aラインドレスで、腰の中央に鮮やかな赤リボンを結んでいる。
   - A pristine white cotton A-line dress featuring gentle pleats on the flared skirt and fine white lace trim along the hem. A vibrant red ribbon encircles the waist, tied into a charming neat bow at the front center.

### 「さっきと違うものに」だけ — 似ている度合い 17、いちばん多い色の種類 1（白・白・白・白・白）、1 回 11.2 秒

1. **あかりぼんワンピース**
   - レース丸襟と腰の大きな赤リボンが特徴の白のフレアワンピースで、パフ袖と膝丈フリル裾に赤リボンが付く。
   - A sweet white flared one-piece dress featuring a rounded Peter Pan collar trimmed with delicate lace and a prominent bright red satin ribbon bow at the center waist. The puffy short sleeves and ruffled knee-length hemline are decorated with small red ribbon accents.
2. **あかリボンワンピース**
   - 赤いパイピングのセーラー襟と胸元リボンが映える白のノースリーブAラインで、プリーツ裾に赤リボンが施される。
   - A crisp white sleeveless A-line dress featuring a sailor-style collar bordered with fine red piping and a bright red satin bow tied at the center chest. The pleated skirt is neatly edged with a bold red ribbon band along the hem.
3. **あかいリボンドレス**
   - 赤い編み上げとリボンがハイウエストに飾られた白シフォン服で、透けるベル袖と2段フリル裾が広がる。
   - An airy white chiffon empire-waist dress with sheer three-quarter bell sleeves, featuring red ribbon crisscross lacing up the front bodice and a vibrant red bow tied at the high waist. The flowing double-tiered skirt gently ripples outward with soft micro-ruffle hemlines.
4. **あかりぼんワンピース**
   - 両肩に赤サテンリボンを結んだ白サマードレスで、アイレットレースと小赤リボン付きの段フリル裾が広がる。
   - A charming white summer dress featuring a gently gathered sweetheart neckline and wide ruffled shoulder straps tied into vibrant red satin bows atop each shoulder. The bouncy tiered flared skirt is trimmed with delicate white eyelet lace and accented with small red ribbon bows along the lowest ruffle.
5. **あかリボンのしろドレス**
   - 首元に赤リボンの立ち襟とビショップ袖を持つ純白長袖服で、ピンタック胸元と腰の深紅サッシュが彩る。
   - A pure white long-sleeved dress featuring voluminous bishop sleeves with ruffled lace wrists and an upright lace collar accented by a bright red ribbon bow at the neckline. Delicate vertical pintucks decorate the front bodice above a flared two-tiered gathered skirt encircled at the waist by a wide crimson ribbon sash.

### くじのヒント — 似ている度合い 36、いちばん多い色の種類 1（白・白・白・白・白）、1 回 13.9 秒

1. **あかりぼんワンピース** 【きっちり 決まっている: colour,decoration】 くじ: なし
   - 丸襟とウエストの赤いリボンが特徴的な、半袖で膝丈の白いAラインワンピース。
   - A crisp white short-sleeved A-line one-piece dress crafted from smooth cotton fabric, featuring a neat round collar and a vibrant red ribbon bow tied at the waistline. The skirt flares out softly towards the knee with a simple, clean hem.
2. **あかりぼんワンピース** 【きっちり 決まっている: colour,decoration】 くじ: なし
   - 胸元に赤いリボンが付いた、半袖パフスリーブとフレアスカートの白いワンピース。
   - A clean white one-piece dress with short puffy sleeves and a flared skirt, decorated with a neat red ribbon bow at the center of the chest.
3. **しろいワンピース** 【きっちり 決まっている: colour,decoration】 くじ: なし
   - 胸元に鮮やかな赤いリボンを結んだ、半袖パフスリーブの白いAラインワンピース。
   - A clean pure white A-line dress with short puff sleeves, featuring a vibrant red ribbon bow tied neatly at the center of the chest. The flared skirt has a simple, smooth hemline with soft fabric folds.
4. **しろいワンピース** 【きっちり 決まっている: colour,decoration】 くじ: なし
   - 丸襟と胸元の赤いリボンが際立つ、半袖で膝丈の白いAラインワンピース。
   - A clean white short-sleeved A-line dress featuring a rounded collar and a bright red ribbon bow tied neatly at the center of the chest. The knee-length skirt flares out gently with a smooth hemline.
5. **あかりぼんのワンピ** 【きっちり 決まっている: colour,decoration】 くじ: なし
   - ウエストに赤いリボンを結んだ、膝丈フレアの白いノースリーブAラインワンピース。
   - A clean white sleeveless A-line dress with a knee-length flared skirt, adorned with a bright red ribbon tied neatly at the center of the waistline. The fabric is smooth and bright white with gentle folds and a neat, simple hemline.

### くじのヒント + さっきと違うものに — 似ている度合い 44、いちばん多い色の種類 1（白・白・白・白・白）、1 回 15.9 秒

1. **しろいワンピース** 【きっちり 決まっている: colour,decoration】 くじ: なし
   - 丸首で半袖パフスリーブの白いAラインワンピースで、ウエスト中央に鮮やかな赤いリボン結びが付いています。
   - A clean white A-line dress with short puffed sleeves and a round neckline, featuring a bright red ribbon bow tied at the center of the waist. The skirt falls softly in smooth folds with a simple, unadorned hem.
2. **しろいワンピース** 【きっちり 決まっている: colour,decoration】 くじ: なし
   - 半袖パフスリーブと広がるスカートの純白ワンピで、胸元中央に鮮やかな赤いリボンが付いています。
   - A simple pure white one-piece dress with short puffed sleeves and a softly flared skirt, decorated with a neat bright red ribbon tied at the center of the chest.
3. **しろいワンピース** 【きっちり 決まっている: colour,decoration】 くじ: なし
   - ウエスト中央に鮮やかな赤いリボンが付いた、純白でノースリーブのAラインフレアワンピースです。
   - A simple pure white sleeveless one-piece dress with an A-line flared skirt, decorated with a bright red ribbon bow tied at the center of the waist.
4. **あかリボンワンピース** 【きっちり 決まっている: colour,decoration】 くじ: なし
   - 丸首で緩やかに広がる白い半袖Aラインワンピで、胸元中央に鮮やかな赤のサテンリボンが結ばれています。
   - A clean white short-sleeved one-piece dress with a gently flared A-line skirt and a simple round neckline. A bright red satin ribbon is neatly tied into a bow at the center of the chest.
5. **あかリボンワンピ** 【きっちり 決まっている: colour,decoration】 くじ: なし
   - 丸首の純白ノースリーブAライン綿ワンピで、胸元中央に鮮やかな赤いリボン結びが付いています。
   - A pure white sleeveless A-line dress crafted from crisp cotton, featuring a neat round neckline. A bright red ribbon bow is tied cleanly at the center of the chest above the gently flared skirt.

### 1 回で頼む（くじを全部わたす） — 似ている度合い 16、いちばん多い色の種類 1（白・白・白・白・白）、1 回 11.4 秒

1. **しろいワンピース**  くじ: Aライン、ラベンダー、ギンガムチェック（先頭 3 つ）
   - 胸元に赤いリボン、丸襟とパフ半袖、裾に赤リボンをあしらった白のフレアワンピース。
   - A crisp white flared one-piece dress featuring short puffed sleeves, a gentle round collar, and a vibrant red ribbon bow centered at the chest. The soft white skirt flows gently downward with subtle pleats and a thin red ribbon trim along the hem.
2. **しろのリボンドレス**  くじ: サテン、ポケット、パフスリーブ・ひざたけ（先頭 3 つ）
   - 肩紐フリルとスクエアネックが特徴の白のAラインワンピースで、腰に結んだ赤いリボンが映える。
   - A pristine white sleeveless A-line dress with delicate ruffled shoulder straps and a square neckline. A bright red ribbon sash wraps around the waistline and is tied neatly into a prominent bow at the center.
3. **あかリボンのしろわんぴ**  くじ: ニット、ハート、むらさき（先頭 3 つ）
   - 胸元と袖口に赤いリボンを添えた、セーラー襟と段々ギャザースカートの白の長袖ワンピース。
   - A pure white long-sleeved dress featuring a broad white sailor collar fastened at the center with a crisp red ribbon bow tie. The sleeves have neat buttoned cuffs accented with small matching red bows, leading down to a tiered gathered skirt.
4. **あかリボンワンピ**  くじ: まるいボタン、クリームとちゃいろ、ナチュラル（先頭 3 つ）
   - フリル立ち襟の下に赤い光沢リボンを飾り、ピンタックと釣鐘型スカートを備えた白のワンピース。
   - A crisp white dress with an elegant frilled stand collar, elbow-length bishop sleeves with ruffled cuffs, and a fluffy bell-shaped skirt. Fine vertical pintucks detail the bodice, accented by a neat, glossy red ribbon bow pinned below the neck frill.
5. **しろワンピとあかリボン**  くじ: クール、ベルスリーブ・ひざたけ、まるいボタン（先頭 3 つ）
   - キャップ袖の白綿ベビードールワンピースで、前身頃に赤いサテンリボンの編み上げと結び目がある。
   - A breezy white cotton tiered babydoll dress featuring fluttery cap sleeves and a soft boat neckline. Bright red satin ribbon laces neatly criss-cross through small eyelets down the front bodice, tied into a charming red bow at the center.

## 「みずいろと しろの しましまで、すそに レースの ついた ながそでの ドレス」（細かい）

### いまの方法 — 似ている度合い 44、いちばん多い色の種類 2（青・水色・青・水色・水色）、1 回 8.5 秒

1. **しましまレースドレス**
   - 水色と白のボーダー柄長袖ワンピで、白丸襟と裾・袖口のフリルレース、胸元の小リボンが特徴。
   - A sweet long-sleeved dress decorated with horizontal light sky-blue and white stripes, featuring a round white Peter Pan collar and delicate ruffled white lace along the hem and cuffs. A small pastel blue ribbon is tied neatly at the center of the neckline.
2. **しましまレースドレス**
   - 水色と白のボーダー柄長袖Aラインワンピで、丸襟と裾や袖口の白フリルレース、プリーツが上品。
   - A charming long-sleeved A-line dress featuring horizontal light blue and white stripes, finished with delicate white frilly lace trim along the bottom hem and sleeve cuffs. It has a neat rounded collar and softly flaring skirt pleats.
3. **しましまドレス**
   - パステル水色と白のストライプ柄長袖Aラインワンピで、白丸襟、小リボン、裾や袖口のレース付き。
   - A long-sleeved A-line dress featuring pastel light blue and white vertical stripes, finished with delicate white scalloped lace along the hem and sleeve cuffs. A neat white rounded collar and a small light blue ribbon decorate the neckline.
4. **しましまレースドレス**
   - 淡い水色と白の縞柄長袖Aラインワンピで、白い丸襟と袖口や裾にあしらった繊細なフリルレースが魅力。
   - A charming long-sleeved A-line dress patterned with soft light blue and white stripes, featuring a neat white Peter Pan collar and delicate frilly lace trim along the cuffs and skirt hem.
5. **しましまレースドレス**
   - 優しい水色と白の縦縞長袖Aラインワンピで、白丸襟に小リボン、裾と袖口に白フリルレースを飾る。
   - A long-sleeved A-line dress featuring gentle sky-blue and white vertical stripes, detailed with soft white frilly lace along the hem and sleeve cuffs. A neat white round collar with a tiny pastel blue ribbon decorates the neckline.

### 「さっきと違うものに」だけ — 似ている度合い 19、いちばん多い色の種類 2（水色・水色・青・青・水色）、1 回 11.7 秒

1. **しましまのドレス**
   - 水色と白の縦縞の長袖ワンピースで、丸襟や袖と裾の白レース、首元の青いリボンが特徴です。
   - A charming long-sleeved dress with sky blue and white vertical stripes, featuring a classic round collar and soft gathers at the waist. Delicate white ruffled lace accents adorn the sleeve cuffs and the bottom hem, finished with a small blue bow at the neckline.
2. **しましまレースドレス**
   - シアンと白の太い横縞のAライン長袖ワンピースで、スクエアネックと裾の白い花柄2段レースが目を引きます。
   - An A-line long-sleeved dress patterned with bold horizontal stripes of pastel cyan and crisp white, featuring airy bishop sleeves and a clean square neckline. The wide swinging hem is trimmed with a lush double-layered ruffle of scalloped floral white lace.
3. **しましまれーすどれす**
   - 水色と白の斜め縞のエンパイアワンピースで、大きなセーラー襟とベル袖、裾の白いレースが調和しています。
   - An empire-waist dress with diagonal light blue and white candy stripes, styled with wide sailor lapels and flowing bell sleeves. The flared skirt finishes at the bottom hem with a delicate wide trim of white scalloped eyelet lace.
4. **みずいろしまのドレス**
   - 水色と白の細い縦縞の立ち襟長袖ワンピースで、控えめなパフ袖と裾の純白刺繍スカラップレースが優美です。
   - A high-collared long-sleeved dress featuring fine vertical pinstripes of pastel sky blue and white, with gentle shoulder puffs and neat fitted cuffs. The flared skater skirt finishes at the bottom hem with a wide, intricate band of pure white embroidered scalloped lace.
5. **しましまレースドレス**
   - 水色と白の横縞のローウエスト長袖ワンピースで、前ボタンとプリーツ裾の白い花柄レースが印象的です。
   - A long-sleeved drop-waist dress patterned with alternating sky blue and white horizontal stripes, featuring gathered lantern sleeves and a front row of pearlescent buttons. The accordion-pleated skirt flares gently toward the bottom hem, which is bordered with a wide, tiered ruffle of delicate white floral lace.

### くじのヒント — 似ている度合い 42、いちばん多い色の種類 2（水色・水色・水色・水色・青）、1 回 17.5 秒

1. **しましまのドレス** 【きっちり 決まっている: colour,pattern,decoration,length】 くじ: なし
   - 水色と白のボーダー柄長袖ワンピースで、裾に繊細な白レースがあしらわれています。
   - A long-sleeved dress featuring horizontal light blue and white stripes, finished with a delicate white lace trim along the skirt hem.
2. **しましまドレス** 【きっちり 決まっている: colour,pattern,decoration,length】 くじ: なし
   - 丸首で水色と白のボーダー柄長袖膝丈フレアワンピースで、裾に繊細な白フリルレース付きです。
   - A sweet long-sleeved dress with alternating horizontal light blue and white stripes, featuring a flared knee-length skirt trimmed with delicate white frilled lace along the hem. It has a simple rounded neckline and straight-cut long sleeves in matching striped fabric.
3. **しましまドレス** 【きっちり 決まっている: colour,pattern,decoration,length】 くじ: なし
   - 丸首に水色と白のボーダー柄長袖フレアワンピースで、裾には繊細な白レースが施されています。
   - A long-sleeved dress patterned with horizontal light blue and white stripes, featuring a flared skirt trimmed with delicate white lace along the hemline. The full-length sleeves are neatly finished at the cuffs to match the round neckline.
4. **しましまレースドレス** 【きっちり 決まっている: colour,pattern,decoration,length】 くじ: なし
   - 水色と白のボーダー柄の丸首長袖膝丈ワンピースで、裾に繊細な白レースが施されています。
   - A knee-length long-sleeved dress featuring horizontal light blue and white stripes, trimmed with delicate white lace along the hemline. The dress has a simple round neckline and matching striped sleeves.
5. **しましまドレス** 【きっちり 決まっている: colour,pattern,decoration,length】 くじ: なし
   - 水色と白のボーダー柄長袖フレアワンピースで、裾に繊細な白いフリルレースがあしらわれています。
   - A long-sleeved flared dress featuring light blue and white stripes across the entire fabric. The bottom edge of the skirt is finished with a delicate trim of frilly white lace.

### くじのヒント + さっきと違うものに — 似ている度合い 41、いちばん多い色の種類 2（水色・水色・水色・水色・青）、1 回 16.7 秒

1. **しましまドレス** 【きっちり 決まっている: colour,pattern,decoration,length】 くじ: なし
   - 丸襟と裾の白いスカラップレースが特徴の水色と白の長袖ドレス。
   - A long-sleeved dress featuring crisp light blue and white stripes throughout, complemented by a delicate scalloped white lace trim along the flared skirt hem. The dress has simple cuffs and a neat, rounded collar.
2. **しましまドレス** 【きっちり 決まっている: colour,pattern,decoration,length】 くじ: なし
   - 水色と白のストライプ柄で、フレア裾に繊細な白レースが付いた長袖ドレス。
   - A long-sleeved dress patterned with clean light blue and crisp white stripes throughout. The slightly flared skirt finishes with a band of delicate white frilly lace along the hem.
3. **しましまドレス** 【きっちり 決まっている: colour,pattern,decoration,length】 くじ: なし
   - 水色と白のボーダー柄コットン長袖ドレスで、丸首と裾の白レースが特徴。
   - A long-sleeved cotton dress patterned with horizontal light blue and white stripes, featuring a simple round neckline and neat sleeve cuffs. The flared skirt hem is trimmed all along the bottom edge with delicate white scalloped lace.
4. **しましまドレス** 【きっちり 決まっている: colour,pattern,decoration,length】 くじ: なし
   - 水色と白の横縞の長袖コットンドレスで、フレア裾に白いフリルレース付き。
   - A long-sleeved cotton dress with alternating horizontal light blue and white stripes all over. The full-length sleeves have neat simple cuffs, and a delicate band of white ruffled lace trims the bottom hem of the flared skirt.
5. **しましまれーすどれす** 【きっちり 決まっている: colour,pattern,decoration,length】 くじ: なし
   - 水色と白のストライプ柄長袖Aラインドレスで、裾に繊細な白レース付き。
   - A long-sleeved A-line dress patterned with clean light blue and white stripes, featuring fine white ruffled lace along the bottom hem. The sleeves are full-length with simple cuffs matching the striped fabric.

### 1 回で頼む（くじを全部わたす） — 似ている度合い 24、いちばん多い色の種類 2（水色・青・水色・水色・水色）、1 回 11.9 秒

1. **しましまドレス**  くじ: しましま、バルーン、みどり（先頭 3 つ）
   - 水色と白の縦縞の長袖フレアドレスで、フリルの袖口と裾の白レース、首元の小リボンが特徴。
   - A sweet long-sleeved dress with bright light blue and white vertical stripes, featuring ruffled sleeve cuffs and a flared skirt. The bottom hem is decorated with delicate white lace trim and a small ribbon detail at the neckline.
2. **しましまレースドレス**  くじ: おおきなリボン、ローウエスト、ロングたけ（先頭 3 つ）
   - 水色と白のボーダー柄長袖Aラインワンピで、裾にスカラップ柄の幅広な白い透かしレースが付く。
   - A long-sleeved A-line dress featuring horizontal light blue and white stripes with a neat crew neckline and straight sleeves. The bottom hem is bordered with broad white openwork lace displaying delicate scallop details.
3. **しましまれーす**  くじ: Aライン、そでなし・ひざたけ、みんぞくふう（先頭 3 つ）
   - 水色と白の横縞ハイウエストスモックドレスで、長袖ビショップ袖と裾の花柄白レースが特徴。
   - A high-waisted smock dress with light blue and white horizontal stripes, featuring voluminous long bishop sleeves gathered at the wrists. The gathered ruffled hem is finished with a wide border of delicate white floral eyelet lace.
4. **しましまドレス**  くじ: オレンジ、ししゅう、みずたま（先頭 3 つ）
   - 白襟付きの水色と白のストライプ長袖セーラーワンピで、裾に白いスカラップレースを飾る。
   - A long-sleeved sailor dress decorated with crisp light blue and white stripes, featuring a classic white sailor collar and fitted long sleeves. The pleated skirt flares neatly downward and is trimmed at the bottom hem with a delicate band of scalloped white lace.
5. **しましまレースワンピ**  くじ: ハート、ふだんぎ、シフォン（先頭 3 つ）
   - 丸襟と前ボタンが付いた水色と白の縞柄長袖ローウエストワンピで、裾に白い花柄レースを施す。
   - A charming long-sleeved drop-waist dress decorated with alternating light blue and white stripes, featuring a rounded peter pan collar and buttoned front placket. The low-waisted flounce hem is delicately trimmed with a wide band of pure white floral lace.

## 「ピンクの ドレス」（ふつう）

### いまの方法 — 似ている度合い 28、いちばん多い色の種類 2（ピンク・赤・赤・赤・赤）、1 回 9.8 秒

1. **ぴんくのふりるどれす**
   - パフ袖や多層フリル、胸元の白レースと腰の濃いピンクリボンが輝く淡いピンクのドレス。
   - A voluminous pastel pink ballgown featuring puffed short sleeves, white lace along the neckline, and multi-layered frilled skirts. A vivid rose-pink satin ribbon and bow decorate the waistline, with gentle sparkles scattered over the soft fabric.
2. **ぴんくのふりるどれす**
   - パフ袖やチュールフリル、白レースとパールを散らし、大きなピンクリボンを飾った淡いピンクのドレス。
   - A fluffy pastel pink ballgown with puffed sleeves, tiered tulle frills, and a large bright pink satin bow at the waist. The skirt layers are trimmed with delicate white lace edging and scattered with tiny pearl bead accents.
3. **ぴんくのふりるどれす**
   - 裾の白レースとフリル、胸元のパールや腰の大きなマゼンタのリボンが飾る淡いピンクサテンのドレス。
   - A bell-shaped princess gown made of pastel pink satin featuring tiers of gathered frills and white lace along the hem. The fitted bodice is adorned with a large magenta ribbon at the waist and delicate pearl bead accents across the neckline.
4. **ぴんくのふりるどれす**
   - 段々フリルとパフ袖に白レースを配し、大きなサテンリボンと小粒の宝石が輝く淡いピンクのドレス。
   - A frilly pastel pink ballgown dress with tiered ruffled skirts, short puffy sleeves, and a big satin ribbon bow at the waistline. Fine white lace lines the neckline and tiers, accented by sparkling tiny gem brooches.
5. **ぴんくのふりるどれす**
   - パフ袖やフリルスカートに、白レースとウエストの大きなマゼンタサテンリボンが映える淡いピンクのドレス。
   - A sweet pastel pink ballgown dress featuring puffed short sleeves, a flared tiered ruffle skirt, and a large magenta satin bow at the waist. The hem and neckline are trimmed with delicate white frills and scalloped lace details.

### 「さっきと違うものに」だけ — 似ている度合い 7、いちばん多い色の種類 2（赤・ピンク・赤・ピンク・ピンク）、1 回 15.9 秒

1. **ぴんくのふりるどれす**
   - パステルピンクのフリル付き舞踏会ドレス。白レースとリボン飾りが特徴。
   - A sweet pastel pink ballgown dress with layered ruffled skirts, puffed sleeves, and a prominent pink ribbon bow on the waistline. Delicate white lace borders the scalloped hems and neckline for an elegant finish.
2. **きらきらローズドレス**
   - 鮮やかなローズピンクのパーティードレス。星のブローチがスカートを飾る。
   - A vibrant rose-pink party dress featuring a halter-neck bodice and an asymmetrical high-low tiered tulle skirt. Shimmering magenta ribbon trim and tiny golden star brooches accent the layered skirt edges.
3. **ちゅりっぷドレス**
   - 花びら裾のコーラルピンクドレス。真珠と花のブローチで飾られている。
   - A coral-pink tulip-hem dress featuring short cap sleeves and an overlapping petal-shaped skirt with smooth rounded borders. Soft cream-white pearl beads line the square neckline, accented by a tiny sparkling blossom brooch at the center of the chest.
4. **ピンクのシフォンドレス**
   - 透けるベル袖のカーネーションピンクシフォンドレス。銀の星柄が輝く。
   - An empire-waist carnation-pink chiffon dress featuring sheer flowing bell sleeves and a finely pleated floor-length skirt. A shimmering silver filigree brooch accents the shallow V-neckline, complemented by delicate silver starburst patterns along the hemline.
5. **キャンディピンクドレス**
   - ハートのブローチが輝く、ボリューム裾のバブルガムピンクドレス。
   - A sweet off-the-shoulder bubblegum pink dress featuring a voluminous bubble-hem skirt with sparkly sheer tulle overlays. A sparkling crystalline heart brooch sparkles at the sweetheart neckline, accented by tiny satin bows along the waist.

### くじのヒント — 似ている度合い 14、いちばん多い色の種類 2（赤・ピンク・赤・赤・赤）、1 回 20.6 秒

1. **ぴんくのふりるどれす** 【ふつう 決まっている: colour】 くじ: むじ
   - 無地ベビーピンクのサテン製で、腰にリボン、裾にフリルとスカラップ飾りのある釣鐘型ドレス。
   - A sleeveless princess gown made of smooth, plain baby pink satin with no surface patterns, featuring a sweetheart neckline and a neatly tied pastel pink ribbon sash at the waist. The flared bell-shaped skirt is edged with generous layers of soft pink ruffles and clean scalloped trim along the hem.
2. **ぴんくのエプロンドレス** 【ふつう 決まっている: colour】 くじ: ジャンパースカート
   - 白フリル肩紐と真珠ボタン、裾レース付きの淡い桃色エプロンドレスで、腰にローズのリボンを結ぶ。
   - A charming pastel pink pinafore dress with frilly white-trimmed shoulder straps, a decorative bib with tiny pearl buttons, and a flared gathered skirt edged with a delicate lace hem. A soft rose-pink ribbon tied into a neat bow sits prettily at the waistband.
3. **ピンクシフォンドレス** 【ふつう 決まっている: colour】 くじ: シフォン、クール
   - プリーツ身頃と不規則な裾が特徴の桃色シフォン製膝丈ドレスで、腰にくすみローズのリボンが映える。
   - A chic knee-length dress crafted from layered airy pink chiffon, featuring a sleek pleated bodice and an asymmetrical flowing hem. The waist is accented with a cool dusty-rose ribbon band tied into a sharp, stylish bow.
4. **ぴんくのどれす** 【ふつう 決まっている: colour】 くじ: むじ
   - パフスリーブと白フリル付きの無地淡桃色膝丈ドレスで、腰に大きなラズベリーピンクリボンを飾る。
   - A charming knee-length party dress made of solid pastel pink fabric with no printed patterns, featuring short puffed sleeves and a flared tiered skirt. A large ribbon in rich raspberry pink accentuates the waistline, trimmed with clean white frills along the neckline and hem.
5. **ピンクフリルドレス** 【ふつう 決まっている: colour】 くじ: ベルスリーブ・ひざたけ
   - 白レースのベル袖と襟に真珠をあしらった桃色サテンの膝丈ドレスで、腰に濃いローズのリボンがある。
   - A sweet knee-length dress made of layered soft pink satin with flowing bell sleeves trimmed with white scalloped lace. A glossy deep rose pink ribbon bow sits at the waist, adorned with tiny pearl accents along the ruffled collar.

### くじのヒント + さっきと違うものに — 似ている度合い 9、いちばん多い色の種類 2（赤・ピンク・ピンク・赤・赤）、1 回 17.3 秒

1. **ぴんくのみずたまどれす** 【ふつう 決まっている: colour】 くじ: みずたま
   - 白水玉の釣鐘型スカートと裾フリル、腰リボンが付いた桃色のパフ袖ドレス。
   - A fluffy layered pink party dress with short puffed sleeves and a wide bell-shaped skirt decorated with white polka dots. A soft satin sash ties into a cute bow at the waist, trimmed with delicate white ruffles along the hem.
2. **プリンセスドレス** 【ふつう 決まっている: colour】 くじ: おとぎばなし、ロングたけ
   - 金糸刺繍や透ける釣鐘袖、小薔薇の裾飾りが華やかな淡い桃色の足首丈ドレス。
   - An ankle-length fairy-tale ballgown crafted from soft pastel pink satin with an overlay of shimmering translucent tulle. It features sheer long bell sleeves, delicate gold filigree embroidery across the sweetheart bodice, and scalloped hemline ruffles adorned with tiny rose-shaped ribbon accents.
3. **バルーンドレス** 【ふつう 決まっている: colour】 くじ: バルーン、ポケット
   - 白ボタン付き丸ポケットとバルーン裾が特徴のノースリーブの桃色ドレス。
   - A cheerful sleeveless pink dress featuring a voluminous balloon hem that softly gathers inward at the bottom. Two rounded patch pockets decorate the front skirt, each detailed with a neat white button and subtle stitched edging.
4. **こばなぴんくどれす** 【ふつう 決まっている: colour】 くじ: こばな
   - 白レース襟とキャップ袖、小花柄の三段フリルが揺れる膝丈の桃色ドレス。
   - A breezy knee-length tiered dress made of bright blush pink cotton, completely adorned with an all-over small flower print of white and deep rose blossoms. It features fluttery cap sleeves, a neat square neckline edged with delicate white lace trim, and three softly gathered ruffled tiers along the A-line skirt.
5. **ぴんくのしゃつどれす** 【ふつう 決まっている: colour】 くじ: ロングたけ、ふだんぎ
   - 襟や胸ポケット、共布ベルトと前ボタンが並ぶくすみピンクの足首丈シャツドレス。
   - A casual ankle-length button-down shirt dress in soft dusty pink cotton with short rolled-up sleeves and a crisp pointed collar. It features a row of small cream buttons down the front, two neat chest pockets, and a matching fabric belt tied loosely at the waist above a relaxed, straight-falling skirt.

### 1 回で頼む（くじを全部わたす） — 似ている度合い 9、いちばん多い色の種類 2（赤・ピンク・赤・ピンク・ピンク）、1 回 13.7 秒

1. **ぴんくのおはなどれす**  くじ: こばな、ジャンパースカート、ながそで・ミモレたけ（先頭 3 つ）
   - 白や黄の小花柄が広がるパステルピンクのエプロン風ドレスで、裾の白レースとウエストのリボンが特徴です。
   - A pastel pink pinafore-style dress featuring wide shoulder straps, a square neckline, and a gently flared skirt patterned with delicate little white and yellow flowers. Soft white ruffled lace accents the hem and neckline, finished with a neat pink ribbon at the front waistband.
2. **ちぇっくのどれす**  くじ: クール、タータンチェック、パステルの まぜいろ（先頭 3 つ）
   - ピンクとチャコールのチェック柄のノースリーブブレザードレスで、黒のダブルボタンと裾プリーツが際立ちます。
   - A cool and chic sleeveless blazer dress tailored in a stylish pink and charcoal tartan plaid pattern with a sharp notched collar. It features neat double-breasted dark buttons at the front and a crisp pleated hemline.
3. **ぴんくバルーンドレス**  くじ: スカラップ、しろ＋さしいろ、バルーン（先頭 3 つ）
   - パフスリーブとバルーン裾が愛らしい苺色ドレスで、襟元と裾の白いスカラップと腰のリボンが魅力です。
   - A charming strawberry-pink dress featuring short puffed sleeves and a puffy, rounded balloon hem skirt. Delicate white scalloped edges trim the scoop neckline and hem, accented with a small soft pink satin bow at the waist.
4. **ぽんぽんニットドレス**  くじ: ニット、ポンポン、ふんわり ドレス（先頭 3 つ）
   - タートルネックの淡いピンクのケーブルニットドレスで、胸元や裾に揺れる白いポンポンがついています。
   - A cosy blush-pink cable-knit dress featuring long ribbed sleeves, a folded turtleneck, and cheerful fluffy white pom-poms dangling along the chest yoke and skirt hem. Soft ribbing finishes the cuffs and hemline of the warm, relaxed silhouette.
5. **すぽーてぃどれす**  くじ: クリームとちゃいろ、タータンチェック、スポーティ（先頭 3 つ）
   - 袖に白ラインが入った鮮やかなピンクの半袖パーカードレスで、フード裏やポケットのチェック柄が映えます。
   - A sporty bright pink short-sleeved hoodie dress made of soft cotton fleece, accented with twin white athletic stripes along the sleeves. The hood interior and a roomy front kangaroo pouch feature a cheerful pink and white tartan plaid pattern, finished with white braided drawstrings.

## 「うみのおひめさま」（ふつう）

### いまの方法 — 似ている度合い 22、いちばん多い色の種類 1（水色・水色・水色・水色・水色）、1 回 12.6 秒

1. **うみのプリンセスドレス**
   - 輝く水色と薄紫のオーガンジーに真珠の貝殻身頃と波フリルが広がる海のドレス。
   - A flowing sea-themed ballgown made of shimmering aquamarine and soft lavender organza, featuring a shell-shaped scalloped bodice adorned with lustrous pearls and translucent ocean-wave tiered ruffles.
2. **アクアプリンセスドレス**
   - 白真珠の貝殻身頃に水色と薄紫のチュール、波フリルと真珠房が揺れる釣鐘型ドレス。
   - A sparkling ocean princess gown crafted from layered aqua blue and soft lilac tulle, featuring a shell-shaped bodice trimmed with white pearls. The flowing bell-shaped skirt is adorned with wave-like scalloped frills, translucent sea-glass shimmer accents, and delicate pearl bead tassels.
3. **うみのプリンセスドレス**
   - 真珠飾りの水色貝殻身頃に波フリルの青緑スカート、桃色ヒトデと金縁が輝くドレス。
   - A flowing princess ballgown with a seashell-scalloped aqua bodice adorned with white pearls, layered over a shimmering turquoise skirt with translucent wave-like organza ruffles. The hemline sparkles with soft pink starfish motifs and gentle golden trim.
4. **うみのプリンセスドレス**
   - 白真珠の貝殻身頃に水色と薄紫の波状チュールが広がり、小粒真珠とリボンが光るドレス。
   - A sparkling ocean princess gown with a scalloped seashell bodice trimmed in white pearls, leading into a flared seafoam-blue and soft lavender skirt. The tiered tulle ruffles resemble gentle waves and are adorned with tiny pearl beads and ribbon accents.
5. **うみのどれす**
   - 輝く水色サテンと透ける波フリルに白真珠を散らし、裾に波形飾りを施したドレス。
   - A flowing layered princess gown made of glittering aquamarine satin and translucent seafoam ruffles, decorated with white pearl beads and delicate scalloped wave trims along the hem.

### 「さっきと違うものに」だけ — 似ている度合い 8、いちばん多い色の種類 5（水色・赤・青・黄・紫）、1 回 11.7 秒

1. **うみのプリンセスドレス**
   - 真珠と貝殻が輝くスカラップ胸元に水色とシーフォームの段々スカートが広がる波のようなドレス。
   - A sparkling ocean-princess ballgown made of layered aqua and seafoam organza, featuring a scallop-edged sweetheart bodice decorated with iridescent pearls and seashell motifs. The voluminous tiered skirt flares outward in wavy translucent layers that resemble rippling sea waves.
2. **さんごのおひめさま**
   - 金のヒトデや真珠を腰に飾り、膝下からヒレ状シフォンが広がる珊瑚色と淡紫のマーメイドドレス。
   - A fitted mermaid-cut gown crafted from coral pink satin and shimmering lavender organza, adorned with dangling golden starfish charms and strands of tiny pearls at the waist. The skirt flows down smoothly before bursting at the knees into layers of flowing, translucent fin-shaped chiffon flounces.
3. **くらげひめドレス**
   - 水晶やリボンが揺れる丸い裾が特徴的な、濃紺と淡緑サテンのクラゲ風エンパイアドレス。
   - An empire-waist fantasy gown crafted from midnight-blue satin and translucent mint-tinted organza inspired by a glowing jellyfish. The puffy bell-shaped skirt features a rounded bubble hem layered with floating translucent ribbon streamers and shimmering crystal bubble accents.
4. **しんじゅのドレス**
   - 真珠飾りの四角襟と薄紫リボンにレースフリルが重なる、生成りと杏色のAラインドレス。
   - A royal A-line gown crafted from ivory mother-of-pearl satin with a split golden-apricot organza overskirt. The square-neck bodice is lined with delicate pearl beadwork, while the draped overskirt cascades down with scalloped sea-lace ruffles and soft lilac ribbon bows.
5. **しんじゅのドレス**
   - 螺旋貝ペプラムや金糸刺繍と真珠飾りのフリルが覗く、白と深紫のオフショルダードレス。
   - An off-the-shoulder regal gown made of lustrous pearl-white satin and deep royal-amethyst glitter tulle, featuring an asymmetrical swirling nautilus-shaped peplum. The high-low cascading skirt reveals pleated lilac ruffles bordered with golden spiral shell embroideries and dangling pearl drops.

### くじのヒント — 似ている度合い 20、いちばん多い色の種類 2（水色・水色・青・水色・水色）、1 回 24.2 秒

1. **しーぷりんせすどれす** 【ふつう 話題: うみ,おひめさま】 くじ: バルーン
   - 泡緑と海青のバルーン裾に、淡いピンクの貝殻と真珠でスカラップ身頃を飾ったドレス。
   - An ocean princess ballgown with a puffed balloon hem skirt layered in shimmering seafoam organza and sea-blue satin. The scalloped bodice is decorated with pastel pink seashell ornaments and delicate pearl trim.
2. **うみのおひめさまドレス** 【ふつう 話題: うみ,おひめさま】 くじ: ししゅう
   - アクアマリンと泡緑の段フリル裾に金色の貝やヒトデを刺繍し、真珠とチュールを飾ったドレス。
   - A sparkling ocean-princess ballgown made of layered aquamarine and seafoam satin, featuring wave-like scalloped ruffles and intricate golden embroidery of seashells and starfish along the hemline. The bodice is accented with shiny white pearl trim and translucent turquoise tulle frills around the neckline and waist.
3. **うみのプリンセスドレス** 【ふつう 話題: うみ,おひめさま】 くじ: こんいろ
   - 紺地に水色の波フリルが重なり、襟に金色のヒトデ、裾に貝殻をあしらった真珠付きドレス。
   - A flowing navy blue ocean ballgown with layered aquamarine translucent organza ruffles resembling gentle ocean waves. The bodice features delicate white pearl trim and a golden starfish brooch at the neckline, while shimmering shell accents line the scalloped hem.
4. **うみのレースワンピ** 【ふつう 話題: うみ,おひめさま】 くじ: ふだんぎ、レース
   - 水色の波グラデとミントのプリーツに、白レースと貝殻ボタンをあしらったサンドレス。
   - A casual aqua blue sundress with a gentle ocean-wave gradient and soft mint pleats, featuring delicate white scalloped lace trim along the hem and collar, accented with small pearlescent shell buttons down the front.
5. **マリンベリードレス** 【ふつう 話題: sea,princess】 くじ: くだもの
   - 波打つ水色フリルに苺柄が映え、透けるパフ袖や貝のリボン、真珠を添えた豪華なドレス。
   - A princess ballgown featuring shimmering aqua and seafoam layered ruffled skirts that ripple like ocean waves, patterned with sweet red strawberry prints and accented with pearl beading and a shell-shaped ribbon at the waist. The bodice has puffed translucent organza sleeves and a scalloped neckline trimmed with delicate white ruffles.

### くじのヒント + さっきと違うものに — 似ている度合い 9、いちばん多い色の種類 4（水色・赤・青・青・緑）、1 回 18.9 秒

1. **まーめいどどれす** 【ふつう 話題: うみ,おひめさま】 くじ: ほし
   - 金の星が輝く水色と薄紫の絹ドレスで、白真珠やヒトデの宝石、段々の裾フリルが彩ります。
   - A sparkling ocean princess gown made of shimmering aquamarine and pale lilac silk, featuring tiered translucent sea-foam ruffles at the mermaid-tail hem and delicate gold little stars printed across the bodice. The waistline and sweetheart neckline are decorated with strings of white pearls and tiny starfish-shaped gem accents.
2. **さんごのちゅーるどれす** 【ふつう 話題: うみ,おひめさま】 くじ: チュール
   - 珊瑚ピンクと橙のチュールが広がり、貝殻風の胸元に金真珠や泡の刺繍を施したドレスです。
   - A voluminous ballgown dress crafted from fluffy layered tulle in gradient coral pink and peachy orange, mimicking sea anemones and swirling ocean waves. The sweetheart bodice is styled like glossy pink scallop shells, detailed with golden pearl beads and delicate embroidered sea-bubble motifs around the waistband.
3. **うみのバルーンドレス** 【ふつう 話題: うみ,おひめさま】 くじ: バルーン、ニット
   - 真珠ボタン付きの濃紺ニットと、銀の泡刺繍や波型トリムを飾った淡緑のバルーンスカートです。
   - A charming ocean princess dress featuring a soft deep royal blue knit bodice adorned with shiny pearl buttons and a bubbly, voluminous seafoam-green balloon hem skirt. The rounded hem is tucked under softly, embroidered with silver bubble motifs and delicate scalloped wave trims along the waistline.
4. **うみのすとらいぷどれす** 【ふつう 話題: うみ,おひめさま】 くじ: しましま
   - 桃色の貝殻ブローチ付きの白身頃に、ミント緑と紺の波縞が揺れる波型フリル付きシフォンドレス。
   - An elegant sea-princess gown featuring vertical rippling stripes of mint green and deep navy blue down a breezy, flared chiffon skirt finished with scalloped wave-like ruffles. The pearl-white sweetheart bodice is adorned with a soft pink seashell brooch and cascading strands of tiny golden pearls along the waist.
5. **みんとしーどれす** 【ふつう 話題: うみ,おひめさま】 くじ: ミントグリーン、ふだんぎ
   - リボン肩紐と貝殻ポケットが付いたミント緑の綿Aラインドレスで、裾に白い波型飾りがあります。
   - A breezy mint green cotton sundress designed for a casual ocean princess, featuring wide shoulder straps tied in sweet bows. The relaxed A-line skirt is adorned with cute seashell-shaped patch pockets and finished with a crisp white scalloped wave trim along the hemline.

### 1 回で頼む（くじを全部わたす） — 似ている度合い 10、いちばん多い色の種類 4（水色・青・白・緑・水色）、1 回 13.1 秒

1. **うみのおひめドレス**  くじ: サッシュベルト、しましま、そでなし・ひざたけ（先頭 3 つ）
   - 白とターコイズの細縞フレア裾に、ヒトデ飾りのコーラルピンク帯を締めた膝丈ノースリーブドレス。
   - A sleeveless, knee-length ocean princess dress featuring fine vertical stripes of pastel turquoise and soft pearl-white across the flared skirt. A smooth coral-pink sash belt cinches the waist with a scalloped edge and tiny starfish charm at the center.
2. **うみのセーラードレス**  くじ: セーラーえり、ギンガムチェック、はんたいの 2 色（先頭 3 つ）
   - 金の貝殻ブローチ付き黄色セーラー襟に、裾にフリルを飾った青白ギンガムチェックのフレアドレス。
   - An ocean princess dress featuring a wide sailor collar in bright sunny yellow with scalloped trim and a golden seashell brooch. The flared skirt is crafted from a vibrant royal blue and white gingham check fabric, finished with bubbly organza ruffles along the hem.
3. **しんじゅのどれす**  くじ: パール、しろ＋さしいろ、クール（先頭 3 つ）
   - 紺パイピングのハート型胸元と真珠や銀ビーズが襟元を彩る、白サテンの床丈マーメイドドレス。
   - A chic floor-length mermaid gown made of crisp white satin, featuring elegant navy blue velvet piping along the structured sweetheart bodice and tapered hem. Cascades of lustrous white pearls and delicate silver beads drape gracefully across the neckline and frame the sleek silhouette with cool, refined ocean charm.
4. **いちごとうみのどれす**  くじ: ふんわり ドレス、くだもの、みんぞくふう（先頭 3 つ）
   - 水色の編み上げ身頃に、赤苺柄と裾の波型リボンや真珠刺繍が映えるシーフォーム色の膨らむドレス。
   - A voluminous puffy ball-gown folk princess dress crafted from pale seafoam cotton, featuring an aqua laced bodice with folk-style scallop trims. The wide, billowing skirt is patterned with sweet red strawberry prints and bordered along the hem with wave-like embroidered folk ribbons and pearl bead accents.
5. **うみのニットドレス**  くじ: ニット、はんたいの 2 色、こばな（先頭 3 つ）
   - 貝殻風フリル肩紐のターコイズ身頃に、小花柄と波型裾が愛らしいコーラルピンクのニットフレアドレス。
   - A delightful ocean princess dress featuring a bright turquoise ribbed-knit bodice with scalloped shell-like ruffled shoulder straps and a contrasting vibrant coral-pink knit flared skirt. The soft knit skirt is decorated with an all-over dainty small flower print and finished along the hem with bubbly wave-scalloped trim.

## 「はる」（大きい）

### いまの方法 — 似ている度合い 26、いちばん多い色の種類 1（赤・赤・赤・赤・赤）、1 回 9.9 秒

1. **さくらのフリルドレス**
   - 桜柄や花びら風フリル、桃色サテンリボンとレース付き透け袖をあしらった薄桃とクリーム色の春ドレス。
   - A pastel pink and cream spring dress with tiered petal-shaped skirt ruffles, decorated with small cherry blossom motifs, a soft pink satin waist ribbon, and sheer cap sleeves with delicate lace trims.
2. **さくらふりるどれす**
   - 桜の花びら風フリルが重なる淡い桃色の段ドレスで、ミント緑のリボンと裾のスカラップ白レースが特徴。
   - A gentle pastel-pink tiered dress layered with soft chiffon ruffles resembling cherry blossom petals, accented with light mint-green waist ribbons and white lace along the scalloped hemline.
3. **さくらのフリルドレス**
   - 桜の花びら刺繍とミント緑リボンを添えた淡い桃色の段フリルドレスで、裾に白スカラップレースが並ぶ。
   - A pastel pink tiered frill dress adorned with embroidered cherry blossom petals and a soft mint green ribbon sash at the waist. The lightweight chiffon skirt flares outward gracefully with delicate white scalloped lace lining the hem.
4. **はるいろドレス**
   - 花びら風フリル裾の薄桃と淡黄のシフォンドレスに、パフ袖や襟の白レース、ミント緑リボンを合わせた。
   - A pastel pink and soft yellow chiffon dress with fluttering petal-shaped layered frills along the skirt hem. It features short puffed sleeves, delicate white lace trim at the collar, and a mint green ribbon bow at the waist.
5. **さくらドレス**
   - 花びら風スカートに白レースをあしらった膝丈の薄桃色春ドレスで、丸襟やパフ袖、ミント緑リボン付き。
   - A pastel pink knee-length spring dress featuring a flared skirt shaped like layered flower petals with small white lace trims. It has short puffed sleeves, a rounded neckline, and a soft mint green ribbon tied neatly at the waist.

### 「さっきと違うものに」だけ — 似ている度合い 14、いちばん多い色の種類 5（赤・水色・緑・黄・だいだい）、1 回 14.2 秒

1. **さくらワンピース**
   - 淡いピンクのシフォン膝丈ドレス。パフ袖や白レース、スカラップ裾の桜柄と黄色リボン付き。
   - A spring knee-length dress in soft pastel pink chiffon with puffy short sleeves, decorated with delicate cherry blossom petal motifs along the scalloped hem and a bright yellow ribbon sash at the waist. Gentle white lace trims frame the rounded neckline and sleeve cuffs.
2. **たんぽぽどれす**
   - フリル袖の水色綿Aラインドレス。裾の白スカラップやタンポポ柄、首元の黄色リボンが爽やか。
   - A breezy light sky-blue cotton A-line dress with ruffled flutter cap sleeves, decorated with cheerful sunny-yellow dandelion flowers and tiny green sprout prints across the skirt. A delicate scalloped white hemline and a tiny buttercup-yellow bow at the rounded neckline complete the fresh spring look.
3. **ちゅーりっぷドレス**
   - フリル肩紐のミント緑ノースリーブドレス。裾の紫チューリップ刺繍や胸元の紫リボンが愛らしい。
   - A charming mint-green sleeveless dress featuring wide ruffled shoulder straps and a two-tiered flared skirt bordered by dainty embroidered lavender tulip blossoms along the scalloped hemline. A soft pastel-purple ribbon bow accents the square neckline alongside small pearlescent white buttons down the fitted bodice.
4. **みもざのどれす**
   - レース付ベル袖の黄色ティアードドレス。サテン帯と裾のフリルにあるミモザ刺繍が華やか。
   - A sunny mimosa-yellow tiered dress made of airy layered organza, featuring three-quarter bell sleeves trimmed with delicate cream-white lace. The waist is adorned with a soft butter-cream satin sash, while the ruffled hemline is decorated with embroidered clusters of fluffy golden mimosa blossoms and tiny green leaves.
5. **はるかぜドレス**
   - 透けビショップ袖と丸襟の杏色ミディドレス。揺れるプリーツ裾に白カモミール刺繍が咲く。
   - A soft apricot-peach spring midi dress with sheer cream-white long bishop sleeves gathered at the cuffs with delicate ribbon ties. A scalloped Peter Pan collar accents the fitted bodice, while the flowing pleated skirt features dainty embroidered white chamomile blossoms with golden yellow centers along the ruffled hem.

### くじのヒント — 似ている度合い 17、いちばん多い色の種類 2（赤・赤・赤・赤・緑）、1 回 22.6 秒

1. **はるのほしドレス** 【ひろく 話題: はる】 くじ: ハイウエスト、ほし、おとぎばなし
   - 淡いピンクの上身頃に白リボンを添え、星や花柄が散る薄緑のオーガンジーを重ねたふんわり春ドレス。
   - A fairy-tale spring dress featuring a high-waisted pastel pink bodice and a puffy gathered skirt layered with sheer soft-green organza. The skirt is sprinkled with delicate little yellow stars and pink blossom prints, trimmed with a scalloped white ribbon at the waistline.
2. **はるいろドレス** 【ひろく 話題: はる】 くじ: ふんわり ドレス、こばな、まるえり
   - 白い丸襟とパフ袖、淡い緑のリボンが特徴の、小花柄が広がる淡いピンクのふんわり春色ドレス。
   - A spring ball-gown dress featuring a voluminous puffy skirt crafted from soft pastel pink fabric with an all-over small flower print. It has short puffed sleeves, a delicate pastel green waist ribbon, and a neat white round peter-pan collar.
3. **はるのようせいドレス** 【ひろく 話題: はる】 くじ: おとぎばなし、そでなし・ひざたけ
   - 花びら刺繍の淡いピンク身頃に黄色いリボンを結び、桜色と黄緑のチュールを重ねた膝丈ノースリーブドレス。
   - A fairy-tale sleeveless, knee-length dress with a soft pastel pink bodice adorned with delicate petal embroidery and a scalloped hem. The flared skirt features layered gossamer tulle in pale cherry blossom pink and fresh sprout green, tied with a buttercup yellow satin bow at the waist.
4. **はるのチェックドレス** 【ひろく 話題: はる】 くじ: ながそで・ミモレたけ、ししゅう、タータンチェック
   - 淡いピンクとミント緑のタータン柄で、白丸襟と裾に桜や葉の刺繍をあしらった長袖ミモレ丈ドレス。
   - A mid-calf length spring dress with long sleeves, made of soft fabric in a pastel pink and mint green tartan plaid pattern. It features a rounded white collar and hemline adorned with delicate embroidered pink blossom flowers and tiny green leaves.
5. **はるかぜワンピース** 【ひろく 話題: はる】 くじ: みどり、ふだんぎ
   - 白い丸襟とパフ袖にミント色の帯が付き、裾に白と黄のデイジー刺繍が散る薄緑のＡライン綿ドレス。
   - A casual light green cotton A-line dress with short puffed sleeves, a neat rounded white Peter Pan collar, and a gathered waist with a simple mint-green sash. Tiny embroidered white and yellow spring daisy flowers are scattered gently along the flared hemline.

### くじのヒント + さっきと違うものに — 似ている度合い 13、いちばん多い色の種類 4（赤・緑・黄・水色・緑）、1 回 17.5 秒

1. **はるのいちごドレス** 【ひろく 話題: はる】 くじ: ベルベット、くだもの、パフスリーブ・ひざたけ
   - 苺と小花柄の淡い桃色ベルベット膝丈半袖ワンピ。丸襟と裾にレースと赤リボン。
   - A knee-length pastel pink velvet dress with puffy short sleeves, decorated with an all-over print of spring strawberries and tiny white blossoms. The hem and Peter Pan collar are trimmed with soft cream lace, accented by a small red velvet ribbon at the center of the collar.
2. **はるのチュールドレス** 【ひろく 話題: はる】 くじ: レース、チュール、パーティー
   - 首と腰に白レース付きのミント色サテン身頃と、黄と薄緑のチュール段々ドレス。
   - An elegant spring party dress featuring a sleeveless mint green satin bodice with delicate white scalloped lace trim along the neckline and waist. The skirt is crafted from voluminous tiered layers of soft translucent yellow and pastel green tulle, finished with broad floral lace trim around the flouncy hem.
3. **はるのデニムワンピ** 【ひろく 話題: はる】 くじ: デニム、フリル、クリームとちゃいろ
   - 袖フリルのクリーム色ブラウスに、デイジー刺繍と段々フリル付き茶デニムジャンスカ。
   - A charming spring dress featuring a soft cream blouse with ruffled cuffs under a milk-chocolate brown denim pinafore. Tiered cream frills decorate the flared hem and shoulder straps, accented with delicate embroidered spring daisies across the front.
4. **みんとわんぴーす** 【ひろく 話題: はる】 くじ: ミントグリーン、ローウエスト
   - 黄リボン付き白セーラー襟とキンポウゲ刺繍プリーツ裾の、薄ミント色半袖ワンピ。
   - A light mint green cotton drop-waist dress featuring short flutter sleeves and a crisp white sailor collar lined with soft yellow ribbon. The elongated bodice flows into a neatly pleated flounce skirt decorated with tiny embroidered yellow buttercups along the hem.
5. **はるのほしどれす** 【ひろく 話題: はる】 くじ: チュール、ほし、ミントグリーン
   - 金星柄ミント色身頃と段々チュール裾に、透け袖と淡黄リボンが輝くドレス。
   - A breezy spring dress featuring sheer flutter sleeves and a mint green bodice sprinkled with tiny golden stars. The fluffy flared skirt is made from tiers of airy mint green layered tulle shimmering with scattered little star prints and finished with a pale yellow satin ribbon at the waist.

### 1 回で頼む（くじを全部わたす） — 似ている度合い 13、いちばん多い色の種類 5（赤・紫・緑・青・ピンク）、1 回 10.5 秒

1. **はるのいちごドレス**  くじ: まるえり、チュール、くだもの（先頭 3 つ）
   - 白い丸襟と赤い苺柄の身頃に、裾レース付きの淡いピンクのチュールフレアスカートを合わせた春ドレス。
   - A pastel pink spring dress featuring a crisp white round peter-pan collar and a sweet red strawberry pattern printed across the bodice. The flared skirt is made of fluffy layered tulle in light blush pink with a delicate white lace hem.
2. **らべんだーどれす**  くじ: ラベンダー、まるいボタン、コーデュロイ（先頭 3 つ）
   - 黄色い花柄丸襟と乳白色ボタンが並ぶ薄紫のコーデュロイ製で、パフ袖とポケット付きAラインスカートの春ドレス。
   - A spring dress made of soft lavender corduroy featuring large round milky-white buttons running down the center of the bodice. It has short puffed sleeves, a gentle white rounded collar with delicate yellow floral accents, and an A-line skirt with dual front pockets.
3. **はるのほしドレス**  くじ: ロングたけ、バルーン、ほし（先頭 3 つ）
   - スカラップ襟と黄色い帯紐が付き、淡い星柄ミントグリーンのバルーン裾スカートが広がる足首丈ドレス。
   - An ankle-length long dress featuring a puffy balloon hem skirt crafted from fresh spring mint-green fabric patterned with tiny pastel yellow stars. The fitted bodice has a delicate cream scalloped collar and a soft sunshine-yellow sash tied neatly around the waist.
4. **はるのセーラーわんぴ**  くじ: セーラーえり、パフスリーブ・ひざたけ、デニム（先頭 3 つ）
   - 黄色い線入り白セーラー襟と黄色リボンが付いた淡青デニム製で、パフ袖とプリーツ裾の膝丈ドレス。
   - A knee-length dress crafted from light-wash sky blue denim, featuring short puffed sleeves and a wide white sailor collar trimmed with soft butter-yellow stripes. A neat pastel yellow ribbon ties at the neckline above a gently flared pleated skirt finished with crisp double-stitched hems.
5. **はるいろどれす**  くじ: ピンク、レース、ローウエスト（先頭 3 つ）
   - 白い波型レースを飾った角襟と袖口、ローウエストのプリーツスカートが特徴の鮮やかなピンクの春ドレス。
   - A spring dress in bright petal pink featuring an elongated fitted bodice with a drop waist and a softly pleated skirt. Delicate white scallop lace trim adorns the square neckline, sleeve cuffs, and the drop-waist seam.

## 「ゆめ」（大きい）

### いまの方法 — 似ている度合い 34、いちばん多い色の種類 4（紫・?・赤・ピンク・紫）、1 回 9.4 秒

1. **ゆめいろドレス**
   - ラベンダー・桃・水色グラデのシフォンドレス。透けパフ袖、裾の雲形フリル、首元の金星が特徴。
   - A fluffy layered party dress made of soft pastel chiffon gradient in lavender, baby pink, and sky blue. It features sheer puff sleeves, cloud-shaped scalloped ruffles along the hem, and tiny glittering golden star pendants along the neckline.
2. **ゆめいろドレス**
   - 薄紫・桃・ミント青の段々チュールドレス。金星飾りや雲風フリル、胸元の真珠風リボンが彩る。
   - A fluffy, tiered tulle ballgown with pastel lavender, soft pink, and mint blue gradient layers, embellished with tiny glittering gold star pendants and cloud-like ruffles along the hem. The bodice features a sweetheart neckline accented by small pearlescent ribbon bows.
3. **ゆめみるドレス**
   - 桃・紫・水色グラデの雲風オーガンジードレス。身頃に金星チャーム、腰に大ぶり透けリボンつき。
   - A fluffy pastel ballgown made of layered cloud-like organza ruffles with a gradient from soft pink to dreamy lavender and sky blue. The bodice is decorated with miniature gold star charms and a large sheer ribbon bow sits at the waist.
4. **ゆめいろドレス**
   - 紫・桃・薄ミント青グラデの透けオーガンジードレス。雲形フリルや星柄、腰の大サテンリボンつき。
   - A dreamy pastel ballgown made of layered sheer organza in gradient lavender, soft pink, and pale mint blue, decorated with cloud-shaped scalloped frills, glittery star prints, and a big satin ribbon at the waist.
5. **ゆめみるドレス**
   - ラベンダー・桃・水色のグラデチュールドレス。繊細な金リボンと散りばめた星チャームで飾る。
   - A fluffy pastel ballgown made of layered gradient tulle in soft lavender, baby pink, and sky blue, decorated with delicate golden ribbon bows and scattered sparkling star charms.

### 「さっきと違うものに」だけ — 似ている度合い 8、いちばん多い色の種類 4（紫・青・黄・水色・紫）、1 回 11 秒

1. **ゆめみるドレス**
   - 薄紫とピンクの段重ねチュールに星柄と雲形裾、金星付きミント青リボンが光るドレス。
   - A fluffy pastel layered gown made of soft lavender and pink tulle, adorned with printed glowing stars and cloud-shaped ruffles along the scalloped hem. A large mint-blue ribbon with a sparkling golden star gem accents the empire waistline.
2. **よぞらのドレス**
   - 紺と紫の別珍Aラインに透け袖、金刺繍の波裾、三日月ブローチと真珠鎖付き星柄重層ドレス。
   - A deep midnight blue and twilight violet velvet A-line dress featuring sheer organza puffed sleeves and delicate gold embroidery along the scalloped hem. A shining golden crescent moon brooch accents the neckline, and gentle dangling pearl chains shimmer across the sheer star-printed overskirt.
3. **ゆめみるドレス**
   - 黄とミント色の段重ねシフォンに桃色リボン袖、裾にレースと虹刺繍や真珠が揺れるドレス。
   - A tiered babydoll dress crafted from airy cream-yellow and mint chiffon, featuring flutter sleeves tied with dainty peach satin ribbons. The flowing skirt is edged with delicate scalloped lace and accented with floating iridescent pearl drops and tiny pastel rainbow embroidery along the hem.
4. **ゆめいろバルーン**
   - 空色と桃色サテンの風船裾ドレスで、泡ビーズの透け身頃に縞模様リボンが飾られている。
   - A pastel sky-blue and coral-peach satin balloon dress with short tulip sleeves and a rounded, cloud-like puffed hemline. Translucent iridescent organza covers the bodice, decorated with tiny floating bubble beads and a candy-striped ribbon bow at the waist.
5. **ほしのナイトドレス**
   - 薄紫と黄色の前後丈違い絹ドレスで、広がる袖口にリボン、裾の雲フリースに金星が揺れる。
   - An airy high-low evening dress crafted from sheer iridescent lilac and butter-yellow silk, featuring wide flowing angel bell sleeves. Plush white fleece clouds rim the hemline, accented by tiny dangling golden star charms and satiny bow ties at the cuffs.

### くじのヒント — 似ている度合い 18、いちばん多い色の種類 4（紫・赤・紫・黄・青）、1 回 12 秒

1. **ゆめみるえぷろんどれす** 【ひろく 話題: ゆめ】 くじ: コットン、みんぞくふう
   - 金の星刺繍や雲と月のエプロンが飾るパステル紫の膝丈ドレス。
   - A folk-style knee-length dress made of soft pastel lavender cotton, featuring short puffed sleeves, a light cream lace-up bodice embroidered with tiny golden stars, and a frilly apron adorned with gentle smiling cloud and moon motifs. Soft white scalloped lace lines the square neckline and skirt hem for a cozy, dreamy look.
2. **ゆめのいちごドレス** 【ひろく 話題: ゆめ】 くじ: コットン、まるえり、くだもの
   - 丸襟に苺と星柄、首元の紫リボンが愛らしい淡いピンクのドレス。
   - A dreamy pastel pink soft cotton dress featuring a cute white round peter-pan collar, puffy sleeves, and a gathered skirt printed with tiny pastel strawberries and golden dream stars. The hemline is finished with soft white scalloped lace and accented by a lavender ribbon bow at the neckline.
3. **ゆめみるドレス** 【ひろく 話題: ゆめ】 くじ: レース、ベルベット
   - 星柄チュールを重ねた紫と桃色のベルベット製星ボタン付きドレス。
   - A dreamy pastel purple and soft pink velvet dress with puffy short sleeves and a bell-shaped skirt layered with sheer star-patterned tulle. Delicate white lace trim decorates the square neckline and skirt hem, finished with small golden star buttons along the bodice.
4. **ゆめのはらドレス** 【ひろく 話題: ゆめ】 くじ: ナチュラル、レモンいろ
   - 星花刺繍や雲風フリル、水色リボンが揺れるレモン色のサンドレス。
   - A breezy lemon-yellow cotton tiered sundress featuring soft cloud-like scalloped ruffles along the hem and delicate embroidered star-flower motifs across the natural linen bodice. A gentle sky-blue woven ribbon belt ties into a soft bow at the waist with fluttering pastel leaf-shaped charms.
5. **ゆめいろわんぴーす** 【ひろく 話題: ゆめ】 くじ: はんそで・ミニ、ふだんぎ、ハート
   - 紫と水色のグラデに桃色ハートが散る、雲形トリムの半袖ドレス。
   - A casual short-sleeved cotton dress with an above-the-knee flared skirt, featuring a soft pastel lavender and baby blue gradient. The fabric is decorated with a scattered pattern of tiny pastel pink hearts and finished with fluffy white cloud-shaped trim at the collar and hem.

### くじのヒント + さっきと違うものに — 似ている度合い 13、いちばん多い色の種類 5（紫・青・ピンク・赤・黄）、1 回 15.7 秒

1. **ゆめのクラシカルドレス** 【ひろく 話題: ゆめ】 くじ: ベルスリーブ・ひざたけ、レトロ
   - ベル袖に星柄チュールや月型金ボタン、桃色リボンをあしらった淡紫とクリームサテンの膝丈ドレス。
   - A knee-length retro classic dress in pastel lavender and cream satin, featuring elegant bell sleeves edged with soft scalloped lace. The gathered skirt has a sheer starry tulle overlay, complemented by a pastel pink ribbon sash and small golden moon-shaped buttons on the bodice.
2. **ゆめみるドレス** 【ひろく 話題: ゆめ】 くじ: ローウエスト、サッシュベルト、そでなし・ひざたけ
   - 雲形フリルの襟元、星柄ティアード、黄色のリボン帯が映える空色とミントの袖なし膝丈ドレス。
   - A sleeveless knee-length drop-waist dress made of airy sky-blue and soft mint satin with delicate cloud-shaped scalloped frills along the neckline. A shimmering pastel yellow organza sash belt is tied in a puffy bow at the dropped waist, sitting above a fluffy tiered skirt patterned with tiny floating stars.
3. **ゆめチェックドレス** 【ひろく 話題: ゆめ】 くじ: ギンガムチェック、ポンポン
   - 白丸襟とパフ袖付きの桃白ギンガムに、裾の黄色と薄紫のポンポンが揺れるベビードールドレス。
   - A sweet babydoll dress with puffed short sleeves made of pastel baby-pink and white gingham check cotton fabric. A soft white frilled peter pan collar accents the neckline, while tiny pastel yellow and lavender fluffy pom-poms swing merrily along the ruffled hem.
4. **ゆめみるドレス** 【ひろく 話題: ゆめ】 くじ: サテン、ふんわり ドレス、ベルスリーブ・ひざたけ
   - ベル袖に青紫リボン、裾に雲と泡の刺繍が施された桃色とクリーム色サテンの膝丈ドレス。
   - A knee-length dress crafted from glossy satin in dreamy rose-pink and starlight cream, featuring graceful bell sleeves and an extra-puffy ball-gown skirt. Soft periwinkle ribbon bows trim the cuffs, while fluffy embroidered cloud shapes and tiny floating dream bubbles drift along the hemline.
5. **ゆめのマントドレス** 【ひろく 話題: ゆめ】 くじ: おとぎばなし、ポンポン
   - 透けるランタン袖の黄色シフォンに水色ケープ、白いポンポンと星型金留め具が付いた膝丈ドレス。
   - A knee-length fairy-tale empire dress made of buttercup yellow chiffon with sheer white lantern sleeves, paired with an attached pastel aqua-blue mini capelet over the shoulders. Soft fluffy white pom-poms fringe the edges of the capelet and the scalloped skirt hem, tied at the neckline with a delicate golden star clasp.

### 1 回で頼む（くじを全部わたす） — 似ている度合い 10、いちばん多い色の種類 4（紫・赤・水色・紫・青）、1 回 9.8 秒

1. **ゆめのエプロンドレス**  くじ: ジャンパースカート、スカラップ、おとぎばなし（先頭 3 つ）
   - パフ袖にスカラップや雲フリル、小星が飾られた紫と水色のエプロンドレス。
   - A fairy-tale pinafore-style dress with broad shoulder straps over puffed pastel sleeves, featuring sweet scalloped edges along the bib and hem. The mid-length skirt is crafted from dreamy pastel lavender and sky-blue fabric adorned with gentle cloud frills and tiny pastel stars.
2. **ゆめのサテンドレス**  くじ: サテン、ロングたけ、あか（先頭 3 つ）
   - 足首丈の深紅サテンに金色の月星刺繍とチュールを重ねたオフショルドレス。
   - An ankle-length evening gown crafted from radiant crimson glossy satin, adorned with translucent dream-mist tulle overlays and embroidered golden crescent moons and stars. The off-shoulder bodice features gentle draped satin folds that lead into an elegant flowing skirt shimmering with starlight motifs.
3. **ゆめふわドレス**  くじ: シフォン、Aライン、ハート（先頭 3 つ）
   - 襟元ギャザーと裾フリル付き、小ハート柄の淡いミントと桃色Ａラインドレス。
   - An A-line flared dress tailored from layers of airy light chiffon in soft pastel mint and blush pink, patterned with scattered floating little pastel hearts. The bodice has gentle gathers at the neckline, while the flared skirt cascades into dreamy soft ruffles at the hem.
4. **ゆめちろるどれす**  くじ: ギンガムチェック、みんぞくふう、そでなし・ひざたけ（先頭 3 つ）
   - リボンの編み上げとスカラップレースを施した淡紫ギンガムの膝丈ドレス。
   - A sleeveless, knee-length folk-style dress made with a dreamy pastel lavender and cream gingham check pattern. The snug bodice features decorative ribbon criss-cross lacing, leading down to a gentle knee-length flared skirt trimmed with soft scalloped lace.
5. **ゆめいろスポワンピ**  くじ: はんそで・ミニ、スポーティ、シフォン（先頭 3 つ）
   - リブ襟や前ジッパー、白黄縞のプリーツが特徴の淡い水色と桃色の半袖ドレス。
   - A sporty short-sleeved dress crafted from dreamy pastel sky-blue and soft pink light chiffon, featuring a casual ribbed collar and a front zipper. The airy skirt flares gently above the knee with translucent chiffon athletic pleats trimmed with dreamy white and yellow stripes.

