/**
 * 生成の幅（計画書 2026-11-26 の 6 章）
 *
 *  テーマが細かい（色・形・飾りなどが決まっている）ときは、そのとおりに。
 *  テーマが大きい（「はる」「ゆめ」など）ときは、毎回ちがうデザインに。
 *
 *  - くじは、ここ（サーバー）で引く。AI に「自由に」と任せると、毎回似るため。
 *  - デザインの軸ごとに 1 つずつ引いた「ヒント」を、まぜた順で企画の AI に渡す。
 *    AI は、テーマが決めていることを書き出して細かさを 3 段に分け、
 *    決まっていない軸のヒントだけを、前から順に 0 個（きっちり）／1〜2 個（ふつう）／2〜3 個（ひろく）使う。
 *    呼び出しは、いままでどおり 1 回（文の AI の回数は増えない）。
 *  - ヒントは説明の文にだけ入る（マネキン・背景・子ども向けの決まりには触らない）。テーマとぶつかったら、テーマが勝つ。
 *  - 候補は子ども向けの服として安全なものだけ。カテゴリに合わない軸は出さない。ぶつかる組み合わせは表で外す。
 */
import { categoryKind } from './generate.ts';

export type Rng = () => number; // 0 以上 1 未満

export type Axis = 'shape' | 'pattern' | 'palette' | 'decoration' | 'motif';
export interface Hint {
  axis: Axis;
  text: string; // AI への英語の短い句
}

// カテゴリの種類（ラベルから）。軸と候補の表を選ぶ
export type VarietyKind = 'garment' | 'shoes' | 'hair' | 'face' | 'hat' | 'small';

const HAT_LABEL = /ぼうし|帽子|hat|cap|キャップ|ハット/i;
const SMALL_LABEL = /アクセ|accessor|てぶくろ|手袋|glove|ソックス|くつした|靴下|sock|タイツ|tights/i;

export function varietyKind(label: string): VarietyKind {
  const kind = categoryKind(label);
  if (kind === 'face') return 'face';
  if (kind === 'hair' || kind === 'backhair') return 'hair';
  if (kind === 'shoes') return 'shoes';
  if (HAT_LABEL.test(label)) return 'hat';
  if (SMALL_LABEL.test(label)) return 'small';
  return 'garment';
}

const PALETTES = [
  'shades of one single colour, from light to dark',
  'two clearly contrasting colours',
  'soft pastel colours',
  'bright, vivid colours',
  'deep jewel-tone colours',
  'warm colours (reds, oranges, yellows)',
  'cool colours (blues, greens, purples)',
  'white with one bright accent colour',
];
const PATTERNS = ['small polka dots', 'stripes', 'a small flower print', 'little stars', 'gingham checks', 'little hearts', 'a plain colour with a contrasting trim', 'a scalloped edge'];
const MOTIFS = ['cats', 'rabbits', 'strawberries', 'sweets and candy', 'the sea and shells', 'the night sky and the moon', 'forest leaves and acorns', 'a flower garden', 'clouds and rainbows', 'birds', 'a fairy tale', 'a sporty look', 'a retro 1960s look', 'a cosy winter look'];

// 軸 → 種類ごとの候補。無い軸は、その種類では使わない
const TABLE: Record<VarietyKind, Partial<Record<Axis, string[]>>> = {
  garment: {
    shape: ['puffy and rounded', 'neat and simple straight lines', 'a flared, swirly hem', 'tiered layers of ruffles', 'a sheer layer over a plain layer', 'a high waist with a wide sash', 'a sailor collar', 'a big round collar'],
    pattern: PATTERNS,
    palette: PALETTES,
    decoration: ['a big ribbon bow', 'frills', 'a row of round buttons', 'simple embroidery', 'small sparkling gems', 'cute pockets', 'lace trim', 'contrasting piping'],
    motif: MOTIFS,
  },
  shoes: {
    shape: ['boots', 'ballet flats', 'sneakers', 'strap shoes (Mary Janes)', 'sandals', 'loafers', 'rain boots'],
    pattern: ['small polka dots', 'stripes', 'little stars', 'a plain colour with a contrasting sole', 'little hearts'],
    palette: PALETTES,
    decoration: ['a ribbon bow', 'a shiny buckle', 'colourful laces', 'a small charm', 'a pompom'],
    motif: MOTIFS,
  },
  hat: {
    shape: ['a beret', 'a wide-brimmed sun hat', 'a cap', 'a knitted beanie', 'a small top hat', 'a bucket hat', 'a straw boater'],
    pattern: ['small polka dots', 'stripes', 'gingham checks', 'a plain colour with a contrasting band'],
    palette: PALETTES,
    decoration: ['a ribbon band', 'a flower', 'a pompom', 'a small badge', 'a little bow'],
    motif: MOTIFS,
  },
  hair: {
    shape: ['twin tails', 'a high ponytail', 'two braids', 'a short bob', 'buns on both sides', 'long soft waves', 'a short, fluffy cut', 'a side ponytail'],
    decoration: ['a ribbon', 'a flower clip', 'a star hair clip', 'a headband', 'no hair ornament'],
    palette: ['a natural brown or black hair colour', 'a light golden hair colour', 'a soft pastel hair colour', 'a bright, playful hair colour', 'two-tone hair'],
  },
  face: {
    shape: ['big, round sparkling eyes', 'gentle, slightly droopy eyes', 'bright almond-shaped eyes', 'cheerful smiling (closed, curved) eyes'],
    decoration: ['rosy blush', 'a tiny star sticker on one cheek', 'soft coloured eyeshadow', 'a few cute freckles', 'long eyelashes'],
    motif: ['a big smile', 'a gentle smile', 'a playful wink', 'a small surprised mouth', 'an open, happy mouth'],
  },
  small: {
    pattern: PATTERNS,
    palette: PALETTES,
    decoration: ['a ribbon bow', 'frills', 'small sparkling gems', 'lace trim', 'a pompom'],
    motif: MOTIFS,
  },
};

