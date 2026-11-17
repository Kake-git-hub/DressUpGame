/**
 * 手足の先を服に合わせる（ドールの手足を、服の下で隠す）ための純粋関数
 *
 * 画像生成 AI は手足の形を少し変えて描くので、手袋やくつの先からドールの指先がはみ出すことがある。
 * 手首から先・すねから下の「範囲」の中で、AI が描いた体と服の形（shape）の外にあるドールの部分を隠す。
 * こうすると、その範囲では「服と、AI の描いた手足の形」どうしが合い、範囲の外のドールはそのまま残る。
 */
import type { Box } from './alpha';
import type { BodyParts } from './bodyParts';

export type Limb = 'hands' | 'feet';

const clampBox = (b: Box, width: number, height: number): Box => {
  const x0 = Math.max(0, Math.round(b.x));
  const y0 = Math.max(0, Math.round(b.y));
  const x1 = Math.min(width, Math.round(b.x + b.w));
  const y1 = Math.min(height, Math.round(b.y + b.h));
  return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
};

// 隠してよい範囲（手: 前腕の途中から指先まで、足: すねの途中からつま先まで）
export function limbZones(parts: BodyParts, limbs: Limb[], width: number, height: number): Box[] {
  const tall = parts.feet.y + parts.feet.h - parts.head.y;
  const pad = Math.round(tall * 0.025);
  const zones: Box[] = [];
  if (limbs.includes('hands')) {
    for (const [arm, hand] of [
      [parts.armLeft, parts.handLeft],
      [parts.armRight, parts.handRight],
    ] as const) {
      const x0 = Math.min(arm.x, hand.x) - pad;
      const x1 = Math.max(arm.x + arm.w, hand.x + hand.w) + pad;
      const y0 = arm.y + arm.h * 0.6;
      const y1 = Math.max(arm.y + arm.h, hand.y + hand.h) + pad;
      zones.push(clampBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, width, height));
    }
  }
  if (limbs.includes('feet')) {
    const x0 = Math.min(parts.legs.x, parts.feet.x) - pad;
    const x1 = Math.max(parts.legs.x + parts.legs.w, parts.feet.x + parts.feet.w) + pad;
    const y0 = parts.legs.y + parts.legs.h * 0.65;
    const y1 = parts.feet.y + parts.feet.h + pad;
    zones.push(clampBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, width, height));
  }
  return zones.filter((z) => z.w > 0 && z.h > 0);
}

/**
 * 隠す所の不透明度（0〜255、キャンバス大）を作る。
 *  dollAlpha: ドールの不透明度、shapeAlpha: AI が描いた体と服の形（服と同じ位置）
 */
export function hideMask(dollAlpha: ArrayLike<number>, shapeAlpha: ArrayLike<number>, zones: Box[], width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (const z of zones) {
    for (let y = z.y; y < z.y + z.h; y++) {
      for (let x = z.x; x < z.x + z.w; x++) {
        const p = y * width + x;
        const value = Math.round((dollAlpha[p] * (255 - shapeAlpha[p])) / 255);
        if (value > out[p]) out[p] = value;
      }
    }
  }
  return out;
}

// カテゴリ名から、ふつう合わせる手足を決める（手袋なら手、くつ・くつしたなら足）
export function defaultLimbs(label: string): Limb[] {
  if (/てぶくろ|手袋|グローブ|glove/i.test(label)) return ['hands'];
  if (/くつ|靴|ブーツ|ソックス|タイツ|shoe|sock|boot/i.test(label)) return ['feet'];
  return [];
}
