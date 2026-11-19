// @vitest-environment node
/**
 * 本物の生成画像（上半身の拡大シルエットに描かせた髪）で、切り抜きと位置合わせを確かめる
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import { estimateBodyParts } from '../../src/pipeline/bodyParts.ts';
import type { Tile } from '../../src/pipeline/frames.ts';
import { tileTemplate, toTile } from './frame.ts';
import { cutOutDoll } from './makeDoll.ts';
import { processGenerated } from './processGenerated.ts';
import type { DollTemplate } from './processGenerated.ts';

const SPIKE = path.join(import.meta.dirname, '../../docs/superpowers/specs/2026-11-19-spike');

describe('髪（上半身の拡大図、本物の生成画像）', () => {
  it('頭にぴったり乗る: 位置合わせでほとんど動かさず、青や緑が残らない', async () => {
    const cut = await sharp(await cutOutDoll(await sharp(path.join(SPIKE, 'doll_new1.webp')).png().toBuffer())).raw().toBuffer({ resolveWithObject: true });
    const size = cut.info.width;
    const rgba = new Uint8ClampedArray(cut.data.buffer, cut.data.byteOffset, cut.data.byteLength);
    const mask = new Uint8Array(size * size);
    for (let p = 0; p < mask.length; p++) if (rgba[p * 4 + 3] >= 128) mask[p] = 1;
    const doll: DollTemplate = { rgba, mask, canvasW: size, canvasH: size };
    const parts = estimateBodyParts(mask, size, size)!;
    // 試行で AI に渡したのは、2048px の絵の上半分の中央（512, 0）から 1024px 四方
    const tile: Tile = { from: { x: 512, y: 0, w: 1024, h: 1024 }, to: { x: 0, y: 0, w: 1024, h: 1024 } };
    const generated = await sharp(await fs.readFile(path.join(SPIKE, 'hair1.webp'))).png().toBuffer();
    const head = toTile(parts.head, tile);
    const result = await processGenerated(generated, await tileTemplate(doll, 1, tile), { silhouetteColor: [0, 0, 255], anchor: head });

    expect(Math.abs(result.alignment.dx)).toBeLessThanOrEqual(8);
    expect(Math.abs(result.alignment.dy)).toBeLessThanOrEqual(8);
    const box = alphaBBox(result.rgba, 1024, 1024)!;
    // 髪は頭のてっぺんより上から始まり、頭の左右を覆う
    expect(box.y).toBeLessThan(head.y);
    expect(box.x).toBeLessThan(head.x);
    expect(box.x + box.w).toBeGreaterThan(head.x + head.w);
    let opaque = 0, keyed = 0;
    for (let p = 0; p < 1024 * 1024; p++) {
      if (result.rgba[p * 4 + 3] < 128) continue;
      opaque++;
      const [r, g, b] = [result.rgba[p * 4], result.rgba[p * 4 + 1], result.rgba[p * 4 + 2]];
      if (g - Math.max(r, b) > 60 || b - Math.max(r, g) > 60) keyed++;
    }
    expect(opaque).toBeGreaterThan(100_000);
    expect(keyed / opaque).toBeLessThan(0.005);
  }, 60_000);

  it('枠が数 px ずれていても、頭の位置合わせは少し直すだけ（首や肩を頭の範囲に引きこんで大きく動かさない）', async () => {
    const cut = await sharp(await cutOutDoll(await sharp(path.join(SPIKE, 'doll_new1.webp')).png().toBuffer())).raw().toBuffer({ resolveWithObject: true });
    const size = cut.info.width;
    const rgba = new Uint8ClampedArray(cut.data.buffer, cut.data.byteOffset, cut.data.byteLength);
    const mask = new Uint8Array(size * size);
    for (let p = 0; p < mask.length; p++) if (rgba[p * 4 + 3] >= 128) mask[p] = 1;
    const parts = estimateBodyParts(mask, size, size)!;
    const generated = await sharp(await fs.readFile(path.join(SPIKE, 'hair1.webp'))).png().toBuffer();
    // 頭に対する髪の位置（髪の外接矩形の中心と上端 − 頭の中心と上端）が、枠をずらしても変わらないこと
    const place = async (ox: number, oy: number) => {
      const tile: Tile = { from: { x: 512 + ox, y: 8 + oy, w: 1008, h: 1008 }, to: { x: 0, y: 0, w: 1024, h: 1024 } };
      // 生成画像は (512, 8) から 1008px 四方。枠（型）のほうを少しずらして、AI が絵をずらしたのと同じ状況にする
      const image = await sharp(generated).extract({ left: 0, top: 8, width: 1008, height: 1008 }).resize(1024, 1024).png().toBuffer();
      const head = toTile(parts.head, tile);
      const result = await processGenerated(image, await tileTemplate({ rgba, mask, canvasW: size, canvasH: size }, 1, tile), { silhouetteColor: [0, 0, 255], anchor: head });
      const box = alphaBBox(result.rgba, 1024, 1024)!;
      return { x: box.x + box.w / 2 - (head.x + head.w / 2), y: box.y - head.y };
    };
    const base = await place(0, 0);
    for (const [ox, oy] of [[6, 4], [-5, 6], [4, -6]]) {
      const moved = await place(ox, oy);
      expect(Math.abs(moved.x - base.x), `x at ${ox},${oy}`).toBeLessThanOrEqual(6);
      expect(Math.abs(moved.y - base.y), `y at ${ox},${oy}`).toBeLessThanOrEqual(6);
    }
  }, 120_000);
});
