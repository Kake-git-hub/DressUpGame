import { describe, expect, it } from 'vitest';
import { removeFarSpecks } from './removeFarSpecks';
import { alphaBBox } from './alpha';

const W = 400;
const H = 400;
function canvas(rects: [number, number, number, number][]) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (const [x, y, w, h] of rects) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) rgba[(j * W + i) * 4 + 3] = 255;
  return rgba;
}

describe('removeFarSpecks', () => {
  it('本体から離れた小さなかけらを消し、外接矩形を本体だけにする', () => {
    const rgba = canvas([[100, 20, 200, 60], [190, 300, 2, 3]]);
    expect(removeFarSpecks(rgba, W, H)).toBe(6);
    expect(alphaBBox(rgba, W, H)).toEqual({ x: 100, y: 20, w: 200, h: 60 });
  });

  it('本体のすぐそばの小さな飾りは残す', () => {
    const rgba = canvas([[100, 20, 200, 60], [305, 40, 3, 3]]);
    expect(removeFarSpecks(rgba, W, H)).toBe(0);
  });

  it('左右に分かれた品目（くつ・てぶくろ）は両方とも残す', () => {
    const rgba = canvas([[50, 300, 60, 40], [290, 300, 60, 40]]);
    expect(removeFarSpecks(rgba, W, H)).toBe(0);
  });

  it('小さなものだけの品目は消さない', () => {
    const rgba = canvas([[50, 50, 3, 3], [300, 300, 3, 3]]);
    expect(removeFarSpecks(rgba, W, H)).toBe(0);
  });
});
