import { describe, expect, it } from 'vitest';
import { RAINBOW_TRACK, hueTrack, mainColor, trackCss } from '../pipeline/hueTrack';
import { recolor, tintFor } from '../pipeline/recolor';

const solid = (r: number, g: number, b: number, n = 16, a = 255) => new Uint8ClampedArray(Array.from({ length: n }, () => [r, g, b, a]).flat());
const rgbOf = (css: string) => css.match(/\d+/g)!.map(Number) as [number, number, number];

describe('色の帯（その服が、実際になる色）', () => {
  it('赤い服: 13 個。まん中（0°）が赤、+120° は緑が強く、−120° は青が強い', () => {
    const stops = hueTrack(solid(255, 0, 0), false)!;
    expect(stops).toHaveLength(13);
    expect(stops[6]).toBe('rgb(255, 0, 0)');
    const plus = rgbOf(stops[10]); // +120°
    const minus = rgbOf(stops[2]); // −120°
    expect(plus[1]).toBeGreaterThan(plus[0]);
    expect(plus[1]).toBeGreaterThan(plus[2]);
    expect(minus[2]).toBeGreaterThan(minus[0]);
    expect(minus[2]).toBeGreaterThan(minus[1]);
    // 両端（−180° と +180°）は同じ色
    expect(stops[0]).toBe(stops[12]);
  });

  it('どの位置の色も、代表の色を recolor に通した色と同じ（服の表示と同じ式）', () => {
    const stops = hueTrack(solid(40, 160, 90), false)!;
    for (const [index, degrees] of [[0, -180], [3, -90], [6, 0], [9, 90]] as const) {
      const out = new Uint8ClampedArray(4);
      recolor(new Uint8ClampedArray([40, 160, 90, 255]), out, degrees, false);
      expect(stops[index]).toBe(`rgb(${out[0]}, ${out[1]}, ${out[2]})`);
    }
  });

  it('黒っぽい絵（黒髪など）: まん中は元の黒、動かした所は、黒い所に付く色（tintFor の色あい）', () => {
    const stops = hueTrack(solid(20, 20, 22), true)!;
    const middle = rgbOf(stops[6]);
    expect(Math.max(...middle)).toBeLessThan(40);
    const at90 = rgbOf(stops[9]);
    const tint = tintFor(90);
    // いちばん強い色の成分が、tintFor と同じ
    expect(at90.indexOf(Math.max(...at90))).toBe(tint.indexOf(Math.max(...tint)));
    expect(Math.max(...at90) - Math.min(...at90)).toBeGreaterThan(30);
  });

  it('黒っぽい髪に、色のはっきりした飾り（青いヘアピン 5%）: 帯は、髪（黒い所）がなる色。飾りの色にしない', () => {
    const pixels = new Uint8ClampedArray([...solid(20, 20, 22, 95), ...solid(40, 80, 220, 5)]);
    expect(mainColor(pixels, true)).toEqual([20, 20, 22]);
    const stops = hueTrack(pixels, true)!;
    expect(Math.max(...rgbOf(stops[6]))).toBeLessThan(40); // まん中は黒
    const at90 = rgbOf(stops[9]);
    const tint = tintFor(90);
    expect(at90.indexOf(Math.max(...at90))).toBe(tint.indexOf(Math.max(...tint))); // 髪と同じ色あい（飾りの回した色ではない）
    // 黒っぽい絵でなければ（dark = false）、今までどおり、色のはっきりした所が代表
    expect(mainColor(pixels, false)).toEqual([40, 80, 220]);
  });

  it('色味の無い服（白・灰）: 13 個とも、ほぼ同じ灰色（動かしても変わらないことが、見て分かる）', () => {
    for (const stops of [hueTrack(solid(250, 250, 250), false)!, hueTrack(solid(128, 130, 127), false)!]) {
      for (const css of stops) {
        const [r, g, b] = rgbOf(css);
        expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(8);
      }
    }
  });

  it('白い服に赤いリボン（赤が 5%）: 代表の色は赤（白に引っぱられない）', () => {
    const pixels = new Uint8ClampedArray([...solid(255, 255, 255, 95), ...solid(220, 20, 30, 5)]);
    expect(mainColor(pixels)).toEqual([220, 20, 30]);
  });

  it('色が 2 つある服（紺のえり 60%・赤いスカーフ 40%）: 多いほうの色（紺）が代表。まぜた色（紫）にしない', () => {
    const pixels = new Uint8ClampedArray([...solid(30, 40, 120, 60), ...solid(200, 30, 40, 40)]);
    expect(mainColor(pixels)).toEqual([30, 40, 120]);
    // 同じ色あいの濃淡（明るい緑と暗い緑）は、まとめて平均する
    const greens = new Uint8ClampedArray([...solid(60, 200, 120, 50), ...solid(30, 120, 70, 50)]);
    expect(mainColor(greens)).toEqual([45, 160, 95]);
  });

  it('色味のある画素が、ほんの少し（1% 未満）なら、全体の平均（線のにじみを、服の色と見ない）', () => {
    const pixels = new Uint8ClampedArray([...solid(240, 240, 240, 999), ...solid(255, 0, 0, 1)]);
    const [r, g, b] = mainColor(pixels)!;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThanOrEqual(8);
  });

  it('透明な絵・空の配列: null（色の文字に NaN を作らない）', () => {
    expect(mainColor(solid(255, 0, 0, 8, 0))).toBeNull();
    expect(hueTrack(solid(255, 0, 0, 8, 0), false)).toBeNull();
    expect(hueTrack(new Uint8ClampedArray(0), false)).toBeNull();
  });

  it('trackCss: つまみの半分だけ内側に色を置く（つまみの中心は、帯の端までは行かない。つまみの下の色 = 服の色にする）', () => {
    const css = trackCss(['rgb(1, 1, 1)', 'rgb(2, 2, 2)', 'rgb(3, 3, 3)'], 'right', 22);
    expect(css).toBe('linear-gradient(to right, rgb(1, 1, 1) 22px, rgb(2, 2, 2) calc(22px + (100% - 44px) * 0.5), rgb(3, 3, 3) calc(100% - 22px))');
    // 内側に寄せない（0）なら、今までどおり
    expect(trackCss(['rgb(1, 1, 1)', 'rgb(2, 2, 2)'], 'top', 0)).toBe('linear-gradient(to top, rgb(1, 1, 1), rgb(2, 2, 2))');
  });

  it('trackCss: 帯の背景になる CSS。読めないときの虹も 13 色', () => {
    const css = trackCss(hueTrack(solid(255, 0, 0), false)!, 'right');
    expect(css.startsWith('linear-gradient(to right, rgb(')).toBe(true);
    expect(css.match(/rgb\(/g)).toHaveLength(13);
    expect(css).not.toContain('NaN');
    expect(RAINBOW_TRACK).toHaveLength(13);
    expect(trackCss(RAINBOW_TRACK, 'top').startsWith('linear-gradient(to top, ')).toBe(true);
  });
});
