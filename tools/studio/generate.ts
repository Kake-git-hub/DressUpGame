/**
 * テーマからの自動生成
 *
 *  企画（Claude）→ 品目ごとに: 切り抜きやすい色を選ぶ → 型紙のシルエットを作る → 画像生成（Gemini）
 *  → 切り抜きと位置合わせ → 数値の検品 → 見た目の検品（Claude）→ 不合格なら理由を添えて作り直す
 *
 * できた候補は公開しない。人が採用したものだけが、別の API で登録される。
 */
import sharp from 'sharp';
import type { Box } from '../../src/pipeline/alpha.ts';
import { shareInsideRegion } from '../../src/pipeline/bodyParts.ts';
import type { BodyParts } from '../../src/pipeline/bodyParts.ts';
import { chooseKeyColors } from '../../src/pipeline/keyColors.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { ManifestDoll } from '../../src/content/manifest.ts';
import { AiError } from './ai.ts';
import type { ImageAi, TextAi } from './ai.ts';
import type { Budget } from './budget.ts';
import { processGenerated } from './processGenerated.ts';
import type { DollTemplate, ProcessWarning } from './processGenerated.ts';
import { renderPreview, renderSilhouette, rgbaToPng } from './silhouette.ts';

// ドールごとの型紙（studio/templates.json に保存する）
export interface TemplateData {
  parts: BodyParts;
  regions: Record<string, Box | null>; // カテゴリ ID → あるはずの範囲。null = どこでもよい
  style: string; // 絵柄の説明
  styleRefs: string[]; // 絵柄の見本にするアイテムの ID
}

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
  warnings: ProcessWarning[];
  notes: string[]; // 検品で気づいたこと・失敗の理由（日本語）
}

