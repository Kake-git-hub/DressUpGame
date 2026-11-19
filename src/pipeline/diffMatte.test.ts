/**
 * 「元の絵に描き足した画像」から、描き足した分だけを取り出すテスト
 */
import { describe, expect, it } from 'vitest';
import { diffMatte, matchToReference } from './diffMatte';

const W = 200;
const H = 200;
const BG = [255, 255, 255];

// 白い背景に、上から下へ少し暗くなる肌色の丸（頭）
function head(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const inside = (x - 100) ** 2 + (y - 100) ** 2 <= 70 * 70;
      const c = inside ? [240 - y * 0.15, 200 - y * 0.15, 170 - y * 0.15] : BG;
      px.set([c[0], c[1], c[2], 255], (y * W + x) * 4);
    }
  }
  return px;
}
// 目（不透明なこげ茶の四角 2 つ）と、ほお（ピンクを 35% で重ねる）を描き足す
function paintFace(px: Uint8ClampedArray): void {
  const blend = (x: number, y: number, c: number[], a: number) => {
    const i = (y * W + x) * 4;
    for (let k = 0; k < 3; k++) px[i + k] = Math.round(px[i + k] * (1 - a) + c[k] * a);
  };
  for (let y = 80; y < 96; y++) for (const x0 of [70, 114]) for (let x = x0; x < x0 + 16; x++) blend(x, y, [60, 35, 30], 1);
  for (let y = 108; y < 124; y++) for (const x0 of [62, 122]) for (let x = x0; x < x0 + 16; x++) blend(x, y, [255, 90, 120], 0.35);
}
// AI が描き直したときのゆらぎ: 全体を (dx, dy) ずらし、色を少し変え、細かいむらを足す
function disturb(px: Uint8ClampedArray, dx: number, dy: number, drift: number, noise: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px.length);
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.min(W - 1, Math.max(0, x - dx));
      const sy = Math.min(H - 1, Math.max(0, y - dy));
      const i = (y * W + x) * 4;
      const j = (sy * W + sx) * 4;
      for (let k = 0; k < 3; k++) out[i + k] = px[j + k] + drift + Math.round(rand() * noise);
      out[i + 3] = 255;
    }
  }
  return out;
}
const at = (px: Uint8ClampedArray, x: number, y: number) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 4));
// 取り出した絵を元の絵に重ねた色
function over(item: number[], base: number[]): number[] {
  const a = item[3] / 255;
  return [0, 1, 2].map((k) => item[k] * a + base[k] * (1 - a));
}

describe('matchToReference', () => {
  it('ずれた画像を、元の絵の位置に戻す', () => {
    const ref = head();
    const drawn = head();
    paintFace(drawn);
    const m = matchToReference(disturb(drawn, 5, -3, 0, 0), ref, W, H);
    expect(Math.abs(m.dx + 5)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.dy - 3)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.scale - 1)).toBeLessThan(0.011);
  });
  it('ずれていない画像は動かさない', () => {
    const ref = head();
    const drawn = head();
    paintFace(drawn);
    const m = matchToReference(drawn, ref, W, H);
    expect([m.scale, m.dx, m.dy]).toEqual([1, 0, 0]);
  });
});

describe('diffMatte', () => {
  it('描き足した所だけが残り、元のままの肌と背景は透明になる', () => {
    const ref = head();
    const drawn = head();
    paintFace(drawn);
    const r = diffMatte(drawn, ref, W, H);
    expect(at(r.rgba, 78, 88)[3]).toBe(255); // 目
    expect(at(r.rgba, 100, 60)[3]).toBe(0); // ひたい
    expect(at(r.rgba, 100, 140)[3]).toBe(0); // あご
    expect(at(r.rgba, 10, 10)[3]).toBe(0); // 背景
    expect(r.changedShare).toBeLessThan(0.05);
  });
  it('うすく重ねた色（ほお）は半透明で残り、元の絵に重ねると描かれた色に戻る', () => {
    const ref = head();
    const drawn = head();
    paintFace(drawn);
    const r = diffMatte(drawn, ref, W, H);
    const cheek = at(r.rgba, 70, 116);
    expect(cheek[3]).toBeGreaterThan(40);
    expect(cheek[3]).toBeLessThan(255);
    const back = over(cheek, at(ref, 70, 116));
    const want = at(drawn, 70, 116);
    for (let k = 0; k < 3; k++) expect(Math.abs(back[k] - want[k])).toBeLessThan(6);
  });
  it('AI の描き直しによる少しのずれ・色の変化・むらでは、肌や輪郭が残らない', () => {
    const ref = head();
    const drawn = head();
    paintFace(drawn);
    const disturbed = disturb(drawn, 4, -2, 6, 3);
    const m = matchToReference(disturbed, ref, W, H);
    const r = diffMatte(m.rgba, ref, W, H);
    expect(at(r.rgba, 78, 88)[3]).toBeGreaterThan(240); // 目は残る
    // 目とほお（とその周り 4px）の外に残った画素
    let stray = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const eye = y >= 76 && y < 100 && ((x >= 66 && x < 90) || (x >= 110 && x < 134));
        const cheek = y >= 104 && y < 128 && ((x >= 58 && x < 82) || (x >= 118 && x < 142));
        if (!eye && !cheek && at(r.rgba, x, y)[3] > 24) stray++;
      }
    }
    expect(stray).toBeLessThan(20);
  });
  it('何も描き足されていなければ、何も残らない', () => {
    const r = diffMatte(head(), head(), W, H);
    expect(r.changedShare).toBe(0);
    expect(r.rgba.some((v, i) => i % 4 === 3 && v > 0)).toBe(false);
  });
});
