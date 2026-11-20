/**
 * 髪を「本物のドールに描かせた絵」から取り出すテスト（合成の絵）
 */
import { describe, expect, it } from 'vitest';
import { extractHair, fillUnderDoll, hairFromMask, hairThumbs, THUMB_BODY } from './hairLayers';
import type { Rgb } from './keyColors';

const S = 256;
const GREEN: Rgb = [0, 255, 0];
const SKIN = [254, 214, 190];
const BROWN = [120, 70, 40];
// ドール: x 96〜159、y 40〜229 の四角
const DOLL = { x0: 96, y0: 40, x1: 159, y1: 229 };

function rect(px: Uint8ClampedArray, x0: number, y0: number, x1: number, y1: number, color: number[]) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px.set([...color, 255], (y * S + x) * 4);
}
function reference(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(S * S * 4);
  rect(px, 0, 0, S - 1, S - 1, GREEN);
  rect(px, DOLL.x0, DOLL.y0, DOLL.x1, DOLL.y1, SKIN);
  return px;
}
function dollAlpha(): Uint8Array {
  const a = new Uint8Array(S * S);
  for (let y = DOLL.y0; y <= DOLL.y1; y++) for (let x = DOLL.x0; x <= DOLL.x1; x++) a[y * S + x] = 255;
  return a;
}
const alpha = (px: Uint8ClampedArray, x: number, y: number) => px[(y * S + x) * 4 + 3];
const rgb = (px: Uint8ClampedArray, x: number, y: number) => Array.from(px.subarray((y * S + x) * 4, (y * S + x) * 4 + 3));
const extract = (image: Uint8ClampedArray) => extractHair(image, reference(), dollAlpha(), S, S, GREEN);

describe('extractHair', () => {
  it('ドールの上に描かれた髪は前の範囲、体から離れた外の髪は後ろだけ', () => {
    const image = reference();
    rect(image, 60, 20, 195, 100, BROWN); // 頭の上・左右・顔の上半分をおおう髪
    const hair = extract(image);
    expect(alpha(hair.rgba, 128, 70)).toBe(255); // ドールの上
    expect(alpha(hair.rgba, 70, 70)).toBe(255); // 体の外
    expect(alpha(hair.rgba, 10, 10)).toBe(0); // 背景
    expect(alpha(hair.rgba, 128, 180)).toBe(0); // 変わっていない肌
    expect(hair.front[70 * S + 128]).toBe(255);
    expect(hair.front[70 * S + 70]).toBe(0); // 体から 26px 離れた髪
    expect(hair.front[70 * S + 95]).toBe(255); // 体のふちのすぐ外は、前にも入れる（境目にすき間を作らない）
    expect(rgb(hair.rgba, 128, 70)).toEqual(BROWN);
  });

  it('体のふちに細くかぶっただけの髪（後ろ髪のふち）は、前にしない', () => {
    const image = reference();
    rect(image, 80, 110, 97, 200, BROWN); // 体の左のふちに 2px かぶる
    const hair = extract(image);
    expect(alpha(hair.rgba, 85, 150)).toBe(255);
    expect(hair.front.some((v) => v > 0)).toBe(false);
  });

  it('肌とほとんど同じ色（色の差 10）は髪にしない。髪に囲まれた小さな穴は髪にする。大きな穴（顔）は残す', () => {
    const image = reference();
    rect(image, 100, 150, 120, 170, [254, 214, 180]); // 肌との差 10
    rect(image, 60, 20, 195, 120, BROWN);
    rect(image, 110, 60, 111, 61, SKIN); // 髪の中の 2×2 の穴（色が肌と同じだった所）
    rect(image, 120, 70, 145, 100, SKIN); // 顔
    const hair = extract(image);
    expect(alpha(hair.rgba, 110, 160)).toBe(0);
    expect(alpha(hair.rgba, 110, 60)).toBe(255);
    expect(alpha(hair.rgba, 132, 85)).toBe(0);
  });

  it('AI がドールを少し削って、背景の色になった所は、髪にしない', () => {
    const image = reference();
    rect(image, 60, 20, 195, 100, BROWN);
    rect(image, 96, 150, 103, 229, GREEN); // 体の左のふちが 8px 細くなった
    const hair = extract(image);
    expect(alpha(hair.rgba, 99, 180)).toBe(0);
    expect(hair.front[180 * S + 99]).toBe(0);
  });

  it('髪が頭の上にしか無くても、1 つも無くても、落ちない', () => {
    const above = reference();
    rect(above, 100, 5, 155, 30, BROWN);
    const hair = extract(above);
    expect(alpha(hair.rgba, 128, 15)).toBe(255);
    expect(hair.front.some((v) => v > 0)).toBe(false);
    const none = extract(reference());
    expect(none.rgba.some((v) => v > 0)).toBe(false);
    expect(none.unlike).toBe(0);
    expect(none.stray).toBe(0);
  });

  it('重ね直すと AI の絵に戻る（unlike がほぼ 0）。髪から離れた所の描き変えは、髪に入れずに数える（stray）', () => {
    const image = reference();
    rect(image, 60, 20, 195, 100, BROWN);
    expect(extract(image).unlike).toBeLessThan(0.01);
    rect(image, 118, 180, 137, 199, [0, 0, 220]); // おなかに描き足された青い四角
    const hair = extract(image);
    expect(alpha(hair.rgba, 128, 190)).toBe(0);
    expect(hair.stray).toBeGreaterThan(0.02);
  });

  it('肌にとても近い色の髪は、closeToSkin が大きくなる', () => {
    const image = reference();
    rect(image, 60, 20, 195, 100, [254, 214, 172]); // 肌との差 18
    expect(extract(image).closeToSkin).toBeGreaterThan(0.5);
    const clear = reference();
    rect(clear, 60, 20, 195, 100, BROWN);
    expect(extract(clear).closeToSkin).toBeLessThan(0.05);
  });
});

