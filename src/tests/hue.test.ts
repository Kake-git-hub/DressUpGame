/**
 * 色相変換のテスト（PixiJS の ColorMatrixFilter.hue と同じ行列）
 */
import { describe, it, expect } from 'vitest';
import { hueMatrix, applyHue } from '../pipeline/hue';

const px = (...v: number[]) => new Uint8ClampedArray(v);

describe('applyHue', () => {
  it('0 度は何も変えない', () => {
    const p = px(10, 200, 30, 128);
    applyHue(p, p, 0);
    expect(Array.from(p)).toEqual([10, 200, 30, 128]);
  });
  it('120 度で赤が緑になる', () => {
    const out = px(0, 0, 0, 0);
    applyHue(px(255, 0, 0, 255), out, 120);
    expect(Array.from(out)).toEqual([0, 255, 0, 255]);
  });
  it('-120 度で赤が青になる', () => {
    const out = px(0, 0, 0, 0);
    applyHue(px(255, 0, 0, 255), out, -120);
    expect(Array.from(out)).toEqual([0, 0, 255, 255]);
  });
  it('アルファは変えない', () => {
    const out = px(0, 0, 0, 0);
    applyHue(px(200, 100, 50, 77), out, 45);
    expect(out[3]).toBe(77);
  });
  it('元の配列は書き換えない（何度でもやり直せる）', () => {
    const src = px(255, 0, 0, 255);
    applyHue(src, px(0, 0, 0, 0), 90);
    expect(Array.from(src)).toEqual([255, 0, 0, 255]);
  });
  it('グレーは色相を回しても変わらない（誤差 1 以内）', () => {
    const out = px(0, 0, 0, 0);
    applyHue(px(128, 128, 128, 255), out, 77);
    for (const v of out.slice(0, 3)) expect(Math.abs(v - 128)).toBeLessThanOrEqual(1);
  });
  it('結果は 0〜255 に収まる', () => {
    const out = px(0, 0, 0, 0);
    applyHue(px(255, 255, 0, 255), out, -90);
    for (const v of out) expect(v >= 0 && v <= 255).toBe(true);
  });
  it('複数の画素をまとめて変換する', () => {
    const out = new Uint8ClampedArray(8);
    applyHue(px(255, 0, 0, 255, 0, 255, 0, 10), out, 120);
    expect(Array.from(out)).toEqual([0, 255, 0, 255, 0, 0, 255, 10]);
  });
});

describe('hueMatrix', () => {
  it('360 度は 0 度と同じ', () => {
    const a = hueMatrix(0);
    const b = hueMatrix(360);
    a.forEach((v, i) => expect(b[i]).toBeCloseTo(v, 6));
  });
  it('各行の和は 1（明るさを保つ）', () => {
    const m = hueMatrix(53);
    for (const r of [0, 3, 6]) expect(m[r] + m[r + 1] + m[r + 2]).toBeCloseTo(1, 6);
  });
});
