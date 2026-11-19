// @vitest-environment node
/**
 * 拡大図に描かせる品目（髪・帽子・くつ・てぶくろ）の生成を、サンプルのドールと偽の画像 AI で確かめる
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import { estimateBodyParts } from '../../src/pipeline/bodyParts.ts';
import type { BodyParts } from '../../src/pipeline/bodyParts.ts';
import { frameTiles } from '../../src/pipeline/frames.ts';
import { chooseBackground, colorDistance } from '../../src/pipeline/keyColors.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import type { ManifestDoll } from '../../src/content/manifest.ts';
import type { ImageAi, TextAi } from './ai.ts';
import { Budget } from './budget.ts';
import { toTile } from './frame.ts';
import { generateCandidate, planItems } from './generate.ts';
import type { Candidate } from './generate.ts';
import { dollTemplateFromImage } from './processGenerated.ts';
import type { DollTemplate } from './processGenerated.ts';
import { pngToRgba } from './silhouette.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const DOLL_IMAGE = { file: 'doll-anime.webp', canvasW: 1024, canvasH: 1024, box: { x: 282, y: 27, w: 462, h: 978 } };
const category = (id: string) => ({ id, label: id, layer: 1, menuOrder: 0, overlap: false, movable: false });
const manifestDoll = { id: 'd', name: 'd', image: DOLL_IMAGE, categories: ['くつ', 'てぶくろ', 'ヘアスタイル', 'ぼうし'].map(category), items: [], backgrounds: [] } as ManifestDoll;
const text: TextAi = { json: async <T>() => ({ ok: true, reason: 'よい', fix: '' }) as T };

let doll: DollTemplate;
let parts: BodyParts;
let dir: string;
beforeAll(async () => {
  doll = await dollTemplateFromImage(await fs.readFile(path.join(FIXTURES, 'doll-anime.webp')), DOLL_IMAGE);
  parts = estimateBodyParts(doll.mask, doll.canvasW, doll.canvasH)!;
  dir = await fs.mkdtemp(path.join(import.meta.dirname, '../../node_modules/.tmp-frames-'));
});
afterAll(() => fs.rm(dir, { recursive: true, force: true }));

// paint: 渡された拡大図に、SVG を重ねて返す偽の画像 AI
async function run(categoryId: string, paint: (size: number) => string, colors = ['#7a3b1e']) {
  const calls: { prompt: string; images: Buffer[] }[] = [];
  const image: ImageAi = {
    async generate(input) {
      calls.push(input);
      const size = (await sharp(input.images[0]).metadata()).width!;
      return sharp(input.images[0]).composite([{ input: Buffer.from(paint(size)) }]).png().toBuffer();
    },
  };
  const candidate: Candidate = { item: { category: categoryId, name: 'てすと', description: 'A test item.', colors }, status: 'waiting', attempts: 0, warnings: [], notes: [] };
  await generateCandidate(
    { text, image, budget: new Budget(path.join(dir, `budget-${categoryId}.json`), { perDay: 9, perRun: 9 }), doll: manifestDoll, template: doll, data: { parts, regions: {} }, style: '' },
    candidate,
  );
  return { calls, candidate };
}
const svg = (size: number, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${body}</svg>`;
const pixel = async (png: Buffer, x: number, y: number): Promise<Rgb> => {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 3;
  return [data[i], data[i + 1], data[i + 2]];
};

describe('chooseBackground', () => {
  it('品目の色・肌・白のどれからも遠い、はっきりした色を選ぶ', () => {
    const skin: Rgb = [240, 200, 170];
    for (const item of [[0, 200, 60], [230, 40, 200], [40, 60, 230], [120, 80, 40]] as Rgb[]) {
      const bg = chooseBackground([item, skin, [255, 255, 255]]);
      for (const c of [item, skin, [255, 255, 255] as Rgb]) expect(colorDistance(bg, c)).toBeGreaterThan(150);
      expect(Math.max(...bg) - Math.min(...bg)).toBe(255);
    }
  });
});

describe('くつ（差し替え式）', () => {
  it('本物の脚の拡大図を 1 枚だけ渡し、足首から下を差し替える候補ができる', async () => {
    const [tile] = frameTiles('feet', parts, doll.canvasW, doll.canvasH);
    const feet = toTile(parts.feet, tile);
    const { calls, candidate } = await run('くつ', (size) =>
      svg(size, `<rect x="${feet.x - 20}" y="${feet.y - 60}" width="${feet.w + 40}" height="${feet.h + 80}" rx="30" fill="#7a3b1e"/>`),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].images).toHaveLength(1);
    const meta = await sharp(calls[0].images[0]).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 1024]);
    // 背景ははっきりした単色、脚は肌色（シルエットではない）
    const corner = await pixel(calls[0].images[0], 5, 5);
    expect(Math.max(...corner) - Math.min(...corner)).toBe(255);
    const shin = await pixel(calls[0].images[0], feet.x + Math.round(feet.w * 0.25), Math.round(feet.y * 0.3));
    expect(shin[0]).toBeGreaterThan(200);
    expect(shin[0]).toBeGreaterThan(shin[2]);
    expect(calls[0].prompt).toMatch(/lower legs and bare feet/);
    expect(calls[0].prompt).not.toMatch(/silhouette/);

    expect(candidate.notes).toEqual([]);
    expect(candidate.status).toBe('passed');
    expect(candidate.hide).toBeDefined();
    const item = await pngToRgba(candidate.png!);
    expect([item.width, item.height]).toEqual([doll.canvasW, doll.canvasH]);
    const box = alphaBBox(item.rgba, item.width, item.height)!;
    // 靴は足のあたりにあり、すねの上のほうには何も無い
    expect(box.y).toBeGreaterThan(parts.feet.y - 60);
    expect(box.y + box.h).toBeGreaterThanOrEqual(parts.feet.y + parts.feet.h);
    const hide = await pngToRgba(candidate.hide!);
    const hideBox = alphaBBox(hide.rgba, hide.width, hide.height)!;
    expect(hideBox.y).toBe(parts.feet.y);
  }, 60_000);
});

describe('てぶくろ（差し替え式）', () => {
  it('左右の腕を 1 枚に並べた拡大図を渡し、両手の候補ができる', async () => {
    const tiles = frameTiles('hands', parts, doll.canvasW, doll.canvasH);
    const hands = [toTile(parts.handLeft, tiles[0]), toTile(parts.handRight, tiles[1])];
    const { calls, candidate } = await run('てぶくろ', (size) =>
      svg(size, hands.map((h, i) => `<rect x="${i * 512 + h.x - 10}" y="${h.y - 10}" width="${h.w + 20}" height="${h.h + 20}" rx="20" fill="#7a3b1e"/>`).join('')),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].prompt).toMatch(/two panels/);
    expect(candidate.status).toBe('passed');
    const item = await pngToRgba(candidate.png!);
    const box = alphaBBox(item.rgba, item.width, item.height)!;
    // 左右の手の両方にかかる
    expect(box.x).toBeLessThan(parts.handLeft.x + parts.handLeft.w);
    expect(box.x + box.w).toBeGreaterThan(parts.handRight.x);
    expect(candidate.hide).toBeDefined();
  }, 60_000);
});

describe('ヘアスタイル（上半身の拡大図）', () => {
  it('上半身のシルエットの拡大図に描かせ、キャンバスの頭の位置に戻す', async () => {
    const [tile] = frameTiles('upper', parts, doll.canvasW, doll.canvasH);
    const head = toTile(parts.head, tile);
    const { calls, candidate } = await run(
      'ヘアスタイル',
      (size) => svg(size, `<ellipse cx="${head.x + head.w / 2}" cy="${head.y + head.h * 0.25}" rx="${head.w * 0.7}" ry="${head.h * 0.4}" fill="#3a2414"/>`),
      ['#3a2414'],
    );
    expect(calls).toHaveLength(1);
    const meta = await sharp(calls[0].images[0]).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 1024]);
    expect(calls[0].prompt).toMatch(/upper half/);
    // 頭の中心は、単色のシルエット
    const centre = await pixel(calls[0].images[0], head.x + Math.round(head.w / 2), head.y + Math.round(head.h / 2));
    expect(Math.max(...centre) - Math.min(...centre)).toBeGreaterThanOrEqual(255 - 128);
    expect(candidate.hide).toBeUndefined();
    const item = await pngToRgba(candidate.png!);
    expect([item.width, item.height]).toEqual([doll.canvasW, doll.canvasH]);
    const box = alphaBBox(item.rgba, item.width, item.height)!;
    const cx = box.x + box.w / 2;
    expect(Math.abs(cx - (parts.head.x + parts.head.w / 2))).toBeLessThan(6);
    expect(Math.abs(box.w - parts.head.w * 1.4)).toBeLessThan(10);
    expect(box.y).toBeLessThan(parts.head.y + parts.head.h * 0.2);
  }, 60_000);
});

describe('企画の指示', () => {
  it('靴は閉じた靴に限らない。髪は腰までにする', async () => {
    let prompt = '';
    const planner: TextAi = {
      json: async <T>(input: { prompt: string }) => {
        prompt = input.prompt;
        return { items: [{ category: 'くつ', name: 'くつ', description: 'Shoes.', colors: [] }] } as T;
      },
    };
    await planItems(planner, manifestDoll, { theme: 'うみ', count: 1, style: '' });
    expect(prompt).not.toMatch(/No sandals/);
    expect(prompt).toMatch(/no longer than the hips/);
  });
});
