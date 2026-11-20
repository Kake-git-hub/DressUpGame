import { describe, expect, it } from 'vitest';
import { fillSmooth, smoothField } from './smoothFill';

const S = 64;
// 左半分が赤、右半分が青。まん中の 16 列が、塗る範囲
function scene() {
  const rgba = new Uint8ClampedArray(S * S * 4);
  const region = new Uint8Array(S * S);
  const source = new Uint8Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const p = y * S + x;
      if (x >= 24 && x < 40) {
        region[p] = 1;
        continue;
      }
      rgba.set(x < 24 ? [200, 0, 0, 255] : [0, 0, 200, 255], p * 4);
      source[p] = 1;
    }
  }
  return { rgba, region, source };
}

describe('fillSmooth', () => {
  it('範囲の外の画素は 1 つも変えない', () => {
    const { rgba, region, source } = scene();
    const before = new Uint8ClampedArray(rgba);
    fillSmooth(rgba, region, source, S, S);
    for (let p = 0; p < S * S; p++) if (!region[p]) expect(Array.from(rgba.subarray(p * 4, p * 4 + 4))).toEqual(Array.from(before.subarray(p * 4, p * 4 + 4)));
  });

  it('範囲を不透明に塗り、左から右へ色がなめらかに移る', () => {
    const { rgba, region, source } = scene();
    fillSmooth(rgba, region, source, S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 24; x < 40; x++) {
        const i = (y * S + x) * 4;
        expect(rgba[i + 3]).toBe(255);
        if (x > 24) expect(rgba[i]).toBeLessThanOrEqual(rgba[i - 4]); // 赤は、右へ行くほど減る
      }
    }
    expect(rgba[(32 * S + 24) * 4]).toBeGreaterThan(rgba[(32 * S + 39) * 4] + 60);
  });

  it('横じまが出ない: 縦にとなり合う画素の差が 3 以下', () => {
    const { rgba, region, source } = scene();
    // 行ごとに左右の色が違っていても（髪の線など）、塗った色は縦にもなめらか
    for (let y = 0; y < S; y += 2) for (let x = 0; x < 24; x++) rgba.set([120, 60, 0, 255], (y * S + x) * 4);
    fillSmooth(rgba, region, source, S, S);
    for (let y = 1; y < S; y++) {
      for (let x = 24; x < 40; x++) {
        const i = (y * S + x) * 4;
        for (let c = 0; c < 3; c++) expect(Math.abs(rgba[i + c] - rgba[i - S * 4 + c])).toBeLessThanOrEqual(3);
      }
    }
  });

  it('色のもとが 1 つも無ければ、何も変えない', () => {
    const { rgba, region } = scene();
    const before = new Uint8ClampedArray(rgba);
    expect(() => fillSmooth(rgba, region, new Uint8Array(S * S), S, S)).not.toThrow();
    expect(Array.from(rgba)).toEqual(Array.from(before));
  });
});

describe('smoothField', () => {
  it('もとの画素では、その色を返す。もとの無い所は、まわりの色で埋まる', () => {
    const { rgba, source } = scene();
    const field = smoothField(rgba, source, S, S);
    expect(field.length).toBe(S * S * 3);
    expect(Math.round(field[(10 * S + 5) * 3])).toBe(200);
    expect(Math.round(field[(10 * S + 60) * 3 + 2])).toBe(200);
    const mid = (32 * S + 32) * 3;
    expect(field[mid]).toBeGreaterThan(20);
    expect(field[mid + 2]).toBeGreaterThan(20);
  });
});
