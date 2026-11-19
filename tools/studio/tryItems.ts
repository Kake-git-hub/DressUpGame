/**
 * 品目を決め打ちで渡して、本物の画像生成を回すコマンド（企画と見た目の検品は、人が代わる）
 *
 *   npx tsx tools/studio/tryItems.ts <素材フォルダ> <ドールの ID> <品目の JSON> <出力フォルダ>
 *   npx tsx tools/studio/tryItems.ts save <素材フォルダ> <ドールの ID> <出力フォルダ> <番号,番号,...> [replace]
 *
 * 品目の JSON: [{ "category": "くつ", "name": "…", "description": "英語の説明", "colors": ["#rrggbb"] }, …]
 * 出力フォルダに、品目ごとに 切り抜き（-cut.png）・隠す所（-hide.png）・AI の形（-shape.png）・ドールに着せた絵（-worn.jpg）と、
 * 結果の一覧（result.json）を書く。save は、選んだ番号の候補を素材フォルダに登録する（公開はしない）。
 * 最後に replace を付けると、同じカテゴリ・同じ名前の品目を置き換える。
 * Claude API のキーが無い環境のためのもの。見た目の検品は必ず「合格」を返すので、できた絵は人が見て選ぶこと。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { TextAi } from './ai.ts';
import { createAiFromEnv } from './ai.ts';
import { StudioApi } from './api.ts';
import type { ApiResponse } from './api.ts';
import { Budget } from './budget.ts';

const noInspection: TextAi = { json: async <T>() => ({ ok: true, reason: '（人が見て確かめる）', fix: '' }) as T };

function makeApi(contentDir: string, outDir: string): StudioApi {
  const image = createAiFromEnv().image;
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
}

async function generate(contentDir: string, dollId: string, itemsFile: string, outDir: string): Promise<void> {
  await fs.mkdir(outDir, { recursive: true });
  const api = makeApi(contentDir, outDir);
  const items = JSON.parse(await fs.readFile(itemsFile, 'utf8')) as unknown[];
  const { id } = await ok<{ id: string }>(api, 'POST', '/api/jobs', { dollId, items, styleId: process.env.STYLE_ID });
  await api.waitForJob(id);
  const job = await ok<{ candidates: View[] }>(api, 'GET', `/api/jobs?id=${id}`);
  const manifest = await api.store.read();
  const doll = manifest.dolls.find((d) => d.id === dollId)!;
  const dollPng = await sharp(path.join(contentDir, doll.image.file)).resize(doll.image.box.w, doll.image.box.h, { fit: 'fill' }).png().toBuffer();
  for (const [i, c] of job.candidates.entries()) {
    console.log(`${i}: ${c.item.category} ${c.item.name} → ${c.status} ${[...c.warnings.map((w) => w.message), ...c.notes].join(' / ')}`);
    if (!c.hasImage) continue;
    const get = async (kind: string) => (await call(api, 'GET', `/api/jobs/image?id=${id}&index=${i}&kind=${kind}`)).body as Buffer;
    const cut = await get('png');
    await fs.writeFile(path.join(outDir, `${i}-cut.png`), cut);
    if (c.hasShape) await fs.writeFile(path.join(outDir, `${i}-shape.png`), await get('shape'));
    const meta = await sharp(cut).metadata();
    const pad = Math.round((meta.width! - doll.image.canvasW) / 2);
    // ドール（差し替え式なら、隠す所を消してから）に重ねる
    let body = await sharp({ create: { width: meta.width!, height: meta.height!, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: dollPng, left: doll.image.box.x + pad, top: doll.image.box.y + pad }])
      .png()
      .toBuffer();
    if (c.hasHide) {
      const hide = await get('hide');
      await fs.writeFile(path.join(outDir, `${i}-hide.png`), hide);
      body = await sharp(body).composite([{ input: hide, blend: 'dest-out' }]).png().toBuffer();
    }
    await sharp({ create: { width: meta.width!, height: meta.height!, channels: 3, background: '#c8d0e0' } })
      .composite([{ input: body }, { input: cut }])
      .jpeg({ quality: 90 })
      .toFile(path.join(outDir, `${i}-worn.jpg`));
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
    const saved = await ok<{ id: string }>(api, 'POST', '/api/items', { dollId, category: c.item.category, name: c.item.name, png, hide: await read(`${i}-hide.png`), shape: await read(`${i}-shape.png`), replaceId: existing.find((e) => e.category === c.item.category && e.name === c.item.name)?.id });
    console.log(`登録しました: ${saved.id}`);
  }
}

const args = process.argv.slice(2);
const run = args[0] === 'save' && (args.length === 5 || (args.length === 6 && args[5] === 'replace')) ? save(args[1], args[2], args[3], args[4], args[5] === 'replace') : args.length === 4 ? generate(args[0], args[1], args[2], args[3]) : null;
if (!run) {
  console.log('使い方:\n  tryItems.ts <素材フォルダ> <ドールの ID> <品目の JSON> <出力フォルダ>\n  tryItems.ts save <素材フォルダ> <ドールの ID> <出力フォルダ> <番号,番号,...> [replace]');
  process.exitCode = 1;
} else {
  run.catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
