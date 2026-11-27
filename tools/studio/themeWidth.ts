/**
 * テーマの細かさで、生成の幅を変える（v0.47.0。アプリの「つくる」だけが使う）
 *
 *  1. 測る（measureTheme）: 文の AI に、テーマの言葉が、デザインの軸（色・柄・飾り…）のどれを言っているかを聞く
 *  2. 細かさ（levelOf）: 言っている軸の数から、きっちり／ふつう／ひろく
 *  3. くじ（drawHints）: テーマが言っていない軸から、こちらでヒントを引く（AI に「自由に」と任せると、毎回似るため）
 *  4. 足す行（widthLines）: 品目を考える AI への頼みの、最後に足す
 *
 * 細かいテーマは、そのとおりに。大きなテーマは、毎回ちがうデザインに。ただし、おかしな服にはしない:
 * 表には、子ども向けの服として、どれが出ても困らない候補だけを入れる（季節を選ぶ素材・はだ色のくつ・ひざまでの髪は入れない）。
 * 設計: docs/superpowers/specs/2026-11-27-v0.47.0-generation-width-design.md
 */
import type { TextAi } from './ai.ts';
import { categoryKind } from './generate.ts';

export type WidthKind = 'dress' | 'tops' | 'bottoms' | 'shoes' | 'hat' | 'hair' | 'face' | 'other' | 'set';
export type WidthLevel = 'tight' | 'normal' | 'wide';

// くじの候補。en = AI に渡す句、ja = 記録に残す名前、frilly = 女の子向けに寄った候補（おとこのこ には出さない）
export interface WidthOption {
  en: string;
  ja: string;
  frilly?: true;
}
// デザインの軸。ask = 測る頼みに書く説明。options が空の軸は、測るだけで、くじは引かない
export interface WidthAxis {
  id: string;
  ja: string;
  ask: string;
  options: WidthOption[];
}
export interface WidthHint {
  axis: string;
  en: string;
  ja: string;
}

const o = (en: string, ja: string): WidthOption => ({ en, ja });
const f = (en: string, ja: string): WidthOption => ({ en, ja, frilly: true });

const COLOURS: WidthOption[] = [
  f('mainly pink', 'ピンク'),
  o('mainly sky blue', 'みずいろ'),
  o('mainly mint green', 'ミントグリーン'),
  f('mainly lavender', 'ラベンダー'),
  o('mainly lemon yellow', 'レモンいろ'),
  o('mainly red', 'あか'),
  o('mainly navy blue', 'こんいろ'),
  o('mainly white with one accent colour', 'しろ＋さしいろ'),
  o('mainly orange', 'オレンジ'),
  o('mainly green', 'みどり'),
  o('mainly purple', 'むらさき'),
  o('cream and brown', 'クリームとちゃいろ'),
  o('two contrasting bright colours', 'はんたいの 2 色'),
  o('a soft pastel mix of several colours', 'パステルの まぜいろ'),
];
const PATTERNS: WidthOption[] = [
  o('polka dots', 'みずたま'),
  o('stripes', 'しましま'),
  o('gingham check', 'ギンガムチェック'),
  f('a small flower print', 'こばな'),
  o('little stars', 'ほし'),
  f('little hearts', 'ハート'),
  o('plain fabric with no pattern', 'むじ'),
  o('tartan plaid', 'タータンチェック'),
  o('zigzag lines', 'ジグザグ'),
];
const TASTES: WidthOption[] = [
  o('casual everyday wear', 'ふだんぎ'),
  o('elegant party wear', 'パーティー'),
  o('sporty', 'スポーティ'),
  o('retro classic', 'レトロ'),
  o('a folk costume feeling', 'みんぞくふう'),
  f('fairy-tale', 'おとぎばなし'),
  o('cool and chic', 'クール'),
  o('natural and outdoorsy', 'ナチュラル'),
];
const MATERIALS: WidthOption[] = [
  o('soft cotton', 'コットン'),
  f('layered tulle', 'チュール'),
  o('glossy satin', 'サテン'),
  f('light chiffon', 'シフォン'),
  o('denim', 'デニム'),
  f('crisp organdy', 'オーガンジー'),
  o('linen', 'リネン'),
];
const WEAR_DECORATIONS: WidthOption[] = [
  f('one big ribbon bow', 'おおきなリボン'),
  f('frills and ruffles', 'フリル'),
  f('lace trim', 'レース'),
  o('large round buttons', 'まるいボタン'),
  o('pom-poms', 'ポンポン'),
  o('embroidery', 'ししゅう'),
  f('pearls or beads', 'パール'),
  o('patch pockets', 'ポケット'),
  o('a sash belt', 'サッシュベルト'),
  f('scalloped edges', 'スカラップ'),
  o('a sailor collar', 'セーラーえり'),
  f('a round peter-pan collar', 'まるえり'),
];
const SMALL_DECORATIONS: WidthOption[] = [
  f('a small ribbon bow', 'ちいさなリボン'),
  f('a frill edge', 'フリル'),
  o('pom-poms', 'ポンポン'),
  o('a small star charm', 'ほしのかざり'),
  o('embroidery', 'ししゅう'),
  f('pearls or beads', 'パール'),
  o('small buttons', 'ボタン'),
  o('a contrasting line along the edge', 'ふちのライン'),
];

