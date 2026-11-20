/**
 * ドールづくりの道具（コマンド）
 *
 *   候補を作る:  npx tsx tools/studio/makeDoll.ts generate <絵柄の見本の画像> <出力フォルダ> [枚数=4] [girl|boy]
 *               （boy は、見本のドールと同じ姿勢のまま男の子にする。見本には、作りやすい姿勢のドールを渡す）
 *   取り込む:    npx tsx tools/studio/makeDoll.ts import <候補の画像> <素材フォルダ> <名前> [カテゴリを写すドールの ID]
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
  } else {
    console.log('使い方:\n  makeDoll.ts generate <絵柄の見本の画像> <出力フォルダ> [枚数] [girl|boy]\n  makeDoll.ts import <候補の画像> <素材フォルダ> <名前> [カテゴリを写すドールの ID]');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
