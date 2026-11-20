/**
 * E2E の準備: テスト用プリセットを配信用の形に変換して、ビルド済みの dist に置く。
 * アプリは /DressUpGame/?content=e2e-content/ で、この素材を読む。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { buildContent } from '../tools/content/buildContent.ts';
import { writePresetDir } from './fixtures/makePreset.ts';

export default async function globalSetup(): Promise<void> {
  const presetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dressup-e2e-preset-'));
  try {
    await writePresetDir(presetDir);
    const out = path.resolve('dist/e2e-content');
    await buildContent(presetDir, out);
    await addHide(out);
    await addBack(out);
    await addShoeLayers(out);
    await addSet(out);
  } finally {
    await fs.rm(presetDir, { recursive: true, force: true });
  }
}

// ボトムス（green）に「着ているあいだ、ドールのすそ（y=820〜900）を隠す」を付ける
async function addHide(dir: string): Promise<void> {
  const box = { x: 320, y: 820, w: 384, h: 80 };
  const mask = await sharp({ create: { width: box.w, height: box.h, channels: 4, background: '#ffffff' } }).webp({ lossless: true }).toBuffer();
  await fs.writeFile(path.join(dir, 'files', 'e2e-hide.webp'), mask);
  const file = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as { dolls: { items: { name: string; hide?: unknown }[] }[] };
  const green = manifest.dolls[0].items.find((i) => i.name === 'green');
  if (!green) throw new Error('e2e: green が見つかりません');
  green.hide = { file: 'files/e2e-hide.webp', canvasW: 1024, canvasH: 1024, box };
  await fs.writeFile(file, JSON.stringify(manifest, null, 1));
}

// くつ（shoe）に、靴の開きに見える肌（under、ピンク）と、靴の外の足を隠す所（hide）を付ける。
// 隠す所は、足もと（x=330〜694、y=850〜911）のうち、靴と肌のある所（x=420〜604）を除いた左右
async function addShoeLayers(dir: string): Promise<void> {
  const underBox = { x: 470, y: 852, w: 85, h: 49 };
  const under = await sharp({ create: { width: underBox.w, height: underBox.h, channels: 4, background: '#ff80c0' } }).webp({ lossless: true }).toBuffer();
  const hideBox = { x: 330, y: 850, w: 365, h: 62 };
  const { data, info } = await sharp({ create: { width: hideBox.w, height: hideBox.h, channels: 4, background: '#ffffff' } }).raw().toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y++) for (let x = 420 - hideBox.x; x < 605 - hideBox.x; x++) data[(y * info.width + x) * 4 + 3] = 0;
  const hide = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).webp({ lossless: true }).toBuffer();
  await fs.writeFile(path.join(dir, 'files', 'e2e-under.webp'), under);
  await fs.writeFile(path.join(dir, 'files', 'e2e-shoe-hide.webp'), hide);
  const file = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as { dolls: { items: { name: string; under?: unknown; hide?: unknown }[] }[] };
  const shoe = manifest.dolls[0].items.find((i) => i.name === 'shoe');
  if (!shoe) throw new Error('e2e: shoe が見つかりません');
  shoe.under = { file: 'files/e2e-under.webp', canvasW: 1024, canvasH: 1024, box: underBox };
  shoe.hide = { file: 'files/e2e-shoe-hide.webp', canvasW: 1024, canvasH: 1024, box: hideBox };
  await fs.writeFile(file, JSON.stringify(manifest, null, 1));
}

// トップス（blue）に「ドールの後ろに描く分」を付ける（髪の、うしろがみと同じ仕組み）。
// むらさきで、トップスより横に広い（x=200〜824）ので、左右にはみ出して見える
async function addBack(dir: string): Promise<void> {
  const box = { x: 200, y: 240, w: 624, h: 280 };
  const image = await sharp({ create: { width: box.w, height: box.h, channels: 4, background: '#8000ff' } }).webp({ lossless: true }).toBuffer();
  await fs.writeFile(path.join(dir, 'files', 'e2e-back.webp'), image);
  const file = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as { dolls: { items: { name: string; back?: unknown }[] }[] };
  const blue = manifest.dolls[0].items.find((i) => i.name === 'blue');
  if (!blue) throw new Error('e2e: blue が見つかりません');
  blue.back = { file: 'files/e2e-back.webp', canvasW: 1024, canvasH: 1024, box };
  await fs.writeFile(file, JSON.stringify(manifest, null, 1));
}

// セット「あかみどり」: トップス（red）とボトムス（green）
async function addSet(dir: string): Promise<void> {
  const file = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(file, 'utf8')) as { dolls: { id: string; sets?: { id: string; name: string }[]; items: { name: string; set?: string }[] }[] };
  const doll = manifest.dolls[0];
  const set = { id: `${doll.id}/セット/あかみどり`, name: 'あかみどり' };
  doll.sets = [set];
  for (const name of ['red', 'green']) {
    const item = doll.items.find((i) => i.name === name);
    if (!item) throw new Error(`e2e: ${name} が見つかりません`);
    item.set = set.id;
  }
  await fs.writeFile(file, JSON.stringify(manifest, null, 1));
}
