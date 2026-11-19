/**
 * テーマからの自動生成
 *
 *  企画（Claude）→ 品目ごとに: 切り抜きやすい色を選ぶ → 型紙のシルエットを作る → 画像生成（Gemini）
 *  → 切り抜きと位置合わせ → 数値の検品 → 見た目の検品（Claude がドールに着せた絵を見る）
 *  → 不合格なら、直してほしい点を画像生成への指示にして、1 回だけ自動で作り直す
 *
 * 顔だけは作り方が違う: ドールの本物の頭の拡大図に描かせ、その頭を肌ごと「お面」のように切り取る（processFace.ts）。
 *
 * できた候補は公開しない。人が採用したものだけが、別の API で登録される。
 */
import sharp from 'sharp';
import type { Box } from '../../src/pipeline/alpha.ts';
import { anchorPart, shareInsideRegion } from '../../src/pipeline/bodyParts.ts';
import type { BodyParts } from '../../src/pipeline/bodyParts.ts';
import { isHairCategory } from '../../src/pipeline/hairSplit.ts';
import { chooseKeyColors } from '../../src/pipeline/keyColors.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { ManifestDoll } from '../../src/content/manifest.ts';
import { AiError } from './ai.ts';
import type { ImageAi, TextAi } from './ai.ts';
import type { Budget } from './budget.ts';
import { faceCrop, isFaceCategory, processFace, renderHeadCloseup } from './processFace.ts';
import { processGenerated } from './processGenerated.ts';
import type { DollTemplate, ProcessWarning, WarningCode } from './processGenerated.ts';
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
  const categories = doll.categories.filter((c) => !input.categories?.length || input.categories.includes(c.id));
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
              ? ' (hairstyle only: hair and bangs. Never any facial features.)'
              : kind === 'shoes'
                ? ' (closed shoes or boots that cover the whole foot. No sandals, open toes or bare insteps.)'
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
      '- A hair category (かみ, ヘア): the item is only the hairstyle, like a wig, optionally with a small hair ornament. No face.',
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
const HAIR_LABEL = /^(かみ|髪|ヘア|hair)$|ヘアスタイル|かみがた|髪型|hair ?style/i;

const SHOES_LABEL = /くつ(?!した)|靴(?!下)|shoe|ブーツ|boot/i;

export function categoryKind(label: string): 'face' | 'hair' | 'shoes' | null {
  if (HAIR_LABEL.test(label.trim())) return 'hair';
  if (FACE_LABEL.test(label)) return 'face';
  if (SHOES_LABEL.test(label)) return 'shoes';
  return null;
}

