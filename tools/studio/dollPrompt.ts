/**
 * 新しいドールを画像生成 AI に描かせるときの指示文
 *
 * 服・靴・手袋・髪を描かせやすく、切り抜きやすい姿勢と大きさを決めている
 * （設計: docs/superpowers/specs/2026-11-19-new-doll-and-part-swap-design.md の 5.1）。
 * 絵柄の見本にするドールの画像を 1 枚添えて使う。
 */
import type { Rgb } from '../../src/pipeline/keyColors.ts';

const hex = (c: Rgb) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export function dollPrompt(background: Rgb): string {
  return [
    'The attached image is the base doll of a paper-doll dress-up game for young children. Draw a NEW base doll in exactly the same art style, the same skin colour and the same plain white bandeau top and white shorts, but redesigned so that clothes, shoes, gloves and wigs are easy to draw onto it:',
    '- Full body, standing upright, seen straight from the front, perfectly left-right mirror-symmetric, centred. The whole figure is visible with a clear margin on every side (the figure is about 88% of the image height).',
    '- Proportions: about 5.5 heads tall with a larger, rounder head than the reference (cute but not chibi), slim child-friendly body, modest and simple.',
    '- The head is completely bald and has no face at all: no eyes, eyebrows, nose or mouth; small simple ears. Just smooth skin.',
    '- Arms straight, held away from the body in an A-pose (about 35 degrees from the torso), with a wide clear gap between each arm and the torso and hips. Both hands identical and mirrored: open and relaxed with the four fingers together and straight (mitten-like), thumb slightly apart, pointing down and outward along the arm.',
    '- Legs straight and clearly apart, like a mannequin standing with the feet at shoulder width: the inner thighs, the knees and the calves do NOT touch each other. The background is visible between the legs all the way from just below the crotch down to the ground.',
    '- Feet flat on the ground, well separated (a gap of at least one foot width between the heels), each foot turned outward about 30 degrees so the top of the foot and the toes are clearly visible. No tiptoe, no crossed or overlapping feet.',
    '- Thin, clean dark-brown outlines of even width (much thinner than the reference), flat cel shading with very little shading detail.',
    `- Background: completely flat ${hex(background)}, no shadow, no floor, no text, no frame.`,
  ].join('\n');
}
