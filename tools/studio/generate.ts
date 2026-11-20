/**
 * テーマからの自動生成
 *
 *  企画（Claude）→ 品目ごとに: 切り抜きやすい色を選ぶ → 型紙のシルエットを作る → 画像生成（Gemini）
 *  → 切り抜きと位置合わせ → 数値の検品 → 見た目の検品（Claude がドールに着せた絵を見る）
 *  → 不合格なら、直してほしい点を画像生成への指示にして、1 回だけ自動で作り直す
 *
 * 髪は、ドールの本物の上半身を拡大した図（顔なし）に描かせ、元の図との違いを取り出す（processHair.ts）。前髪と後ろ髪は、その 1 枚からできる。
 * 帽子は、上半身を拡大したシルエットに描かせる（細部がつぶれない）。
 * くつは、ドールの本物の脚を拡大した図に描かせ、靴・靴の中に見える肌・隠す所に分ける（processShoe.ts）。
 * てぶくろは、本物の腕を拡大した図に描かせ、手首から先を絵ごと差し替える（processSwap.ts）。
 * 顔だけは作り方が違う: ドールの本物の頭の拡大図に描かせ、その頭を肌ごと「お面」のように切り取る（processFace.ts）。
 *
 * できた候補は公開しない。人が採用したものだけが、別の API で登録される。
 */
import sharp from 'sharp';
import type { Box } from '../../src/pipeline/alpha.ts';
import type { Tile } from '../../src/pipeline/frames.ts';
import { shareInsideRegion } from '../../src/pipeline/bodyParts.ts';
import type { BodyParts } from '../../src/pipeline/bodyParts.ts';
import { hairFromMask } from '../../src/pipeline/hairLayers.ts';
import { isBackHairCategory } from '../../src/pipeline/hairSplit.ts';
import { frameKind, frameTiles, swapZones } from '../../src/pipeline/frames.ts';
import { chooseBackground, chooseKeyColors, skinColor } from '../../src/pipeline/keyColors.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { ManifestDoll } from '../../src/content/manifest.ts';
import { AiError } from './ai.ts';
import type { ImageAi, TextAi } from './ai.ts';
import type { Budget } from './budget.ts';
import { faceCrop, isFaceCategory, processFace, renderHeadCloseup } from './processFace.ts';
import { pasteTile, pasteTileAlpha, renderFrame, tileTemplate, toTile } from './frame.ts';
import { processGenerated } from './processGenerated.ts';
import type { DollTemplate, ProcessResult, ProcessWarning, WarningCode } from './processGenerated.ts';
import { processHair } from './processHair.ts';
import { processShoe } from './processShoe.ts';
import { processSwap } from './processSwap.ts';
import { alphaToPng, renderPreview, renderSilhouette, rgbaToPng } from './silhouette.ts';

// ドールごとの型紙（studio/templates.json に保存する）
export interface TemplateData {
  parts: BodyParts;
  regions: Record<string, Box | null>; // カテゴリ ID → あるはずの範囲。null = どこでもよい
}

// キャラクター名などで断られないための、どの依頼にも付ける決まり
const NO_NAMES =
  'Never mention the name of any real or fictional character, film, anime, game, franchise, brand, designer or celebrity, and do not describe an outfit as "like" or "inspired by" one. Describe only the generic look (shape, colours, materials, decorations).';

export interface PlannedItem {
  category: string; // カテゴリ ID
  name: string; // 子ども向けのひらがな・カタカナの短い名前
  description: string; // 画像生成への指示（英語）
  colors: string[]; // 使う予定の色（#rrggbb）
}

export interface Candidate {
  item: PlannedItem;
  status: 'waiting' | 'working' | 'passed' | 'flagged' | 'failed';
  attempts: number;
  png?: Buffer; // ドールのキャンバス大の、切り抜いた服
  source?: Buffer; // 切り抜く前（位置合わせ済み）
  shape?: Buffer; // AI が描いた体と服の形（PNG）。手足の先を服に合わせるときに使う
  hide?: Buffer; // 差し替え式の品目（くつ・てぶくろ）: 着ているあいだドールを隠す所（PNG、白で不透明な所）
  front?: Buffer; // 髪: 前髪としてドールの上に描く範囲（PNG、不透明な所）。png は髪の全体
  under?: Buffer; // くつ: 靴の中に見える足の肌（PNG）。ドールのすぐ上、ほかの服の下に描く
  warnings: ProcessWarning[];
  notes: string[]; // 検品で気づいたこと・失敗の理由（日本語）
}

// 1 品目あたりの生成回数の既定（2 = できた絵を検品して、不合格なら指示を添えて 1 回だけ自動で作り直す）。
// STUDIO_MAX_ATTEMPTS で変えられる（1 = 作り直しなし）
export const MAX_ATTEMPTS = 2;
const MIN_REGION_SHARE = 0.8;
// 頭の拡大図の背景（AI が塗り変えにくい、うすい無彩色）
const FACE_BACKGROUND: Rgb = [233, 230, 242];