const ASK = {
  colour: 'a colour word',
  pattern: 'a pattern word (dots, stripes, checks, flowers, stars and so on)',
  decoration: 'a named decoration or trim (bow, frills, buttons, pockets and so on)',
  material: 'a named fabric or material',
  shape: 'a named silhouette or a specific garment type within the category',
  length: 'a sleeve, skirt, trouser or hair length',
  taste: 'a named style or occasion (sporty, party, casual and so on)',
  style: 'a named hairstyle (ponytail, bob, curls and so on)',
  bangs: 'how the bangs are cut',
  ornament: 'a hair ornament',
  eyes: 'the shape of the eyes',
  eyecolour: 'the colour of the eyes',
  expression: 'an expression or mood of the face',
  cheeks: 'blush, freckles or make-up',
} as const;

const axis = (id: keyof typeof ASK, ja: string, options: WidthOption[]): WidthAxis => ({ id, ja, ask: ASK[id], options });

const AXES: Record<WidthKind, WidthAxis[]> = {
  dress: [
    axis('colour', '色', COLOURS),
    axis('pattern', '柄', PATTERNS),
    axis('decoration', '飾り', WEAR_DECORATIONS),
    axis('material', '素材', MATERIALS),
    axis('shape', '形', [
      o('an A-line flared skirt', 'Aライン'),
      f('a puffy ball-gown skirt', 'ふんわり ドレス'),
      o('a straight simple shift', 'まっすぐ'),
      f('a tiered skirt', 'だんだん スカート'),
      o('a high waist with a gathered skirt', 'ハイウエスト'),
      o('a drop waist', 'ローウエスト'),
      o('a pinafore style with shoulder straps', 'ジャンパースカート'),
      f('a balloon hem', 'バルーン'),
    ]),
    axis('length', '丈とそで', [
      o('sleeveless, knee-length skirt', 'そでなし・ひざたけ'),
      f('puff sleeves, knee-length skirt', 'パフスリーブ・ひざたけ'),
      o('long sleeves, mid-calf skirt', 'ながそで・ミモレたけ'),
      o('short sleeves, short skirt above the knee', 'はんそで・ミニ'),
      o('an ankle-length long skirt', 'ロングたけ'),
      o('bell sleeves, knee-length skirt', 'ベルスリーブ・ひざたけ'),
    ]),
    axis('taste', 'ふんいき', TASTES),
  ],
  tops: [
    axis('colour', '色', COLOURS),
    axis('pattern', '柄', PATTERNS),
    axis('decoration', '飾り', WEAR_DECORATIONS),
    axis('material', '素材', MATERIALS),
    axis('shape', '形', [
      o('a T-shirt', 'Tシャツ'),
      o('a blouse or shirt with a collar', 'えりつきシャツ'),
      o('a hoodie', 'パーカー'),
      o('a sweatshirt', 'トレーナー'),
      o('a cardigan', 'カーディガン'),
      o('a long tunic', 'チュニック'),
      o('a polo shirt', 'ポロシャツ'),
      o('a vest over a shirt', 'ベスト'),
    ]),
    axis('length', 'そで', [
      o('short sleeves', 'はんそで'),
      o('long sleeves', 'ながそで'),
      o('sleeveless', 'そでなし'),
      f('puff sleeves', 'パフスリーブ'),
      o('three-quarter sleeves', 'しちぶそで'),
    ]),
    axis('taste', 'ふんいき', TASTES),
  ],
  bottoms: [
    axis('colour', '色', COLOURS),
    axis('pattern', '柄', PATTERNS),
    axis('decoration', '飾り', [
      f('a ribbon bow at the waist', 'リボン'),
      f('a frill hem', 'フリル'),
      f('lace trim at the hem', 'レース'),
      o('large buttons', 'ボタン'),
      o('patch pockets', 'ポケット'),
      o('embroidery', 'ししゅう'),
      o('a belt', 'ベルト'),
      o('turned-up cuffs', 'おりかえし'),
      o('shoulder straps (suspenders)', 'サスペンダー'),
      o('a contrasting stripe down each side', 'サイドライン'),
    ]),
    axis('material', '素材', MATERIALS),
    axis('shape', '形', [
      f('a pleated skirt', 'プリーツスカート'),
      f('a flared skirt', 'フレアスカート'),
      f('a tiered skirt', 'だんだん スカート'),
      o('shorts', 'ショートパンツ'),
      o('wide-leg trousers', 'ワイドパンツ'),
      o('straight trousers', 'ストレートパンツ'),
      o('overalls with a bib', 'サロペット'),
      o('culottes', 'キュロット'),
      o('cargo shorts with pockets', 'カーゴパンツ'),
    ]),
    axis('length', '丈', [o('above the knee', 'ひざうえ'), o('knee-length', 'ひざたけ'), o('ankle-length', 'くるぶしたけ')]),
    axis('taste', 'ふんいき', TASTES),
  ],
  shoes: [
    // はだ色に近い色（ベージュ・ピーチなど）は、足と見分けられなくなるので、入れない
    axis('colour', '色', [
      o('mainly red', 'あか'),
      o('mainly navy blue', 'こんいろ'),
      o('mainly white', 'しろ'),
      o('mainly black', 'くろ'),
      o('mainly yellow', 'きいろ'),
      o('mainly sky blue', 'みずいろ'),
      f('mainly pink', 'ピンク'),
      o('mainly green', 'みどり'),
      o('mainly purple', 'むらさき'),
      o('two contrasting bright colours', 'はんたいの 2 色'),
    ]),
    axis('decoration', '飾り', [
      f('ribbon bows', 'リボン'),
      o('star patches', 'ほしのワッペン'),
      o('a contrasting stripe on each side', 'サイドライン'),
      o('buckles', 'バックル'),
      o('pom-poms', 'ポンポン'),
      f('flower charms', 'おはな'),
      o('small wing ornaments', 'はね'),
    ]),
    axis('shape', '形', [
      o('sneakers', 'スニーカー'),
      o('short boots', 'ショートブーツ'),
      f('strap shoes (mary janes)', 'ストラップシューズ'),
      o('sandals', 'サンダル'),
      o('loafers', 'ローファー'),
      f('ballet flats', 'バレエシューズ'),
      o('rain boots', 'ながぐつ'),
      o('high-top sneakers', 'ハイカットスニーカー'),
    ]),
    axis('material', '素材', []),
    axis('taste', 'ふんいき', TASTES),
  ],
  hat: [
    axis('colour', '色', COLOURS),
    axis('pattern', '柄', PATTERNS),
    axis('decoration', '飾り', [
      f('a ribbon band with a bow', 'リボン'),
      o('a small badge', 'バッジ'),
      o('a pom-pom on top', 'ポンポン'),
      f('a flower ornament', 'おはな'),
      o('a feather', 'はね'),
      o('a star patch', 'ほしのワッペン'),
    ]),
    axis('shape', '形', [
      o('a beret', 'ベレーぼう'),
      o('a straw hat', 'むぎわらぼうし'),
      o('a baseball cap', 'キャップ'),
      o('a bucket hat', 'バケットハット'),
      o('a newsboy cap', 'キャスケット'),
      o('a sailor hat', 'セーラーぼう'),
      o('a wide-brimmed sun hat', 'つばひろ ぼうし'),
    ]),
    axis('material', '素材', []),
    axis('taste', 'ふんいき', TASTES),
  ],
  hair: [
    axis('colour', '色', [
      o('black', 'くろ'),
      o('dark brown', 'こげちゃ'),
      o('light brown', 'あかるい ちゃいろ'),
      o('golden blonde', 'きんいろ'),
      f('pink', 'ピンク'),
      o('sky blue', 'みずいろ'),
      f('lavender', 'ラベンダー'),
      o('red-orange', 'あかオレンジ'),
      o('mint green', 'ミントグリーン'),
      o('silver white', 'ぎんいろ'),
    ]),
    axis('style', '形', [
      o('straight hair', 'ストレート'),
      o('soft waves', 'ウェーブ'),
      f('twin tails', 'ツインテール'),
      f('a high ponytail', 'ポニーテール'),
      f('braids', 'みつあみ'),
      f('two buns', 'おだんご'),
      o('a bob cut', 'ボブ'),
      o('short cropped hair', 'ショート'),
      o('short layered hair with flicked ends', 'はねた ショート'),
      o('short curly hair', 'くるくる ショート'),
      f('a half-up style', 'ハーフアップ'),
    ]),
    axis('bangs', 'まえがみ', [
      o('straight-cut bangs', 'ぱっつん'),
      o('side-swept bangs', 'ながし まえがみ'),
      o('bangs parted in the middle', 'センターわけ'),
      o('thin wispy bangs', 'うすい まえがみ'),
    ]),
    axis('ornament', 'かざり', [
      f('a ribbon', 'リボン'),
      o('a simple hair clip', 'ヘアピン'),
      f('small flower hairpins', 'おはなの ピン'),
      o('a star-shaped pin', 'ほしの ピン'),
      o('no ornament', 'かざりなし'),
    ]),
    // 長さは、くじにしない（腰まで。ひざまでは、テーマがロングを頼んだときだけ、の決まりを守る）
    axis('length', '長さ', []),
  ],
  face: [
    axis('eyes', '目の形', [
      o('big round eyes', 'まるい め'),
      o('gentle drooping eyes', 'たれめ'),
      o('slightly upturned eyes', 'つりめ'),
      o('sparkling eyes with star highlights', 'きらきらの め'),
      f('eyes with long eyelashes', 'ながい まつげ'),
    ]),
    axis('eyecolour', '目の色', [o('brown', 'ちゃいろ'), o('blue', 'あお'), o('green', 'みどり'), o('violet', 'むらさき'), o('amber', 'こはくいろ'), f('pink', 'ピンク'), o('grey', 'グレー')]),
    axis('expression', '表情', [
      o('a big cheerful smile', 'にっこり'),
      o('a gentle calm smile', 'おすまし'),
      o('a small surprised open mouth', 'びっくり'),
      o('a cool confident look', 'きりっと'),
      o('a shy little smile', 'はにかみ'),
    ]),
    axis('cheeks', 'ほっぺ', [o('round blush on the cheeks', 'まるい ほっぺ'), o('freckles', 'そばかす'), f('heart-shaped blush', 'ハートの ほっぺ'), o('no blush', 'ほっぺなし')]),
  ],
  other: [axis('colour', '色', COLOURS), axis('pattern', '柄', PATTERNS), axis('decoration', '飾り', SMALL_DECORATIONS), axis('material', '素材', []), axis('shape', '形', []), axis('taste', 'ふんいき', TASTES)],
  set: [
    axis('colour', '色の合わせ方', [
      o('shades of one colour, light and dark', 'おなじ色の こい・うすい'),
      o('two contrasting bright colours', 'はんたいの 2 色'),
      o('soft pastel colours', 'パステル'),
      o('vivid bright colours', 'ビビッド'),
      o('a white base with one accent colour', 'しろ＋さしいろ'),
      o('a dark base with one bright accent colour', 'こい色＋さしいろ'),
      o('warm colours (red, orange, yellow)', 'あたたかい色'),
      o('cool colours (blue, green, purple)', 'すずしい色'),
    ]),
    axis('pattern', '柄', PATTERNS),
    axis('decoration', '飾り', WEAR_DECORATIONS),
    axis('material', '素材', MATERIALS),
    axis('taste', 'ふんいき', TASTES),
    // 形・丈は、品目ごとなので、くじにしない（テーマが言っていれば、細かいテーマとして数える）
    axis('shape', '形', []),
    axis('length', '丈', []),
  ],
};

