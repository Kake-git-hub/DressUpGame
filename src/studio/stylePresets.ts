/**
 * 絵柄の選択肢（スタジオの画面と、自動生成のサーバーの両方で使う）
 * prompt は画像生成 AI に渡す英語の説明。
 */
export interface StylePreset {
  id: string;
  label: string;
  prompt: string;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    id: 'anime',
    label: 'アニメ',
    prompt: 'Japanese anime illustration: clean, confident dark outlines, cel shading with soft shadows and small highlights, bright and clear colours.',
  },
  {
    id: 'real',
    label: 'リアル',
    prompt: 'Semi-realistic digital painting: detailed fabric textures and folds, natural soft lighting and shading, thin or no outlines.',
  },
  {
    id: 'pastel',
    label: 'ゆめかわパステル',
    prompt: 'Dreamy kawaii style: soft pastel colours, gentle sparkles and glitter, rounded cute shapes, thin coloured outlines.',
  },
  {
    id: 'picturebook',
    label: '絵本・水彩',
    prompt: "Children's picture-book illustration: soft watercolour textures, gentle pencil outlines, warm and slightly muted colours.",
  },
  {
    id: 'pop',
    label: 'ポップ',
    prompt: 'Flat pop illustration: simple bold shapes, flat bright colours, thick even outlines, minimal shading.',
  },
];

export const DEFAULT_STYLE_ID = 'anime';

export const findStyle = (id: string | null | undefined): StylePreset => STYLE_PRESETS.find((s) => s.id === id) ?? STYLE_PRESETS.find((s) => s.id === DEFAULT_STYLE_ID)!;
