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
const OUT = path.join(HERE, process.env.ROUND ? `out-${process.env.ROUND}` : 'out'); // ROUND=2 で、2 回めの絵を out-2 に分ける
const LIMIT = Number(process.argv[2]);
if (!Number.isInteger(LIMIT) || LIMIT < 1) throw new Error('上限の枚数を、最初に渡す');
const LOOKS = (process.argv[3] ?? 'cinderella,idol,cheer').split(',');
// 2 回め（作者の言葉「正面向きにこだわる必要はない。もっと自然なポーズを優先して」）: 体の向き・見る角度は、AI にまかせる。
// 1 回めの頼み（正面・立ったまま寄り）は、git の履歴（7（ポーズ）の試し 1 回め）に有る。
export const POSES: Record<string, string> = {
  peace: 'leaning forward a little with a playful wink, making a peace sign near her cheek, her other hand on her hip, weight on one leg',
  wave: 'walking by and turning to wave at the viewer with a big smile, body in three-quarter view, mid-step',
  jump: 'leaping joyfully in the air, body twisted slightly, one arm thrown up, one knee bent high, hair and skirt flying',
  sit: 'sitting on the floor hugging her knees, seen from a three-quarter angle, head tilted, smiling at the viewer',
  bow: 'spinning around in a twirl and looking back over her shoulder at the viewer, seen from behind in three-quarter back view, skirt and hair swirling',
};
const POSE_IDS = (process.argv[4] ?? Object.keys(POSES).join(',')).split(',');

export const posePrompt = (pose: string) =>
  [
    'The attached picture shows a dress-up doll character in a stiff, neutral front-facing pose.',
    `Draw the SAME character as a lively illustration in a natural pose: ${pose}.`,
    'A natural, expressive pose matters most. The character does NOT have to face the front: turn the body, tilt the head, shift the weight, and choose the viewing angle that makes the pose look natural. Hair, skirt and ribbons may move with the motion. The facial expression may change to fit the pose.',
    'It must still clearly be the same character: the same face design, eye color, hairstyle and hair color, and the same outfit with its details, patterns, colors, accessories and shoes, in the same art style and line quality. Parts that would be seen from another angle should be drawn consistently with the design.',
    'Do not add or remove any clothing or accessory. If the character holds an item in the picture, she still has it.',
    'Show the whole body, on a plain white background. One character only. No text, no frame.',
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
