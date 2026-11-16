// @vitest-environment node
/**
 * AI 画像 1 枚の処理を、作者のサンプル（緑シルエット 2 枚、黒シルエット 1 枚）で確かめる
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import { dollTemplateFromImage, processGenerated } from './processGenerated.ts';
import type { DollTemplate, ProcessResult } from './processGenerated.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const read = (name: string) => fs.readFile(path.join(FIXTURES, name));
// 素材リポジトリの「アニメ」ドールの位置情報
const DOLL_IMAGE = { file: 'doll-anime.webp', canvasW: 1024, canvasH: 1024, box: { x: 282, y: 27, w: 462, h: 978 } };

let doll: DollTemplate;
beforeAll(async () => {
  doll = await dollTemplateFromImage(await read('doll-anime.webp'), DOLL_IMAGE);
});

const alphaAt = (r: ProcessResult, x: number, y: number) => r.rgba[(y * r.width + x) * 4 + 3];
// 不透明な画素のうち、緑 [14,249,6] に近いものの割合
function greenShare(r: ProcessResult): number {
  let opaque = 0;
  let green = 0;
  for (let i = 0; i < r.rgba.length; i += 4) {
    if (r.rgba[i + 3] < 128) continue;
    opaque++;
    if (Math.hypot(r.rgba[i] - 14, r.rgba[i + 1] - 249, r.rgba[i + 2] - 6) < 60) green++;
  }
  return green / opaque;
}

describe('processGenerated（サンプル画像）', () => {
  it('緑シルエットの上下セット: 警告なし、服が残り、シルエットと背景が消える', async () => {
    const r = await processGenerated(await read('sample-green-set.webp'), doll);
    expect(r.warnings).toEqual([]);
    expect(r.width).toBe(1024);
    expect(alphaAt(r, 512, 100)).toBe(0); // 頭（シルエットだった所）
    expect(alphaAt(r, 512, 990)).toBe(0); // 足先
    expect(alphaAt(r, 20, 20)).toBe(0); // 背景
    expect(alphaAt(r, 512, 290)).toBe(255); // トップス
    expect(alphaAt(r, 450, 750)).toBe(255); // パンツ
    expect(greenShare(r)).toBeLessThan(0.002);
    const box = alphaBBox(r.rgba, r.width, r.height)!;
    expect(box.y).toBeGreaterThan(150); // 頭より下から始まる
    expect(r.keyColors.silhouette![1]).toBeGreaterThan(230);
  }, 30_000);

  it('緑シルエットのドレス: 警告なし。服の内側の白いハイライトは残る', async () => {
    const r = await processGenerated(await read('sample-green-dress.webp'), doll);
    expect(r.warnings).toEqual([]);
    expect(greenShare(r)).toBeLessThan(0.002);
    // スカートの広い範囲に穴が無い
    let holes = 0;
    for (let y = 560; y < 800; y++) for (let x = 440; x < 580; x++) if (alphaAt(r, x, y) < 255) holes++;
    expect(holes).toBe(0);
  }, 30_000);

  it('ドレスを 4% 拡大して 60px ずらした画像でも、ずらす前とほぼ同じ位置になる', async () => {
    const input = await read('sample-green-dress.webp');
    const before = await processGenerated(input, doll);
    // 2080px に拡大して、上の 60px を切り落とす（右と下の端も少し切れるが、服には届かない）
    const big = await sharp(input).resize(2080, 2080).toBuffer();
    const shifted = await sharp(big).extract({ left: 0, top: 60, width: 2000, height: 2000 }).png().toBuffer();
    const after = await processGenerated(shifted, doll);
    expect(after.warnings.map((w) => w.code)).not.toContain('poor-fit');
    const a = alphaBBox(before.rgba, 1024, 1024)!;
    const b = alphaBBox(after.rgba, 1024, 1024)!;
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(4);
    expect(Math.abs(a.w - b.w)).toBeLessThanOrEqual(4);
    expect(Math.abs(a.h - b.h)).toBeLessThanOrEqual(4);
  }, 60_000);

  it('黒シルエットに紺のスカート: color-too-close の警告が出る', async () => {
    const r = await processGenerated(await read('sample-black-skirt.webp'), doll);
    expect(r.warnings.map((w) => w.code)).toContain('color-too-close');
    expect(r.warnings[0].message).toMatch(/欠けて/);
  }, 30_000);

  it('すでに透過済みの画像: 位置合わせなしでそのまま通り、警告なし', async () => {
    const first = await processGenerated(await read('sample-green-set.webp'), doll);
    const png = await sharp(Buffer.from(first.rgba.buffer), { raw: { width: 1024, height: 1024, channels: 4 } }).png().toBuffer();
    const r = await processGenerated(png, doll);
    expect(r.warnings).toEqual([]);
    expect(r.alignment).toMatchObject({ scale: 1, dx: 0, dy: 0 });
    expect(alphaBBox(r.rgba, 1024, 1024)).toEqual(alphaBBox(first.rgba, 1024, 1024));
  }, 30_000);

  it('全面が単色の画像: empty の警告', async () => {
    const flat = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
    const r = await processGenerated(flat, doll);
    expect(r.warnings.map((w) => w.code)).toContain('empty');
  });

  it('nudge を渡すと、その分だけ結果が動く', async () => {
    const input = await read('sample-green-set.webp');
    const a = alphaBBox((await processGenerated(input, doll)).rgba, 1024, 1024)!;
    const b = alphaBBox((await processGenerated(input, doll, { nudge: { scale: 1, dx: 10, dy: -7 } })).rgba, 1024, 1024)!;
    expect(b.x - a.x).toBe(10);
    expect(b.y - a.y).toBe(-7);
  }, 30_000);

  it('壊れた入力は Error', async () => {
    await expect(processGenerated(Buffer.from('これは画像ではない'), doll)).rejects.toThrow(/読めません/);
  });
});
