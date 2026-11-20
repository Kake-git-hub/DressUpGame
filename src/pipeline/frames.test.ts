import { describe, expect, it } from 'vitest';
import type { BodyParts } from './bodyParts';
import { FRAME_SIZE, frameKind, frameTiles, swapZones } from './frames';

// 「アニメ」の型紙を、作業用キャンバス（1228）に移したもの
const PAD = 102;
const raw: BodyParts = {
  head: { x: 460, y: 27, w: 107, h: 134 },
  torso: { x: 409, y: 160, w: 209, h: 192 },
  hips: { x: 409, y: 351, w: 209, h: 163 },
  legs: { x: 420, y: 513, w: 187, h: 424 },
  feet: { x: 449, y: 936, w: 129, h: 69 },
  armLeft: { x: 282, y: 296, w: 127, h: 250 },
  armRight: { x: 618, y: 297, w: 126, h: 249 },
  handLeft: { x: 282, y: 476, w: 85, h: 70 },
  handRight: { x: 659, y: 476, w: 85, h: 70 },
};
const shift = (p: BodyParts, d: number): BodyParts => Object.fromEntries(Object.entries(p).map(([k, b]) => [k, { ...b, x: b.x + d, y: b.y + d }])) as BodyParts;
const parts = shift(raw, PAD);
const W = 1228;
const contains = (outer: { x: number; y: number; w: number; h: number }, inner: { x: number; y: number; w: number; h: number }) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

describe('frameKind', () => {
  it('カテゴリ名から枠の種類を決める', () => {
    // 髪は本物のドールの上半身（hair）、ぼうしは上半身のシルエット（upper）。枠の範囲は同じ
    expect(frameKind('ヘアスタイル')).toBe('hair');
    expect(frameKind('まえがみ')).toBe('hair');
    expect(frameKind('ぼうし')).toBe('upper');
    expect(frameKind('うしろがみ')).toBeNull();
    expect(frameKind('くつ')).toBe('feet');
    expect(frameKind('てぶくろ')).toBe('hands');
    expect(frameKind('くつした')).toBeNull();
    expect(frameKind('ソックス')).toBeNull();
    expect(frameKind('トップス')).toBeNull();
    expect(frameKind('かお')).toBeNull();
  });
});

describe('frameTiles', () => {
  it('hair の枠は、upper と同じ範囲', () => {
    expect(frameTiles('hair', parts, 1228, 1228)).toEqual(frameTiles('upper', parts, 1228, 1228));
  });

  for (const kind of ['upper', 'feet', 'hands'] as const) {
    it(`${kind}: キャンバスの中に収まり、縦横比が合う`, () => {
      const tiles = frameTiles(kind, parts, W, W);
      expect(tiles.length).toBe(kind === 'hands' ? 2 : 1);
      for (const t of tiles) {
        expect(contains({ x: 0, y: 0, w: W, h: W }, t.from)).toBe(true);
        expect(contains({ x: 0, y: 0, w: FRAME_SIZE, h: FRAME_SIZE }, t.to)).toBe(true);
        expect(Math.abs(t.from.w / t.from.h - t.to.w / t.to.h)).toBeLessThan(0.01);
      }
    });
  }
  it('upper は頭と腰を含む', () => {
    const [t] = frameTiles('upper', parts, W, W);
    expect(contains(t.from, parts.head)).toBe(true);
    expect(t.from.y).toBe(0);
    expect(t.from.y + t.from.h).toBeGreaterThanOrEqual(parts.hips.y + parts.hips.h);
  });
  it('feet は足先を、下に余白を付けて含む', () => {
    const [t] = frameTiles('feet', parts, W, W);
    expect(contains(t.from, parts.feet)).toBe(true);
    expect(t.from.y + t.from.h).toBeGreaterThan(parts.feet.y + parts.feet.h + 20);
    // 拡大になっている
    expect(t.from.w).toBeLessThan(W / 2);
  });
  it('hands は左右の手をそれぞれ含み、左右に並ぶ', () => {
    const [l, r] = frameTiles('hands', parts, W, W);
    expect(contains(l.from, parts.handLeft)).toBe(true);
    expect(contains(r.from, parts.handRight)).toBe(true);
    // 2 枚のあいだに背景のすき間を空ける（つながった 1 つの絵に見えないように）
    expect(l.to).toEqual({ x: 0, y: 0, w: 480, h: 1024 });
    expect(r.to).toEqual({ x: 544, y: 0, w: 480, h: 1024 });
    // 胴を写さない: 枠の内側の端は、腕の内側の端まで
    expect(l.from.x + l.from.w).toBeLessThanOrEqual(parts.armLeft.x + parts.armLeft.w);
    expect(r.from.x).toBeGreaterThanOrEqual(parts.armRight.x);
  });
  it('部位がキャンバスの端にあっても、枠ははみ出さない', () => {
    const edge = shift(raw, 0); // 余白なしのキャンバス（1024）
    edge.feet = { ...edge.feet, h: 1024 - edge.feet.y };
    for (const kind of ['upper', 'feet', 'hands'] as const) {
      for (const t of frameTiles(kind, edge, 1024, 1024)) expect(contains({ x: 0, y: 0, w: 1024, h: 1024 }, t.from)).toBe(true);
    }
  });
});

describe('swapZones', () => {
  it('足は足先の箱、手は左右の手の箱', () => {
    expect(swapZones('feet', parts)).toEqual([parts.feet]);
    expect(swapZones('hands', parts)).toEqual([parts.handLeft, parts.handRight]);
  });
});
