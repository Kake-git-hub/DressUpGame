/**
 * 髪を前髪と後ろ髪に分けるテスト
 */
import { describe, expect, it } from 'vitest';
import { capeHair, isBackHairCategory, isHairCategory, splitHair, splitsHair } from './hairSplit';

const W = 160;
const H = 200;
const DEPTH = 6;
const GOLD = [240, 200, 90, 255];

function rect(px: Uint8ClampedArray | Uint8Array, channels: number, x0: number, y0: number, x1: number, y1: number, value: number[]) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) for (let c = 0; c < channels; c++) px[(y * W + x) * channels + c] = value[c];
}
// ドール: x 60〜100、y 20〜190 の四角
function doll(): Uint8Array {
  const a = new Uint8Array(W * H);
  rect(a, 1, 60, 20, 100, 190, [255]);
  return a;
}
// 髪: 体の左右に垂れた後ろ髪（AI のシルエットは体より 3px 細いので、体のふちに 3px かぶる）と、頭の上の前髪
function hair(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  rect(px, 4, 30, 10, 62, 150, GOLD); // 左の後ろ髪（体の x 60〜62 にかぶる）
  rect(px, 4, 98, 10, 130, 150, GOLD); // 右の後ろ髪（体の x 98〜100 にかぶる）
  rect(px, 4, 30, 10, 130, 45, GOLD); // 頭の上と前髪（体の中まで）
  return px;
}
const alpha = (px: Uint8ClampedArray, x: number, y: number) => px[(y * W + x) * 4 + 3];

