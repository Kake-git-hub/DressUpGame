import fs from 'node:fs/promises';
import sharp from '/home/user/DressUpGame/node_modules/sharp/lib/index.js';
import { estimateBodyParts } from '/home/user/DressUpGame/src/pipeline/bodyParts.ts';
import { frameTiles } from '/home/user/DressUpGame/src/pipeline/frames.ts';
import { dollTemplateFromImage, padTemplate, workPad } from '/home/user/DressUpGame/tools/studio/processGenerated.ts';
export const C = '/home/user/DressUpGame-content/';
export const OUT = './out/';
export async function setup() {
  const m = JSON.parse(await fs.readFile(C + 'manifest.json', 'utf8'));
  const doll = m.dolls[2];
  const { canvasW, canvasH, box } = doll.image;
  const base = await dollTemplateFromImage(await fs.readFile(C + doll.image.file), doll.image);
  const work = padTemplate(base, workPad(canvasW));
  const master = await fs.readFile(C + 'studio/masters/2e5ca8f579d6cc54.webp');
  const hiBase = await dollTemplateFromImage(master, { file: '', canvasW: canvasW * 2, canvasH: canvasH * 2, box: { x: box.x * 2, y: box.y * 2, w: box.w * 2, h: box.h * 2 } });
  const hi = padTemplate(hiBase, workPad(canvasW) * 2);
  const parts = estimateBodyParts(work.mask, work.canvasW, work.canvasH)!;
  return { m, doll, work, hi, parts, tiles: (k: 'upper' | 'feet' | 'hands') => frameTiles(k, parts, work.canvasW, work.canvasH) };
}
export { sharp, fs };
