import { describe, expect, it } from 'vitest';
import type { BodyParts } from './bodyParts';
import { defaultLimbs, hideMask, limbZones } from './limbZones';

const parts: BodyParts = {
  head: { x: 450, y: 20, w: 100, h: 130 },
  torso: { x: 410, y: 150, w: 200, h: 200 },
  hips: { x: 410, y: 350, w: 200, h: 160 },
  legs: { x: 420, y: 510, w: 180, h: 420 },
  feet: { x: 450, y: 930, w: 130, h: 70 },
  armLeft: { x: 280, y: 290, w: 130, h: 250 },
  armRight: { x: 620, y: 290, w: 130, h: 250 },
  handLeft: { x: 280, y: 470, w: 90, h: 70 },
  handRight: { x: 660, y: 470, w: 90, h: 70 },
};

describe('limbZones', () => {
  it('手は前腕の途中から指先まで（左右 2 つ）、足はすねの途中からつま先まで', () => {
    const hands = limbZones(parts, ['hands'], 1024, 1024);
    expect(hands).toHaveLength(2);
    expect(hands[0].y).toBe(440); // 290 + 250 × 0.6
    expect(hands[0].y + hands[0].h).toBeGreaterThan(540);
    const feet = limbZones(parts, ['feet'], 1024, 1024);
    expect(feet).toHaveLength(1);
    expect(feet[0].y).toBe(783);
    expect(feet[0].y + feet[0].h).toBeLessThanOrEqual(1024);
    expect(limbZones(parts, [], 1024, 1024)).toEqual([]);
  });
});

describe('hideMask', () => {
  it('範囲の中で、AI の形の外にあるドールだけを隠す', () => {
    const W = 10;
    const doll = new Uint8Array(100).fill(255);
    const shape = new Uint8Array(100);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 10; y++) shape[y * W + x] = 255;
    const mask = hideMask(doll, shape, [{ x: 0, y: 5, w: 10, h: 5 }], W, 10);
    expect(mask[7 * W + 2]).toBe(0); // 形の中
    expect(mask[7 * W + 8]).toBe(255); // 形の外・範囲の中
    expect(mask[2 * W + 8]).toBe(0); // 範囲の外
  });
});

describe('defaultLimbs', () => {
  it('カテゴリ名から決める', () => {
    expect(defaultLimbs('てぶくろ')).toEqual(['hands']);
    expect(defaultLimbs('くつ')).toEqual(['feet']);
    expect(defaultLimbs('ソックス')).toEqual(['feet']);
    expect(defaultLimbs('ドレス')).toEqual([]);
  });
});
