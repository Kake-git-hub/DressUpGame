import { describe, expect, it } from 'vitest';
import type { Box } from './alpha';
import { findPartShifts, warpByParts } from './partAlign';

const W = 200;
const H = 200;
const fill = (mask: Uint8Array, b: Box) => {
  for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) mask[y * W + x] = 1;
};
// 胴（中央）と、右に伸びた細い腕
const body: Box = { x: 80, y: 40, w: 40, h: 120 };
const arm: Box = { x: 120, y: 60, w: 50, h: 10 };
const armPart: Box = { x: 122, y: 50, w: 63, h: 30 };
const bodyPart: Box = { x: 75, y: 35, w: 45, h: 130 };

function masks(armShift: [number, number]) {
  const doll = new Uint8Array(W * H);
  fill(doll, body);
  fill(doll, arm);
  const fg = new Uint8Array(W * H);
  fill(fg, body);
  fill(fg, { ...arm, x: arm.x + armShift[0], y: arm.y + armShift[1] });
  return { doll, fg };
}

describe('findPartShifts', () => {
  it('ずれた腕だけを、ずれの分だけ戻す', () => {
    const { doll, fg } = masks([6, 4]);
    const [b, a] = findPartShifts(fg, doll, W, H, [bodyPart, armPart], { reach: 10 });
    expect([b.dx, b.dy]).toEqual([0, 0]);
    expect([a.dx, a.dy]).toEqual([-6, -4]);
    expect(a.after).toBeGreaterThan(a.before);
  });
  it('体の形と合わない所（ふくらんだスカート）は動かさない', () => {
    const doll = new Uint8Array(W * H);
    fill(doll, { x: 90, y: 100, w: 8, h: 80 });
    fill(doll, { x: 102, y: 100, w: 8, h: 80 });
    const fg = new Uint8Array(W * H);
    fill(fg, { x: 40, y: 95, w: 120, h: 70 });
    const [s] = findPartShifts(fg, doll, W, H, [{ x: 85, y: 100, w: 30, h: 80 }], { reach: 10 });
    expect([s.dx, s.dy]).toEqual([0, 0]);
  });
});

describe('warpByParts', () => {
  it('部位の中の画素を動かし、部位から遠い所はそのまま', () => {
    const rgba = new Uint8ClampedArray(W * H * 4);
    const paint = (x: number, y: number) => rgba.set([255, 0, 0, 255], (y * W + x) * 4);
    paint(160, 64); // 腕の先（手袋）
    paint(20, 20); // 部位の外
    const out = warpByParts(rgba, W, H, [{ box: armPart, dx: -6, dy: -4, before: 0, after: 1 }], 0);
    expect(out[(60 * W + 154) * 4 + 3]).toBe(255);
    expect(out[(64 * W + 160) * 4 + 3]).toBe(0);
    expect(out[(20 * W + 20) * 4 + 3]).toBe(255);
  });
  it('小さい部位（手）が大きい部位（腕）より優先される', () => {
    const rgba = new Uint8ClampedArray(W * H * 4);
    rgba.set([0, 0, 255, 255], (65 * W + 160) * 4);
    const hand: Box = { x: 150, y: 55, w: 25, h: 20 };
    const out = warpByParts(rgba, W, H, [{ box: armPart, dx: 0, dy: 0, before: 1, after: 1 }, { box: hand, dx: 3, dy: 0, before: 0, after: 1 }], 0);
    expect(out[(65 * W + 163) * 4 + 3]).toBe(255);
  });
  it('ずれが無ければ同じ画像', () => {
    const rgba = new Uint8ClampedArray(W * H * 4).fill(7);
    expect(warpByParts(rgba, W, H, [{ box: armPart, dx: 0, dy: 0, before: 1, after: 1 }])).toEqual(rgba);
  });
});
