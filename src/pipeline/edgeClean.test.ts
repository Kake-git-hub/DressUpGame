import { describe, expect, it } from 'vitest';
import { cleanKeyEdge } from './edgeClean';
import type { Rgb } from './keyColors';

const GREEN: Rgb = [0, 255, 0];
const W = 24;
const H = 5;
// 1 行の絵を、H 行くり返す（上下の行も同じなので、近傍の探し方に左右されない）
function rows(pixels: number[][]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) pixels.forEach((px, x) => rgba.set(px, (y * W + x) * 4));
  return rgba;
}
const at = (rgba: Uint8ClampedArray, x: number) => Array.from(rgba.subarray((2 * W + x) * 4, (2 * W + x) * 4 + 4));
const SKIN = [254, 214, 190, 255];
const CLEAR = [0, 0, 0, 0];

describe('cleanKeyEdge', () => {
  // 透明 | 半透明の緑まじり | 緑まじりの線 | こげ茶の線 | 肌…
  const line = () => rows([CLEAR, CLEAR, [199, 196, 145, 135], [82, 84, 28, 255], [82, 60, 27, 255], ...Array.from({ length: W - 5 }, () => SKIN)]);

  it('ふちの暗い線から、緑の混ざりを取る', () => {
    const rgba = line();
    cleanKeyEdge(rgba, W, H, GREEN, 3);
    const [r, g, b, a] = at(rgba, 3);
    expect(g).toBeLessThanOrEqual((r + b) / 2 + 8);
    expect(r).toBe(82);
    expect(b).toBe(28);
    expect(a).toBe(255);
  });

  it('半透明のふちは、となりの不透明な線の色になり、不透明度は変わらない', () => {
    const rgba = line();
    cleanKeyEdge(rgba, W, H, GREEN, 3);
    const edge = at(rgba, 2);
    const solid = at(rgba, 3);
    expect(edge.slice(0, 3)).toEqual(solid.slice(0, 3));
    expect(edge[3]).toBe(135);
  });

  it('肌と、もともとこげ茶の線、不透明度は変えない', () => {
    const rgba = line();
    const before = new Uint8ClampedArray(rgba);
    cleanKeyEdge(rgba, W, H, GREEN, 3);
    expect(at(rgba, 4)).toEqual([82, 60, 27, 255]);
    expect(at(rgba, 5)).toEqual(SKIN);
    for (let i = 3; i < rgba.length; i += 4) expect(rgba[i]).toBe(before[i]);
  });

  it('ふちから遠い緑（服の緑）は変えない', () => {
    const rgba = rows([CLEAR, ...Array.from({ length: 10 }, () => SKIN), [30, 120, 30, 255], ...Array.from({ length: W - 12 }, () => SKIN)]);
    cleanKeyEdge(rgba, W, H, GREEN, 3);
    expect(at(rgba, 11)).toEqual([30, 120, 30, 255]);
  });

  it('ふちの明るい色（うすい色の髪）は変えない', () => {
    const rgba = rows([CLEAR, [230, 250, 200, 255], ...Array.from({ length: W - 2 }, () => SKIN)]);
    cleanKeyEdge(rgba, W, H, GREEN, 3);
    expect(at(rgba, 1)).toEqual([230, 250, 200, 255]);
  });

  it('背景が青なら、ふちの暗い線から青の混ざりを取る', () => {
    const rgba = rows([CLEAR, [40, 30, 90, 255], ...Array.from({ length: W - 2 }, () => SKIN)]);
    cleanKeyEdge(rgba, W, H, [0, 0, 255], 3);
    const [r, g, b] = at(rgba, 1);
    expect(b).toBeLessThanOrEqual((r + g) / 2 + 8);
  });

  it('背景が白のときは、何も変えない', () => {
    const rgba = line();
    const before = new Uint8ClampedArray(rgba);
    cleanKeyEdge(rgba, W, H, [255, 255, 255], 3);
    expect(Array.from(rgba)).toEqual(Array.from(before));
  });
});
