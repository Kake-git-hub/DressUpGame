/**
 * 髪を前髪と後ろ髪に分けるテスト
 */
import { describe, expect, it } from 'vitest';
import { splitHair } from './hairSplit';

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
  it('体の内側に髪が無ければ null（分けない）', () => {
    const px = new Uint8ClampedArray(W * H * 4);
    rect(px, 4, 10, 10, 40, 150, GOLD);
    expect(splitHair(px, doll(), W, H, DEPTH)).toBeNull();
  });
});