describe('fillUnderDoll', () => {
  // 体の左右の外にだけ髪がある（y 60〜150）
  function sides(): Uint8ClampedArray {
    const px = new Uint8ClampedArray(S * S * 4);
    rect(px, 70, 60, 95, 150, BROWN);
    rect(px, 160, 60, 186, 150, BROWN);
    return px;
  }
  it('髪にはさまれた体の裏を塗る。体の外には 1px も足さない', () => {
    const hair = sides();
    const doll = dollAlpha();
    const back = fillUnderDoll(hair, doll, S, S);
    expect(alpha(back, 128, 100)).toBe(255);
    expect(rgb(back, 128, 100)).toEqual(BROWN);
    for (let p = 0; p < S * S; p++) if (back[p * 4 + 3] > 0) expect(hair[p * 4 + 3] > 0 || doll[p] >= 128).toBe(true);
  });
  it('髪の無い高さの体は塗らない', () => {
    const back = fillUnderDoll(sides(), dollAlpha(), S, S);
    expect(alpha(back, 128, 200)).toBe(0);
    expect(alpha(back, 128, 45)).toBe(0);
  });
  it('髪が片側にしか無くても、髪に接する体のふちは少しだけ塗る（境目にすき間を作らない）', () => {
    const px = new Uint8ClampedArray(S * S * 4);
    rect(px, 70, 60, 95, 150, BROWN);
    const back = fillUnderDoll(px, dollAlpha(), S, S);
    expect(alpha(back, 97, 100)).toBe(255);
    expect(alpha(back, 128, 100)).toBe(0);
  });
});

describe('hairFromMask', () => {
  it('前の範囲の髪だけが前髪になり、後ろ髪は髪の全体＋体の裏', () => {
    const image = reference();
    rect(image, 60, 20, 195, 100, BROWN);
    const hair = extract(image);
    const layers = hairFromMask(hair.rgba, hair.front, dollAlpha(), S, S);
    expect(alpha(layers.front, 128, 70)).toBe(255);
    expect(alpha(layers.front, 70, 70)).toBe(0);
    expect(Array.from(layers.back)).toEqual(Array.from(fillUnderDoll(hair.rgba, dollAlpha(), S, S)));
    expect(alpha(layers.back, 70, 70)).toBe(255);
  });
});

describe('hairThumbs', () => {
  it('うしろがみの絵は、髪の範囲の中の体を、うすい色の形でおおう（塗りつぶしが見えない）', () => {
    const image = reference();
    rect(image, 60, 20, 195, 100, BROWN);
    rect(image, 60, 20, 95, 150, BROWN);
    rect(image, 160, 20, 195, 150, BROWN);
    const hair = extract(image);
    const { front, back } = hairFromMask(hair.rgba, hair.front, dollAlpha(), S, S);
    const thumbs = hairThumbs(front, back, dollAlpha(), S, S);
    expect(rgb(thumbs.back, 128, 130)).toEqual(THUMB_BODY); // 体の裏の塗りつぶしの上
    expect(alpha(thumbs.back, 128, 130)).toBe(255);
    expect(rgb(thumbs.back, 128, 70)).toEqual(THUMB_BODY); // 前髪の所も、うしろがみの絵では体の形
    expect(alpha(thumbs.back, 128, 200)).toBe(0); // 髪の範囲の外の体は描かない
    expect(rgb(thumbs.back, 70, 100)).toEqual(BROWN);
    expect(rgb(thumbs.hair, 128, 70)).toEqual(BROWN); // 髪の絵では、前髪が形の上にのる
    expect(rgb(thumbs.hair, 128, 130)).toEqual(THUMB_BODY);
  });
});
