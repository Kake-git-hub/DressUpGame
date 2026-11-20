import { describe, it, expect } from 'vitest';
import { applyHue } from '../pipeline/hue';
import { isDarkImage, recolor } from '../pipeline/recolor';

const pixels = (...list: number[][]) => new Uint8ClampedArray(list.flat());
const chroma = (p: ArrayLike<number>, i = 0) => Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]);
const luma = (p: ArrayLike<number>, i = 0) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
// 色相（度）
const hueOf = (p: ArrayLike<number>, i = 0) => {
  const [r, g, b] = [p[i], p[i + 1], p[i + 2]];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('isDarkImage（黒っぽい絵か）', () => {
  it('不透明な画素の半分以上が、暗くて色味のない画素なら true', () => {
    expect(isDarkImage(pixels([20, 20, 24, 255], [40, 40, 44, 255], [200, 200, 200, 255]))).toBe(true);
    expect(isDarkImage(pixels([20, 20, 24, 255], [200, 60, 60, 255], [200, 200, 200, 255]))).toBe(false);
  });
  it('色のついた絵（暗い赤・こい青）は false', () => {
    expect(isDarkImage(pixels([90, 10, 10, 255], [20, 20, 110, 255]))).toBe(false);
  });
  it('透明な画素は数えない。全部透明なら false', () => {
    expect(isDarkImage(pixels([255, 255, 255, 0], [255, 0, 0, 0], [10, 10, 10, 255]))).toBe(true);
    expect(isDarkImage(pixels([10, 10, 10, 0]))).toBe(false);
  });
});

describe('recolor', () => {
  it('黒っぽくない絵は、色相の回転と同じ', () => {
    const source = pixels([255, 100, 150, 255], [10, 10, 10, 200], [0, 0, 255, 128]);
    const a = new Uint8ClampedArray(source.length);
    const b = new Uint8ClampedArray(source.length);
    recolor(source, a, 75, false);
    applyHue(source, b, 75);
    expect([...a]).toEqual([...b]);
  });

  it('黒っぽい絵: 0 度なら元のまま', () => {
    const source = pixels([20, 20, 24, 255], [230, 230, 235, 255]);
    const out = new Uint8ClampedArray(source.length);
    recolor(source, out, 0, true);
    expect([...out]).toEqual([...source]);
  });

  it('黒っぽい絵: 黒い所に、はっきり色が付いて明るくなる。角度で色が変わる', () => {
    const source = pixels([28, 28, 32, 255]);
    const out = new Uint8ClampedArray(4);
    const hues: number[] = [];
    for (const degrees of [-120, -60, 60, 120, 180]) {
      recolor(source, out, degrees, true);
      expect(chroma(out)).toBeGreaterThan(60);
      expect(luma(out)).toBeGreaterThan(luma(source) + 30);
      expect(out[3]).toBe(255);
      hues.push(hueOf(out));
    }
    // どの 2 つも、色相が 40 度以上はなれている
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const d = Math.abs(hues[i] - hues[j]);
        expect(Math.min(d, 360 - d)).toBeGreaterThan(40);
      }
    }
  });

  it('黒っぽい絵: 線（もっと暗い所）は地より暗く、つや（明るい所）は白に近いまま', () => {
    const source = pixels([6, 6, 8, 255], [34, 34, 38, 255], [235, 235, 240, 255]);
    const out = new Uint8ClampedArray(source.length);
    recolor(source, out, 90, true);
    expect(luma(out, 0)).toBeLessThan(luma(out, 4) - 15);
    expect(luma(out, 8)).toBeGreaterThan(215);
  });

  it('黒っぽい絵: 色のはっきりした所（赤いヘアピンなど）は、いままでどおり色相だけが回る', () => {
    const source = pixels([220, 30, 40, 255]);
    const a = new Uint8ClampedArray(4);
    const b = new Uint8ClampedArray(4);
    recolor(source, a, 90, true);
    applyHue(source, b, 90);
    expect([...a]).toEqual([...b]);
  });

  it('黒っぽい絵: スライダーを少し動かしただけでは、色が急に変わらない', () => {
    const source = pixels([28, 28, 32, 255]);
    const out = new Uint8ClampedArray(4);
    recolor(source, out, 2, true);
    for (let c = 0; c < 3; c++) expect(Math.abs(out[c] - source[c])).toBeLessThan(10);
  });

  it('不透明度は変えない。透明な画素はそのまま', () => {
    const source = pixels([28, 28, 32, 120], [9, 9, 9, 0]);
    const out = new Uint8ClampedArray(source.length);
    recolor(source, out, 90, true);
    expect(out[3]).toBe(120);
    expect([...out.subarray(4)]).toEqual([9, 9, 9, 0]);
  });

  it('同じ配列に書いてもよい', () => {
    const source = pixels([28, 28, 32, 255]);
    const expected = new Uint8ClampedArray(4);
    recolor(source, expected, 90, true);
    recolor(source, source, 90, true);
    expect([...source]).toEqual([...expected]);
  });
});
