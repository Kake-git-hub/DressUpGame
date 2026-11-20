// @vitest-environment node
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import type { Tile } from '../../src/pipeline/frames.ts';
import { pasteTile, pasteTileAlpha, renderFrame, tileTemplate, toTile } from './frame.ts';
import type { DollTemplate } from './processGenerated.ts';

// 四角い頭と胴のドール（肌色）。k 倍の大きさでも作れる
function makeDoll(k = 1): DollTemplate {
  const canvasW = 200 * k;
  const canvasH = 200 * k;
  const rgba = new Uint8ClampedArray(canvasW * canvasH * 4);
  const mask = new Uint8Array(canvasW * canvasH);
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = y0 * k; y < y1 * k; y++) {
      for (let x = x0 * k; x < x1 * k; x++) {
        rgba.set([240, 200, 170, 255], (y * canvasW + x) * 4);
        mask[y * canvasW + x] = 1;
      }
    }
  };
  rect(80, 20, 120, 60); // 頭
  rect(60, 60, 140, 180); // 胴
  return { rgba, mask, canvasW, canvasH };
}
const tile: Tile = { from: { x: 50, y: 0, w: 100, h: 100 }, to: { x: 0, y: 0, w: 1024, h: 1024 } };
const raw = async (png: Buffer) => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};
const count = (mask: Uint8Array) => mask.reduce((n, v) => n + v, 0);

describe('renderFrame', () => {
  it('本物のドールを、枠の範囲だけ拡大して写す', async () => {
    const { data, width, height } = await raw(await renderFrame(makeDoll(), 1, [tile], [0, 255, 0], null));
    expect([width, height]).toEqual([1024, 1024]);
    const at = (x: number, y: number) => [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
    expect(at(10, 10)).toEqual([0, 255, 0]); // 背景
    expect(at(512, 400)).toEqual([240, 200, 170]); // 頭（キャンバスの 100, 39）
  });
  it('シルエットの色を指定すると、ドールを単色で塗る', async () => {
    const { data, width } = await raw(await renderFrame(makeDoll(), 1, [tile], [0, 255, 0], [0, 0, 255]));
    expect([...data.subarray((400 * width + 512) * 3, (400 * width + 512) * 3 + 3)]).toEqual([0, 0, 255]);
  });
  it('2 枚組の枠では、それぞれの位置に写し、残りは背景', async () => {
    const tiles: Tile[] = [
      { from: { x: 60, y: 60, w: 40, h: 80 }, to: { x: 0, y: 0, w: 512, h: 1024 } },
      { from: { x: 0, y: 0, w: 40, h: 80 }, to: { x: 512, y: 0, w: 512, h: 1024 } },
    ];
    const { data, width } = await raw(await renderFrame(makeDoll(), 1, tiles, [0, 255, 0], null));
    expect([...data.subarray((500 * width + 256) * 3, (500 * width + 256) * 3 + 3)]).toEqual([240, 200, 170]);
    expect([...data.subarray((500 * width + 768) * 3, (500 * width + 768) * 3 + 3)]).toEqual([0, 255, 0]);
  });
});

describe('tileTemplate と pasteTile', () => {
  for (const k of [1, 2]) {
    it(`枠の中だけの型を作り、貼り戻すと元の位置に戻る（元画像 ${k} 倍）`, async () => {
      const doll = makeDoll();
      const t = await tileTemplate(makeDoll(k), k, tile);
      expect([t.canvasW, t.canvasH]).toEqual([1024, 1024]);
      // 枠の中のドール: 頭 40×40 と、胴の 80×40 = 4800 px（キャンバス上）→ 1024/100 倍の 2 乗
      const expected = 4800 * (1024 / 100) ** 2;
      expect(Math.abs(count(t.mask) - expected) / expected).toBeLessThan(0.02);
      const target = new Uint8ClampedArray(doll.canvasW * doll.canvasH * 4);
      await pasteTile(target, doll.canvasW, doll.canvasH, t.rgba, tile);
      const box = alphaBBox(target, doll.canvasW, doll.canvasH)!;
      expect(Math.abs(box.x - 60)).toBeLessThanOrEqual(2);
      expect(Math.abs(box.y - 20)).toBeLessThanOrEqual(2);
      expect(Math.abs(box.x + box.w - 140)).toBeLessThanOrEqual(2);
      expect(Math.abs(box.y + box.h - 100)).toBeLessThanOrEqual(2);
    });
  }
  it('貼り戻しは、すでにある絵に重ねる（透明な所は消さない）', async () => {
    const doll = makeDoll();
    const target = new Uint8ClampedArray(doll.rgba);
    await pasteTile(target, doll.canvasW, doll.canvasH, new Uint8ClampedArray(1024 * 1024 * 4), tile);
    expect(target[(40 * 200 + 100) * 4 + 3]).toBe(255);
  });
});

describe('toTile', () => {
  it('不透明度だけの絵（形・隠す所）も、枠の位置に正しく戻る', async () => {
    // 枠の中（200×200）の下半分が 255。キャンバス 100×100 の (20,10)〜(60,50) に戻す
    const alpha = new Uint8Array(200 * 200);
    for (let y = 100; y < 200; y++) for (let x = 0; x < 200; x++) alpha[y * 200 + x] = 255;
    const target = new Uint8Array(100 * 100);
    await pasteTileAlpha(target, 100, 100, alpha, { from: { x: 20, y: 10, w: 40, h: 40 }, to: { x: 0, y: 0, w: 200, h: 200 } });
    expect(target[15 * 100 + 40]).toBe(0); // 上半分
    expect(target[45 * 100 + 25]).toBe(255); // 下半分の左
    expect(target[45 * 100 + 55]).toBe(255); // 下半分の右
    expect(target[45 * 100 + 70]).toBe(0); // 枠の外
    expect(target[60 * 100 + 40]).toBe(0);
    // 同じ大きさ（拡大なし）でも同じ
    const same = new Uint8Array(200 * 200);
    await pasteTileAlpha(same, 200, 200, alpha, { from: { x: 0, y: 0, w: 200, h: 200 }, to: { x: 0, y: 0, w: 200, h: 200 } });
    expect(same[50 * 200 + 100]).toBe(0);
    expect(same[150 * 200 + 100]).toBe(255);
    expect(same[199 * 200 + 199]).toBe(255);
  });

  it('キャンバス上の箱を、枠の中の位置に直す', () => {
    expect(toTile({ x: 80, y: 20, w: 40, h: 40 }, tile)).toEqual({ x: 307, y: 205, w: 410, h: 410 });
  });
});