// カテゴリの名前（ラベル）から、くじの表の種類を決める。知らない名前は「そのほか」
export function widthKind(categoryLabel: string): WidthKind {
  const known = categoryKind(categoryLabel);
  if (known === 'face') return 'face';
  if (known === 'hair' || known === 'backhair') return 'hair';
  if (known === 'shoes') return 'shoes';
  if (/ぼうし|帽子|ハット|キャップ|\bhat\b|\bcap\b/i.test(categoryLabel)) return 'hat';
  // ヘッドドレス（頭の飾り）は、ドレスではない
  if (/(?<!ヘッド)ドレス|ワンピ|(?<!head)dress/i.test(categoryLabel)) return 'dress';
  if (/トップス|シャツ|ブラウス|上着|うわぎ|tops?\b/i.test(categoryLabel)) return 'tops';
  if (/ボトムス|スカート|パンツ|ズボン|bottoms?\b/i.test(categoryLabel)) return 'bottoms';
  return 'other';
}

// ドールを見分ける印は、名前しか無い
const BOY_DOLL = /おとこ|男|boy/i;

// その種類の軸。おとこのこ のドールには、女の子向けに寄った候補を出さない（テーマで頼めば作る。外すのは、くじだけ）
export function axesFor(kind: WidthKind, dollName: string): WidthAxis[] {
  const boy = BOY_DOLL.test(dollName);
  return AXES[kind].map((a) => ({ ...a, options: boy ? a.options.filter((option) => !option.frilly) : [...a.options] }));
}

