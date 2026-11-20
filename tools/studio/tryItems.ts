/**
 * 品目を決め打ちで渡して、本物の画像生成を回すコマンド（企画と見た目の検品は、人が代わる）
 *
 *   npx tsx tools/studio/tryItems.ts <素材フォルダ> <ドールの ID> <品目の JSON> <出力フォルダ> [--with <品目の ID>]
 *   npx tsx tools/studio/tryItems.ts save <素材フォルダ> <ドールの ID> <出力フォルダ> <番号,番号,...> [replace]
 *
 * 品目の JSON: [{ "category": "くつ", "name": "…", "description": "英語の説明", "colors": ["#rrggbb"] }, …]
 * 出力フォルダに、品目ごとに 切り抜き（-cut.png）・隠す所（-hide.png）・AI の形（-shape.png）・前髪の範囲（-front.png）・
 * くつの中の肌（-under.png）・AI の絵（-source.png）・ドールに着せた絵（-worn.jpg）と、結果の一覧（result.json）を書く。
 * 髪は、サムネイル（-thumb.png）と、うしろがみのサムネイル（-backthumb.png）も書く。
 * --with を付けると、その品目（靴下など）も重ねた絵（-worn-with.jpg）を書く。
 * save は、選んだ番号の候補を素材フォルダに登録する（公開はしない）。最後に replace を付けると、同じカテゴリ・同じ名前の品目を置き換える。
 * Claude API のキーが無い環境のためのもの。見た目の検品は必ず「合格」を返すので、できた絵は人が見て選ぶこと。
 * STUDIO_FAKE_IMAGE=<画像ファイル> を付けると、画像生成の代わりにその画像を返す（道具そのものの確認用。枚数は数えない）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { hairFromMask, hairThumbs } from '../../src/pipeline/hairLayers.ts';
import type { ImageAi, TextAi } from './ai.ts';
import { createAiFromEnv } from './ai.ts';
import { StudioApi } from './api.ts';
import type { ApiResponse } from './api.ts';
import { Budget } from './budget.ts';

const noInspection: TextAi = { json: async <T>() => ({ ok: true, reason: '（人が見て確かめる）', fix: '' }) as T };

function makeApi(contentDir: string, outDir: string): StudioApi {
  const fake = process.env.STUDIO_FAKE_IMAGE;
  const image: ImageAi | null = fake ? { generate: () => fs.readFile(fake) } : createAiFromEnv().image;
  return new StudioApi({
    contentDir,
    ai: { text: noInspection, image },
    budget: new Budget(path.join(outDir, 'usage.json'), { perDay: Number(process.env.STUDIO_DAILY_IMAGE_LIMIT ?? 40), perRun: 30 }),
    maxAttempts: 1,
    concurrency: 4,
  });
}
const call = (api: StudioApi, method: string, url: string, body?: unknown): Promise<ApiResponse> => {
  const u = new URL(url, 'http://localhost');
  return api.handle({ method, path: u.pathname, query: u.searchParams, host: 'localhost', body: body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)) });
};
async function ok<T>(api: StudioApi, method: string, url: string, body?: unknown): Promise<T> {
  const res = await call(api, method, url, body);
  if (res.status !== 200) throw new Error(`${res.status} ${res.body.toString()}`);
  return JSON.parse(res.body.toString()) as T;
}

interface View {
  item: { category: string; name: string };
  status: string;
  notes: string[];
  warnings: { code: string; message: string }[];
  hasImage: boolean;
  hasShape: boolean;
  hasHide: boolean;
  hasFront?: boolean;
  hasUnder?: boolean;
}

type Rgba = { data: Uint8ClampedArray; width: number; height: number };
const rawOf = async (input: Buffer | string, width?: number, height?: number): Promise<Rgba> => {
  let pipeline = sharp(input).ensureAlpha();
  if (width && height) pipeline = pipeline.resize(width, height, { fit: 'fill' });
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
};
const pngOf = (rgba: Uint8ClampedArray, width: number, height: number) => sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } }).png().toBuffer();
// 品目の画像（切り抜き済み）を、キャンバス（width × height、中心を合わせる）の上に置いた PNG
async function placedPng(contentDir: string, image: { file: string; canvasW: number; canvasH: number; box: { x: number; y: number; w: number; h: number } }, width: number, height: number): Promise<Buffer> {
  const part = await sharp(path.join(contentDir, image.file)).resize(image.box.w, image.box.h, { fit: 'fill' }).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: part, left: Math.round((width - image.canvasW) / 2) + image.box.x, top: Math.round((height - image.canvasH) / 2) + image.box.y }])
    .png()
    .toBuffer();
}

async function generate(contentDir: string, dollId: string, itemsFile: string, outDir: string, withId: string | null): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const api = makeApi(contentDir, outDir);
  const items = JSON.parse(await fs.readFile(itemsFile, 'utf8')) as unknown[];
  const { id } = await ok<{ id: string }>(api, 'POST', '/api/jobs', { dollId, items, styleId: process.env.STYLE_ID });
  await api.waitForJob(id);
  const job = await ok<{ candidates: View[] }>(api, 'GET', `/api/jobs?id=${id}`);
  const manifest = await api.store.read();
  const doll = manifest.dolls.find((d) => d.id === dollId)!;
  const withItem = withId ? doll.items.find((i) => i.id === withId) : undefined;
  if (withId && !withItem) throw new Error(`品目「${withId}」がありません`);
  for (const [i, c] of job.candidates.entries()) {
    console.log(`${i}: ${c.item.category} ${c.item.name} → ${c.status} ${[...c.warnings.map((w) => w.message), ...c.notes].join(' / ')}`);
    if (!c.hasImage) continue;
    const get = async (kind: string) => (await call(api, 'GET', `/api/jobs/image?id=${id}&index=${i}&kind=${kind}`)).body as Buffer;
    const write = (suffix: string, data: Buffer) => fs.writeFile(path.join(outDir, `${i}-${suffix}`), data);
    const cut = await get('png');
    await write('cut.png', cut);
    await write('source.png', await get('source')); // AI の絵（位置合わせ済み）。あとで処理を直したときに、作り直さずに確かめられるように
    if (c.hasShape) await write('shape.png', await get('shape'));
    const meta = await sharp(cut).metadata();
    const W = meta.width!;
    const H = meta.height!;
    // ドール（差し替え式なら、隠す所を消してから）
    let body = await placedPng(contentDir, doll.image, W, H);
    let hide: Buffer | null = null;
    if (c.hasHide) {
      hide = await get('hide');
      await write('hide.png', hide);
      body = await sharp(body).composite([{ input: hide, blend: 'dest-out' }]).png().toBuffer();
    }
    const under = c.hasUnder ? await get('under') : null;
    if (under) await write('under.png', under);
    // 着せた絵: 髪は 後ろ髪 → ドール → 前髪。ほかは ドール → 肌 → [重ねる品目] → 品目
    let behind: Buffer[] = [];
    let above: Buffer[] = [cut];
    if (c.hasFront) {
      const frontPng = await get('front');
      await write('front.png', frontPng);
      const dollAlpha = await rawOf(body);
      const alpha = new Uint8Array(W * H);
      for (let p = 0; p < alpha.length; p++) alpha[p] = dollAlpha.data[p * 4 + 3];
      const front = await rawOf(frontPng);
      const mask = new Uint8Array(W * H);
      for (let p = 0; p < mask.length; p++) mask[p] = front.data[p * 4 + 3];
      const layers = hairFromMask((await rawOf(cut)).data, mask, alpha, W, H);
      behind = [await pngOf(layers.back, W, H)];
      above = [await pngOf(layers.front, W, H)];
      const thumbs = hairThumbs(layers.front, layers.back, alpha, W, H);
      const thumb = async (rgba: Uint8ClampedArray) => sharp(await pngOf(rgba, W, H)).trim({ threshold: 0 }).resize(192, 192, { fit: 'contain', background: { r: 247, g: 243, b: 251, alpha: 1 } }).flatten({ background: '#f7f3fb' }).png().toBuffer();
      await write('thumb.png', await thumb(thumbs.hair));
      await write('backthumb.png', await thumb(thumbs.back));
    }
    const worn = async (extra: Buffer[]) =>
      sharp({ create: { width: W, height: H, channels: 3, background: '#c8d0e0' } })
        .composite([...behind, body, ...(under ? [under] : []), ...extra, ...above].map((input) => ({ input })))
        .jpeg({ quality: 90 })
        .toBuffer();
    await write('worn.jpg', await worn([]));
    if (withItem) {
      // 重ねる品目も、くつの隠す所で消す（ゲームと同じ）
      let other = await placedPng(contentDir, withItem.image, W, H);
      if (hide) other = await sharp(other).composite([{ input: hide, blend: 'dest-out' }]).png().toBuffer();
      await write('worn-with.jpg', await worn([other]));
    }
  }
  await fs.writeFile(path.join(outDir, 'result.json'), JSON.stringify(job.candidates, null, 1));
}

async function save(contentDir: string, dollId: string, outDir: string, picks: string, replace: boolean): Promise<void> {
  const api = makeApi(contentDir, outDir);
  const candidates = JSON.parse(await fs.readFile(path.join(outDir, 'result.json'), 'utf8')) as View[];
  const existing = replace ? ((await api.store.read()).dolls.find((d) => d.id === dollId)?.items ?? []) : [];
  const read = async (file: string) => fs.readFile(path.join(outDir, file)).then((b) => b.toString('base64'), () => undefined);
  for (const i of picks.split(',').map(Number)) {
    const c = candidates[i];
    const png = await read(`${i}-cut.png`);
    if (!c || !png) throw new Error(`${i} 番の候補がありません`);
    const front = await read(`${i}-front.png`);
    const saved = await ok<{ id: string }>(api, 'POST', '/api/items', {
      dollId,
      category: c.item.category,
      name: c.item.name,
      png,
      hide: await read(`${i}-hide.png`),
      shape: front ? undefined : await read(`${i}-shape.png`),
      front,
      under: await read(`${i}-under.png`),
      replaceId: existing.find((e) => e.category === c.item.category && e.name === c.item.name)?.id,
    });
    console.log(`登録しました: ${saved.id}`);
  }
}

const args = process.argv.slice(2);
const withAt = args.indexOf('--with');
const withId = withAt >= 0 ? (args[withAt + 1] ?? null) : null;
const plain = withAt >= 0 ? args.slice(0, withAt) : args;
const run =
  plain[0] === 'save' && (plain.length === 5 || (plain.length === 6 && plain[5] === 'replace'))
    ? save(plain[1], plain[2], plain[3], plain[4], plain[5] === 'replace')
    : plain.length === 4 && (withAt < 0 || withId)
      ? generate(plain[0], plain[1], plain[2], plain[3], withId)
      : null;
if (!run) {
  console.log('使い方:\n  tryItems.ts <素材フォルダ> <ドールの ID> <品目の JSON> <出力フォルダ> [--with <品目の ID>]\n  tryItems.ts save <素材フォルダ> <ドールの ID> <出力フォルダ> <番号,番号,...> [replace]');
  process.exitCode = 1;
} else {
  run.catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
