// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentStore } from '../content/manifestEdit.ts';
import { dollPrompt } from './dollPrompt.ts';
import { importDoll } from './makeDoll.ts';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'make-doll-'));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('dollPrompt', () => {
  it('作りやすい姿勢の条件と、背景色が入る', () => {
    const prompt = dollPrompt([0, 255, 0]);
    expect(prompt).toMatch(/5\.5 heads/);
    expect(prompt).toMatch(/#00FF00/);
    expect(prompt).toMatch(/turned outward/);
    expect(prompt).toMatch(/no face/);
  });
});

describe('importDoll', () => {
  it('緑の背景のドールを切り抜いて登録し、2 倍の元画像を studio/masters に残す。カテゴリは写し元と同じ', async () => {
    const store = new ContentStore(dir);
    await store.init();
    const blank = await sharp({ create: { width: 400, height: 800, channels: 4, background: { r: 240, g: 200, b: 170, alpha: 1 } } }).png().toBuffer();
    const first = await store.addDoll({ name: 'もと', data: await sharp({ create: { width: 500, height: 900, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: blank }]).png().toBuffer() });
    await store.createCategory(first.id, { id: 'とくべつ', label: 'とくべつ', layer: 5, menuOrder: 20, overlap: false, movable: false });

    const generated = await sharp(path.join(import.meta.dirname, '../../docs/superpowers/specs/2026-11-19-spike/doll_new1.webp')).png().toBuffer();
    const doll = await importDoll(dir, 'あたらしい', generated, first.id);
    const manifest = await store.read();
    expect(manifest.dolls.map((d) => d.name)).toEqual(['もと', 'あたらしい']);
    expect(doll.categories.map((c) => c.id)).toEqual(manifest.dolls[0].categories.map((c) => c.id));
    expect(doll.categories.some((c) => c.id === 'とくべつ')).toBe(true);
    expect(doll.items).toEqual([]);
    expect(doll.image.box.h).toBeGreaterThan(960);

    // 配信用の画像に、緑が残っていない
    const { data, info } = await sharp(path.join(dir, doll.image.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let opaque = 0, green = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      opaque++;
      if (data[i + 1] - Math.max(data[i], data[i + 2]) > 60) green++;
    }
    expect(opaque).toBeGreaterThan(info.width * info.height * 0.2);
    expect(green / opaque).toBeLessThan(0.002);

    const master = await sharp(path.join(dir, 'studio', 'masters', `${path.basename(doll.image.file, path.extname(doll.image.file))}.webp`)).metadata();
    expect([master.width, master.height]).toEqual([doll.image.box.w * 2, doll.image.box.h * 2]);
    expect(master.hasAlpha).toBe(true);
  }, 60_000);

  it('背景が単色でない画像は断る', async () => {
    const store = new ContentStore(dir);
    await store.init();
    const noise = await sharp(Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * 7919) % 256)), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
    await expect(importDoll(dir, 'だめ', noise)).rejects.toThrow(/背景/);
  });
});
