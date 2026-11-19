// @vitest-environment node
/**
 * 顔の作り方（本物の頭の拡大図に描かせて、違いを取り出す）を、サンプルのドールで確かめる
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import { estimateBodyParts } from '../../src/pipeline/bodyParts.ts';
import type { BodyParts } from '../../src/pipeline/bodyParts.ts';
import type { ManifestDoll } from '../../src/content/manifest.ts';
import type { ImageAi, TextAi } from './ai.ts';
import { Budget } from './budget.ts';
import { generateCandidate } from './generate.ts';
import type { Candidate } from './generate.ts';
import { FACE_SIZE, faceCrop, isFaceCategory, processFace, renderHeadCloseup } from './processFace.ts';
import { dollTemplateFromImage } from './processGenerated.ts';
import type { DollTemplate } from './processGenerated.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');
const DOLL_IMAGE = { file: 'doll-anime.webp', canvasW: 1024, canvasH: 1024, box: { x: 282, y: 27, w: 462, h: 978 } };
const BG: [number, number, number] = [233, 230, 242];

let doll: DollTemplate;
let parts: BodyParts;
beforeAll(async () => {
  doll = await dollTemplateFromImage(await fs.readFile(path.join(FIXTURES, 'doll-anime.webp')), DOLL_IMAGE);
  parts = estimateBodyParts(doll.mask, doll.canvasW, doll.canvasH)!;
});

// 偽の画像生成: 渡された頭の拡大図に、目・口（不透明）とほお紅（半透明）を描く。
// 本物の AI と同じように、大きさを変え、少しずらし、絵全体を少し明るくし、圧縮のむらを付けて返す
async function paintFace(reference: Buffer, shift = { x: 7, y: -5 }): Promise<Buffer> {
  const n = FACE_SIZE;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}">
    <ellipse cx="${n * 0.43}" cy="${n * 0.45}" rx="${n * 0.035}" ry="${n * 0.045}" fill="#3a2a5a"/>
    <ellipse cx="${n * 0.57}" cy="${n * 0.45}" rx="${n * 0.035}" ry="${n * 0.045}" fill="#3a2a5a"/>
    <ellipse cx="${n * 0.5}" cy="${n * 0.58}" rx="${n * 0.04}" ry="${n * 0.015}" fill="#c8324b"/>
    <ellipse cx="${n * 0.39}" cy="${n * 0.53}" rx="${n * 0.04}" ry="${n * 0.025}" fill="#ff6a8a" fill-opacity="0.4"/>
    <ellipse cx="${n * 0.61}" cy="${n * 0.53}" rx="${n * 0.04}" ry="${n * 0.025}" fill="#ff6a8a" fill-opacity="0.4"/>
  </svg>`;
  const drawn = await sharp(reference).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
  const moved = await sharp({ create: { width: n, height: n, channels: 3, background: { r: BG[0], g: BG[1], b: BG[2] } } })
    .composite([{ input: drawn, left: shift.x, top: shift.y }])
    .png()
    .toBuffer();
  return sharp(moved).resize(1184, 1184).linear(1, 5).jpeg({ quality: 90 }).toBuffer();
}

describe('isFaceCategory', () => {
  it('顔・化粧は顔として扱い、髪・服は扱わない', () => {
    expect(isFaceCategory('かお')).toBe(true);
    expect(isFaceCategory('メイク')).toBe(true);
    expect(isFaceCategory('ヘアスタイル')).toBe(false);
    expect(isFaceCategory('かおまわりのヘア')).toBe(false);
    expect(isFaceCategory('ドレス')).toBe(false);
  });
});

describe('faceCrop', () => {
  it('頭を中心にした正方形で、キャンバスからはみ出さない', () => {
    const crop = faceCrop(parts.head, doll.canvasW, doll.canvasH);
    expect(crop.x).toBeGreaterThanOrEqual(0);
    expect(crop.y).toBeGreaterThanOrEqual(0);
    expect(crop.y + crop.size).toBeLessThanOrEqual(doll.canvasH);
    expect(crop.x).toBeLessThanOrEqual(parts.head.x);
    expect(crop.x + crop.size).toBeGreaterThanOrEqual(parts.head.x + parts.head.w);
    expect(crop.size).toBeGreaterThanOrEqual(parts.head.h);
  });
});

describe('processFace', () => {
  it('描き足した顔だけが残る。肌・輪郭・背景は残らず、緑も付かない', async () => {
    const crop = faceCrop(parts.head, doll.canvasW, doll.canvasH);
    const reference = await renderHeadCloseup(doll, crop, BG);
    const r = await processFace(await paintFace(reference), reference, doll, crop, BG);
    expect(r.warnings).toEqual([]);
    expect(r.width).toBe(doll.canvasW);
    const k = crop.size / FACE_SIZE;
    const at = (fx: number, fy: number) => {
      const i = ((crop.y + Math.round(FACE_SIZE * fy * k)) * r.width + crop.x + Math.round(FACE_SIZE * fx * k)) * 4;
      return Array.from(r.rgba.slice(i, i + 4));
    };
    expect(at(0.43, 0.45)[3]).toBeGreaterThan(230); // 目
    expect(at(0.39, 0.53)[3]).toBeGreaterThan(30); // ほお紅
    expect(at(0.5, 0.3)[3]).toBe(0); // ひたい（肌のまま）
    expect(at(0.05, 0.05)[3]).toBe(0); // 背景
    // 顔のあたり（目・口・ほお）の外には、何も残らない
    const box = alphaBBox(r.rgba, r.width, r.height)!;
    const inFace = (v: number, from: number, to: number, origin: number) => v >= origin + FACE_SIZE * from * k - 3 && v <= origin + FACE_SIZE * to * k + 3;
    expect(inFace(box.x, 0.34, 0.66, crop.x) && inFace(box.x + box.w, 0.34, 0.66, crop.x)).toBe(true);
    expect(inFace(box.y, 0.39, 0.61, crop.y) && inFace(box.y + box.h, 0.39, 0.61, crop.y)).toBe(true);
    // 緑がかった画素（旧方式の色残り）が無い
    let green = 0;
    for (let i = 0; i < r.rgba.length; i += 4) if (r.rgba[i + 3] >= 64 && r.rgba[i + 1] - Math.max(r.rgba[i], r.rgba[i + 2]) > 30) green++;
    expect(green).toBe(0);
  }, 60_000);

  it('何も描かれていなければ「顔が見つかりません」', async () => {
    const crop = faceCrop(parts.head, doll.canvasW, doll.canvasH);
    const reference = await renderHeadCloseup(doll, crop, BG);
    const r = await processFace(reference, reference, doll, crop, BG);
    expect(r.warnings.map((w) => w.code)).toEqual(['empty']);
  }, 60_000);

  it('頭ごと描き直されたら、警告する', async () => {
    const crop = faceCrop(parts.head, doll.canvasW, doll.canvasH);
    const reference = await renderHeadCloseup(doll, crop, BG);
    const repainted = await sharp({ create: { width: FACE_SIZE, height: FACE_SIZE, channels: 3, background: '#7a4a2a' } }).png().toBuffer();
    const r = await processFace(repainted, reference, doll, crop, BG);
    expect(r.warnings.map((w) => w.code)).toEqual(['repainted']);
  }, 60_000);
});

describe('generateCandidate（顔）', () => {
  it('顔のカテゴリは、シルエットではなく本物の頭の拡大図を AI に渡す', async () => {
    const calls: { prompt: string; images: Buffer[] }[] = [];
    const image: ImageAi = {
      async generate(input) {
        calls.push(input);
        return paintFace(input.images[0]);
      },
    };
    const text: TextAi = { json: async <T>() => ({ ok: true, reason: 'よい' }) as T };
    const dir = await fs.mkdtemp(path.join(import.meta.dirname, '../../node_modules/.tmp-face-'));
    const manifestDoll = { id: 'd', name: 'd', image: DOLL_IMAGE, categories: [{ id: 'かお', label: 'かお', layer: 6, menuOrder: 0, overlap: false, movable: false }], items: [], backgrounds: [] } as ManifestDoll;
    const candidate: Candidate = { item: { category: 'かお', name: 'きらきらおめめ', description: 'Big sparkling violet eyes and a small smile.', colors: ['#6a5acd'] }, status: 'waiting', attempts: 0, warnings: [], notes: [] };
    try {
      await generateCandidate(
        { text, image, budget: new Budget(path.join(dir, 'budget.json'), { perDay: 5, perRun: 5 }), doll: manifestDoll, template: doll, data: { parts, regions: { かお: null } }, style: '', closeup: null },
        candidate,
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
    expect(candidate.notes).toEqual([]);
    expect(candidate.status).toBe('passed');
    expect(calls).toHaveLength(1);
    expect(calls[0].images).toHaveLength(1);
    expect(calls[0].prompt).toMatch(/blank head/);
    expect(calls[0].prompt).not.toMatch(/silhouette|#00FF00/);
    // 渡した画像は拡大図（肌色がある。単色のシルエットではない）
    const { data } = await sharp(calls[0].images[0]).resize(8, 8).raw().toBuffer({ resolveWithObject: true });
    const centre = Array.from(data.subarray((4 * 8 + 4) * 3, (4 * 8 + 4) * 3 + 3));
    expect(centre[0]).toBeGreaterThan(centre[2]); // 肌色（赤 > 青）
    expect(candidate.shape).toBeUndefined();
    expect(candidate.png).toBeDefined();
  }, 60_000);
});