describe('splitHair', () => {
  it('体の内側に描かれた前髪は前に、体のふちにかぶっただけの後ろ髪は前に残らない', () => {
    const s = splitHair(hair(), doll(), W, H, DEPTH)!;
    expect(alpha(s.front, 80, 30)).toBe(255); // 前髪
    expect(alpha(s.front, 61, 100)).toBe(0); // 体の左のふち（後ろ髪がかぶった所）
    expect(alpha(s.front, 99, 100)).toBe(0);
    expect(alpha(s.front, 40, 100)).toBe(0); // 体の外の後ろ髪
  });
  it('前髪は、体のふち（輪郭線）と、その少し外まで続く', () => {
    const s = splitHair(hair(), doll(), W, H, DEPTH)!;
    expect(alpha(s.front, 60, 30)).toBe(255); // 頭の左のふち
    expect(alpha(s.front, 58, 30)).toBe(255); // ふちの少し外
    expect(alpha(s.front, 40, 30)).toBe(0); // 体から離れた所は後ろだけ
  });
  it('後ろ髪は髪の全体を持ち、体の形の穴は左右の髪の色で埋まる（マントのような 1 枚になる）', () => {
    const s = splitHair(hair(), doll(), W, H, DEPTH)!;
    expect(alpha(s.back, 40, 100)).toBe(255);
    expect(alpha(s.back, 80, 30)).toBe(255); // 前髪の所も持つ
    expect(alpha(s.back, 68, 100)).toBe(255);
    expect(alpha(s.back, 80, 100)).toBe(255); // 体のまん中まで埋まる
    expect(Array.from(s.back.slice((100 * W + 80) * 4, (100 * W + 80) * 4 + 3))).toEqual(GOLD.slice(0, 3));
    expect(alpha(s.back, 80, 170)).toBe(0); // 髪の無い高さは埋めない
  });
  it('左右に分かれた髪と体のあいだの広い空きは埋めない（体の下だけ埋まる）', () => {
    const px = new Uint8ClampedArray(W * H * 4);
    rect(px, 4, 30, 10, 130, 45, GOLD); // 頭の上と前髪
    rect(px, 4, 20, 10, 35, 150, GOLD); // 左のふさ（体から 24px 離れている）
    rect(px, 4, 125, 10, 140, 150, GOLD);
    const s = splitHair(px, doll(), W, H, DEPTH)!;
    expect(alpha(s.back, 48, 100)).toBe(0); // ふさと体のあいだの空き
    expect(alpha(s.back, 80, 100)).toBe(255); // 体の下（ドールに隠れる）
  });
  it('frontBottom より下の髪は前にしない（手や腕にかかった髪は、後ろ髪だけに入る）', () => {
    const px = hair();
    rect(px, 4, 66, 120, 94, 140, GOLD); // 体のまん中にかかった髪
    expect(alpha(splitHair(px, doll(), W, H, DEPTH)!.front, 80, 130)).toBe(255);
    const s = splitHair(px, doll(), W, H, DEPTH, { frontBottom: 60 })!;
    expect(alpha(s.front, 80, 130)).toBe(0);
    expect(alpha(s.front, 80, 30)).toBe(255);
    expect(alpha(s.back, 80, 130)).toBe(255);
  });
  it('AI のシルエットが体より太くてできたすき間を、後ろ髪が埋める', () => {
    const px = hair();
    rect(px, 4, 58, 60, 62, 150, [0, 0, 0, 0]); // 左の後ろ髪を、体の 2px 手前（x 57）で終わらせる
    const s = splitHair(px, doll(), W, H, DEPTH)!;
    expect(alpha(s.back, 58, 100)).toBe(255);
    expect(alpha(s.back, 59, 100)).toBe(255);
    expect(alpha(s.back, 62, 100)).toBe(255);
  });
  it('体の内側の細い線だけのかけら（AI が描き足したあごの線）は前に残さない', () => {
    const px = hair();
    rect(px, 4, 74, 80, 86, 81, [120, 120, 120, 255]);
    const s = splitHair(px, doll(), W, H, DEPTH)!;
    expect(alpha(s.front, 80, 80)).toBe(0);
    expect(alpha(s.front, 80, 30)).toBe(255);
  });
  it('腕と胴のあいだのような、髪に接していないすき間は埋めない', () => {
    const px = hair();
    const d = doll();
    rect(d, 1, 76, 60, 84, 150, [0]); // 体のまん中に、細いすき間（腕と胴のあいだ）
    const s = splitHair(px, d, W, H, DEPTH)!;
    expect(alpha(s.back, 80, 100)).toBe(0);
    expect(alpha(s.back, 70, 100)).toBe(255);
  });
  it('AI の体の形が分かっていれば、髪の隣のすき間は「AI の体があった所」だけ埋める', () => {
    const px = hair();
    rect(px, 4, 50, 60, 62, 150, [0, 0, 0, 0]); // 左の後ろ髪を、体の 10px 手前（x 49）で終わらせる
    const shape = new Uint8Array(W * H);
    rect(shape, 1, 30, 10, 130, 150, [255]); // AI の絵では、そこも体か髪だった
    expect(alpha(splitHair(px, doll(), W, H, DEPTH, { bodyShape: shape })!.back, 55, 100)).toBe(255);
    rect(shape, 1, 50, 60, 59, 150, [0]); // AI の絵でも背景だった（髪と体のあいだの空き）
    expect(alpha(splitHair(px, doll(), W, H, DEPTH, { bodyShape: shape })!.back, 55, 100)).toBe(0);
  });
  it('体の裏は、横じまにならない: 髪の線が行ごとに違っていても、縦にとなり合う画素の色の差が 3 以下', () => {
    const px = hair();
    // 髪の線: 2 行ごとに、左右の髪を暗い色にする（行ごとに色をつなぐと、体の裏に横じまが出る）
    for (let y = 60; y <= 140; y += 2) {
      rect(px, 4, 30, y, 62, y, [90, 60, 20, 255]);
      rect(px, 4, 98, y, 130, y, [90, 60, 20, 255]);
    }
    const s = splitHair(px, doll(), W, H, DEPTH)!;
    for (let y = 61; y <= 140; y++) {
      for (let x = 66; x <= 94; x++) {
        expect(alpha(s.back, x, y)).toBe(255);
        for (let c = 0; c < 3; c++) expect(Math.abs(s.back[(y * W + x) * 4 + c] - s.back[((y - 1) * W + x) * 4 + c])).toBeLessThanOrEqual(3);
      }
    }
  });
  it('体の裏の色は、髪の線ではなく、髪の地の色', () => {
    const px = hair();
    // 髪のふちの線（体のすぐ横の 2 列だけ暗い）
    rect(px, 4, 61, 50, 62, 150, [60, 40, 10, 255]);
    rect(px, 4, 98, 50, 99, 150, [60, 40, 10, 255]);
    const s = splitHair(px, doll(), W, H, DEPTH)!;
    const i = (100 * W + 80) * 4;
    expect(s.back[i]).toBeGreaterThan(200); // 金色の地（R 240）に近い
    expect(s.back[i + 1]).toBeGreaterThan(160);
  });
  it('体の内側に髪が無ければ null（分けない）', () => {
    const px = new Uint8ClampedArray(W * H * 4);
    rect(px, 4, 10, 10, 40, 150, GOLD);
    expect(splitHair(px, doll(), W, H, DEPTH)).toBeNull();
  });
});

