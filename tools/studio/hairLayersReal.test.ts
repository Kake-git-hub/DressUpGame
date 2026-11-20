// @vitest-environment node
/**
 * 髪の取り出し: 本物の生成画像（2026-11-20 の試作。AI の絵と、渡した拡大図）で確かめる
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { extractHair, fillUnderDoll } from '../../src/pipeline/hairLayers.ts';
import { pixelDistance } from '../../src/pipeline/keyColors.ts';
import { isShadowOf } from '../../src/pipeline/skinShadow.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';

const SIZE = 1024;
const GREEN: Rgb = [0, 255, 0];
const BLUE: Rgb = [0, 0, 255];
const CYAN: Rgb = [0, 255, 255];
const NECK_Y = 460; // 試作の拡大図での、首（肩の上）の高さ
const file = (name: string) => path.join(import.meta.dirname, 'fixtures', 'diff', name);

async function raw(name: string): Promise<Uint8ClampedArray> {
  const data = await sharp(fs.readFileSync(file(name))).removeAlpha().ensureAlpha().resize(SIZE, SIZE, { fit: 'fill' }).raw().toBuffer();
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
}
// 元の図で、背景でない所がドール
function dollOf(reference: Uint8ClampedArray, background: Rgb): Uint8Array {
  const alpha = new Uint8Array(SIZE * SIZE);
  for (let p = 0; p < alpha.length; p++) if (pixelDistance(reference, p * 4, background) >= 70) alpha[p] = 255;
  return alpha;
}
async function load(slug: string, background: Rgb) {
  const reference = await raw(`${slug}-ref.webp`);
  const image = await raw(`${slug}-gen.webp`);
  const doll = dollOf(reference, background);
  return { doll, reference, image, hair: extractHair(image, reference, doll, SIZE, SIZE, background, NECK_Y) };
}

describe('extractHair（本物の生成画像）', async () => {
  const pink = await load('h1-pink', GREEN);
  const brown = await load('h2-brown', GREEN);
  const braids = await load('h3-braids', BLUE);
  const all = { 'うすいピンクのツインテール': pink, '茶色のロング': brown, '金の三つ編み': braids };

  for (const [name, { doll, hair }] of Object.entries(all)) {
    it(`${name}: 重ね直すと AI の絵に戻り、髪から離れた描き変えは無い`, () => {
      expect(hair.unlike).toBeLessThan(0.02);
      expect(hair.stray).toBeLessThan(0.01);
      expect(hair.closeToSkin).toBeLessThan(0.25);
    });
    it(`${name}: 体の裏の塗りつぶしは、体の外に 1px も出ない`, () => {
      const back = fillUnderDoll(hair.rgba, doll, SIZE, SIZE);
      let outside = 0;
      let filled = 0;
      for (let p = 0; p < SIZE * SIZE; p++) {
        if (back[p * 4 + 3] === 0 || hair.rgba[p * 4 + 3] > 0) continue;
        filled++;
        if (doll[p] < 128) outside++;
      }
      expect(outside).toBe(0);
      expect(filled).toBeGreaterThan(20000); // 頭と胴の裏が塗られている
    });
  }

  for (const [name, { hair }] of Object.entries(all)) {
    it(`${name}: 前髪は、ひとつながり`, () => {
      const seen = new Uint8Array(SIZE * SIZE);
      const sizes: number[] = [];
      for (let start = 0; start < SIZE * SIZE; start++) {
        if (!hair.front[start] || seen[start]) continue;
        let size = 0;
        const stack = [start];
        seen[start] = 1;
        while (stack.length) {
          const p = stack.pop()!;
          size++;
          const x = p % SIZE;
          for (const q of [x > 0 ? p - 1 : -1, x < SIZE - 1 ? p + 1 : -1, p - SIZE, p + SIZE]) if (q >= 0 && q < SIZE * SIZE && hair.front[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
        }
        sizes.push(size);
      }
      expect(sizes.length).toBe(1);
    });
  }

  it('三つ編み: 体の前にたれた三つ編みが、前の範囲に入る', () => {
    let belowChin = 0;
    for (let y = Math.round(SIZE * 0.32); y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (braids.hair.front[y * SIZE + x]) belowChin++;
    expect(belowChin).toBeGreaterThan(5000);
  });

  it('頭の上のふくらみ（ドールの外）も前に入り、前髪だけで頭をおおう', () => {
    for (const { doll, hair } of Object.values(all)) {
      expect(doll[170 * SIZE + 512]).toBe(0); // 頭より上
      expect(hair.front[170 * SIZE + 512]).toBe(255);
    }
  });

  it('ツインテールのしっぽと、肩より下の後ろ髪の広がりは、前にしない', () => {
    // 左のしっぽの、肩より下（x < 300、y 480〜700）は、ほとんどが後ろだけ
    let tail = 0;
    let tailFront = 0;
    for (let y = 480; y < 700; y++) {
      for (let x = 0; x < 300; x++) {
        if (pink.hair.rgba[(y * SIZE + x) * 4 + 3] < 128) continue;
        tail++;
        if (pink.hair.front[y * SIZE + x]) tailFront++;
      }
    }
    expect(tail).toBeGreaterThan(10000);
    expect(tailFront / tail).toBeLessThan(0.05);
    expect(brown.hair.rgba[(800 * SIZE + 215) * 4 + 3]).toBe(255); // 体の左に広がる後ろ髪
    expect(brown.hair.front[800 * SIZE + 215]).toBe(0);
  });

  it('前の範囲は、肩より上で左右同じ高さに分かれる（片側のしっぽだけが前に入ることはない）', () => {
    const rows = (x0: number, x1: number) => {
      let lowest = -1;
      for (let y = 0; y < SIZE; y++) for (let x = x0; x < x1; x++) if (pink.hair.front[y * SIZE + x] && pink.hair.rgba[(y * SIZE + x) * 4 + 3] >= 128) lowest = Math.max(lowest, y);
      return lowest;
    };
    // しっぽは x < 300 と x > 724
    expect(Math.abs(rows(0, 300) - rows(724, SIZE))).toBeLessThanOrEqual(8);
  });

  it('ツインテール: 前の範囲は、ほとんどが頭のまわり（体の後ろの髪は前にしない）', () => {
    let total = 0;
    let head = 0;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!pink.hair.front[y * SIZE + x]) continue;
        total++;
        if (y < NECK_Y + 10) head++;
      }
    }
    expect(total).toBeGreaterThan(10000);
    expect(head / total).toBeGreaterThan(0.9);
  });

  it('うすいピンク（肌に近い色）の前髪が、欠けずに取り出せる', () => {
    // 前髪の帯のうち、髪でない所は、房のすき間の肌の影だけ（影は髪に入れない）
    let band = 0;
    let hairOrShadow = 0;
    let opaque = 0;
    for (let y = Math.round(SIZE * 0.24); y < SIZE * 0.29; y++) {
      for (let x = Math.round(SIZE * 0.44); x < SIZE * 0.56; x++) {
        band++;
        const i = (y * SIZE + x) * 4;
        if (pink.hair.rgba[i + 3] >= 128) opaque++;
        if (pink.hair.rgba[i + 3] >= 128 || isShadowOf(pink.image[i], pink.image[i + 1], pink.image[i + 2], pink.reference[i], pink.reference[i + 1], pink.reference[i + 2])) hairOrShadow++;
      }
    }
    expect(hairOrShadow / band).toBeGreaterThan(0.95);
    expect(opaque / band).toBeGreaterThan(0.88);
  });

  it('前髪が額に落とした肌の影は、髪に入れない（色スライダーで、影だけが色変わりしないように）', () => {
    // 取り除く前は、髪に入った影の色の画素が ピンク 2168・三つ編み 2632。いまは 115・368（耳のまわりの小さなかけら）
    for (const { doll, reference, hair } of [pink, braids]) {
      let shadow = 0;
      for (let p = 0; p < SIZE * SIZE; p++) {
        const i = p * 4;
        if (!doll[p] || hair.rgba[i + 3] < 128) continue;
        if (isShadowOf(hair.rgba[i], hair.rgba[i + 1], hair.rgba[i + 2], reference[i], reference[i + 1], reference[i + 2])) shadow++;
      }
      expect(shadow).toBeLessThan(500);
    }
  });

  it('白いシャツが肌より広いドール（男の子、2026-11-20）でも、額の影を髪に入れない', async () => {
    // 肌の色を「いちばん多い色」で決めていたときは、シャツの白を肌と取り違えて、影の色の画素が 1500 以上残った
    const boy = await load('h4-boy', CYAN);
    let shadow = 0;
    let onDoll = 0;
    for (let p = 0; p < SIZE * SIZE; p++) {
      const i = p * 4;
      if (!boy.doll[p] || boy.hair.rgba[i + 3] < 128) continue;
      onDoll++;
      if (isShadowOf(boy.hair.rgba[i], boy.hair.rgba[i + 1], boy.hair.rgba[i + 2], boy.reference[i], boy.reference[i + 1], boy.reference[i + 2])) shadow++;
    }
    expect(onDoll).toBeGreaterThan(15000); // 髪は取り出せている
    expect(shadow).toBeLessThan(200);
    expect(boy.hair.unlike).toBeLessThan(0.02);
  });

  it('三つ編み: 手のまわりの小さな描き変えを、髪にしない（三つ編みの先より下に、髪は無い）', () => {
    let low = 0;
    for (let p = Math.round(SIZE * 0.87) * SIZE; p < SIZE * SIZE; p++) if (braids.hair.rgba[p * 4 + 3] > 0) low++;
    expect(low).toBe(0);
  });

  it('髪のふちに、背景の緑が残らない', () => {
    let greenish = 0;
    let solid = 0;
    for (let p = 0; p < SIZE * SIZE; p++) {
      const i = p * 4;
      if (brown.hair.rgba[i + 3] < 128) continue;
      solid++;
      if (brown.hair.rgba[i + 1] - Math.max(brown.hair.rgba[i], brown.hair.rgba[i + 2]) > 25) greenish++;
    }
    expect(greenish / solid).toBeLessThan(0.002);
  });
});