// カテゴリごとの追加の決まり（画像生成への指示）
export function categoryRules(label: string): string[] {
  switch (categoryKind(label)) {
    case 'face':
      return [
        '- This item is the face only: eyes, eyebrows, eyelashes, nose, mouth and cheek blush, drawn on the head of the mannequin.',
        '- Draw no hair at all: no bangs, fringe, sidelocks, sideburns, ponytail, hair outline or hair accessories. Hairstyles are a separate item, so the top and sides of the head must stay bald.',
        '- No hat, no ears decorations and nothing outside the face area.',
      ];
    case 'hair':
      return [
        '- This item is the hairstyle only (hair, bangs, and the hair at the back), like a wig placed on the mannequin\'s head.',
        '- Do not draw eyes, eyebrows, nose, mouth or any other facial features. Faces are a separate item, so the face area must stay the flat mannequin colour where the hair does not cover it.',
        '- No hat or other accessories.',
        '- The hair may be long and wide. Hair that hangs behind the body is fine: it will be placed behind the doll, so what matters is that the hair sits exactly on the head.',
      ];
    case 'shoes':
      // 靴の内側（足が入る所）をシルエットの色のまま残させない。残ると、そこが切り抜かれて、ドールの足と形が合わずにのぞく
      return [
        '- Draw the shoes as solid, fully opaque objects seen straight from the front, completely covering both feet of the mannequin from the toes up to the top edge of the shoe.',
        '- Inside the outline of each shoe, nothing of the mannequin may remain visible: no foot, toes, instep or ankle in the mannequin colour, and no visible shoe opening. Paint that whole area with the shoe itself.',
        '- The top edge of each shoe is a clean line across the ankle or leg; the leg simply disappears into the shoe.',
        '- Straps, ribbons or laces must lie on the shoe itself or be drawn as solid bands around the leg, not as thin lines with the mannequin colour showing between them.',
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
  'touches-edge': 'The item reached the edge of the image and was cut off. Draw it smaller so that the whole item fits inside the image with a clear margin on every side.',
  repainted: 'The head or skin was repainted. Leave everything except the facial features exactly as it is.',
};

function itemPrompt(item: PlannedItem, categoryLabel: string, style: string, silhouette: Rgb, background: Rgb, feedback: string | null, closeup: boolean): string {
  return [
    `The first image is a mannequin template: a flat ${colorName(silhouette)} silhouette of a doll on a flat ${colorName(background)} background.`,
    closeup
      ? 'The second image shows close-ups of the same mannequin\'s hands and feet in their real colours (from left to right: the hand on the left side of the template, the hand on the right side, the feet). ' +
        'Use it only to see the exact shape of the fingers and toes so that the item fits them precisely. Do not copy it into the result and do not paint skin colour on the mannequin.'
      : '',
    `Draw exactly one item on the mannequin: ${item.description}`,
    `Item type: ${categoryLabel}.`,
    style ? `Art style: ${style}` : '',
    isHairCategory(categoryLabel)
      ? `This item is a hairstyle worn like a wig. Draw only the hair. The face area of the head must stay the same flat ${colorName(silhouette)} (no eyes, no mouth, no skin). ` +
        `Every gap between strands of hair must show the flat ${colorName(background)} background or the flat mannequin, never any other colour.`
      : '',
    'Strict rules:',
    '- Keep the mannequin exactly as it is: same position, same size, same pose, same outline. Do not move, resize, redraw or restyle it.',
    `- Every part of the mannequin that the item does not cover must stay the same flat ${colorName(silhouette)}. Apart from the item itself, do not draw skin, a face, hair or anything else on it.`,
    `- The background must stay the same flat ${colorName(background)} with no shadows, gradients, floor, text or frame.`,
    `- The item itself must not contain ${colorName(silhouette)} or ${colorName(background)} or colours close to them.`,
    '- Do not draw an outline, border or shadow around the mannequin itself, and do not draw body details on it (no chin or jaw line, no neck line, no collarbone, no fingers).',
    '- Draw only this one item, worn naturally on the mannequin, fully visible and not cut off by the image edge.',
    ...categoryRules(categoryLabel),
    '- Square image, same framing as the template.',
    feedback ? `A previous attempt at this same item was inspected and rejected. Draw it again from scratch and fix these problems:\n${feedback}` : '',
  ]
    .filter(Boolean)
    .join('\n');
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
  closeup: Buffer | null; // 手と足の拡大図（PNG）。手袋・靴など、手足にかかる品目のときだけ
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
  let kept: { png: Buffer; source: Buffer; shape?: Buffer; warnings: ProcessWarning[]; notes: string[] } | null = null;
  let rewritten = false; // 断られて説明文を書き直したか（1 回まで）
  let rewriteNote: string[] = []; // 書き直したことを、最後まで候補の注記に残す
  let redoNote: string[] = []; // 検品で不合格になり、指示を添えて作り直したこと
  const keepEarlier = (reason: string) => {
    if (!kept) return false;
    candidate.png = kept.png;
    candidate.source = kept.source;
    candidate.shape = kept.shape;
    candidate.warnings = kept.warnings;
    candidate.notes = [...kept.notes, `作り直しは採用しませんでした（${reason}）`];
    candidate.status = 'flagged';
    return true;
  };

  // 断られて説明文を書き直したときは、回数の上限とは別に 1 回だけやり直す（断られた依頼は画像ができていない）
  for (let attempt = 1; attempt <= maxAttempts + (rewritten ? 1 : 0); attempt++) {
    candidate.attempts = attempt;
    candidate.status = 'working'; // 作り直し中は、前の回の画像を候補として見せない
    let result;
    try {
      if (isFaceCategory(label)) {
        // 顔: 本物の頭の拡大図に描かせて、元の図との違いを取り出す
        const crop = faceCrop(ctx.data.parts.head, ctx.template.canvasW, ctx.template.canvasH);
        const reference = await renderHeadCloseup(ctx.template, crop, FACE_BACKGROUND);
        await ctx.budget.spend();
        const generated = await ctx.image.generate({ prompt: facePrompt(item, label, ctx.style, feedback), images: [reference] });
        result = await processFace(generated, reference, ctx.template, crop, FACE_BACKGROUND, ctx.data.parts.head);
      } else {
        const keys = chooseKeyColors([...planned, ...avoid]);
        const silhouette = await renderSilhouette(ctx.template, keys.silhouette, keys.background);
        await ctx.budget.spend();
        const generated = await ctx.image.generate({
          prompt: itemPrompt(item, label, ctx.style, keys.silhouette, keys.background, feedback, !!ctx.closeup),
          images: ctx.closeup ? [silhouette, ctx.closeup] : [silhouette],
        });
        // 髪型・帽子は、体全体ではなく頭に合わせて置く
        const anchor = anchorPart(label);
        result = await processGenerated(generated, ctx.template, {
          silhouetteColor: keys.silhouette,
          parts: Object.values(ctx.data.parts),
          anchor: anchor ? ctx.data.parts[anchor] : undefined,
        });
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
    candidate.warnings = [...result.warnings];
    candidate.notes = [...rewriteNote, ...redoNote];

    // 数値の検品
    const problems: string[] = result.warnings.map((w) => w.message);
    const fixes: string[] = result.warnings.map((w) => WARNING_FIX[w.code]); // 作り直すときに画像生成 AI へ伝える指示（英語）
    const region = ctx.data.regions[item.category];
    if (region && !empty) {
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
        const preview = await renderPreview(ctx.template, [result.rgba]);
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
            categoryKind(label) === 'shoes' ? 'These must be shoes that cover the feet completely: set ok to false if the doll\'s bare foot, toes or the outline of the foot shows through inside a shoe or sticks out of it.' : '',
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
    kept = { png: candidate.png, source: candidate.source, shape: candidate.shape, warnings: candidate.warnings, notes: [...redoNote, ...problems] };
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