// 品目を考える AI に、ドールのことを伝える行。おとこのこ のドールには、男の子の服を（伝えないと、スカートやツインテールを考える）
export function dollLines(dollName: string): string[] {
  if (!BOY_DOLL.test(dollName)) return [];
  return ['This item is for a boy doll: design boys\' clothing and boys\' hairstyles (no skirts, dresses, frills, lace, hair ribbons or twin tails), unless the theme itself asks for them.'];
}

// 細かさ: 点 = 言っている軸の数 +（話題の言葉が 2 つ以上なら 1）。2 点以上 = きっちり、1 点 = ふつう、0 点 = ひろく
export function levelOf(fixed: string[], topics: string[]): WidthLevel {
  const score = fixed.length + (topics.length >= 2 ? 1 : 0);
  return score >= 2 ? 'tight' : score === 1 ? 'normal' : 'wide';
}

/**
 * くじ: きっちり = 0 個、ふつう = 1〜2 個、ひろく = 2〜3 個。
 * テーマが言っていない軸から選び、1 つの軸からは 1 つだけ。引ける軸が足りなければ、引けた分だけ。
 */
export function drawHints(level: WidthLevel, fixed: string[], axes: WidthAxis[], random: () => number): WidthHint[] {
  if (level === 'tight') return [];
  const pick = (n: number) => Math.min(n - 1, Math.max(0, Math.floor(random() * n)));
  const count = (level === 'normal' ? 1 : 2) + (random() < 0.5 ? 0 : 1);
  const open = axes.filter((a) => a.options.length > 0 && !fixed.includes(a.id));
  for (let i = open.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [open[i], open[j]] = [open[j], open[i]];
  }
  return open.slice(0, count).map((a) => {
    const option = a.options[pick(a.options.length)];
    return { axis: a.id, en: option.en, ja: option.ja };
  });
}

