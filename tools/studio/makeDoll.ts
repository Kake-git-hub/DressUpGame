/**
 * ドールづくりの道具（コマンド）
 *
 *   候補を作る:  npx tsx tools/studio/makeDoll.ts generate <絵柄の見本の画像> <出力フォルダ> [枚数=4] [girl|boy]
 *               （boy は、見本のドールと同じ姿勢のまま男の子にする。見本には、作りやすい姿勢のドールを渡す）
 *   取り込む:    npx tsx tools/studio/makeDoll.ts import <候補の画像> <素材フォルダ> <名前> [カテゴリを写すドールの ID]
 *   差し替える:  npx tsx tools/studio/makeDoll.ts replace <新しい絵> <素材フォルダ> <ドールの ID> <いまのドールのもとの絵>
 *               （下着だけを変えたときなど。いまのドールと同じ位置合わせで置くので、服はそのまま使える。
 *                 新しい絵は、いまのドールのもとの絵を見本にして、同じ姿勢・大きさで作ること）
 *
 * 候補は、単色の背景に立つドール（dollPrompt の条件）。取り込みでは、背景を抜いて素材フォルダに登録し、
 * 拡大図のもとにする 2 倍の画像を studio/masters/ に残す。
 * 生成には GEMINI_API_KEY が要る（クラウド環境では NODE_USE_ENV_PROXY=1 と仮のキー）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { cutOutClothing } from '../../src/pipeline/cutout.ts';
import { cleanKeyEdge } from '../../src/pipeline/edgeClean.ts';
import type { ManifestDoll } from '../../src/content/manifest.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import { encodeCutout } from '../content/encode.ts';
import { ContentError, ContentStore } from '../content/manifestEdit.ts';
import { createAiFromEnv } from './ai.ts';
import { dollPrompt } from './dollPrompt.ts';

export const DOLL_BACKGROUND: Rgb = [0, 255, 0];
const MASTER_SCALE = 2;

// 画像のふち（1 px）の色がそろっていれば、その色を返す。そろっていなければ null
function borderColor(data: Buffer, width: number, height: number): Rgb | null {
  const samples: number[][] = [[], [], []];
  const add = (x: number, y: number) => {
    for (let c = 0; c < 3; c++) samples[c].push(data[(y * width + x) * 4 + c]);
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    add(0, y);
    add(width - 1, y);
  }
  const median = samples.map((v) => [...v].sort((a, b) => a - b)[v.length >> 1]);
  let off = 0;
  for (let i = 0; i < samples[0].length; i++) {
    if (Math.abs(samples[0][i] - median[0]) + Math.abs(samples[1][i] - median[1]) + Math.abs(samples[2][i] - median[2]) > 60) off++;
  }
  return off > samples[0].length * 0.05 ? null : (median as Rgb);
}

// 輪郭線から背景色の混ざりを取る幅（幅 1024 の絵で 3 px。絵の幅に合わせる）
export const outlineReach = (width: number): number => Math.max(1, Math.round((3 * width) / 1024));

// 単色の背景を抜いた PNG（元の大きさ）。輪郭線に混ざった背景色も取る（形は変えない）
export async function cutOutDoll(image: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(image).removeAlpha().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const background = borderColor(data, info.width, info.height);
  if (!background) throw new ContentError('背景が単色ではないようです。単色の背景に立つドールの画像を選んでください');
  const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  cutOutClothing(rgba, info.width, info.height, { background, silhouette: null });
  cleanKeyEdge(rgba, info.width, info.height, background, outlineReach(info.width));
  return sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

// 候補の画像を素材フォルダに登録する。copyFrom があれば、そのドールのカテゴリを写す
export async function importDoll(contentDir: string, name: string, image: Buffer, copyFrom?: string): Promise<ManifestDoll> {
  const store = new ContentStore(contentDir);
  const cut = await cutOutDoll(image);
  let categories;
  if (copyFrom) {
    const source = (await store.read()).dolls.find((d) => d.id === copyFrom);
    if (!source) throw new ContentError(`ドール「${copyFrom}」がありません`);
    categories = source.categories;
  }
  const doll = await store.addDoll({ name, data: cut, categories });
  // 拡大図のもと: 配信用の画像と同じ範囲を、整数倍の大きさで残す
  const { w, h } = doll.image.box;
  const masters = path.join(contentDir, 'studio', 'masters');
  await fs.mkdir(masters, { recursive: true });
  await sharp(cut)
    .trim({ threshold: 0 })
    .resize(w * MASTER_SCALE, h * MASTER_SCALE, { fit: 'fill', kernel: 'lanczos3' })
    .webp({ quality: 95, alphaQuality: 100 })
    .toFile(path.join(masters, `${path.basename(doll.image.file, path.extname(doll.image.file))}.webp`));
  return doll;
}

// 透明でない所の外接矩形（切り抜いた PNG）
async function opaqueBox(cut: Buffer): Promise<{ left: number; top: number; width: number; height: number; canvasW: number; canvasH: number }> {
  const { data, info } = await sharp(cut).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width;
  let y0 = info.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new ContentError('画像が全部透明です');
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, canvasW: info.width, canvasH: info.height };
}

/**
 * いまあるドールの絵だけを差し替える（ID・カテゴリ・服はそのまま）。
 * image: 新しい絵。previous: いまのドールのもとの絵（どちらも単色の背景、同じ大きさ）。
 * 新しい絵は、いまのドールと同じ位置合わせ（もとの絵 → キャンバス）で置く。体の位置が同じなら、服はそのまま合う
 */
