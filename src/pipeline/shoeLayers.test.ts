/**
 * 靴の絵を「靴」「肌」「隠す所」に分けるテスト（合成の絵）
 */
import { describe, expect, it } from 'vitest';
import { extractShoe } from './shoeLayers';
import type { Rgb } from './keyColors';

const S = 256;
const GREEN: Rgb = [0, 255, 0];
const SKIN = [254, 214, 190];
const RED = [200, 30, 40];
const LINE = 170; // 足首の線

function rect(px: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, color: number[]) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px.set([...color, 255], (y * S + x) * 4);
}
// 元の図: 脚（x 110〜145）と、それより広いはだしの足（x 90〜165、y 180〜230）
function reference(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(S * S * 4);
  rect(px, 0, 0, S - 1, S - 1, GREEN);
  rect(px, 110, 0, 145, 180, SKIN);
  rect(px, 90, 180, 165, 230, SKIN);
  return px;
}
function dollAlpha(): Uint8Array {
  const ref = reference();
  const a = new Uint8Array(S * S);
  for (let p = 0; p < S * S; p++) if (ref[p * 4] === SKIN[0]) a[p] = 255;
  return a;
}
// AI の絵: 足を、まん中に肌の見える赤い靴に描き替え（靴ははだしの足より細い）、足首の上にストラップを足した
function drawn(skin = SKIN): Uint8ClampedArray {
  const px = new Uint8ClampedArray(S * S * 4);
  rect(px, 0, 0, S - 1, S - 1, GREEN);
  rect(px, 110, 0, 145, 180, skin);
  rect(px, 100, 175, 155, 235, RED);
  rect(px, 115, 175, 140, 200, skin); // 靴の開き
  rect(px, 108, 150, 147, 156, RED); // ストラップ（線より上）
  return px;
}
const alpha = (px: Uint8ClampedArray, x: number, y: number) => px[(y * S + x) * 4 + 3];
const rgb = (px: Uint8ClampedArray, x: number, y: number) => Array.from(px.subarray((y * S + x) * 4, (y * S + x) * 4 + 3));
const extract = (image: Uint8ClampedArray) => extractShoe(image, reference(), dollAlpha(), S, S, GREEN, LINE);

describe('extractShoe', () => {
  it('靴の開きに見える肌は「肌」に、靴は「靴」に分かれる', () => {
    const r = extract(drawn());
    expect(alpha(r.under, 128, 188)).toBe(255);
    expect(alpha(r.shoe, 128, 188)).toBe(0);
    expect(alpha(r.shoe, 105, 220)).toBe(255);
    expect(alpha(r.under, 105, 220)).toBe(0);
    expect(rgb(r.shoe, 105, 220)).toEqual(RED);
  });

  it('線より上の、変わっていない脚は入れない。描き足されたストラップは靴に入る', () => {
    const r = extract(drawn());
    expect(alpha(r.shoe, 128, 100)).toBe(0);
    expect(alpha(r.under, 128, 100)).toBe(0);
    expect(alpha(r.shoe, 128, 153)).toBe(255);
    expect(alpha(r.under, 128, 153)).toBe(0);
  });

  it('隠す所は、線より下で、新しい絵（靴＋肌）の外になる所だけ', () => {
    const r = extract(drawn());
    expect(r.hide[200 * S + 93]).toBe(255); // はだしの足が、靴より広かった所
    expect(r.hide[200 * S + 20]).toBe(255);
    expect(r.hide[220 * S + 128]).toBe(0); // 靴の内側
    expect(r.hide[188 * S + 128]).toBe(0); // 肌（開き）の内側
    expect(r.hide[100 * S + 128]).toBe(0); // 線より上
    expect(r.hide[100 * S + 20]).toBe(0);
  });

  it('肌の上の端は、足首の線から少しずつ見えてくる（継ぎ目を作らない）', () => {
    const r = extract(drawn());
    expect(alpha(r.under, 128, LINE)).toBe(0);
    expect(alpha(r.under, 128, LINE + 1)).toBeGreaterThan(0);
    expect(alpha(r.under, 128, LINE + 1)).toBeLessThan(255);
    expect(alpha(r.under, 128, LINE + 4)).toBe(255);
  });

  it('AI の絵の肌の色が少し違っていても、ドールの肌の色に合わせる', () => {
    const r = extract(drawn([253, 211, 185])); // 全体に (−1, −3, −5)
    const got = rgb(r.under, 128, 188);
    for (let c = 0; c < 3; c++) expect(Math.abs(got[c] - SKIN[c])).toBeLessThanOrEqual(1);
  });

  it('肌に囲まれた細い線（指の線）は、肌と一緒にする', () => {
    const image = drawn();
    rect(image, 127, 182, 128, 195, [90, 50, 30]);
    const r = extract(image);
    expect(alpha(r.under, 127, 188)).toBe(255);
    expect(alpha(r.shoe, 127, 188)).toBe(0);
  });

  it('警告の材料: 描き足された量と、足首より上の脚がどれだけ描き変えられたか', () => {
    const r = extract(drawn());
    expect(r.drawn).toBeGreaterThan(2000);
    expect(r.changed / r.body).toBeLessThan(0.1);
    expect(r.shoePixels).toBeGreaterThan(2000);
    expect(r.skinPixels).toBeGreaterThan(400);
    const same = extract(reference());
    expect(same.drawn).toBe(0);
  });
});