describe('capeHair（うしろがみ）', () => {
  // マネキンのまわりに描かれた後ろ髪: 体の左右と、頭の上。体の所は、あいている
  function around(): Uint8ClampedArray {
    const px = new Uint8ClampedArray(W * H * 4);
    rect(px, 4, 30, 10, 59, 150, GOLD);
    rect(px, 4, 101, 10, 130, 150, GOLD);
    rect(px, 4, 30, 10, 130, 19, GOLD);
    return px;
  }
  const RED = [200, 0, 0, 255];
  const color = (px: Uint8ClampedArray, x: number, y: number) => Array.from(px.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));

  it('描いた絵が無ければ、体の下を左右の髪の色でつないで埋める。髪より下の体は埋めない', () => {
    const back = capeHair(around(), doll(), W, H);
    expect(color(back, 80, 100)).toEqual(GOLD);
    expect(alpha(back, 80, 170)).toBe(0);
    expect(color(back, 40, 100)).toEqual(GOLD); // もとの髪はそのまま
  });
  it('描いた絵があれば、体の下はその絵で埋める。絵に髪が無い所は埋めない（細いすき間だけ、色をつなぐ）。輪郭はもとの髪のまま', () => {
    const paint = new Uint8ClampedArray(W * H * 4);
    rect(paint, 4, 0, 0, W - 1, 120, RED); // 髪より広く、途中（y=120）まで描いてある
    rect(paint, 4, 62, 50, 63, 60, [0, 0, 0, 0]); // 絵のふちの、細いすき間
    const back = capeHair(around(), doll(), W, H, { paint });
    expect(color(back, 80, 100)).toEqual(RED); // 体の下: 描いた絵
    expect(alpha(back, 80, 140)).toBe(0); // 絵に髪が無い所: 髪は無い
    expect(color(back, 62, 55)).toEqual(GOLD); // 細いすき間: 色をつなぐ
    expect(color(back, 40, 100)).toEqual(GOLD); // もとの髪は、絵で上書きしない
    expect(color(back, 58, 100)).toEqual(RED); // ただし、穴のふちの数 px は、絵に置き換える（輪郭線のにじみを消す）
    expect(alpha(back, 10, 100)).toBe(0); // 髪の外には広げない
    expect(alpha(back, 80, 170)).toBe(0);
  });
});

describe('髪のカテゴリ', () => {
  it('うしろがみは、うしろがみとして見分け、髪（前髪と後ろ髪に分ける対象）には入れない', () => {
    for (const label of ['うしろがみ', '後ろ髪', 'バックヘア', 'Back hair']) {
      expect(isBackHairCategory(label)).toBe(true);
      expect(isHairCategory(label)).toBe(false);
    }
    for (const label of ['ヘアスタイル', 'かみ', 'まえがみ', '前髪']) {
      expect(isBackHairCategory(label)).toBe(false);
      expect(isHairCategory(label)).toBe(true);
    }
    expect(isHairCategory('トップス')).toBe(false);
  });
  it('うしろがみのカテゴリを持つドールでは、髪を前髪と後ろ髪に分けない', () => {
    expect(splitsHair('ヘアスタイル', ['ヘアスタイル', 'トップス'])).toBe(true);
    expect(splitsHair('ヘアスタイル', ['ヘアスタイル', 'うしろがみ'])).toBe(false);
    expect(splitsHair('うしろがみ', ['うしろがみ'])).toBe(false);
  });
});
