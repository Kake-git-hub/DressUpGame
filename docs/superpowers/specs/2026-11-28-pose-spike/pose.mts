/**
 * 試しの道具（捨てる前提）: 着せ替えの絵（in/<着せ方>.png）を画像の AI に渡して、同じ子・同じ服のまま、ポーズだけ変えた絵を作る。
 * **本物の画像生成を使う（作者の費用）。作者が了承した枚数の中でだけ走らせる。**
 *   リポジトリの上で: NODE_USE_ENV_PROXY=1 npx tsx docs/superpowers/specs/2026-11-28-pose-spike/pose.mts <上限の枚数> [着せ方,着せ方] [ポーズ,ポーズ]
 * できた絵は out/<着せ方>-<ポーズ>.png、記録は out/record.json、並べた絵は out/sheet-<着せ方>.jpg。
 * もう有る絵は作り直さない（消してから走らせると、作り直す）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { createGemini, GEMINI_IMAGE_MODEL } from '../../../../tools/studio/ai.ts';

const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'out');
const LIMIT = Number(process.argv[2]);
if (!Number.isInteger(LIMIT) || LIMIT < 1) throw new Error('上限の枚数を、最初に渡す');
const LOOKS = (process.argv[3] ?? 'cinderella,idol,cheer').split(',');
export const POSES: Record<string, string> = {
  peace: 'making a cheerful peace sign (V sign) with one hand raised next to her face, the other hand relaxed, standing',
  wave: 'waving hello with one hand raised high, smiling, standing',
  jump: 'jumping joyfully in the air with both arms raised and knees bent, feet off the ground',
  sit: 'sitting on the floor with her legs tucked to one side, hands resting on her lap',
  bow: 'doing a graceful curtsy: one foot behind the other, knees slightly bent, holding the sides of her skirt, head slightly tilted',
};
const POSE_IDS = (process.argv[4] ?? Object.keys(POSES).join(',')).split(',');

export const posePrompt = (pose: string) =>
  [
    'The attached picture shows a dress-up doll character in a neutral standing pose.',
    `Redraw the SAME character in a new pose: ${pose}.`,
    'Keep everything else exactly the same: the same face, eyes, hairstyle and hair color, the same outfit with every detail, pattern, color, accessory and shoe, and the same art style and line quality.',
    'Do not add, remove or change any clothing or accessory. If the character holds an item in the picture, she still holds it.',
    'Show the whole body from head to toe, centered, on a plain white background. One character only. No text, no frame, no shadow on the wall.',
    'The picture is for young children: cute, cheerful and modest.',
  ].join('\n');

mkdirSync(OUT, { recursive: true });
const image = createGemini('dummy', GEMINI_IMAGE_MODEL, fetch, '1K');
const recordPath = path.join(OUT, 'record.json');
const record: Record<string, unknown>[] = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')).record : [];
let images = 0;
for (const look of LOOKS) {
  const input = await sharp(path.join(HERE, 'in', `${look}.png`)).flatten({ background: '#ffffff' }).png().toBuffer();
  for (const pose of POSE_IDS) {
    const file = path.join(OUT, `${look}-${pose}.png`);
    if (existsSync(file)) continue;
    if (images >= LIMIT) {
      console.log('上限に達したので、ここまで');
      break;
    }
    images++; // 失敗しても、費用がかかったかもしれないので数える
    const t = Date.now();
    try {
      writeFileSync(file, await image.generate({ prompt: posePrompt(POSES[pose]), images: [input] }));
      record.push({ look, pose, ok: true, seconds: Math.round((Date.now() - t) / 1000) });
    } catch (error) {
      record.push({ look, pose, ok: false, error: (error as Error).message, seconds: Math.round((Date.now() - t) / 1000) });
    }
    console.log(look, pose, JSON.stringify(record.at(-1)));
    writeFileSync(recordPath, JSON.stringify({ record }, null, 2));
  }
  // 並べた絵: 左がもとの絵、右へポーズ
  const tiles = [path.join(HERE, 'in', `${look}.png`), ...Object.keys(POSES).map((p) => path.join(OUT, `${look}-${p}.png`))].filter((f) => existsSync(f));
  const bufs = await Promise.all(tiles.map((f) => sharp(f).flatten({ background: '#ffffff' }).resize(420, 420, { fit: 'contain', background: '#ffffff' }).toBuffer()));
  await sharp({ create: { width: 420 * bufs.length, height: 420, channels: 3, background: '#ffffff' } })
    .composite(bufs.map((input, i) => ({ input, left: 420 * i, top: 0 })))
    .jpeg({ quality: 84 })
    .toFile(path.join(OUT, `sheet-${look}.jpg`));
}
console.log(JSON.stringify({ images }));
