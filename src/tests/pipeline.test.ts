/**
 * 画像処理の純粋関数のテスト
 */
import { describe, it, expect } from 'vitest';
import { alphaBBox, isFullyOpaque } from '../pipeline/alpha';
import { removeBorderBackground } from '../pipeline/removeBackground';
import { removeCornerSpeck } from '../pipeline/removeCornerSpeck';

type Rgba = [number, number, number, number];

function image(w: number, h: number, fill: Rgba): Uint8ClampedArray {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(fill, i * 4);
  return px;
}
function rect(px: Uint8ClampedArray, w: number, x0: number, y0: number, rw: number, rh: number, c: Rgba) {
  for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) px.set(c, (y * w + x) * 4);
}
const at = (px: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

const CLEAR: Rgba = [0, 0, 0, 0];
const GREEN: Rgba = [0, 255, 0, 255];
const RED: Rgba = [255, 0, 0, 255];

describe('alphaBBox', () => {
  it('中央の矩形を返す', () => {
    const px = image(10, 10, CLEAR);
    rect(px, 10, 2, 3, 4, 5, RED);
    expect(alphaBBox(px, 10, 10)).toEqual({ x: 2, y: 3, w: 4, h: 5 });
  });
  it('全部透明なら null', () => {
    expect(alphaBBox(image(4, 4, CLEAR), 4, 4)).toBeNull();
  });
  it('alpha 8 以下は透明扱い', () => {
    const px = image(6, 6, [255, 0, 0, 8]);
    rect(px, 6, 1, 1, 2, 2, [255, 0, 0, 9]);
    expect(alphaBBox(px, 6, 6)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
  });
  it('1 画素だけでも返す', () => {
    const px = image(5, 5, CLEAR);
    rect(px, 5, 4, 4, 1, 1, RED);
    expect(alphaBBox(px, 5, 5)).toEqual({ x: 4, y: 4, w: 1, h: 1 });
  });
});

describe('isFullyOpaque', () => {
  it('全画素が不透明なら true、1 画素でも透けていれば false', () => {
    const px = image(3, 3, GREEN);
    expect(isFullyOpaque(px)).toBe(true);
    px[3] = 100;
    expect(isFullyOpaque(px)).toBe(false);
  });
});

describe('removeBorderBackground', () => {
  it('緑背景の中の赤い矩形だけが残る', () => {
    const px = image(12, 12, GREEN);
    rect(px, 12, 4, 4, 4, 4, RED);
    expect(removeBorderBackground(px, 12, 12)).toBe(true);
    expect(at(px, 12, 0, 0)[3]).toBe(0);
    expect(at(px, 12, 11, 11)[3]).toBe(0);
    expect(at(px, 12, 5, 5)).toEqual([255, 0, 0, 255]);
    expect(alphaBBox(px, 12, 12)).toEqual({ x: 4, y: 4, w: 4, h: 4 });
  });
  it('服の内側にある背景色の島は残す', () => {
    const px = image(12, 12, GREEN);
    rect(px, 12, 3, 3, 6, 6, RED);
    rect(px, 12, 5, 5, 2, 2, GREEN); // 赤に囲まれた緑
    removeBorderBackground(px, 12, 12);
    expect(at(px, 12, 5, 5)).toEqual([0, 255, 0, 255]);
  });
  it('背景色に近い色（距離 60 以内）も消し、遠い色は残す', () => {
    const px = image(12, 12, GREEN);
    rect(px, 12, 0, 6, 12, 1, [30, 230, 20, 255]); // 近い（距離 約44）
    rect(px, 12, 4, 2, 4, 2, [0, 150, 0, 255]); // 遠い（距離 105）
    removeBorderBackground(px, 12, 12);
    expect(at(px, 12, 6, 6)[3]).toBe(0);
    expect(at(px, 12, 5, 2)[3]).toBe(255);
  });
  it('四隅の色がばらばらなら何もしない', () => {
    const px = image(8, 8, GREEN);
    rect(px, 8, 0, 0, 4, 4, RED);
    const before = Array.from(px);
    expect(removeBorderBackground(px, 8, 8)).toBe(false);
    expect(Array.from(px)).toEqual(before);
  });
  it('大きな画像でもスタックがあふれない', () => {
    const px = image(600, 600, GREEN);
    expect(removeBorderBackground(px, 600, 600)).toBe(true);
    expect(alphaBBox(px, 600, 600)).toBeNull();
  });
});

describe('removeCornerSpeck', () => {
  it('右下の小さな離れた塊を消す', () => {
    const px = image(400, 400, CLEAR);
    rect(px, 400, 100, 100, 150, 200, RED); // 本体
    rect(px, 400, 330, 340, 40, 40, GREEN); // 右下のマーク
    expect(removeCornerSpeck(px, 400, 400)).toBe(true);
    expect(at(px, 400, 350, 360)[3]).toBe(0);
    expect(at(px, 400, 150, 150)).toEqual([255, 0, 0, 255]);
  });
  it('右下まで続く絵柄は消さない', () => {
    const px = image(400, 400, CLEAR);
    rect(px, 400, 100, 100, 290, 290, RED); // 本体が右下の領域に入り込む
    expect(removeCornerSpeck(px, 400, 400)).toBe(false);
    expect(at(px, 400, 380, 380)).toEqual([255, 0, 0, 255]);
  });
  it('右下にあっても 80px より大きい塊は消さない', () => {
    const px = image(400, 400, CLEAR);
    rect(px, 400, 290, 300, 100, 90, RED);
    expect(removeCornerSpeck(px, 400, 400)).toBe(false);
    expect(at(px, 400, 300, 310)[3]).toBe(255);
  });
  it('右下以外の小さな塊（アクセサリーなど）は消さない', () => {
    const px = image(400, 400, CLEAR);
    rect(px, 400, 20, 20, 30, 30, RED);
    rect(px, 400, 200, 330, 30, 30, RED);
    expect(removeCornerSpeck(px, 400, 400)).toBe(false);
    expect(at(px, 400, 30, 30)[3]).toBe(255);
    expect(at(px, 400, 210, 340)[3]).toBe(255);
  });
  it('右下に何も無ければ何もしない', () => {
    const px = image(400, 400, CLEAR);
    rect(px, 400, 100, 100, 50, 50, RED);
    expect(removeCornerSpeck(px, 400, 400)).toBe(false);
  });
});
