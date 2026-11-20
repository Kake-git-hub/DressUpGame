import { describe, expect, it } from 'vitest';
import { components, dilate, erode } from './morph';

const W = 16;
const H = 12;
const mask = (points: [number, number][]) => {
  const m = new Uint8Array(W * H);
  for (const [x, y] of points) m[y * W + x] = 1;
  return m;
};
const count = (m: Uint8Array) => m.reduce((a, v) => a + (v ? 1 : 0), 0);

describe('morph', () => {
  it('dilate: 1 点を 2 太らせると 5×5 になる', () => {
    const out = dilate(mask([[8, 6]]), W, H, 2);
    expect(count(out)).toBe(25);
    expect(out[4 * W + 6]).toBe(1);
    expect(out[8 * W + 10]).toBe(1);
    expect(out[3 * W + 8]).toBe(0);
  });

  it('erode: 太らせてから同じだけ細らせると、元の 1 点に戻る', () => {
    const out = erode(dilate(mask([[8, 6]]), W, H, 2), W, H, 2);
    expect(count(out)).toBe(1);
    expect(out[6 * W + 8]).toBe(1);
  });

  it('erode: 絵の端は「外は空」とみなして細る', () => {
    const full = new Uint8Array(W * H).fill(1);
    const out = erode(full, W, H, 1);
    expect(out[0]).toBe(0);
    expect(out[1 * W + 1]).toBe(1);
  });

  it('components: かたまりを別々に返し、端に触れるかどうかを伝える', () => {
    const m = mask([[0, 0], [1, 0], [8, 6], [8, 7], [9, 7]]);
    const found: { n: number; border: boolean }[] = [];
    components(m, W, H, (pixels, n, border) => {
      expect(pixels.length).toBeGreaterThanOrEqual(n);
      found.push({ n, border });
    });
    expect(found).toEqual([
      { n: 2, border: true },
      { n: 3, border: false },
    ]);
  });

  it('components: ななめにだけ接する画素は、別のかたまり', () => {
    let pieces = 0;
    components(mask([[4, 4], [5, 5]]), W, H, () => pieces++);
    expect(pieces).toBe(2);
  });
});
