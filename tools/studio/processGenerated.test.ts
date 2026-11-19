// @vitest-environment node
/**
 * AI 画像 1 枚の処理を、作者のサンプル（緑シルエット 2 枚、黒シルエット 1 枚）で確かめる
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import { estimateBodyParts } from '../../src/pipeline/bodyParts.ts';
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
    // 部位ごとの直しをしていても、微調整はそのまま上乗せされる（直しが消えて服が跳ねない）
    const parts = Object.values(estimateBodyParts(doll.mask, doll.canvasW, doll.canvasH)!);
    const c = alphaBBox((await processGenerated(input, doll, { parts })).rgba, 1024, 1024)!;
    const d = alphaBBox((await processGenerated(input, doll, { parts, nudge: { scale: 1, dx: 10, dy: -7 } })).rgba, 1024, 1024)!;
    expect([d.x - c.x, d.y - c.y, d.w - c.w, d.h - c.h]).toEqual([10, -7, 0, 0]);
  }, 60_000);

  it('壊れた入力は Error', async () => {
    await expect(processGenerated(Buffer.from('これは画像ではない'), doll)).rejects.toThrow(/読めません/);
  });

  it('AI が腕を少しずらして描いても、部位ごとの位置合わせで手袋がドールの手に合う', async () => {
    const W = doll.canvasW;
    const parts = estimateBodyParts(doll.mask, W, doll.canvasH)!;
    const arm = parts.armRight;
    const hand = parts.handRight;
    const inBox = (b: typeof arm, x: number, y: number) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
    const [sx, sy] = [6, 5]; // AI が描き直したときの、右腕のずれ
    // 白い背景に緑のシルエット。右腕だけ (sx, sy) ずれていて、その手に赤い手袋
    const raw = Buffer.alloc(W * W * 3, 255);
    for (let y = 0; y < W; y++) {
      for (let x = 0; x < W; x++) {
        const moved = inBox({ x: arm.x, y: arm.y, w: arm.w + 20, h: arm.h + 20 }, x, y);
        const fx = moved ? x - sx : x;
        const fy = moved ? y - sy : y;
        if (fx < 0 || fy < 0 || !doll.mask[fy * W + fx]) continue;
        const glove = moved && inBox(hand, fx, fy);
        raw.set(glove ? [200, 30, 40] : [0, 255, 0], (y * W + x) * 3);
      }
    }
    const input = await sharp(raw, { raw: { width: W, height: W, channels: 3 } }).png().toBuffer();
    // 手袋がドールの手をどれだけ覆うか、手袋のうちドールの外にはみ出す割合
    const fit = (r: ProcessResult) => {
      let handPixels = 0, covered = 0, glove = 0, outside = 0;
      for (let y = hand.y - 20; y < hand.y + hand.h + 20; y++) {
        for (let x = hand.x - 20; x < hand.x + hand.w + 20; x++) {
          const on = doll.mask[y * W + x] === 1 && inBox(hand, x, y);
          const g = alphaAt(r, x, y) >= 128;
          if (on) handPixels++;
          if (on && g) covered++;
          if (g) glove++;
          if (g && !doll.mask[y * W + x]) outside++;
        }
      }
      return { coverage: covered / handPixels, outside: outside / glove };
    };
    const plain = fit(await processGenerated(input, doll, { silhouetteColor: [0, 255, 0] }));
    const fixed = await processGenerated(input, doll, { silhouetteColor: [0, 255, 0], parts: Object.values(parts) });
    const better = fit(fixed);
    expect(plain.outside).toBeGreaterThan(0.08); // 直さなければ、はみ出す
    expect(better.coverage).toBeGreaterThan(0.95);
    expect(better.outside).toBeLessThan(0.03);
    const armShift = fixed.partShifts.find((s) => s.box === arm || (s.box.x === arm.x && s.box.y === arm.y))!;
    expect([armShift.dx, armShift.dy]).toEqual([-sx, -sy]);
  }, 60_000);

  it('作者のサンプルでも、部位ごとの直しは数 px 以内で、服の範囲はほとんど変わらない', async () => {
    const parts = Object.values(estimateBodyParts(doll.mask, doll.canvasW, doll.canvasH)!);
    for (const name of ['sample-green-set.webp', 'sample-green-dress.webp']) {
      const input = await read(name);
      const a = await processGenerated(input, doll);
      const b = await processGenerated(input, doll, { parts });
      expect(b.warnings).toEqual(a.warnings);
      for (const s of b.partShifts) expect(Math.hypot(s.dx, s.dy)).toBeLessThanOrEqual(12);
      const x = alphaBBox(a.rgba, 1024, 1024)!;
      const y = alphaBBox(b.rgba, 1024, 1024)!;
      expect(Math.abs(x.x - y.x) + Math.abs(x.y - y.y) + Math.abs(x.w - y.w) + Math.abs(x.h - y.h)).toBeLessThanOrEqual(16);
    }
  }, 90_000);
});

describe('頭に付く品目の位置合わせ（anchor）', () => {
  const GREEN = [0, 255, 0];
  const MAGENTA = [255, 0, 255];
  const GOLD = [230, 180, 60];
  const HEAD = { x: 460, y: 27, w: 107, h: 134 };
  const DRIFT = 18;

  // AI が、体はそのままで頭だけ右へ DRIFT px ずらして描いた髪型の画像
  async function driftedHair(): Promise<Buffer> {
    const W = doll.canvasW;
    const H = doll.canvasH;
    const rgb = Buffer.alloc(W * H * 3);
    const neck = HEAD.y + HEAD.h;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const body = y >= neck ? doll.mask[y * W + x] : x - DRIFT >= 0 ? doll.mask[y * W + x - DRIFT] : 0;
        // 髪: ずれた頭を囲む楕円。顔の下半分は見えている
        const cx = HEAD.x + HEAD.w / 2 + DRIFT;
        const cy = HEAD.y + HEAD.h * 0.45;
        const inHair = ((x - cx) / (HEAD.w * 0.7)) ** 2 + ((y - cy) / (HEAD.h * 0.62)) ** 2 <= 1;
        const face = body && y > HEAD.y + HEAD.h * 0.4 && y < neck;
        const color = inHair && !face ? GOLD : body ? GREEN : MAGENTA;
        rgb.set(color, (y * W + x) * 3);
      }
    }
    return sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  }
  const centerX = (r: ProcessResult) => {
    const box = alphaBBox(r.rgba, r.width, r.height)!;
    return box.x + box.w / 2;
  };

  it('体に合わせるだけだと髪が頭からずれ、頭を基準にすると頭の真上に来る', async () => {
    const image = await driftedHair();
    const parts = estimateBodyParts(doll.mask, doll.canvasW, doll.canvasH)!;
    const headCenter = HEAD.x + HEAD.w / 2;

    const plain = await processGenerated(image, doll, { silhouetteColor: [0, 255, 0], parts: Object.values(parts) });
    expect(plain.anchorShift).toBeNull();
    expect(Math.abs(centerX(plain) - headCenter)).toBeGreaterThan(10);

    const anchored = await processGenerated(image, doll, { silhouetteColor: [0, 255, 0], parts: Object.values(parts), anchor: HEAD });
    expect(anchored.anchorShift).not.toBeNull();
    expect(Math.abs(anchored.anchorShift!.dx + DRIFT)).toBeLessThanOrEqual(3);
    expect(Math.abs(anchored.anchorShift!.dy)).toBeLessThanOrEqual(3);
    expect(Math.abs(centerX(anchored) - headCenter)).toBeLessThanOrEqual(3);
    expect(anchored.partShifts).toEqual([]); // 部位ごとの直しはしない
  }, 60_000);

  it('ずれていない画像は動かさない', async () => {
    const r = await processGenerated(await read('sample-green-set.webp'), doll, { anchor: HEAD });
    expect(r.anchorShift).toBeNull();
    expect(r.warnings).toEqual([]);
  }, 30_000);
});
