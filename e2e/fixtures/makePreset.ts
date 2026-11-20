/**
 * テスト用の小さなプリセット（フォルダ）を生成する
 * 画像はすべて 1024x1024 のPNG
 * （取り込み処理が右下160pxを消すため、絵柄はその範囲を避けて置く）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SIZE = 1024;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
  color: string;
}

async function png(rect: Rect | null, background?: string): Promise<Buffer> {
  const base = sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: background ?? { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
  if (!rect) return base.png().toBuffer();
  const patch = await sharp({
    create: { width: rect.width, height: rect.height, channels: 4, background: rect.color },
  })
    .png()
    .toBuffer();
  return base.composite([{ input: patch, left: rect.left, top: rect.top }]).png().toBuffer();
}

// テスト用プリセットの中身（パス → PNG）
async function presetFiles(): Promise<Array<[string, Buffer]>> {
  return [
    // ドール: 中央に 384x800 の肌色
    ['doll-test/dolls/doll.png', await png({ left: 320, top: 112, width: 384, height: 800, color: '#ffe0c0' })],
    // トップス: y=240〜520
    ['doll-test/clothing/04_1_トップス/red.png', await png({ left: 292, top: 240, width: 440, height: 280, color: '#ff0000' })],
    ['doll-test/clothing/04_1_トップス/blue.png', await png({ left: 292, top: 240, width: 440, height: 280, color: '#0000ff' })],
    // ボトムス: y=520〜800
    ['doll-test/clothing/03_2_ボトムス/green.png', await png({ left: 292, top: 520, width: 440, height: 280, color: '#00a000' })],
    // くつ: 足もと（y=850〜911）の茶色。まん中（x=480〜543、y=855〜894）があいている（靴の開き）。
    // 開きに見える肌（under）と、靴の外の足を隠す所（hide）は、globalSetup が一覧に足す
    ['doll-test/clothing/02_7_くつ/shoe.png', await shoePng()],
    // ソックス: 脚の下のほう（x=340〜683、y=700〜911）の水色
    ['doll-test/clothing/01_8_ソックス/sock.png', await png({ left: 340, top: 700, width: 344, height: 212, color: '#40e0e0' })],
    // 背景: 全面
    ['doll-test/backgrounds/bg.png', await png(null, '#ffff80')],
  ];
}

async function shoePng(): Promise<Buffer> {
  const base = await png({ left: 420, top: 850, width: 185, height: 62, color: '#804000' });
  const { data, info } = await sharp(base).raw().toBuffer({ resolveWithObject: true });
  for (let y = 855; y < 895; y++) for (let x = 480; x < 544; x++) data[(y * info.width + x) * 4 + 3] = 0;
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

export { png as makePng };

// フォルダとして書き出す（移行スクリプトの入力）
export async function writePresetDir(dir: string): Promise<void> {
  for (const [rel, data] of await presetFiles()) {
    const file = path.join(dir, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }
}
