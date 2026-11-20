/**
 * 新しいドールを画像生成 AI に描かせるときの指示文
 *
 * 服・靴・手袋・髪を描かせやすく、切り抜きやすい姿勢と大きさを決めている
 * （設計: docs/superpowers/specs/2026-11-19-new-doll-and-part-swap-design.md の 5.1）。
 * 絵柄の見本にするドールの画像を 1 枚添えて使う。
 */
import type { Rgb } from '../../src/pipeline/keyColors.ts';

const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export type DollVariant = 'girl' | 'boy';

// 姿勢の条件（どのドールにも共通）
const pose = (background: Rgb): string[] => [
  '- Full body, standing upright, seen straight from the front, perfectly left-right mirror-symmetric, centred. The whole figure is visible with a clear margin on every side (the figure is about 88% of the image height).',
  '- The head is completely bald and has no face at all: no eyes, eyebrows, nose or mouth; small simple ears. Just smooth skin.',
  '- Arms straight, held away from the body in an A-pose (about 35 degrees from the torso), with a wide clear gap between each arm and the torso and hips. Both hands identical and mirrored: an open hand with the palm facing the viewer and all five fingers spread apart (like "paper" in rock-paper-scissors), fingers pointing down and outward in line with the arm, thumb on the side nearer the body, simple rounded fingertips.',
  '- Legs straight and clearly apart, like a mannequin standing with the feet at shoulder width: the inner thighs, the knees and the calves do NOT touch each other. The background is visible between the legs all the way from just below the crotch down to the ground.',
  '- Feet flat on the ground, well separated (a gap of at least one foot width between the heels), each foot turned outward about 30 degrees so the top of the foot and the toes are clearly visible. No tiptoe, no crossed or overlapping feet.',
  `- Background: completely flat ${hex(background)}, no shadow, no floor, no text, no frame.`,
];

/**
 * variant:
 *  girl（既定）… 見本の絵柄で、作りやすい姿勢のドールを新しく描かせる
 *  boy … 見本（作りやすい姿勢のドール）と同じ姿勢・大きさのまま、体つきと下着だけを男の子にする
 */
export function dollPrompt(background: Rgb, variant: DollVariant = 'girl'): string {
  if (variant === 'boy') {
    return [
      'The attached image is the base doll (a girl) of a paper-doll dress-up game for young children. Draw the matching BOY base doll of the same age: exactly the same art style, the same skin colour, the same pose, the same size and position in the image, the same thin clean dark-brown outlines and flat cel shading. Change only what is needed to make the figure read as a young boy:',
      '- Body: a straight, flat torso with no waist curve and no flare at the hips; shoulders slightly wider than the hips; a slightly sturdier neck, arms and legs. Still a slim, child-like body, about 5.5 heads tall with the same large round head.',
      '- Clothes: a plain white sleeveless undershirt (a fitted tank top that covers the chest and the belly down to the shorts) and plain white boxer shorts. No patterns, no logos, no pockets.',
      ...pose(background),
    ].join('\n');
  }
  const [frame, ...rest] = pose(background);
  return [
    'The attached image is the base doll of a paper-doll dress-up game for young children. Draw a NEW base doll in exactly the same art style, the same skin colour and the same plain white bandeau top and white shorts, but redesigned so that clothes, shoes, gloves and wigs are easy to draw onto it:',
    frame,
    '- Proportions: about 5.5 heads tall with a larger, rounder head than the reference (cute but not chibi), slim child-friendly body, modest and simple.',
    ...rest.slice(0, -1),
    '- Thin, clean dark-brown outlines of even width (much thinner than the reference), flat cel shading with very little shading detail.',
    rest[rest.length - 1],
  ].join('\n');
}
