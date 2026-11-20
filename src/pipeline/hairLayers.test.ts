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
    rect(image, 20, 20, 235, 100, BROWN); // 頭の上・左右・顔の上半分をおおう、横に広い髪（ドールの上にあるのは 2 割ほど）
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

  it('体の外の、髪から離れた小さなかけら（AI が手のふちを少し描き変えた所）は、髪にしない', () => {
    const image = reference();
    rect(image, 60, 20, 195, 100, BROWN);
    rect(image, 88, 200, 95, 207, SKIN); // 体のすぐ左に、肌色の小さなはみ出し
    const hair = extract(image);
    expect(alpha(hair.rgba, 90, 205)).toBe(0);
    expect(hair.stray).toBeGreaterThan(0);
  });

  it('ドールの輪郭線だけが描き変わっていても（線の色が少し違う）、髪にしない', () => {
    const image = reference();
    rect(image, 20, 20, 235, 100, BROWN);
    // 体の左右のふち 2px を、暗い色に（髪につながる所から、足もとまで）
    rect(image, DOLL.x0, 101, DOLL.x0 + 1, DOLL.y1, [43, 36, 52]);
    rect(image, DOLL.x1 - 1, 101, DOLL.x1, DOLL.y1, [43, 36, 52]);
    const hair = extract(image);
    expect(alpha(hair.rgba, DOLL.x0, 200)).toBe(0);
    expect(alpha(hair.rgba, DOLL.x1, 150)).toBe(0);
    expect(alpha(hair.rgba, 128, 70)).toBe(255);
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

describe('extractHair: 前髪はひとつながり', () => {
  // 頭・細い首・胴のあるドール。首の横は、ドールの外
  const HEAD = { x0: 104, y0: 40, x1: 151, y1: 90 };
  const NECK = { x0: 120, y0: 91, x1: 135, y1: 110 };
  const BODY = { x0: 90, y0: 111, x1: 165, y1: 229 };
  const parts = [HEAD, NECK, BODY];
  function neckReference(): Uint8ClampedArray {
    const px = new Uint8ClampedArray(S * S * 4);
    rect(px, 0, 0, S - 1, S - 1, GREEN);
    for (const b of parts) rect(px, b.x0, b.y0, b.x1, b.y1, SKIN);
    return px;
  }
  function neckDoll(): Uint8Array {
    const a = new Uint8Array(S * S);
    for (const b of parts) for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) a[y * S + x] = 255;
    return a;
  }
  // 頭の上の髪と、顔の横 → 首の横（ドールの外）→ 胸の上、と前にたれる房。それとは別に、体から離れた後ろ髪
  function lockImage(): Uint8ClampedArray {
    const image = neckReference();
    rect(image, 96, 30, 159, 60, BROWN); // 頭の上
    rect(image, 100, 60, 112, 160, BROWN); // 前にたれる房
    rect(image, 40, 60, 75, 200, BROWN); // 離れた後ろ髪
    return image;
  }
  function pieces(front: Uint8Array): number {
    const seen = new Uint8Array(S * S);
    let count = 0;
    for (let start = 0; start < S * S; start++) {
      if (!front[start] || seen[start]) continue;
      count++;
      const stack = [start];
      seen[start] = 1;
      while (stack.length) {
        const p = stack.pop()!;
        for (const q of [p - 1, p + 1, p - S, p + S]) if (q >= 0 && q < S * S && front[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    return count;
  }

  it('首の横を通る房は、ドールの外の部分もふくめて、頭の髪とつながった 1 枚の前髪になる', () => {
    const hair = extractHair(lockImage(), neckReference(), neckDoll(), S, S, GREEN);
    expect(hair.front[45 * S + 128]).toBe(255); // 頭の上
    expect(hair.front[140 * S + 106]).toBe(255); // 胸の上の房
    expect(hair.front[100 * S + 106]).toBe(255); // 首の横（ドールの外）の、つなぎ目
    expect(pieces(hair.front)).toBe(1);
  });

  it('前髪から離れた後ろ髪は、前に入れない', () => {
    const hair = extractHair(lockImage(), neckReference(), neckDoll(), S, S, GREEN);
    expect(hair.front[100 * S + 55]).toBe(0);
    expect(hair.front[190 * S + 55]).toBe(0);
  });

  it('つなぎ目が遠くても（長い首）、髪をたどってつなぐ', () => {
    // 房が、頭の髪から 60px 下でようやく体にかかる
    const image = neckReference();
    rect(image, 60, 30, 159, 60, BROWN);
    rect(image, 60, 60, 72, 200, BROWN); // 体の左の外を下りて…
    rect(image, 60, 150, 110, 162, BROWN); // …胸の前へ回りこむ
    const hair = extractHair(image, neckReference(), neckDoll(), S, S, GREEN);
    expect(hair.front[156 * S + 100]).toBe(255);
    expect(pieces(hair.front)).toBe(1);
  });
});

describe('extractHair: 前髪の切れ目は、絵の線に沿う', () => {
  const LINE = [40, 20, 10];

  it('ドールの上にかかる房は、ドールの外の部分もふくめて、房ごと前になる。線の向こうの別の房は前にしない', () => {
    const image = reference();
    rect(image, 150, 60, 175, 120, BROWN); // 体の右のふちにかかる房（4 割がドールの上）
    rect(image, 176, 60, 177, 120, LINE); // 房を分ける線
    rect(image, 178, 60, 205, 120, BROWN); // となりの房（ドールの外）
    const hair = extract(image);
    expect(hair.front[90 * S + 155]).toBe(255); // ドールの上
    expect(hair.front[90 * S + 172]).toBe(255); // 同じ房の、ドールの外
    expect(hair.front[90 * S + 195]).toBe(0); // 線の向こうの房
  });

  it('首の高さが分かっていれば、頭のまわりの髪（ほとんどが首より上の房）は、ドールの外でも前になる', () => {
    const image = reference();
    rect(image, 80, 10, 175, 45, BROWN); // 頭の上にのった髪。ドールの上にあるのは下の端だけ
    const withNeck = extractHair(image, reference(), dollAlpha(), S, S, GREEN, 110);
    expect(withNeck.front[20 * S + 128]).toBe(255);
    expect(withNeck.front[20 * S + 90]).toBe(255);
    const without = extract(image);
    expect(without.front[20 * S + 128]).toBe(0);
  });

  it('首より下へ長くのびる房（ツインテールなど）は、首の高さが分かっていても、前にしない', () => {
    const image = reference();
    rect(image, 80, 10, 175, 45, BROWN);
    rect(image, 60, 10, 61, 200, LINE);
    rect(image, 30, 10, 59, 200, BROWN); // 頭の横から腰までたれる房（ドールの外）
    rect(image, 62, 10, 79, 45, BROWN);
    const hair = extractHair(image, reference(), dollAlpha(), S, S, GREEN, 110);
    expect(hair.front[20 * S + 128]).toBe(255);
    expect(hair.front[150 * S + 45]).toBe(0);
    expect(hair.front[30 * S + 45]).toBe(0);
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
    rect(image, 20, 20, 235, 100, BROWN);
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