export async function replaceDollImage(contentDir: string, dollId: string, image: Buffer, previous: Buffer): Promise<ManifestDoll> {
  const store = new ContentStore(contentDir);
  const current = (await store.read()).dolls.find((d) => d.id === dollId);
  if (!current) throw new ContentError(`ドール「${dollId}」がありません`, 404);
  const cut = await cutOutDoll(image);
  const from = await opaqueBox(await cutOutDoll(previous));
  const to = await opaqueBox(cut);
  if (to.canvasW !== from.canvasW || to.canvasH !== from.canvasH) throw new ContentError('新しい絵と、いまのドールのもとの絵の大きさが違います');
  // もとの絵 → キャンバス: いまのドールの外接矩形が、いまの box に重なる
  const { box, canvasW, canvasH } = current.image;
  const sx = box.w / from.width;
  const sy = box.h / from.height;
  const placed = (scale: number) => ({
    left: Math.round((box.x + (to.left - from.left) * sx) * scale),
    top: Math.round((box.y + (to.top - from.top) * sy) * scale),
    width: Math.max(1, Math.round(to.width * sx * scale)),
    height: Math.max(1, Math.round(to.height * sy * scale)),
  });
  const at = placed(1);
  if (at.left < 0 || at.top < 0 || at.left + at.width > canvasW || at.top + at.height > canvasH) throw new ContentError('新しい絵が、ドールのキャンバスからはみ出します');
  const trimmed = sharp(cut).extract({ left: to.left, top: to.top, width: to.width, height: to.height });
  const { data } = await trimmed.clone().resize(at.width, at.height, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  const canvas = new Uint8ClampedArray(canvasW * canvasH * 4);
  for (let y = 0; y < at.height; y++) canvas.set(data.subarray(y * at.width * 4, (y + 1) * at.width * 4), ((at.top + y) * canvasW + at.left) * 4);

  const before = current.image.file;
  const doll = await store.edit(async (manifest, writer) => {
    const target = manifest.dolls.find((d) => d.id === dollId)!;
    const encoded = await encodeCutout(canvas, canvasW, canvasH, writer);
    if (!encoded) throw new ContentError('画像が全部透明です');
    target.image = encoded.image;
    return target;
  });
  // 拡大図のもと: 配信用の画像と同じ範囲を、整数倍の大きさで置く。古いものは消す
  const masters = path.join(contentDir, 'studio', 'masters');
  const baseOf = (file: string) => path.basename(file, path.extname(file));
  await fs.mkdir(masters, { recursive: true });
  await sharp(cut)
    .trim({ threshold: 0 })
    .resize(doll.image.box.w * MASTER_SCALE, doll.image.box.h * MASTER_SCALE, { fit: 'fill', kernel: 'lanczos3' })
    .webp({ quality: 95, alphaQuality: 100 })
    .toFile(path.join(masters, `${baseOf(doll.image.file)}.webp`));
  if (baseOf(before) !== baseOf(doll.image.file)) await fs.rm(path.join(masters, `${baseOf(before)}.webp`), { force: true });
  return doll;
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === 'generate' && rest.length >= 2) {
    const [reference, outDir, count = '4', variant = 'girl'] = rest;
    if (variant !== 'girl' && variant !== 'boy') throw new Error('ドールの種類は girl か boy で指定してください');
    const { image } = createAiFromEnv({ ...process.env, STUDIO_GEMINI_IMAGE_SIZE: '2K' });
    if (!image) throw new Error('GEMINI_API_KEY が設定されていません');
    await fs.mkdir(outDir, { recursive: true });
    const ref = await sharp(reference).flatten({ background: '#ffffff' }).png().toBuffer();
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(6, Number(count))) }, async (_, i) => {
        const file = path.join(outDir, `doll-${i + 1}.png`);
        await fs.writeFile(file, await image.generate({ prompt: dollPrompt(DOLL_BACKGROUND, variant), images: [ref] }));
        console.log(file);
      }),
    );
  } else if (command === 'import' && rest.length >= 3) {
    const [file, contentDir, name, copyFrom] = rest;
    const doll = await importDoll(contentDir, name, await fs.readFile(file), copyFrom);
    console.log(`登録しました: ${doll.id}（${doll.image.file}）`);
  } else if (command === 'replace' && rest.length === 4) {
    const [file, contentDir, dollId, previous] = rest;
    const doll = await replaceDollImage(contentDir, dollId, await fs.readFile(file), await fs.readFile(previous));
    console.log(`差し替えました: ${doll.id}（${doll.image.file}、box ${JSON.stringify(doll.image.box)}）`);
  } else {
    console.log('使い方:\n  makeDoll.ts generate <絵柄の見本の画像> <出力フォルダ> [枚数] [girl|boy]\n  makeDoll.ts import <候補の画像> <素材フォルダ> <名前> [カテゴリを写すドールの ID]\n  makeDoll.ts replace <新しい絵> <素材フォルダ> <ドールの ID> <いまのドールのもとの絵>');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