// 品目を考える AI への頼みの、最後に足す行（planItems・planSet の extra）
export function widthLines(level: WidthLevel, hints: WidthHint[], recent: string[]): string[] {
  if (level === 'tight') {
    return ['The theme is specific. Follow it exactly and keep everything it does not mention simple and consistent with it. Do not add extra patterns, decorations or colours that the theme does not ask for.'];
  }
  const lines: string[] = [];
  if (hints.length > 0) {
    lines.push(
      'Design hints (drawn at random so that the same theme gives a different design each time):',
      ...hints.map((h) => `- ${h.axis}: ${h.en}`),
      'Work these hints into the design where the theme leaves it open. The theme always wins: drop a hint that contradicts the theme, and drop a hint that does not suit the season or mood of the theme. If two hints conflict with each other, keep only one of them. The result must still clearly show the theme and be normal, wearable and child-friendly.',
    );
  }
  if (recent.length > 0) {
    lines.push(
      'The same child recently received these. Design something clearly different from all of them (a different shape, main colour or decorations), while still following the theme:',
      ...recent.map((description) => `- ${description}`),
    );
  }
  return lines;
}

// 測るのを待つ上限（これを超えたら、測れなかったことにして、いままでどおりに作る）
export const MEASURE_TIMEOUT_MS = 8000;

