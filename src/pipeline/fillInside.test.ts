import { describe, expect, it } from 'vitest';
import { fillInside, skinColor } from './fillInside';

const W = 120;
const H = 100;
const RED = [200, 30, 30, 255];
const SKIN: [number, number, number] = [250, 220, 190];
function rect(px: Uint8ClampedArray | Uint8Array, ch: number, x0: number, y0: number, x1: number, y1: number, v: number[]) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let c = 0; c < ch; c++) px[(y * W + x) * ch + c] = v[c];
}
// 片足の靴: U 字（左右の側面と、つま先）。まん中（甲）は AI の足＝切り抜かれて透明
function shoe(px: Uint8ClampedArray, x: number) {
  rect(px, 4, x, 50, x + 5, 80, RED);
  rect(px, 4, x + 24, 50, x + 29, 80, RED);
  rect(px, 4, x, 70, x + 29, 85, RED);
}
const alpha = (px: Uint8ClampedArray, x: number, y: number) => px[(y * W + x) * 4 + 3];

describe('fillInside', () => {
  const zone = { x: 10, y: 30, w: 100, h: 65 };
  it('靴に囲まれた、AI の足があった所を肌の色で埋める。脚（靴より上）と、左右の靴のあいだは埋めない', () => {
    const px = new Uint8ClampedArray(W * H * 4);
    shoe(px, 20);
    shoe(px, 70);
    const sil = new Uint8Array(W * H);
    rect(sil, 1, 26, 0, 43, 69, [1]); // 左の脚と足
    rect(sil, 1, 76, 0, 93, 69, [1]);
    expect(fillInside(px, sil, W, H, zone, SKIN)).toBeGreaterThan(0);
    expect(Array.from(px.slice((60 * W + 35) * 4, (60 * W + 35) * 4 + 4))).toEqual([...SKIN, 255]); // 左の靴の甲
    expect(alpha(px, 85, 60)).toBe(255); // 右の靴の甲
    expect(alpha(px, 35, 40)).toBe(0); // 靴より上の脚
    expect(alpha(px, 60, 60)).toBe(0); // 左右の靴のあいだ（背景）
    expect(Array.from(px.slice((75 * W + 35) * 4, (75 * W + 35) * 4 + 3))).toEqual(RED.slice(0, 3)); // 靴そのものは変えない
  });
  it('切り抜きで残った細い線は、靴の本体とみなさない（線にはさまれた脚を埋めない）', () => {
    const px = new Uint8ClampedArray(W * H * 4);
    shoe(px, 20);
    rect(px, 4, 20, 35, 21, 49, RED); // 側面から上へのびた細い線
    rect(px, 4, 48, 35, 49, 49, RED);
    const sil = new Uint8Array(W * H);
    rect(sil, 1, 26, 0, 43, 69, [1]);
    fillInside(px, sil, W, H, zone, SKIN, 50);
    expect(alpha(px, 35, 40)).toBe(0);
    expect(alpha(px, 35, 60)).toBe(255);
    expect(alpha(px, 20, 40)).toBe(0); // 細い線そのものも消える
    expect(alpha(px, 22, 60)).toBe(255); // 靴の側面は残る
  });
  it('skinColor は、輪郭線ではなく肌の色を返す', () => {
    const doll = new Uint8ClampedArray(W * H * 4);
    rect(doll, 4, 20, 20, 60, 60, [...SKIN, 255]);
    rect(doll, 4, 20, 20, 22, 60, [0, 0, 0, 255]);
    expect(skinColor(doll, W, H, { x: 0, y: 0, w: W, h: H })).toEqual(SKIN);
  });
});