// 一緒に出さない組み合わせ（どちらか片方だけにする）
const CONFLICTS: [string, string][] = [
  ['lace trim', 'a scalloped edge'],
  ['white with one bright accent colour', 'deep jewel-tone colours'],
  ['soft pastel colours', 'a retro 1960s look'],
  ['a cosy winter look', 'sandals'],
  ['a cosy winter look', 'a wide-brimmed sun hat'],
  ['a cosy winter look', 'a straw boater'],
  ['the sea and shells', 'a knitted beanie'],
  ['a plain colour with a contrasting trim', 'contrasting piping'],
];
const conflicts = (a: string, b: string) => CONFLICTS.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

const pick = <T>(list: T[], rng: Rng): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
function shuffle<T>(list: T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 軸ごとに 1 つずつ引き、まぜた順で返す（最大 MAX_HINTS_OFFERED）。
 * skipAxes: 引かない軸（セットで、品目ごとに変わる形など）
 */
export const MAX_HINTS_USED = 3;
export function drawHints(kind: VarietyKind, rng: Rng, skipAxes: Axis[] = []): Hint[] {
  const table = TABLE[kind];
  const axes = shuffle((Object.keys(table) as Axis[]).filter((a) => !skipAxes.includes(a)), rng);
  const hints: Hint[] = [];
  for (const axis of axes) {
    const options = (table[axis] ?? []).filter((text) => !hints.some((h) => conflicts(h.text, text)));
    if (options.length === 0) continue;
    hints.push({ axis, text: pick(options, rng) });
  }
  return hints;
}

const AXIS_NAME: Record<Axis, string> = { shape: 'shape/style', pattern: 'pattern', palette: 'colour scheme', decoration: 'decoration', motif: 'motif/mood' };
export const hintLine = (h: Hint) => `${AXIS_NAME[h.axis]}: ${h.text}`;

// 細かさ: きっちり／ふつう／ひろく
export type Specificity = 'precise' | 'normal' | 'broad';
export const SPECIFICITIES: Specificity[] = ['precise', 'normal', 'broad'];

// 企画の AI への、細かさの決め方とヒントの使い方
export function varietyRules(hintsBlock: string[]): string[] {
  return [
    'How closely to follow the theme (decide this first):',
    '- List in "decided" the design details the theme itself fixes (for example a colour, a shape, a length, a pattern, a decoration, a material). The kind of item itself (dress, skirt, shoes...) is not a detail. Words that only give a mood or a season (for example はる, ゆめ, かわいい) fix nothing by themselves.',
    '- Set "specificity" to "precise" if the theme fixes 2 or more details, "normal" if it fixes exactly 1, "broad" if it fixes none.',
    '- precise: follow the theme exactly and use none of the hints below; fill the rest in the way that suits the theme best.',
    '- normal: also use 1 or 2 of the hints below. broad: use 2 or 3 of them (never more than 3).',
    '- Take the hints in the order they are listed, skipping any hint on something the theme already decides or that does not fit the theme. The theme always wins over a hint.',
    '- Write the hints you used, word for word, in "hints".',
    '- The item must still look like a normal, cute piece of clothing for a child, and clearly match the theme.',
    ...hintsBlock,
  ];
}

// 最近の服の説明（同じドール・同じカテゴリ、新しい順）を、「これとは違うものに」と添える
export const RECENT_MAX = 5;
export function recentRules(recent: string[]): string[] {
  const list = recent.slice(0, RECENT_MAX);
  if (list.length === 0) return [];
  return [
    'The child recently made these items. Unless the theme fixes it, make the new design clearly different from them (shape, colours and decorations):',
    ...list.map((d) => `- ${d.replace(/\s+/g, ' ').trim().slice(0, 300)}`),
  ];
}

// 文の AI の返事に足す項目（記録と比べるため。品目の中身には使わない）
export const VARIETY_PROPERTIES = {
  decided: { type: 'array', items: { type: 'string' } },
  specificity: { type: 'string' }, // precise / normal / broad
  hints: { type: 'array', items: { type: 'string' } },
} as const;

export const VARIETY_REQUIRED = ['decided', 'specificity', 'hints'] as const;

export interface VarietyNote {
  specificity: Specificity | null; // AI が決めた細かさ（読めなければ null）
  decided: string[];
  offered: string[]; // 渡したヒント（hintLine）
  used: string[]; // AI が使ったと言ったヒント
}
export function readVariety(value: { decided?: unknown; specificity?: unknown; hints?: unknown } | undefined, offered: string[]): VarietyNote {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 200)).slice(0, 8) : []);
  const specificity = SPECIFICITIES.find((s) => s === value?.specificity) ?? null;
  return { specificity, decided: strings(value?.decided), offered, used: strings(value?.hints) };
}

export interface VarietyInput {
  rng?: Rng; // 既定 Math.random
  recent?: Record<string, string[]>; // カテゴリ ID → 最近の服の説明（新しい順）
}