/**
 * テーマを測る: テーマの言葉が、どの軸を言っているか（fixed）と、軸に当たらない話題の言葉（topics）。
 * 測れなかったら null（AI の失敗・時間切れ・形のこわれた返事）。投げない。
 * 軸が 1 つでも欠けている返事は「測れなかった」と読む（「何も言っていない」と読むと、細かいテーマに飾りを足してしまう）。
 */
export async function measureTheme(
  text: TextAi,
  input: { theme: string; categoryLabels: string[]; axes: WidthAxis[] },
  timeoutMs: number = MEASURE_TIMEOUT_MS,
): Promise<{ fixed: string[]; topics: string[] } | null> {
  const ids = input.axes.map((a) => a.id);
  const schema = {
    type: 'object',
    properties: { ...Object.fromEntries(ids.map((id) => [id, { type: 'boolean' }])), topics: { type: 'array', items: { type: 'string' } } },
    required: [...ids, 'topics'],
    additionalProperties: false,
  };
  const prompt = [
    `Theme: ${input.theme}`,
    `Item category: ${input.categoryLabels.join(', ')}`,
    'For each design aspect below, answer true only if the words of the theme themselves state it.',
    'A topic, a season, a place, a character type or a mood (for example spring, dream, sea, princess) does not state any aspect: answer false for every aspect it does not literally name.',
    'The category word itself (for example dress, one-piece, shoes, hair) states nothing.',
    'Aspects:',
    ...input.axes.map((a) => `- ${a.id}: ${a.ask}`),
    'topics: the separate topic words in the theme that are not one of the aspects above (for example ["sea", "princess"]); an empty list if there are none.',
  ].join('\n');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const reply = await Promise.race([
      text.json<Record<string, unknown> | null>({ system: 'You analyse a short theme that a child typed to order one item in a dress-up game. Reply with JSON only.', prompt, schema }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    if (typeof reply !== 'object' || reply === null) return null;
    if (!ids.every((id) => typeof reply[id] === 'boolean')) return null;
    const topics = Array.isArray(reply.topics) ? reply.topics.filter((t): t is string => typeof t === 'string' && t.trim() !== '') : [];
    return { fixed: ids.filter((id) => reply[id] === true), topics };
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