const hexToRgb = (hex: string): Rgb | null => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  return m ? [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)] : null;
};
const COLOR_NAMES: [Rgb, string][] = [
  [[0, 255, 0], 'pure bright green (#00FF00)'],
  [[255, 0, 255], 'pure magenta (#FF00FF)'],
  [[0, 255, 255], 'pure cyan (#00FFFF)'],
  [[255, 255, 0], 'pure yellow (#FFFF00)'],
  [[0, 0, 255], 'pure blue (#0000FF)'],
  [[255, 0, 0], 'pure red (#FF0000)'],
  [[255, 128, 0], 'pure orange (#FF8000)'],
  [[255, 255, 255], 'pure white (#FFFFFF)'],
];
const colorName = (c: Rgb) => COLOR_NAMES.find(([k]) => k.every((v, i) => v === c[i]))?.[1] ?? `rgb(${c.join(',')})`;

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          colors: { type: 'array', items: { type: 'string' } },
        },
        required: ['category', 'name', 'description', 'colors'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

// テーマから品目の一覧を作る
export async function planItems(text: TextAi, doll: ManifestDoll, input: { theme: string; count: number; categories?: string[]; style: string }): Promise<PlannedItem[]> {
  // うしろがみは、髪型の 1 枚から一緒にできるので、単独では作らない
  const categories = doll.categories.filter((c) => (!input.categories?.length || input.categories.includes(c.id)) && !isBackHairCategory(c.label));
  if (categories.length === 0) throw new AiError('カテゴリが選ばれていません', 400);
  const result = await text.json<{ items: PlannedItem[] }>({
    system:
      'You plan clothing and accessory items for a paper-doll dress-up game played by young children in Japan. ' +
      'Each item is later drawn by an image model on a fixed mannequin and cut out automatically, so every item must be a single wearable piece that is clearly separable from the body. ' +
      'Reply with JSON only.',
    prompt: [
      `Theme: ${input.theme}`,
      `Number of items to plan: ${input.count}`,
      `Art style: ${input.style || 'not specified'}`,
      'Allowed categories (use the id exactly as written):',
      ...categories.map((c) => {
        const kind = categoryKind(c.label);
        const note =
          kind === 'face'
            ? ' (face only: eyes, eyebrows, nose, mouth, blush. Never any hair.)'
            : kind === 'hair'
              ? ' (hairstyle only: hair and bangs, no longer than the hips. Never any facial features.)'
              : kind === 'shoes'
                ? ' (shoes must not be skin-coloured: no beige, nude or peach shoes.)'
                : '';
        return `- ${c.id}${note}`;
      }),
      '',
      NO_NAMES,
      'If the theme itself names a character or a work, design an original item that only borrows the general mood and colours.',
      '',
      'For each item give:',
      '- category: one of the allowed ids. Spread the items across categories so that complete outfits can be made, unless the theme asks for something specific.',
      '- name: a short, friendly Japanese name in hiragana/katakana only (no kanji), at most 12 characters, unique within this plan.',
      '- description: one or two English sentences for the image model describing only this item: shape, material, colours, decorations. Do not mention the doll, the body, the background or other items.',
      '- colors: 2 to 4 hex colours (#rrggbb) that the item will mainly use, including dark shadow tones if the item is dark.',
      '',
      'Special categories:',
      '- A face category (かお, メイク): the item is only the facial features painted on the doll\'s blank head: eyes, eyebrows, nose, mouth, cheeks, make-up. Describe those only. No hair, no hat, no accessories, no head shape, no skin colour.',
      '- A hair category (かみ, ヘア): the item is only the hairstyle, like a wig, optionally with a small hair ornament. No face. The hair is no longer than the hips.',
    ].join('\n'),
    schema: PLAN_SCHEMA,
  });
  const valid = new Set(categories.map((c) => c.id));
  const seen = new Set<string>();
  const items = (result.items ?? [])
    .filter((i) => valid.has(i.category) && typeof i.name === 'string' && i.name.trim() && typeof i.description === 'string')
    .map((i) => ({ category: i.category, name: i.name.trim().replace(/[\\/]/g, '').slice(0, 40), description: i.description, colors: (i.colors ?? []).filter((c) => hexToRgb(c)) }))
    .filter((i) => i.name && !seen.has(i.name) && seen.add(i.name))
    .slice(0, input.count);
  if (items.length === 0) throw new AiError('品目を作れませんでした。テーマを変えてやり直してください', 422);
  return items;
}

// 顔と髪型は別のカテゴリで着せ替えるので、それぞれ相手の部分を描かせない
const FACE_LABEL = /かお|顔|face|メイク|makeup/i;
const HAIR_LABEL = /^(かみ|髪|ヘア|hair)$|ヘアスタイル|かみがた|髪型|hair ?style|まえがみ|前髪/i;

const SHOES_LABEL = /くつ(?!した)|靴(?!下)|shoe|ブーツ|boot/i;

export function categoryKind(label: string): 'face' | 'hair' | 'backhair' | 'shoes' | null {
  if (isBackHairCategory(label)) return 'backhair';
  if (HAIR_LABEL.test(label.trim())) return 'hair';
  if (FACE_LABEL.test(label)) return 'face';
  if (SHOES_LABEL.test(label)) return 'shoes';
  return null;
}

// カテゴリごとの追加の決まり（シルエットに描かせる品目の、画像生成への指示）
export function categoryRules(label: string): string[] {
  switch (categoryKind(label)) {
    case 'face':
      return [
        '- This item is the face only: eyes, eyebrows, eyelashes, nose, mouth and cheek blush, drawn on the head of the mannequin.',
        '- Draw no hair at all: no bangs, fringe, sidelocks, sideburns, ponytail, hair outline or hair accessories. Hairstyles are a separate item, so the top and sides of the head must stay bald.',
        '- No hat, no ears decorations and nothing outside the face area.',
      ];
    case 'hair':
    case 'backhair':
      return [
        '- This item is the hairstyle only (hair, bangs, and the hair at the back), like a wig placed on the mannequin\'s head.',
        '- Do not draw eyes, eyebrows, nose, mouth or any other facial features. Faces are a separate item, so the face area must stay the flat mannequin colour where the hair does not cover it.',
        '- No hat or other accessories.',
      ];
    default:
      return [];
  }
}

const INSPECT_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, reason: { type: 'string' }, fix: { type: 'string' } },
  required: ['ok', 'reason', 'fix'],
  additionalProperties: false,
};

