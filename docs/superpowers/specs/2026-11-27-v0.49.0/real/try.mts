/**
 * 確かめの道具（捨てる前提）: サーバーと同じ作り（planBackgrounds → generateBackground → 1024 の WebP）で、本物の背景を作り、ドールを重ねて並べる。
 *   リポジトリの上で: NODE_USE_ENV_PROXY=1 npx tsx docs/superpowers/specs/2026-11-27-v0.49.0/real/try.mts <出力フォルダ>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { createGemini, createGeminiText, GEMINI_IMAGE_MODEL, GEMINI_TEXT_MODEL } from '../../../../../tools/studio/ai.ts';
import { generateBackground, planBackgrounds } from '../../../../../tools/studio/generate.ts';
import type { BackgroundCandidate } from '../../../../../tools/studio/generate.ts';
import { findStyle } from '../../../../../src/studio/stylePresets.ts';

const OUT = process.argv[2];
const THEMES = ['うみ', 'おひめさまの おしろ', 'ゆきの もり'];
const text = createGeminiText('dummy', GEMINI_TEXT_MODEL);
const image = createGemini('dummy', GEMINI_IMAGE_MODEL, fetch, '1K');
let images = 0;
const manifest = JSON.parse(readFileSync('../DressUpGame-content/manifest.json', 'utf8'));
const doll = manifest.dolls.find((d: { name: string }) => d.name === 'おんなのこ');
const dollPng = await sharp(`../DressUpGame-content/${doll.image.file}`).resize({ height: 900 }).png().toBuffer();
const record: unknown[] = [];
for (const [i, theme] of THEMES.entries()) {
  const [plan] = await planBackgrounds(text, { theme, count: 1, existing: [] });
  const scene: BackgroundCandidate = { item: plan, status: 'waiting', attempts: 0, notes: [] };
  const t = Date.now();
  await generateBackground({ text, image, budget: { spend: async () => { images++; } }, style: findStyle('anime').prompt }, scene);
  record.push({ theme, name: plan.name, description: scene.item.description, status: scene.status, notes: scene.notes, attempts: scene.attempts, seconds: Math.round((Date.now() - t) / 1000) });
  if (!scene.png) continue;
  const bg = await sharp(scene.png).resize(1024, 1024, { fit: 'inside' }).webp({ quality: 85 }).toBuffer();
  writeFileSync(`${OUT}/${i + 1}.webp`, bg);
  const meta = await sharp(dollPng).metadata();
  writeFileSync(`${OUT}/${i + 1}-doll.jpg`, await sharp(bg).composite([{ input: dollPng, left: Math.round((1024 - meta.width!) / 2), top: 1024 - 900 - 40 }]).jpeg({ quality: 88 }).toBuffer());
}
writeFileSync(`${OUT}/record.json`, JSON.stringify({ images, record }, null, 2));
console.log(JSON.stringify({ images, record }, null, 1));