export const MAX_ATTEMPTS = 2; // 1 品目あたり、作り直しを含めた生成回数の上限
const MIN_REGION_SHARE = 0.8;

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
  const existing = doll.items.map((i) => `${i.category}: ${i.name}`).join('\n') || '(none)';
  const result = await text.json<{ items: PlannedItem[] }>({
    system:
      'You plan clothing and accessory items for a paper-doll dress-up game played by young children in Japan. ' +
      'Each item is later drawn by an image model on a fixed mannequin and cut out automatically, so every item must be a single wearable piece that is clearly separable from the body. ' +
      'Reply with JSON only.',
    prompt: [
      `Theme: ${input.theme}`,
      `Number of items to plan: ${input.count}`,
      `Art style of the game: ${input.style || 'not specified'}`,
      'Allowed categories (use the id exactly as written):',
      ...categories.map((c) => `- ${c.id}`),
      'Items that already exist (do not duplicate these):',
      existing,
      '',
      'For each item give:',
      '- category: one of the allowed ids. Spread the items across categories so that complete outfits can be made, unless the theme asks for something specific.',
      '- name: a short, friendly Japanese name in hiragana/katakana only (no kanji), at most 12 characters, unique within this plan and different from existing names.',
      '- description: one or two English sentences for the image model describing only this item: shape, material, colours, decorations. Do not mention the doll, the body, the background or other items.',
      '- colors: 2 to 4 hex colours (#rrggbb) that the item will mainly use, including dark shadow tones if the item is dark.',
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

const INSPECT_SCHEMA = {
  type: 'object',
  properties: { ok: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['ok', 'reason'],
  additionalProperties: false,
};

function itemPrompt(item: PlannedItem, categoryLabel: string, style: string, silhouette: Rgb, background: Rgb, feedback: string | null, refs: number): string {
  return [
    `The first image is a mannequin template: a flat ${colorName(silhouette)} silhouette of a doll on a flat ${colorName(background)} background.`,
    refs > 0 ? `The other ${refs} image(s) show existing items of the same game. Match their art style, line quality and level of detail, but do not copy their design.` : '',
    `Draw exactly one item on the mannequin: ${item.description}`,
    `Item type: ${categoryLabel}.`,
    style ? `Art style: ${style}` : '',
    'Strict rules:',
    '- Keep the mannequin exactly as it is: same position, same size, same pose, same outline. Do not move, resize, redraw or restyle it.',
    `- Every part of the mannequin that the item does not cover must stay the same flat ${colorName(silhouette)}. Do not draw skin, a face, hair or anything else on it.`,
    `- The background must stay the same flat ${colorName(background)} with no shadows, gradients, floor, text or frame.`,
    `- The item itself must not contain ${colorName(silhouette)} or ${colorName(background)} or colours close to them.`,
    '- Draw only this one item, worn naturally on the mannequin, fully visible and not cut off by the image edge.',
    '- Square image, same framing as the template.',
    feedback ? `The previous attempt was rejected for this reason, fix it: ${feedback}` : '',
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
  styleRefs: Buffer[]; // 絵柄の見本（PNG）
  maxAttempts?: number;
}

// 1 品目を作る。candidate を書き換えながら進める（途中経過を画面に出せるように）
export async function generateCandidate(ctx: GenerateContext, candidate: Candidate): Promise<void> {
  const { item } = candidate;
  const label = ctx.doll.categories.find((c) => c.id === item.category)?.label ?? item.category;
  const planned = item.colors.map(hexToRgb).filter((c): c is Rgb => c !== null);
  const avoid: Rgb[] = []; // 前回、服と近すぎた色
  let feedback: string | null = null;
  candidate.status = 'working';
  const maxAttempts = ctx.maxAttempts ?? MAX_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    candidate.attempts = attempt;
    try {
      const keys = chooseKeyColors([...planned, ...avoid]);
      const silhouette = await renderSilhouette(ctx.template, keys.silhouette, keys.background);
      await ctx.budget.spend();
      const generated = await ctx.image.generate({
        prompt: itemPrompt(item, label, ctx.data.style, keys.silhouette, keys.background, feedback, ctx.styleRefs.length),
        images: [silhouette, ...ctx.styleRefs],
      });
      const result = await processGenerated(generated, ctx.template, { silhouetteColor: keys.silhouette });
      candidate.png = await rgbaToPng(result.rgba, result.width, result.height);
      candidate.source = await rgbaToPng(result.source, result.width, result.height);
      candidate.warnings = [...result.warnings];
      candidate.notes = [];

      // 数値の検品
      const problems: string[] = result.warnings.map((w) => w.message);
      const region = ctx.data.regions[item.category];
      if (region && !result.warnings.some((w) => w.code === 'empty')) {
        const share = shareInsideRegion(result.rgba, result.width, result.height, region);
        if (share < MIN_REGION_SHARE) problems.push(`「${label}」があるはずの範囲から、服の ${Math.round((1 - share) * 100)}% がはみ出しています`);
      }
      if (result.warnings.some((w) => w.code === 'color-too-close')) avoid.push(keys.silhouette, keys.background);

      // 見た目の検品（数値で問題が無いときだけ。問題があれば、どうせ作り直す）
      if (problems.length === 0) {
        const preview = await renderPreview(ctx.template, [result.rgba]);
        const verdict = await ctx.text.json<{ ok: boolean; reason: string }>({
          system: 'You are a strict quality inspector for a children\'s dress-up game. Reply with JSON only.',
          prompt: [
            'The image shows a doll wearing one automatically cut-out item.',
            `The item should be: ${item.description} (type: ${label}).`,
            'Set ok to false if any of these is true: the item does not match the description; parts of it are missing or have holes that look like cut-out errors; ' +
              'leftover patches of flat key colour or background remain; it is misplaced on the body; extra objects, body parts or text are present; the drawing is malformed.',
            'Otherwise set ok to true. In reason, explain briefly in Japanese (one sentence).',
          ].join('\n'),
          images: [preview],
          schema: INSPECT_SCHEMA,
        });
        if (verdict.ok) {
          candidate.status = 'passed';
          return;
        }
        problems.push(verdict.reason || '見た目の検品で不合格でした');
      }
      candidate.notes = problems;
      candidate.status = 'flagged';
      feedback = problems.join(' / ');
    } catch (error) {
      candidate.notes = [(error as Error).message];
      // 画像が 1 枚もできていなければ失敗、前の回の画像が残っていれば「注意あり」のまま
      candidate.status = candidate.png ? 'flagged' : 'failed';
      // 上限・キーの誤りなど、やり直しても同じ結果になるものは打ち切る
      if (!(error instanceof AiError) || error.status !== 422) return;
      feedback = null;
    }
  }
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

export async function generateBackground(ctx: { image: ImageAi; budget: Budget; style: string }, candidate: BackgroundCandidate): Promise<void> {
  candidate.status = 'working';
  candidate.attempts = 1;
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
  } catch (error) {
    candidate.notes = [(error as Error).message];
    candidate.status = 'failed';
  }
}