// 数値の検品で見つけた問題を、画像生成 AI への直し方の指示（英語）にする
const WARNING_FIX: Record<WarningCode, string> = {
  'no-silhouette': 'The mannequin silhouette was missing or repainted. Keep the mannequin exactly as in the template, in the same flat colour, and draw only the item on it.',
  'poor-fit': 'The mannequin was moved, resized or redrawn. Keep it exactly where it is in the template (same position, size, pose and outline) and only add the item.',
  'color-too-close': 'Parts of the item used colours too close to the mannequin or background colour. Use clearly different colours for every part of the item.',
  empty: 'No item was visible in the result. Draw the item clearly on the mannequin.',
  'touches-edge': 'The item reached the edge of the image and was cut off. Draw it smaller or shorter so that the whole item fits inside the image with a clear margin on every side.',
  repainted: 'Parts of the picture that should not change were repainted. Leave everything except the item itself exactly as it is in the given image.',
};

function itemPrompt(item: PlannedItem, categoryLabel: string, style: string, silhouette: Rgb, background: Rgb, feedback: string | null, upper: boolean): string {
  return [
    upper
      ? `The image is a mannequin template: the upper half (head to hips) of a doll as a flat ${colorName(silhouette)} silhouette on a flat ${colorName(background)} background. The body continues below the bottom edge of the image.`
      : `The first image is a mannequin template: a flat ${colorName(silhouette)} silhouette of a doll on a flat ${colorName(background)} background.`,
    `Draw exactly one item on the mannequin: ${item.description}`,
    `Item type: ${categoryLabel}.`,
    style ? `Art style: ${style}` : '',
    'Strict rules:',
    '- Keep the mannequin exactly as it is: same position, same size, same pose, same outline. Do not move, resize, redraw or restyle it.',
    `- Every part of the mannequin that the item does not cover must stay the same flat ${colorName(silhouette)}. Apart from the item itself, do not draw skin, a face, hair or anything else on it.`,
    `- The background must stay the same flat ${colorName(background)} with no shadows, gradients, floor, text or frame.`,
    `- The item itself must not contain ${colorName(silhouette)} or ${colorName(background)} or colours close to them.`,
    '- Do not draw an outline, border or shadow around the mannequin itself, and do not draw body details on it (no chin or jaw line, no neck line, no collarbone, no fingers).',
    '- Draw only this one item, worn naturally on the mannequin, fully visible and not cut off by the image edge.',
    upper ? '- The whole item must end above the bottom edge of the image, with a clear margin.' : '',
    ...categoryRules(categoryLabel),
    '- Square image, same framing as the template.',
    feedback ? `A previous attempt at this same item was inspected and rejected. Draw it again from scratch and fix these problems:\n${feedback}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// 髪の指示文。画像は、ドールの本物の上半身の拡大図（顔なし）
export function hairPrompt(item: PlannedItem, categoryLabel: string, style: string, background: Rgb, feedback: string | null): string {
  return [
    `The image is a close-up of the upper half (head to hips) of a bald doll with a blank face, for a paper-doll dress-up game, on a flat ${colorName(background)} background.`,
    `Give the doll this hairstyle: ${item.description}`,
    `Item type: ${categoryLabel}.`,
    style ? `Art style: ${style}` : '',
    'Draw the complete hairstyle on the doll the way it would naturally look: the bangs and the hair on top of the head in front of the head, and the hair that falls behind the neck, shoulders and back hidden behind the body where the body is in front of it.',
    'Strict rules:',
    '- Keep the doll exactly as it is: same position, size, pose, outline, skin colour and underwear. Do not move, resize, redraw or restyle it. Keep the same framing; do not zoom or crop.',
    '- The face stays completely blank: no eyes, eyebrows, nose, mouth or blush. Faces are a separate item.',
    '- The hair casts no shadow on the doll: do not shade or darken the forehead, face, ears, neck, shoulders or body under or next to the hair. The skin keeps its original flat colour right up to the edge of the hair.',
    '- Draw only the hair (a small hair ornament is fine if the description asks for one). No hat, no clothes, no other objects.',
    `- The background stays the same flat ${colorName(background)} with no shadow, gradient, text or frame. Every gap between strands of hair shows the flat background or the doll.`,
    `- The hair must not contain ${colorName(background)} or colours close to it, and it must be clearly different from the doll's skin colour.`,
    '- The whole hairstyle fits inside the image with a clear margin on every side, and ends above the bottom edge.',
    '- Draw the hair in the same art style and with the same thin dark outlines as the doll.',
    feedback ? `A previous attempt at this same hairstyle was inspected and rejected. Draw it again and fix these problems:\n${feedback}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// 差し替え式の品目（くつ・てぶくろ）の指示文。画像は、ドールの本物の脚（腕）の拡大図
function swapPrompt(item: PlannedItem, categoryLabel: string, style: string, background: Rgb, kind: 'feet' | 'hands', feedback: string | null): string {
  const feet = kind === 'feet';
  return [
    feet
      ? `The image is a close-up of the lower legs and bare feet of a doll for a paper-doll dress-up game, on a flat ${colorName(background)} background.`
      : `The image shows two panels side by side: close-ups of the two forearms and bare hands of a doll for a paper-doll dress-up game (left panel: the arm on the left side of the doll, right panel: the arm on the right side), on a flat ${colorName(background)} background.`,
    feet ? `Put this pair of shoes on the feet: ${item.description}` : `Put this pair of gloves on the two hands, the same glove mirrored on each hand: ${item.description}`,
    `Item type: ${categoryLabel}.`,
    style ? `Art style: ${style}` : '',
    feet
      ? 'The shoes replace the bare feet: draw each foot inside its shoe naturally (skin visible in the opening of a low shoe or between sandal straps is fine), with no part of the original bare foot sticking out beside or below the shoe.'
      : 'The gloves replace the bare hands: draw each hand inside its glove naturally, in the same pose and position, with no part of the original bare hand sticking out beside the glove.',
    'Strict rules:',
    feet
      ? '- Keep both legs exactly as they are above the shoes: same position, size, outline and skin colour.'
      : '- Keep both arms exactly as they are above the gloves: same position, size, angle, outline and skin colour. Keep each arm in its own panel.',
    '- Keep the same framing. Do not zoom, crop, move or rotate anything.',
    `- The background stays the same flat ${colorName(background)} with no shadow, floor, gradient, text or frame.`,
    `- The item must not contain ${colorName(background)} or colours close to it.`,
    '- Draw the item in the same art style and with the same thin outlines as the doll.',
    '- Draw only this one item, fully visible and not cut off by the image edge.',
    feedback ? `A previous attempt at this same item was inspected and rejected. Draw it again and fix these problems:\n${feedback}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// 枠の上で処理した結果を、キャンバスに戻す
async function fromTile(result: ProcessResult, tile: Tile, canvasW: number, canvasH: number): Promise<ProcessResult> {
  const rgba = new Uint8ClampedArray(canvasW * canvasH * 4);
  const source = new Uint8ClampedArray(canvasW * canvasH * 4);
  await pasteTile(rgba, canvasW, canvasH, result.rgba, tile);
  await pasteTile(source, canvasW, canvasH, result.source, tile);
  let shape: Uint8Array | null = null;
  if (result.shape) {
    shape = new Uint8Array(canvasW * canvasH);
    await pasteTileAlpha(shape, canvasW, canvasH, result.shape, tile);
  }
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 8) rgba[i] = 0;
  return { ...result, rgba, source, shape, width: canvasW, height: canvasH };
}

// 顔の指示文。画像は、ドールの本物の頭の拡大図（顔はまだ無い）
function facePrompt(item: PlannedItem, categoryLabel: string, style: string, feedback: string | null): string {
  return [
    'The image is a close-up of the blank head of a doll (no face yet) on a flat plain background. It is the base layer of a paper-doll dress-up game.',
    `Paint this face onto the head: ${item.description}`,
    `Item type: ${categoryLabel}.`,
    style ? `Art style: ${style}` : '',
    'The painted head will be cut out along the outline of the original head and laid over the doll like a mask, so:',
    '- Keep the head exactly where it is: same position, same size, same outline, same angle. Do not move, resize, turn or reshape it.',
    '- Paint the complete face on the existing skin: eyes, eyebrows, nose, mouth, cheeks and make-up. You may shade the skin of the face naturally, but keep the same overall skin colour so that the face still matches the neck and body.',
    '- Do not add hair, a hairline, a hat, glasses, earrings or any other object, and do not add text or a frame. The top and sides of the head stay bald skin.',
    '- Place the features where a face naturally sits on this head, facing the same direction as the head, at a natural size for it.',
    '- Leave the neck, shoulders and background as they are.',
    feedback ? `A previous attempt at this same face was inspected and rejected. Paint it again and fix these problems:\n${feedback}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export interface GenerateContext {
  text: TextAi;
  image: ImageAi;
  budget: Budget;
  doll: ManifestDoll;
  template: DollTemplate;
  data: TemplateData;
  style: string; // 絵柄の説明（英語）
  // ドールの高解像度の型（拡大図のもと）。scale = その大きさ ÷ template の大きさ。無ければ template から拡大する
  hi?: { template: DollTemplate; scale: number };
  maxAttempts?: number;
}

const REWRITE_SCHEMA = {
  type: 'object',
  properties: { description: { type: 'string' } },
  required: ['description'],
  additionalProperties: false,
};

// 画像生成 AI に断られた説明文を、無難な言い方に書き直す
export async function rewriteDescription(text: TextAi, description: string, kind: string): Promise<string> {
  const result = await text.json<{ description: string }>({
    system: 'You rewrite prompts for an image model used in a children\'s dress-up game. Reply with JSON only.',
    prompt: [
      `The image model refused this ${kind} description for content-policy reasons:`,
      description,
      '',
      'Rewrite it in one or two English sentences so that it describes the same kind of thing in a generic, child-friendly way.',
      NO_NAMES,
      'Remove anything that could be read as revealing, sexual, violent or unsafe.',
    ].join('\n'),
    schema: REWRITE_SCHEMA,
  });
  const rewritten = typeof result.description === 'string' ? result.description.trim() : '';
  if (!rewritten) throw new AiError('説明文を書き直せませんでした');
  return rewritten.slice(0, 1000);
}

// 1 品目を作る。candidate を書き換えながら進める（途中経過を画面に出せるように）
export async function generateCandidate(ctx: GenerateContext, candidate: Candidate): Promise<void> {
  const { item } = candidate;
  const label = ctx.doll.categories.find((c) => c.id === item.category)?.label ?? item.category;
  const planned = item.colors.map(hexToRgb).filter((c): c is Rgb => c !== null);
  const avoid: Rgb[] = []; // 前回、服と近すぎた色
  let feedback: string | null = null;
  const maxAttempts = ctx.maxAttempts ?? MAX_ATTEMPTS;
  // 前の回の結果。作り直しが失敗したり、何も残らなかったりしたときは、こちらを残す
  let kept: { png: Buffer; source: Buffer; shape?: Buffer; hide?: Buffer; front?: Buffer; under?: Buffer; warnings: ProcessWarning[]; notes: string[] } | null = null;
  const kind = categoryKind(label);
  // うしろがみは、髪型の 1 枚から一緒にできる（前髪と別々に選べる）。単独では作らない
  if (kind === 'backhair') {
    candidate.status = 'failed';
    candidate.notes = ['うしろがみは、髪型と一緒に作られます。髪型のカテゴリで作ってください'];
    return;
  }
  const frame = frameKind(label);
  const hi = ctx.hi ?? { template: ctx.template, scale: 1 };
  const { canvasW, canvasH } = ctx.template;
  let rewritten = false; // 断られて説明文を書き直したか（1 回まで）
  let rewriteNote: string[] = []; // 書き直したことを、最後まで候補の注記に残す
  let redoNote: string[] = []; // 検品で不合格になり、指示を添えて作り直したこと
  const keepEarlier = (reason: string) => {
    if (!kept) return false;
    candidate.png = kept.png;
    candidate.source = kept.source;
    candidate.shape = kept.shape;
    candidate.hide = kept.hide;
    candidate.front = kept.front;
    candidate.under = kept.under;
    candidate.warnings = kept.warnings;
    candidate.notes = [...kept.notes, `作り直しは採用しませんでした（${reason}）`];
    candidate.status = 'flagged';
    return true;
  };

  // 断られて説明文を書き直したときは、回数の上限とは別に 1 回だけやり直す（断られた依頼は画像ができていない）
  for (let attempt = 1; attempt <= maxAttempts + (rewritten ? 1 : 0); attempt++) {
    candidate.attempts = attempt;
    candidate.status = 'working'; // 作り直し中は、前の回の画像を候補として見せない
    let result: ProcessResult;
    let hide: Uint8Array | null = null;
    let front: Uint8Array | null = null; // 髪: 前髪の範囲
    let under: Uint8ClampedArray | null = null; // くつ: 靴の中に見える肌
    try {
      if (isFaceCategory(label)) {
        // 顔: 本物の頭の拡大図に描かせて、元の図との違いを取り出す
        const crop = faceCrop(ctx.data.parts.head, ctx.template.canvasW, ctx.template.canvasH);
        const reference = await renderHeadCloseup(ctx.template, crop, FACE_BACKGROUND);
        await ctx.budget.spend();
        const generated = await ctx.image.generate({ prompt: facePrompt(item, label, ctx.style, feedback), images: [reference] });
        result = await processFace(generated, reference, ctx.template, crop, FACE_BACKGROUND, ctx.data.parts.head);
      } else if (frame === 'hair') {
        // 髪: 本物の上半身の拡大図（顔なし）に描かせて、元の図との違いを取り出す
        const [tile] = frameTiles('hair', ctx.data.parts, canvasW, canvasH);
        const skin = skinColor(ctx.template.rgba, canvasW, canvasH, ctx.data.parts.head);
        const background = chooseBackground([...planned, ...avoid, skin, [255, 255, 255]]);
        const reference = await renderFrame(hi.template, hi.scale, [tile], background, null);
        await ctx.budget.spend();
        const generated = await ctx.image.generate({ prompt: hairPrompt(item, label, ctx.style, background, feedback), images: [reference] });
        const hair = await processHair(generated, reference, await tileTemplate(hi.template, hi.scale, tile), tile, canvasW, canvasH, background, toTile(ctx.data.parts.torso, tile).y);
        result = hair;
        front = hair.front;
      } else if (frame === 'feet' || frame === 'hands') {
        // くつ・てぶくろ: 本物の脚（腕）の拡大図に描かせる。
        // くつは、靴・靴の中に見える肌・隠す所に分ける。てぶくろは、手首から先を絵ごと差し替える
        const tiles = frameTiles(frame, ctx.data.parts, canvasW, canvasH);
        const skin = skinColor(ctx.template.rgba, canvasW, canvasH, frame === 'feet' ? ctx.data.parts.legs : ctx.data.parts.armLeft);
        const background = chooseBackground([...planned, ...avoid, skin, [255, 255, 255]]);
        const reference = await renderFrame(hi.template, hi.scale, tiles, background, null);
        await ctx.budget.spend();
        const generated = await ctx.image.generate({ prompt: swapPrompt(item, label, ctx.style, background, frame, feedback), images: [reference] });
        if (frame === 'feet') {
          const shoe = await processShoe(generated, reference, ctx.template, tiles, swapZones(frame, ctx.data.parts), background);
          result = shoe;
          hide = shoe.hide;
          if (shoe.under.some((v, i) => i % 4 === 3 && v >= 128)) under = shoe.under;
        } else {
          const swap = await processSwap(generated, reference, ctx.template, tiles, swapZones(frame, ctx.data.parts), background);
          result = swap;
          hide = swap.hide;
        }
        if (result.warnings.some((w) => w.code === 'color-too-close')) avoid.push(background);
      } else if (frame === 'upper') {
        // 帽子: 上半身を拡大したシルエットに描かせ、拡大図の上で切り抜いて、キャンバスに戻す
        const [tile] = frameTiles('upper', ctx.data.parts, canvasW, canvasH);
        const keys = chooseKeyColors([...planned, ...avoid]);
        const silhouette = await renderFrame(hi.template, hi.scale, [tile], keys.background, keys.silhouette);
        await ctx.budget.spend();
        const generated = await ctx.image.generate({ prompt: itemPrompt(item, label, ctx.style, keys.silhouette, keys.background, feedback, true), images: [silhouette] });
        const onTile = await processGenerated(generated, await tileTemplate(hi.template, hi.scale, tile), { silhouetteColor: keys.silhouette, anchor: toTile(ctx.data.parts.head, tile) });
        result = await fromTile(onTile, tile, canvasW, canvasH);
        if (result.warnings.some((w) => w.code === 'color-too-close')) avoid.push(keys.silhouette, keys.background);
      } else {
        const keys = chooseKeyColors([...planned, ...avoid]);
        const silhouette = await renderSilhouette(ctx.template, keys.silhouette, keys.background);
        await ctx.budget.spend();
        const generated = await ctx.image.generate({ prompt: itemPrompt(item, label, ctx.style, keys.silhouette, keys.background, feedback, false), images: [silhouette] });
        result = await processGenerated(generated, ctx.template, { silhouetteColor: keys.silhouette, parts: Object.values(ctx.data.parts) });
        if (result.warnings.some((w) => w.code === 'color-too-close')) avoid.push(keys.silhouette, keys.background);
      }
    } catch (error) {
      const message = (error as Error).message;
      // 内容の決まりで断られたら、説明文を書き直して 1 回だけやり直す
      if (error instanceof AiError && error.blocked && !rewritten) {
        rewritten = true;
        try {
          const before = item.description;
          item.description = await rewriteDescription(ctx.text, before, label);
          rewriteNote = [`画像 AI に断られたので、説明文を書き直しました（前: ${before}）`];
          candidate.notes = rewriteNote;
          feedback = null;
          continue;
        } catch {
          // 書き直せなければ、下でふつうの失敗として扱う
        }
      }
      if (keepEarlier(message)) return;
      candidate.notes = [message];
      candidate.status = 'failed';
      // 上限・キーの誤りなど、やり直しても同じ結果になるものは打ち切る
      if (!(error instanceof AiError) || !error.retryable) return;
      feedback = null;
      continue;
    }

    const empty = result.warnings.some((w) => w.code === 'empty');
    if (empty && keepEarlier('服が見つかりませんでした')) return;
    candidate.png = await rgbaToPng(result.rgba, result.width, result.height);
    candidate.source = await rgbaToPng(result.source, result.width, result.height);
    candidate.shape = result.shape ? await alphaToPng(result.shape, result.width, result.height) : undefined;
    candidate.hide = hide ? await alphaToPng(hide, result.width, result.height) : undefined;
    candidate.front = front ? await alphaToPng(front, result.width, result.height) : undefined;
    candidate.under = under ? await rgbaToPng(under, result.width, result.height) : undefined;
    candidate.warnings = [...result.warnings];
    candidate.notes = [...rewriteNote, ...redoNote];

    // 数値の検品
    const problems: string[] = result.warnings.map((w) => w.message);
    const fixes: string[] = result.warnings.map((w) => WARNING_FIX[w.code]); // 作り直すときに画像生成 AI へ伝える指示（英語）
    const region = ctx.data.regions[item.category];
    // 髪は長くも広くもなるので、範囲では見ない（頭に合っているかは、見た目の検品で見る）
    // くつ・てぶくろは、拡大図の枠の中にしか描けないので見ない
    if (region && !empty && kind !== 'hair' && frame !== 'feet' && frame !== 'hands') {
      const share = shareInsideRegion(result.rgba, result.width, result.height, region);
      if (share < MIN_REGION_SHARE) {
        problems.push(`「${label}」があるはずの範囲から、服の ${Math.round((1 - share) * 100)}% がはみ出しています`);
        fixes.push(`The item was too large or in the wrong place for a "${label}" item. Draw it at a natural size, only on the part of the body where such an item is worn.`);
      }
    }

    // 見た目の検品（数値で問題が無いときだけ。問題があれば、どうせ作り直す）
    if (problems.length === 0) {
      let verdict: { ok: boolean; reason: string; fix?: string };
      try {
        // 差し替え式は、ゲームと同じように、ドールの足（手）を隠してから重ねる
        let shown = ctx.template;
        if (hide) {
          const rgba = new Uint8ClampedArray(ctx.template.rgba);
          for (let p = 0; p < hide.length; p++) rgba[p * 4 + 3] = Math.round((rgba[p * 4 + 3] * (255 - hide[p])) / 255);
          shown = { ...ctx.template, rgba };
        }
        // 髪は、ゲームと同じように、後ろ髪をドールの後ろ、前髪をドールの前に置く。靴の肌は、靴の下に置く
        let preview: Buffer;
        if (front) {
          const dollAlpha = new Uint8Array(result.width * result.height);
          for (let p = 0; p < dollAlpha.length; p++) dollAlpha[p] = ctx.template.rgba[p * 4 + 3];
          const layers = hairFromMask(result.rgba, front, dollAlpha, result.width, result.height);
          preview = await renderPreview(shown, [layers.front], undefined, [layers.back]);
        } else {
          preview = await renderPreview(shown, under ? [under, result.rgba] : [result.rgba]);
        }
        verdict = await ctx.text.json<{ ok: boolean; reason: string; fix?: string }>({
          system: 'You are a strict quality inspector for a children\'s dress-up game. Reply with JSON only.',
          prompt: [
            'The image shows a doll wearing one item that an image model drew and that was then cut out automatically.',
            `The item should be: ${item.description} (type: ${label}).`,
            'Look at the picture carefully and set ok to false if any of these is true:',
            '- the item does not match the description;',
            '- it is misplaced: shifted sideways or up/down from the body part it belongs to, so that it does not sit naturally on the doll (for hair and hats: not centred on the head, or the bald head sticks out on one side);',
            '- its size is unnatural for this doll: clearly too large or too small for the body part that wears it (for example a tiara or hat much wider than the head);',
            '- parts of it are missing, cut off in a straight line, or have holes that look like cut-out errors;',
            '- leftover patches of flat key colour or background, stray specks or a rectangular block remain;',
            '- extra objects, body parts or text are present, or the drawing is malformed.',
            categoryKind(label) === 'face' ? 'This item must be a face without any hair: set ok to false if any hair (bangs, sidelocks, hair outline) is drawn.' : '',
            categoryKind(label) === 'hair' ? 'This item must be a hairstyle without a face: set ok to false if eyes, a mouth or other facial features are drawn.' : '',
            frame === 'feet' ? 'The shoes replace the doll\'s feet: set ok to false if a second foot or toes stick out beside or below a shoe, or if there is a visible seam or colour jump on the leg just above the shoe.' : '',
            frame === 'hands' ? 'The gloves replace the doll\'s hands: set ok to false if a second hand or fingers stick out beside a glove, or if there is a visible seam or colour jump on the arm just above the glove.' : '',
            'Otherwise set ok to true.',
            'reason: explain briefly in Japanese (one sentence) what you saw.',
            'fix: if ok is false, write one to three short English sentences addressed to the image model that will redraw the item, saying exactly what to change ' +
              '(for example "Draw the tiara much smaller, about as wide as the head, resting on top of the hair." or "Centre the hair on the head; the head must be fully covered on both sides."). ' +
              'Describe the desired result, not the cut-out process. If ok is true, set fix to an empty string.',
          ].filter(Boolean).join('\n'),
          images: [preview],
          schema: INSPECT_SCHEMA,
        });
      } catch (error) {
        // 検品そのものができなかった。できた画像は残し、人に見てもらう（作り直しても検品はまた失敗する）
        candidate.notes = [...rewriteNote, ...redoNote, `見た目の検品ができませんでした（${(error as Error).message}）`];
        candidate.status = 'flagged';
        return;
      }
      if (verdict.ok) {
        candidate.notes = [...rewriteNote, ...redoNote];
        candidate.status = 'passed';
        return;
      }
      problems.push(verdict.reason || '見た目の検品で不合格でした');
      fixes.push((typeof verdict.fix === 'string' && verdict.fix.trim()) || verdict.reason || 'The result did not pass inspection. Follow the rules above more strictly.');
    }
    candidate.notes = [...rewriteNote, ...redoNote, ...problems];
    kept = { png: candidate.png, source: candidate.source, shape: candidate.shape, hide: candidate.hide, front: candidate.front, under: candidate.under, warnings: candidate.warnings, notes: [...redoNote, ...problems] };
    feedback = fixes.map((f) => `- ${f}`).join('\n');
    redoNote = [`検品の指摘を伝えて、自動で作り直しました（前の指摘: ${problems.join(' / ')}）`];
  }
  candidate.status = candidate.png ? 'flagged' : 'failed';
}

const BACKGROUND_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, description: { type: 'string' } },
        required: ['name', 'description'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

export interface PlannedBackground {
  name: string;
  description: string;
}

export async function planBackgrounds(text: TextAi, input: { theme: string; count: number; existing: string[] }): Promise<PlannedBackground[]> {
  const result = await text.json<{ items: PlannedBackground[] }>({
    system: 'You plan background scenes for a paper-doll dress-up game played by young children in Japan. Reply with JSON only.',
    prompt: [
      `Theme: ${input.theme}`,
      `Number of backgrounds: ${input.count}`,
      `Existing background names (do not duplicate): ${input.existing.join(', ') || '(none)'}`,
      'For each background give:',
      '- name: a short Japanese name in hiragana/katakana only, at most 12 characters, unique.',
      '- description: one or two English sentences describing the scene. No people, no animals in the foreground, no text. The centre of the picture must be calm and uncluttered because a doll stands there.',
      NO_NAMES.replace('an outfit', 'a scene'),
    ].join('\n'),
    schema: BACKGROUND_PLAN_SCHEMA,
  });
  const seen = new Set(input.existing);
  const items = (result.items ?? [])
    .filter((i) => typeof i.name === 'string' && typeof i.description === 'string')
    .map((i) => ({ name: i.name.trim().replace(/[\\/]/g, '').slice(0, 40), description: i.description }))
    .filter((i) => i.name && !seen.has(i.name) && seen.add(i.name))
    .slice(0, input.count);
  if (items.length === 0) throw new AiError('背景の案を作れませんでした。テーマを変えてやり直してください', 422);
  return items;
}

export interface BackgroundCandidate {
  item: PlannedBackground;
  status: 'waiting' | 'working' | 'passed' | 'failed';
  attempts: number;
  png?: Buffer;
  notes: string[];
}

export async function generateBackground(ctx: { text: TextAi; image: ImageAi; budget: Budget; style: string }, candidate: BackgroundCandidate): Promise<void> {
  candidate.status = 'working';
  // 内容の決まりで断られたら、説明文を書き直して 1 回だけやり直す
  for (let attempt = 1; attempt <= 2; attempt++) {
    candidate.attempts = attempt;
    try {
      await ctx.budget.spend();
      const generated = await ctx.image.generate({
        prompt: [
          `Draw a square background illustration for a children's dress-up game: ${candidate.item.description}`,
          ctx.style ? `Art style: ${ctx.style}` : 'Soft, bright, friendly illustration style.',
          'Rules: no people, no characters, no text, no frame. Keep the centre calm and uncluttered. The ground or floor should be visible in the lower quarter so a standing doll looks natural.',
        ].join('\n'),
        images: [],
      });
      // 正方形でなければ中央を切り出す
      candidate.png = await sharp(generated).resize(1024, 1024, { fit: 'cover' }).png().toBuffer();
      candidate.status = 'passed';
      return;
    } catch (error) {
      candidate.notes = [(error as Error).message];
      candidate.status = 'failed';
      if (!(error instanceof AiError && error.blocked) || attempt > 1) return;
      try {
        const before = candidate.item.description;
        candidate.item.description = await rewriteDescription(ctx.text, before, 'background');
        candidate.notes = [`断られたので説明文を書き直しました（前: ${before}）`];
        candidate.status = 'working';
      } catch {
        return;
      }
    }
  }
}
