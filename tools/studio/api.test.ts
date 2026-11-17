// @vitest-environment node
/**
 * スタジオの API のテスト（HTTP サーバーを立てずに、関数を直接呼ぶ。AI は偽物）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ImageAi, TextAi } from './ai.ts';
import { AiError } from './ai.ts';
import { StudioApi } from './api.ts';
import type { ApiResponse } from './api.ts';
import { Budget } from './budget.ts';

let dir: string;
let api: StudioApi;
let budget: Budget;
let dollId: string;
let imageCalls: { prompt: string; images: Buffer[] }[];
let textCalls: { system: string; prompt: string }[];
let verdicts: { ok: boolean; reason: string }[];

// 人型（頭・胴・腕・脚）の透過画像
async function dollPng(): Promise<Buffer> {
  const skin = '#f0c8a8';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="1000">
    <circle cx="250" cy="80" r="70" fill="${skin}"/><rect x="225" y="140" width="50" height="40" fill="${skin}"/>
    <rect x="170" y="175" width="160" height="330" fill="${skin}"/>
    <rect x="60" y="180" width="60" height="330" fill="${skin}" transform="rotate(12 90 180)"/>
    <rect x="380" y="180" width="60" height="330" fill="${skin}" transform="rotate(-12 410 180)"/>
    <rect x="170" y="500" width="70" height="480" fill="${skin}"/><rect x="260" y="500" width="70" height="480" fill="${skin}"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// 偽の画像生成: 渡されたシルエット画像の胴に、赤い服を描いて返す
const fakeImage: ImageAi = {
  async generate(input) {
    imageCalls.push(input);
    if (input.images.length === 0) return sharp({ create: { width: 1200, height: 800, channels: 3, background: '#88bbee' } }).png().toBuffer();
    const meta = await sharp(input.images[0]).metadata();
    const w = meta.width!;
    const cloth = await sharp({ create: { width: Math.round(w * 0.24), height: Math.round(w * 0.2), channels: 3, background: '#c81e28' } }).png().toBuffer();
    return sharp(input.images[0]).composite([{ input: cloth, left: Math.round(w * 0.38), top: Math.round(w * 0.22) }]).png().toBuffer();
  },
};
const fakeText: TextAi = {
  async json<T>(input: { system?: string; prompt: string; schema: Record<string, unknown> }): Promise<T> {
    textCalls?.push({ system: input.system ?? '', prompt: input.prompt });
    const props = (input.schema.properties ?? {}) as Record<string, unknown>;
    if (!('items' in props) && 'description' in props) return { description: 'A plain blue dress with ribbons.' } as T;
    if ('ok' in props) return (verdicts.shift() ?? { ok: true, reason: 'よくできています' }) as T;
    if (/Number of backgrounds/.test(input.prompt)) return { items: [{ name: 'うみべ', description: 'A calm beach.' }, { name: 'おしろ', description: 'A castle hall.' }] } as T;
    return {
      items: [
        { category: 'トップス', name: 'あかいシャツ', description: 'A red shirt.', colors: ['#c81e28'] },
        { category: 'ない', name: 'むこう', description: 'x', colors: [] },
        { category: 'トップス', name: 'みどりのシャツ', description: 'A green shirt.', colors: ['#20c040', '#ffffff'] },
      ],
    } as T;
  },
};

function call(method: string, url: string, body?: unknown, host = 'localhost:5173', origin?: string): Promise<ApiResponse> {
  const u = new URL(url, 'http://x');
  const data = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  return api.handle({ method, path: u.pathname, query: u.searchParams, host, origin, body: data });
}
async function ok<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await call(method, url, body);
  if (res.status !== 200) throw new Error(`${res.status} ${res.body.toString()}`);
  return JSON.parse(res.body.toString()) as T;
}
const errorOf = async (res: Promise<ApiResponse>) => {
  const r = await res;
  return { status: r.status, error: (JSON.parse(r.body.toString()) as { error: string }).error };
};

// 作り直しの動きを確かめるため、テストでは既定（1 回）ではなく 2 回までにする
function makeApi(ai = { text: fakeText as TextAi | null, image: fakeImage as ImageAi | null }, limits = { perDay: 20, perRun: 10 }, maxAttempts: number | null = 2) {
  budget = new Budget(path.join(dir, '.usage.json'), limits);
  api = new StudioApi({ contentDir: path.join(dir, 'content'), ai, budget, maxAttempts: maxAttempts ?? undefined }); // null = 既定
}

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-'));
  imageCalls = [];
  textCalls = [];
  verdicts = [];
  makeApi();
  await api.store.init();
  dollId = (await ok<{ doll: { id: string } }>('POST', '/api/dolls?name=テスト', await dollPng())).doll.id;
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('基本', () => {
  it('status: キーの有無と上限、git の状態を返す', async () => {
    const s = await ok<{ ai: object; budget: object; git: { isRepo: boolean } }>('GET', '/api/status');
    expect(s.ai).toEqual({ text: true, image: true });
    expect(s.budget).toMatchObject({ usedToday: 0, perDay: 20, perRun: 10 });
    expect(s.git.isRepo).toBe(false);
  });
  it('Host が外部なら 403', async () => {
    expect((await call('GET', '/api/status', undefined, 'evil.example.com')).status).toBe(403);
    expect((await call('GET', '/api/status', undefined, '127.0.0.1:5173')).status).toBe(200);
  });
  it('ほかのサイトからの呼び出し（Origin が別）は 403。同じ PC の画面からは通る', async () => {
    expect((await call('POST', '/api/publish', {}, 'localhost:5173', 'https://evil.example.com')).status).toBe(403);
    expect((await call('GET', '/api/status', undefined, 'localhost:5173', 'null')).status).toBe(403);
    expect((await call('GET', '/api/status', undefined, 'localhost:5173', 'http://localhost:5173')).status).toBe(200);
  });
  it('素材フォルダの中身を返す。フォルダの外は 400、無いファイルは 404', async () => {
    const res = await call('GET', '/content/manifest.json');
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body.toString()).dolls).toHaveLength(1);
    expect((await call('GET', '/content/..%2F.usage.json')).status).toBe(400);
    expect((await call('GET', '/content/files/none.webp')).status).toBe(404);
    expect((await call('GET', '/content/%E0')).status).toBe(400);
    await fs.mkdir(path.join(dir, 'content/.git'), { recursive: true });
    await fs.writeFile(path.join(dir, 'content/.git/config'), 'x');
    expect((await call('GET', '/content/.git/config')).status).toBe(404);
  });
  it('無い API は 404、JSON でない本文は 400', async () => {
    expect((await call('GET', '/api/none')).status).toBe(404);
    expect((await call('POST', '/api/items', Buffer.from('x'))).status).toBe(400);
  });
});

describe('ドールと型紙', () => {
  it('ドールを追加すると、部位と、カテゴリごとの範囲が推定される', async () => {
    const t = await ok<{ parts: Record<string, { x: number; y: number; w: number; h: number }>; regions: Record<string, object | null> }>('GET', `/api/template?doll=${dollId}`);
    expect(t.parts.head.y).toBeLessThan(40);
    expect(t.parts.feet.y).toBeGreaterThan(900);
    expect(t.parts.torso.y).toBeGreaterThan(t.parts.head.y);
    expect(t.parts.legs.y).toBeGreaterThan(t.parts.torso.y);
    expect(t.regions['くつ']).not.toBeNull();
    expect(t.regions['アクセサリー']).toBeNull();
  });
  it('型紙を保存できる。形が違えば 400', async () => {
    const t = await ok<{ parts: Record<string, { x: number; y: number; w: number; h: number }> }>('GET', `/api/template?doll=${dollId}`);
    const head = { ...t.parts.head, y: t.parts.head.y + 3 };
    // 以前の型紙の絵柄の項目は、送られてきても保存しない
    const saved = await ok<Record<string, unknown> & typeof t>('PUT', '/api/template', { dollId, template: { ...t, parts: { ...t.parts, head }, style: 'x', styleRefs: [] } });
    expect(saved.parts.head).toEqual(head);
    expect(Object.keys(saved).sort()).toEqual(['parts', 'regions']);
    expect((await ok<typeof t>('GET', `/api/template?doll=${dollId}`)).parts.head).toEqual(head);
    expect((await call('PUT', '/api/template', { dollId, template: { style: 1 } })).status).toBe(400);
    // 壊れた値は保存されず、型紙は読めるまま
    expect((await call('PUT', '/api/template', { dollId, template: { ...t, parts: null } })).status).toBe(400);
    expect((await call('PUT', '/api/template', { dollId, template: { ...t, parts: { ...(t as unknown as { parts: object }).parts, head: { x: 0, y: 0, w: 0, h: 5 } } } })).status).toBe(400);
    expect((await call('GET', `/api/template?doll=${dollId}`)).status).toBe(200);
  });
  it('基準画像: 体の中心が指定色、隅が背景色', async () => {
    const res = await call('GET', `/api/silhouette?doll=${dollId}&color=ff00ff&bg=00ffff`);
    expect(res.type).toBe('image/png');
    const { data, info } = await sharp(res.body as Buffer).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(2048);
    const at = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    expect(at(1024, 700)).toEqual([255, 0, 255]);
    expect(at(5, 5)).toEqual([0, 255, 255]);
    expect((await call('GET', `/api/silhouette?doll=${dollId}&color=zz`)).status).toBe(400);
    expect((await call('GET', '/api/silhouette?doll=いない')).status).toBe(404);
  });
});

describe('服の追加', () => {
  it('画像を処理して、保存できる', async () => {
    const generated = await fakeImage.generate({ prompt: '', images: [(await call('GET', `/api/silhouette?doll=${dollId}`)).body as Buffer] });
    const r = await ok<{ png: string; source: string; warnings: unknown[]; keyColors: { silhouette: number[] } }>('POST', `/api/process?doll=${dollId}`, generated);
    expect(r.warnings).toEqual([]);
    expect(r.keyColors.silhouette[1]).toBeGreaterThan(240);
    const item = await ok<{ id: string; image: { box: { w: number } } }>('POST', '/api/items', { dollId, category: 'トップス', name: 'あか', png: r.png });
    expect(item.id).toBe('テスト/トップス/あか');
    expect(item.image.box.w).toBeGreaterThan(200);
    await ok('PATCH', '/api/items', { id: item.id, name: 'あかいふく' });
    expect((await ok<{ dolls: { items: { name: string }[] }[] }>('GET', '/api/content')).dolls[0].items[0].name).toBe('あかいふく');
    await ok('DELETE', `/api/items?id=${encodeURIComponent(item.id)}`);
    expect((await call('DELETE', `/api/items?id=${encodeURIComponent(item.id)}`)).status).toBe(404);
  }, 30_000);
  it('処理の結果に AI の体の形が付き、隠す所を添えて保存すると一覧に hide が入る。置き換えで外せる', async () => {
    const generated = await fakeImage.generate({ prompt: '', images: [(await call('GET', `/api/silhouette?doll=${dollId}`)).body as Buffer] });
    const r = await ok<{ png: string; shape: string | null }>('POST', `/api/process?doll=${dollId}`, generated);
    expect(r.shape).toBeTruthy();
    const shape = await sharp(Buffer.from(r.shape!, 'base64')).metadata();
    expect([shape.width, shape.height]).toEqual([1024, 1024]);
    // 右下の 40px 四方を隠す
    const mask = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 40, height: 40, channels: 4, background: '#ffffff' } }).png().toBuffer(), left: 900, top: 950 }])
      .png()
      .toBuffer();
    const item = await ok<{ id: string; hide?: { file: string; box: { x: number; y: number; w: number; h: number } } }>('POST', '/api/items', { dollId, category: 'くつ', name: 'かくす', png: r.png, hide: mask.toString('base64') });
    expect(item.hide?.box).toEqual({ x: 900, y: 950, w: 40, h: 40 });
    const replaced = await ok<{ hide?: unknown }>('POST', '/api/items', { dollId, category: 'くつ', name: 'かくす', png: r.png, replaceId: item.id });
    expect(replaced.hide).toBeUndefined();
    const small = (await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ffffff' } }).png().toBuffer()).toString('base64');
    expect((await call('POST', '/api/items', { dollId, category: 'くつ', name: 'だめ', png: r.png, hide: small })).status).toBe(400);
    await ok('DELETE', `/api/items?id=${encodeURIComponent(item.id)}`);
  }, 30_000);
  it('壊れた画像・不正な名前・無いドールは、何も書かずにエラー', async () => {
    expect((await call('POST', `/api/process?doll=${dollId}`, Buffer.from('x'))).status).toBe(400);
    expect((await call('POST', '/api/process?doll=いない', Buffer.from('x'))).status).toBe(404);
    expect((await call('POST', `/api/process?doll=${dollId}&dx=abc`, Buffer.from('x'))).status).toBe(400);
    const red = (await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#ff0000' } }).png().toBuffer()).toString('base64');
    expect((await call('POST', '/api/items', { dollId, category: 'トップス', name: '../x', png: red })).status).toBe(400);
    expect((await call('POST', '/api/items', { dollId, category: 'トップス', name: 'a', png: 'AAAA' })).status).toBe(400);
    expect((await ok<{ dolls: { items: unknown[] }[] }>('GET', '/api/content')).dolls[0].items).toEqual([]);
  });
  it('カテゴリと背景', async () => {
    await ok('PUT', '/api/categories', { dollId, category: { label: 'かばん', layer: 12, menuOrder: 11, overlap: true, movable: false } });
    await ok('POST', '/api/categories/order', { dollId, order: [{ id: 'かばん', layer: 3, menuOrder: 0 }] });
    // 同じ名前の「新しいカテゴリ」は、既存の設定を上書きせずに断る
    expect((await call('PUT', '/api/categories', { dollId, category: { label: 'ドレス', layer: 11, menuOrder: 11, overlap: false, movable: false } })).status).toBe(409);
    // 一部の項目だけを変えられる
    await ok('PATCH', '/api/categories', { dollId, id: 'ドレス', change: { overlap: true } });
    const dress = (await ok<{ dolls: { categories: { id: string; layer: number; overlap: boolean }[] }[] }>('GET', '/api/content')).dolls[0].categories.find((c) => c.id === 'ドレス');
    expect(dress).toMatchObject({ layer: 4, overlap: true });
    expect((await call('PUT', '/api/categories', { dollId, category: { label: 'x', layer: 'a', menuOrder: 0, overlap: false, movable: false } })).status).toBe(400);
    await ok('DELETE', `/api/categories?doll=${dollId}&id=かばん`);
    const bg = await ok<{ id: string }>('POST', '/api/backgrounds?name=そら', await sharp({ create: { width: 300, height: 300, channels: 3, background: '#aaccff' } }).png().toBuffer());
    expect(bg.id).toBe('bg/そら');
    await ok('DELETE', `/api/backgrounds?id=${encodeURIComponent(bg.id)}`);
  });
});

describe('テーマからの自動生成', () => {
  const plan = () => ok<{ items: { category: string; name: string; description: string; colors: string[] }[]; maxImages: number }>('POST', '/api/plan', { dollId, theme: 'うみ', count: 5 });
  type JobView = { done: boolean; candidates: { status: string; attempts: number; notes: string[]; hasImage: boolean; item: { name: string } }[] };

  it('キーが無ければ 503 で、理由を返す', async () => {
    makeApi({ text: null, image: fakeImage });
    expect(await errorOf(call('POST', '/api/plan', { dollId, theme: 'うみ', count: 3 }))).toMatchObject({ status: 503, error: expect.stringMatching(/ANTHROPIC_API_KEY/) });
    makeApi({ text: fakeText, image: null });
    expect((await errorOf(call('POST', '/api/plan', { dollId, theme: 'うみ', count: 3 }))).error).toMatch(/GEMINI_API_KEY/);
  });
  it('企画: 無いカテゴリの品目は除かれ、最大枚数の見積もりが付く', async () => {
    const p = await plan();
    expect(p.items.map((i) => i.name)).toEqual(['あかいシャツ', 'みどりのシャツ']);
    expect(p.maxImages).toBe(4);
    expect((await call('POST', '/api/plan', { dollId, theme: ' ', count: 3 })).status).toBe(400);
    expect((await call('POST', '/api/plan', { dollId, theme: 'x', count: 6 })).status).toBe(400); // 1 回の上限 10 枚 ÷ 2 回 = 5 点まで
  });
  it('企画: 既にある素材の一覧は渡さず、キャラクター名などを書かないよう指示し、選んだ絵柄を渡す', async () => {
    await ok('POST', '/api/items', { dollId, category: 'トップス', name: 'もとからあるふく', png: (await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#c81e28' } }).png().toBuffer()).toString('base64') });
    await ok('POST', '/api/plan', { dollId, theme: 'うみ', count: 1, styleId: 'pastel' });
    const prompt = textCalls[0].prompt;
    expect(prompt).not.toMatch(/もとからあるふく/);
    expect(prompt).toMatch(/Never mention the name of any real or fictional character/);
    expect(prompt).toMatch(/pastel colours/);
  });
  it('生成: 選んだ絵柄を画像 AI に渡す。手足にかかる品目（くつ）には手と足の拡大図を添え、どこにでも付く品目には添えない', async () => {
    const { id } = await ok<{ id: string }>('POST', '/api/jobs', {
      dollId,
      styleId: 'real',
      items: [
        { category: 'アクセサリー', name: 'a', description: 'A red shirt.', colors: ['#c81e28'] },
        { category: 'くつ', name: 'b', description: 'Red shoes.', colors: ['#c81e28'] },
      ],
    });
    await api.waitForJob(id);
    const shirt = imageCalls.find((c) => c.prompt.includes('red shirt'))!;
    const shoes = imageCalls.find((c) => c.prompt.includes('Red shoes'))!;
    expect(shirt.prompt).toMatch(/Semi-realistic/);
    expect(shirt.images).toHaveLength(1);
    expect(shirt.prompt).not.toMatch(/close-ups/);
    expect(shoes.images).toHaveLength(2);
    expect(shoes.prompt).toMatch(/close-ups of the same mannequin's hands and feet/);
  }, 60_000);
  it('画像 AI に内容の決まりで断られたら、説明文を書き直して 1 回だけやり直す', async () => {
    let calls = 0;
    makeApi({
      text: fakeText,
      image: {
        async generate(input) {
          calls++;
          if (calls === 1) throw new AiError('Gemini API が内容の決まりにより断りました', 422, false, true);
          return fakeImage.generate(input);
        },
      },
    });
    const { id } = await ok<{ id: string }>('POST', '/api/jobs', { dollId, items: [{ category: 'トップス', name: 'a', description: 'An Elsa dress.', colors: ['#c81e28'] }] });
    await api.waitForJob(id);
    const c = (await ok<JobView & { candidates: { item: { description: string } }[] }>('GET', `/api/jobs?id=${id}`)).candidates[0];
    expect(calls).toBe(2);
    expect(c).toMatchObject({ status: 'passed', attempts: 2, hasImage: true });
    expect(c.item.description).toBe('A plain blue dress with ribbons.');
    expect(c.notes[0]).toMatch(/書き直しました.*An Elsa dress/);
    expect(imageCalls[0].prompt).toMatch(/plain blue dress/);
  }, 60_000);
  it('生成: 候補ができ、合格し、採用するまで一覧には入らない', async () => {
    const p = await plan();
    const { id } = await ok<{ id: string }>('POST', '/api/jobs', { dollId, items: p.items });
    await api.waitForJob(id);
    const job = await ok<JobView>('GET', `/api/jobs?id=${id}`);
    expect(job.done).toBe(true);
    expect(job.candidates.map((c) => c.status)).toEqual(['passed', 'passed']);
    expect(job.candidates.every((c) => c.attempts === 1 && c.hasImage)).toBe(true);
    expect(await budget.usedToday()).toBe(2);
    // シルエット画像を添えて呼んでいる。緑の服のときは緑のシルエットを避けている
    expect(imageCalls).toHaveLength(2);
    const green = imageCalls.find((c) => c.prompt.includes('green shirt'))!;
    expect(green.prompt).not.toMatch(/silhouette of a doll on a flat pure white/);
    expect(green.prompt).not.toMatch(/flat pure bright green \(#00FF00\) silhouette/);
    expect((await ok<{ dolls: { items: unknown[] }[] }>('GET', '/api/content')).dolls[0].items).toEqual([]);
    // 採用 = 候補の画像を、ふつうの保存 API に渡す
    const image = await call('GET', `/api/jobs/image?id=${id}&index=0`);
    expect(image.type).toBe('image/png');
    await ok('POST', '/api/items', { dollId, category: 'トップス', name: 'あかいシャツ', png: (image.body as Buffer).toString('base64') });
    expect((await ok<{ dolls: { items: unknown[] }[] }>('GET', '/api/content')).dolls[0].items).toHaveLength(1);
    expect((await call('GET', `/api/jobs/image?id=${id}&index=9`)).status).toBe(404);
  }, 60_000);
  it('検品で不合格なら、理由を添えて 1 回だけ作り直し、それでも不合格なら「注意あり」で残す', async () => {
    verdicts = [{ ok: false, reason: 'そでが欠けています' }, { ok: false, reason: 'まだ欠けています' }];
    const { id } = await ok<{ id: string }>('POST', '/api/jobs', { dollId, items: [(await plan()).items[0]] });
    await api.waitForJob(id);
    const c = (await ok<JobView>('GET', `/api/jobs?id=${id}`)).candidates[0];
    expect(c).toMatchObject({ status: 'flagged', attempts: 2, hasImage: true, notes: ['まだ欠けています'] });
    expect(imageCalls[1].prompt).toMatch(/そでが欠けています/);
    expect(await budget.usedToday()).toBe(2);
  }, 60_000);
  it('作り直しのあいだは「作成中」になり、作り直しが何も残さなければ前の回の画像を残す', async () => {
    verdicts = [{ ok: false, reason: 'そでが欠けています' }];
    const statuses: string[] = [];
    let calls = 0;
    let jobId = '';
    makeApi({
      text: fakeText,
      image: {
        async generate(input) {
          calls++;
          if (calls === 2) {
            statuses.push((await ok<JobView>('GET', `/api/jobs?id=${jobId}`)).candidates[0].status);
            return sharp({ create: { width: 600, height: 600, channels: 3, background: '#ffffff' } }).png().toBuffer(); // 何も描かれていない
          }
          return fakeImage.generate(input);
        },
      },
    });
    jobId = (await ok<{ id: string }>('POST', '/api/jobs', { dollId, items: [{ category: 'トップス', name: 'a', description: 'A red shirt.', colors: ['#c81e28'] }] })).id;
    await api.waitForJob(jobId);
    expect(statuses).toEqual(['working']);
    const c = (await ok<JobView>('GET', `/api/jobs?id=${jobId}`)).candidates[0];
    expect(c).toMatchObject({ status: 'flagged', attempts: 2, hasImage: true });
    expect(c.notes[0]).toBe('そでが欠けています');
    expect(c.notes[1]).toMatch(/作り直しは採用しませんでした/);
    const kept = (await call('GET', `/api/jobs/image?id=${jobId}&index=0`)).body as Buffer;
    expect((await sharp(kept).stats()).channels[3].max).toBe(255); // 1 回目の服が残っている
  }, 60_000);
  it('見た目の検品ができなかったら、画像は残し、作り直さない（もう 1 枚ぶん使わない）', async () => {
    makeApi({ text: { json: async <T,>(input: { prompt: string; schema: Record<string, unknown> }) => {
      if ('ok' in ((input.schema.properties ?? {}) as object)) throw new AiError('Claude API がこの依頼を受け付けませんでした', 422);
      return fakeText.json<T>(input as Parameters<TextAi['json']>[0]);
    } }, image: fakeImage });
    const { id } = await ok<{ id: string }>('POST', '/api/jobs', { dollId, items: [{ category: 'トップス', name: 'a', description: 'A red shirt.', colors: ['#c81e28'] }] });
    await api.waitForJob(id);
    const c = (await ok<JobView>('GET', `/api/jobs?id=${id}`)).candidates[0];
    expect(c).toMatchObject({ status: 'flagged', attempts: 1, hasImage: true });
    expect(c.notes[0]).toMatch(/検品ができませんでした/);
    expect(await budget.usedToday()).toBe(1);
  }, 60_000);
  it('既定では作り直さない: 検品で不合格でも 1 枚だけで「注意あり」になる。断られたときの書き直しは 1 回だけ行う', async () => {
    makeApi(undefined, undefined, null);
    expect((await ok<{ budget: { maxAttempts: number } }>('GET', '/api/status')).budget.maxAttempts).toBe(1);
    verdicts = [{ ok: false, reason: 'そでが欠けています' }];
    const { id } = await ok<{ id: string }>('POST', '/api/jobs', { dollId, items: [{ category: 'トップス', name: 'a', description: 'A red shirt.', colors: ['#c81e28'] }] });
    await api.waitForJob(id);
    const c = (await ok<JobView>('GET', `/api/jobs?id=${id}`)).candidates[0];
    expect(c).toMatchObject({ status: 'flagged', attempts: 1, hasImage: true, notes: ['そでが欠けています'] });
    expect(imageCalls).toHaveLength(1);

    let calls = 0;
    makeApi({ text: fakeText, image: { generate: async (input) => (++calls === 1 ? Promise.reject(new AiError('断りました', 422, false, true)) : fakeImage.generate(input)) } }, undefined, null);
    const second = await ok<{ id: string }>('POST', '/api/jobs', { dollId, items: [{ category: 'トップス', name: 'b', description: 'An Elsa dress.', colors: ['#c81e28'] }] });
    await api.waitForJob(second.id);
    expect((await ok<JobView>('GET', `/api/jobs?id=${second.id}`)).candidates[0]).toMatchObject({ status: 'passed', attempts: 2 });
    expect(calls).toBe(2);
  }, 60_000);
  it('画像生成が失敗したら、候補は「失敗」になり、理由が残る', async () => {
    makeApi({ text: fakeText, image: { generate: async () => { throw new AiError('Gemini API のキーが正しくありません', 500); } } });
    const { id } = await ok<{ id: string }>('POST', '/api/jobs', { dollId, items: [{ category: 'トップス', name: 'a', description: 'A shirt.', colors: [] }] });
    await api.waitForJob(id);
    const c = (await ok<JobView>('GET', `/api/jobs?id=${id}`)).candidates[0];
    expect(c).toMatchObject({ status: 'failed', attempts: 1, hasImage: false });
    expect(c.notes[0]).toMatch(/キー/);
  });
  it('上限: 1 回の実行の上限を超える品目数は、始める前に 429', async () => {
    const items = (await plan()).items;
    makeApi(undefined, { perDay: 20, perRun: 3 });
    expect(await errorOf(call('POST', '/api/jobs', { dollId, items }))).toMatchObject({ status: 429, error: expect.stringMatching(/最大 3 枚/) });
    expect(imageCalls).toHaveLength(0);
  });
  it('上限: 今日の上限を超えたら、それ以上は作らない', async () => {
    const item = (await plan()).items[0];
    makeApi(undefined, { perDay: 4, perRun: 4 });
    const first = await ok<{ id: string }>('POST', '/api/jobs', { dollId, items: [item, { ...item, name: 'べつ' }] });
    await api.waitForJob(first.id);
    expect(await budget.usedToday()).toBe(2);
    await ok<{ id: string }>('POST', '/api/jobs', { dollId, items: [item] }).then((j) => api.waitForJob(j.id));
    expect(await errorOf(call('POST', '/api/jobs', { dollId, items: [item] }))).toMatchObject({ status: 429, error: expect.stringMatching(/今日の上限/) });
    expect(imageCalls).toHaveLength(3);
  }, 60_000);
  it('背景: 案を作って生成し、採用すると背景に入る', async () => {
    const { id } = await ok<{ id: string }>('POST', '/api/background-jobs', { theme: 'うみ', count: 2 });
    await api.waitForJob(id);
    const job = await ok<JobView & { kind: string }>('GET', `/api/jobs?id=${id}`);
    expect(job.kind).toBe('backgrounds');
    expect(job.candidates.map((c) => [c.item.name, c.status])).toEqual([['うみべ', 'passed'], ['おしろ', 'passed']]);
    const image = (await call('GET', `/api/jobs/image?id=${id}&index=0`)).body as Buffer;
    expect((await sharp(image).metadata()).width).toBe(1024);
    const bg = await ok<{ id: string }>('POST', '/api/backgrounds?name=うみべ', image);
    expect(bg.id).toBe('bg/うみべ');
    expect((await call('POST', '/api/background-jobs', { theme: 'x', count: 11 })).status).toBe(400);
  });
});

describe('公開', () => {
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], { stdio: 'pipe' }).toString();

  it('git の作業フォルダでなければ 409。保存した内容は残る', async () => {
    const r = await errorOf(call('POST', '/api/publish', {}));
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/残っています/);
    expect((await ok<{ dolls: unknown[] }>('GET', '/api/content')).dolls).toHaveLength(1);
  });
  it('commit して push する。不要な画像は先に消す', async () => {
    const content = path.join(dir, 'content');
    const remote = path.join(dir, 'remote.git');
    execFileSync('git', ['init', '--bare', '-q', remote]);
    git(content, 'init', '-q', '-b', 'main');
    git(content, 'config', 'user.name', 't');
    git(content, 'config', 'user.email', 't@example.com');
    git(content, 'remote', 'add', 'origin', remote);
    git(content, 'add', '-A');
    git(content, 'commit', '-q', '-m', 'first');
    git(content, 'push', '-q', '-u', 'origin', 'main');
    await ok('POST', '/api/backgrounds?name=そら', await sharp({ create: { width: 300, height: 300, channels: 3, background: '#aaccff' } }).png().toBuffer());
    expect((await ok<{ git: { isRepo: boolean; changedFiles: number } }>('GET', '/api/status')).git).toMatchObject({ isRepo: true, changedFiles: 3 });
    const r = await ok<{ log: string }>('POST', '/api/publish', { message: 'そらを追加' });
    expect(r.log).toMatch(/そらを追加/);
    expect(git(remote, 'log', '--oneline', 'main').trim().split('\n')).toHaveLength(2);
    expect((await ok<{ git: { changedFiles: number } }>('GET', '/api/status')).git.changedFiles).toBe(0);
  });
  it('push 先が無ければ 502。変更は commit されて残り、もう一度押せる', async () => {
    const content = path.join(dir, 'content');
    git(content, 'init', '-q', '-b', 'main');
    git(content, 'config', 'user.name', 't');
    git(content, 'config', 'user.email', 't@example.com');
    const r = await errorOf(call('POST', '/api/publish', {}));
    expect(r.status).toBe(502);
    expect(r.error).toMatch(/もう一度/);
    expect((await ok<{ dolls: unknown[] }>('GET', '/api/content')).dolls).toHaveLength(1);
    expect((await errorOf(call('POST', '/api/publish', {}))).status).toBe(502);
  });
});
