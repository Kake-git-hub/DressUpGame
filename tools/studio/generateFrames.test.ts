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
    // この靴は足をまるごとおおうので、隠す所は無いか、あっても足首の線より下だけ
    const hideBox = alphaBBox(hide.rgba, hide.width, hide.height);
    expect(hideBox === null || hideBox.y >= parts.feet.y).toBe(true);
  }, 60_000);
});

describe('てぶくろ（差し替え式）', () => {
  it('左右の腕を 1 枚に並べた拡大図を渡し、両手の候補ができる', async () => {
    const tiles = frameTiles('hands', parts, doll.canvasW, doll.canvasH);
    const hands = [toTile(parts.handLeft, tiles[0]), toTile(parts.handRight, tiles[1])];
    const { calls, candidate } = await run('てぶくろ', (size) =>
      svg(size, hands.map((h, i) => `<rect x="${tiles[i].to.x + h.x - 10}" y="${h.y - 10}" width="${h.w + 20}" height="${h.h + 20}" rx="20" fill="#7a3b1e"/>`).join('')),
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

describe('ヘアスタイル（本物のドールの上半身に描かせる）', () => {
  it('本物の上半身の拡大図（顔なし）を 1 枚渡し、髪の全体と前の範囲ができる', async () => {
    const [tile] = frameTiles('hair', parts, doll.canvasW, doll.canvasH);
    const head = toTile(parts.head, tile);
    const inspected: Buffer[] = [];
    const inspector: TextAi = {
      json: async <T>(input: { images?: Buffer[] }) => {
        if (input.images?.[0]) inspected.push(input.images[0]);
        return { ok: true, reason: 'よい', fix: '' } as T;
      },
    };
    const calls: { prompt: string; images: Buffer[] }[] = [];
    const image: ImageAi = {
      async generate(input) {
        calls.push(input);
        const size = (await sharp(input.images[0]).metadata()).width!;
        // 頭の上半分をおおい、頭の左右にもはみ出す髪
        const hair = svg(size, `<ellipse cx="${head.x + head.w / 2}" cy="${head.y + head.h * 0.25}" rx="${head.w * 0.7}" ry="${head.h * 0.4}" fill="#3a2414"/>`);
        return sharp(input.images[0]).composite([{ input: Buffer.from(hair) }]).png().toBuffer();
      },
    };
    const candidate: Candidate = { item: { category: 'ヘアスタイル', name: 'てすと', description: 'Short dark brown hair.', colors: ['#3a2414'] }, status: 'waiting', attempts: 0, warnings: [], notes: [] };
    const budget = new Budget(path.join(dir, 'budget-hair.json'), { perDay: 9, perRun: 9 });
    await generateCandidate({ text: inspector, image, budget, doll: manifestDoll, template: doll, data: { parts, regions: {} }, style: '' }, candidate);

    expect(calls).toHaveLength(1);
    expect(await budget.usedToday()).toBe(1);
    expect(calls[0].images).toHaveLength(1);
    const meta = await sharp(calls[0].images[0]).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 1024]);
    expect(calls[0].prompt).toMatch(/upper half/);
    expect(calls[0].prompt).toMatch(/blank face/);
    expect(calls[0].prompt).not.toMatch(/silhouette/);
    // 頭の中心は、本物のドールの肌の色（単色の人形型ではない）。背景は、はっきりした単色
    const centre = await pixel(calls[0].images[0], head.x + Math.round(head.w / 2), head.y + Math.round(head.h / 2));
    expect(centre[0]).toBeGreaterThan(200);
    expect(centre[0]).toBeGreaterThan(centre[2]);
    const corner = await pixel(calls[0].images[0], 5, 5);
    expect(Math.max(...corner) - Math.min(...corner)).toBe(255);

    expect(candidate.notes).toEqual([]);
    expect(candidate.status).toBe('passed');
    expect(candidate.front).toBeDefined();
    expect(candidate.hide).toBeUndefined();
    expect(candidate.under).toBeUndefined();
    expect(candidate.shape).toBeUndefined();
    const item = await pngToRgba(candidate.png!);
    expect([item.width, item.height]).toEqual([doll.canvasW, doll.canvasH]);
    const box = alphaBBox(item.rgba, item.width, item.height)!;
    const cx = box.x + box.w / 2;
    expect(Math.abs(cx - (parts.head.x + parts.head.w / 2))).toBeLessThan(6);
    expect(Math.abs(box.w - parts.head.w * 1.4)).toBeLessThan(10);
    expect(box.y).toBeLessThan(parts.head.y + parts.head.h * 0.2);
    // 前の範囲は、髪のある所だけ
    const front = await pngToRgba(candidate.front!);
    let frontPixels = 0;
    for (let p = 0; p < front.width * front.height; p++) {
      if (front.rgba[p * 4 + 3] < 128) continue;
      frontPixels++;
      expect(item.rgba[p * 4 + 3]).toBeGreaterThan(0);
    }
    expect(frontPixels).toBeGreaterThan(500);
    // 見た目の検品には、ドールに着せた絵（後ろ髪 → ドール → 前髪）を渡す: 頭の上は髪の色、顔は肌の色
    expect(inspected).toHaveLength(1);
    const shown = await sharp(inspected[0]).resize(doll.canvasW, doll.canvasH).png().toBuffer();
    const top = await pixel(shown, Math.round(parts.head.x + parts.head.w / 2), Math.round(parts.head.y + parts.head.h * 0.15));
    expect(top[0]).toBeLessThan(110);
    const face = await pixel(shown, Math.round(parts.head.x + parts.head.w / 2), Math.round(parts.head.y + parts.head.h * 0.75));
    expect(face[0]).toBeGreaterThan(200);
  }, 60_000);

  it('うしろがみのカテゴリの品目は、画像を作らずに断る（髪型と一緒にできるため）', async () => {
    const withBack = { ...manifestDoll, categories: [...manifestDoll.categories, category('うしろがみ')] } as ManifestDoll;
    let calls = 0;
    const image: ImageAi = { generate: async () => { calls++; throw new Error('呼ばれないはず'); } };
    const candidate: Candidate = { item: { category: 'うしろがみ', name: 'てすと', description: 'Long back hair.', colors: [] }, status: 'waiting', attempts: 0, warnings: [], notes: [] };
    const budget = new Budget(path.join(dir, 'budget-back.json'), { perDay: 9, perRun: 9 });
    await generateCandidate({ text, image, budget, doll: withBack, template: doll, data: { parts, regions: {} }, style: '' }, candidate);
    expect(candidate.status).toBe('failed');
    expect(candidate.notes.join('')).toMatch(/髪型と一緒に作られます/);
    expect(calls).toBe(0);
    expect(await budget.usedToday()).toBe(0);
  });
});

describe('くつ（靴・肌・隠す所）', () => {
  it('靴の開きに見える肌は、別の絵（肌）として候補に付く', async () => {
    const [tile] = frameTiles('feet', parts, doll.canvasW, doll.canvasH);
    const feet = toTile(parts.feet, tile);
    const image: ImageAi = {
      async generate(input) {
        const size = (await sharp(input.images[0]).metadata()).width!;
        // 足を、茶色の靴に描き替える。まん中に、脚と同じ肌の色の開き
        const skin = await pixel(input.images[0], feet.x + Math.round(feet.w * 0.25), Math.round(feet.y * 0.3));
        const shoe = svg(size, `<rect x="${feet.x - 20}" y="${feet.y - 4}" width="${feet.w + 40}" height="${feet.h + 20}" rx="30" fill="#7a3b1e"/>
          <rect x="${feet.x + feet.w * 0.3}" y="${feet.y - 4}" width="${feet.w * 0.4}" height="${feet.h * 0.5}" fill="rgb(${skin.join(',')})"/>`);
        return sharp(input.images[0]).composite([{ input: Buffer.from(shoe) }]).png().toBuffer();
      },
    };
    const candidate: Candidate = { item: { category: 'くつ', name: 'てすと', description: 'Brown pumps.', colors: ['#7a3b1e'] }, status: 'waiting', attempts: 0, warnings: [], notes: [] };
    await generateCandidate({ text, image, budget: new Budget(path.join(dir, 'budget-pumps.json'), { perDay: 9, perRun: 9 }), doll: manifestDoll, template: doll, data: { parts, regions: {} }, style: '' }, candidate);
    expect(candidate.status).toBe('passed');
    expect(candidate.hide).toBeDefined();
    expect(candidate.under).toBeDefined();
    const under = await pngToRgba(candidate.under!);
    const box = alphaBBox(under.rgba, under.width, under.height)!;
    expect(box.y).toBeGreaterThanOrEqual(parts.feet.y);
    expect(box.x).toBeGreaterThan(parts.feet.x);
    expect(box.x + box.w).toBeLessThan(parts.feet.x + parts.feet.w);
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
    expect(prompt).toMatch(/must not be skin-coloured/);
  });

  it('うしろがみのカテゴリは、作れるカテゴリに入れない。髪は、前髪だけにしない', async () => {
    let prompt = '';
    const planner: TextAi = {
      json: async <T>(input: { prompt: string }) => {
        prompt = input.prompt;
        return { items: [{ category: 'ヘアスタイル', name: 'かみ', description: 'Hair.', colors: [] }, { category: 'うしろがみ', name: 'うしろ', description: 'Back hair.', colors: [] }] } as T;
      },
    };
    const withBack = { ...manifestDoll, categories: [...manifestDoll.categories, category('うしろがみ')] } as ManifestDoll;
    const items = await planItems(planner, withBack, { theme: 'うみ', count: 2, style: '' });
    expect(prompt).not.toMatch(/- うしろがみ/);
    expect(prompt).not.toMatch(/front hair only/i);
    expect(items.map((i) => i.category)).toEqual(['ヘアスタイル']);
  });
});
