/**
 * E2E の準備: テスト用プリセットを配信用の形に変換して、ビルド済みの dist に置く。
 * アプリは /DressUpGame/?content=e2e-content/ で、この素材を読む。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildContent } from '../tools/content/buildContent.ts';
import { writePresetDir } from './fixtures/makePreset.ts';

export default async function globalSetup(): Promise<void> {
  const presetDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dressup-e2e-preset-'));
  try {
    await writePresetDir(presetDir);
    await buildContent(presetDir, path.resolve('dist/e2e-content'));
  } finally {
    await fs.rm(presetDir, { recursive: true, force: true });
  }
}
