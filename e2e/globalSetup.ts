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
