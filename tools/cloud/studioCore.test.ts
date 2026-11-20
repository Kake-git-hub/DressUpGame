// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentStore } from '../content/manifestEdit.ts';
import type { ImageAi, TextAi } from '../studio/ai.ts';
import { AiError } from '../studio/ai.ts';
import { DollAssets } from '../studio/dollAssets.ts';
import { MemoryFiles, MemoryStore } from './memoryStore.ts';
import { CloudError } from './store.ts';
import { deleteItem, discard, keep, listItems, listJobs, runJob, signIn, startJob } from './studioCore.ts';
import type { CoreDeps } from './studioCore.ts';

let dir: string;
let store: MemoryStore;
let files: MemoryFiles;
let deps: CoreDeps;
let dollId: string;
let imageCalls: number;
let failImages: boolean;
let clock: number;
let ids: number;

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
    imageCalls++;
    if (failImages) throw new AiError('Gemini API のエラー（500）: boom');
    const meta = await sharp(input.images[0]).metadata();
    const w = meta.width!;
    const cloth = await sharp({ create: { width: Math.round(w * 0.24), height: Math.round(w * 0.2), channels: 3, background: '#c81e28' } }).png().toBuffer();
    return sharp(input.images[0]).composite([{ input: cloth, left: Math.round(w * 0.38), top: Math.round(w * 0.22) }]).png().toBuffer();
  },
};
// 偽の文章の AI: 企画（1 点・セット）と、検品（いつも合格）
const fakeText: TextAi = {
  async json<T>(input: { prompt: string; schema: Record<string, unknown> }): Promise<T> {
    const props = (input.schema.properties ?? {}) as Record<string, unknown>;
    if ('ok' in props) return { ok: true, reason: 'よくできています' } as T;
    const wanted = [...input.prompt.matchAll(/^- (\S+)/gm)].map((m) => m[1]).filter((id) => ['トップス', 'アクセサリー', 'ボトムス', 'くつ'].includes(id));
    const items = wanted.filter((id) => id !== 'ボトムス').map((category) => ({ category, name: `うみの${category}`, description: `A red ${category}.`, colors: ['#c81e28'] }));
    return ('name' in props ? { name: 'うみのセット', items } : { items }) as T;
  },
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-'));
  const content = new ContentStore(dir);
  await content.init();
  dollId = (await content.addDoll({ name: 'テスト', data: await dollPng() })).id;
  store = new MemoryStore();
  files = new MemoryFiles();
  imageCalls = 0;
  failImages = false;
  clock = 1_000_000;
  ids = 0;
  deps = {
    store,
    files,
    ai: { text: fakeText, image: fakeImage },
    content: {
      manifest: () => content.read(),
      assets: new DollAssets({ readFile: (file) => fs.readFile(path.join(dir, file)).catch(() => null), readTemplates: async () => ({}) }),
    },
    adminCodes: [],
    limits: { perDay: 20, maxAttempts: 1 },
    now: () => clock,
    newId: () => `job${++ids}`,
  };
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const oneTop = () => ({ dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category' as const, categoryId: 'トップス' } });
const code = (e: unknown) => (e instanceof CloudError ? e.code : `not a CloudError: ${String(e)}`);
async function userWith(uid: string, tickets: number) {
  await signIn(deps, uid);
  if (tickets > 0) await store.addTickets(uid, tickets, 'test', clock);
}

describe('利用者', () => {
  it('初めてなら作る（チケット 0 枚、8 文字の利用者コード）。2 回目は同じ利用者', async () => {
    const a = await signIn(deps, 'u1');
    expect(a).toMatchObject({ tickets: 0, admin: false });
    expect(a.userCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(await signIn(deps, 'u1')).toEqual(a);
    expect((await signIn(deps, 'u2')).userCode).not.toBe(a.userCode);
  });
  it('管理者は、秘密の値にある利用者コードで決まる', async () => {
    const a = await signIn(deps, 'u1');
    deps.adminCodes = [a.userCode];
    expect((await signIn(deps, 'u1')).admin).toBe(true);
    expect((await signIn(deps, 'u2')).admin).toBe(false);
  });
});

describe('生成を始める', () => {
  it('チケットを 1 枚引いて、順番待ちの仕事ができる', async () => {
    await userWith('u1', 2);
    const { jobId, cost } = await startJob(deps, 'u1', oneTop());
    expect(cost).toBe(1);
    expect((await signIn(deps, 'u1')).tickets).toBe(1);
    const job = (await store.getJob('u1', jobId))!;
    expect(job).toMatchObject({ dollId, done: false, tickets: 1 });
    expect(job.candidates).toHaveLength(1);
    expect(job.candidates[0]).toMatchObject({ index: 0, categoryId: 'トップス', name: 'うみのトップス', status: 'waiting' });
    expect(imageCalls).toBe(0); // 始めるだけでは、絵は作らない
  });
  it('チケットが足りないときは断り、何も引かない・作らない', async () => {
    await userWith('u1', 0);
    expect(code(await startJob(deps, 'u1', oneTop()).catch((e) => e))).toBe('no-tickets');
    expect(await listJobs(deps, 'u1')).toEqual([]);
  });
  it('セット: 企画に入った点数だけ引く（企画が落としたカテゴリの分は引かない）', async () => {
    await userWith('u1', 5);
    const { jobId, cost } = await startJob(deps, 'u1', { dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'set', categoryIds: ['トップス', 'ボトムス', 'アクセサリー'] } });
    expect(cost).toBe(2); // 偽の企画は、ボトムスを返さない
    const job = (await store.getJob('u1', jobId))!;
    expect(job.set).toEqual({ id: `my:set-${jobId}`, name: 'うみのセット' });
    expect(job.candidates.map((c) => c.categoryId)).toEqual(['トップス', 'アクセサリー']);
    expect((await signIn(deps, 'u1')).tickets).toBe(3);
  });
  it('入力の確かめ: テーマ（1〜60 文字）、ドール、カテゴリ、セットの数（2〜6）', async () => {
    await userWith('u1', 9);
    const start = (change: object) => startJob(deps, 'u1', { ...oneTop(), ...change } as never).catch((e) => code(e));
    expect(await start({ theme: ' ' })).toBe('refused');
    expect(await start({ theme: 'あ'.repeat(61) })).toBe('refused');
    expect(await start({ dollId: 'ない' })).toBe('refused');
    expect(await start({ target: { kind: 'category', categoryId: 'ない' } })).toBe('refused');
    expect(await start({ target: { kind: 'set', categoryIds: ['トップス'] } })).toBe('refused');
    expect(await start({ target: { kind: 'set', categoryIds: ['トップス', 'アクセサリー', 'くつ', 'ボトムス', 'ぼうし', 'ソックス', 'インナー'] } })).toBe('refused');
    expect((await signIn(deps, 'u1')).tickets).toBe(9);
  });
  it('1 枚しか無いのに、同時に 2 回始めても、1 回だけ通る', async () => {
    await userWith('u1', 1);
    const results = await Promise.all([startJob(deps, 'u1', oneTop()).catch((e) => code(e)), startJob(deps, 'u1', oneTop()).catch((e) => code(e))]);
    expect(results.filter((r) => r === 'no-tickets')).toHaveLength(1);
    expect((await signIn(deps, 'u1')).tickets).toBe(0);
  });
  it('管理者は、チケットが無くても作れる（残りは変わらず、台帳には残る）', async () => {
    const a = await signIn(deps, 'u1');
    deps.adminCodes = [a.userCode];
    await startJob(deps, 'u1', oneTop());
    expect((await signIn(deps, 'u1')).tickets).toBe(0);
    expect(store.ledger.some((l) => l.uid === 'u1' && l.reason.startsWith('admin'))).toBe(true);
  });
  it('AI のキーが設定されていないときは、引かずに断る', async () => {
    await userWith('u1', 2);
    deps.ai = { text: null, image: null };
    expect(code(await startJob(deps, 'u1', oneTop()).catch((e) => e))).toBe('unknown');
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
  });
});

describe('生成を進める', () => {
  it('できた服の絵（切り抜き）と位置、保存用の絵が置き場に入り、仕事が終わる', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    clock += 5000;
    await runJob(deps, 'u1', jobId);
    const job = (await store.getJob('u1', jobId))!;
    expect(job.done).toBe(true);
    expect(job.heartbeat).toBe(clock);
    const c = job.candidates[0];
    expect(c.status).toBe('done');
    expect(c.preview!.path).toBe(`users/u1/jobs/${jobId}/0-preview.png`);
    expect(c.preview!.canvasW).toBeGreaterThan(1024); // 余白つきの作業用のキャンバス
    expect(c.preview!.box.w).toBeGreaterThan(50);
    const preview = await sharp((await files.get(c.preview!.path))!).metadata();
    expect([preview.width, preview.height]).toEqual([c.preview!.box.w, c.preview!.box.h]);
    expect(await files.get(c.layers!.png!)).toBeTruthy();
    expect(imageCalls).toBe(1);
    expect(store.usage.get(new Date(clock).toISOString().slice(0, 10))).toBe(1);
    // もう一度呼んでも、作り直さない
    await runJob(deps, 'u1', jobId);
    expect(imageCalls).toBe(1);
  }, 60_000);
  it('絵ができなかった品目は「できなかった」になり、その分のチケットが戻る', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    failImages = true;
    await runJob(deps, 'u1', jobId);
    const job = (await store.getJob('u1', jobId))!;
    expect(job.done).toBe(true);
    expect(job.tickets).toBe(0);
    expect(job.candidates[0].status).toBe('failed');
    expect(job.candidates[0].notes.join('')).toMatch(/チケットは戻しました/);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
  }, 60_000);
  it('その日の上限に達していたら、作らずに「できなかった」にして、チケットを戻す', async () => {
    await userWith('u1', 2);
    deps.limits = { perDay: 0, maxAttempts: 1 };
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await runJob(deps, 'u1', jobId);
    expect(imageCalls).toBe(0);
    expect((await store.getJob('u1', jobId))!.candidates[0].notes.join('')).toMatch(/上限/);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
  }, 60_000);
  it('同時に 2 回呼んでも、絵は 1 回しか作らない', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await Promise.all([runJob(deps, 'u1', jobId), runJob(deps, 'u1', jobId)]);
    expect(imageCalls).toBe(1);
    expect((await store.getJob('u1', jobId))!.candidates[0].status).toBe('done');
  }, 60_000);
  it('途中で止まっていた仕事（作成中のまま 3 分たった）は、呼び直すと続きを進める。止まっていない仕事には手を出さない', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await store.updateJob('u1', jobId, (job) => ({ ...job, heartbeat: clock, candidates: job.candidates.map((c) => ({ ...c, status: 'working' as const })) }));
    clock += 60_000; // 1 分: まだ動いているかもしれない
    await runJob(deps, 'u1', jobId);
    expect(imageCalls).toBe(0);
    clock += 180_000; // さらに 3 分: 止まっている
    await runJob(deps, 'u1', jobId);
    expect(imageCalls).toBe(1);
    expect((await store.getJob('u1', jobId))!.done).toBe(true);
  }, 60_000);
  it('ほかの利用者の仕事は進められない', async () => {
    await userWith('u1', 2);
    await signIn(deps, 'u2');
    const { jobId } = await startJob(deps, 'u1', oneTop());
    expect(code(await runJob(deps, 'u2', jobId).catch((e) => e))).toBe('refused');
    expect(imageCalls).toBe(0);
  });
});

describe('使う・捨てる・消す', () => {
  async function made(uid = 'u1', target: object = { kind: 'category', categoryId: 'トップス' }) {
    await userWith(uid, 5);
    const { jobId } = await startJob(deps, uid, { dollId, theme: 'うみ', styleId: 'anime', target } as never);
    await runJob(deps, uid, jobId);
    return jobId;
  }
  it('「使う」: 自分の服ができる（my: の ID、WebP の絵、置き場のパス）。候補は「使った」になる', async () => {
    const jobId = await made();
    const item = await keep(deps, 'u1', jobId, 0, 'あたらしいなまえ');
    expect(item.id).toBe(`my:${jobId}-0`);
    expect(item.dollId).toBe(dollId);
    expect(item.item).toMatchObject({ id: item.id, name: 'あたらしいなまえ', category: 'トップス' });
    expect(item.item.image.canvasW).toBeGreaterThan(1024);
    expect(item.item.image.file).toMatch(/^files\/[0-9a-f]{16}\.webp$/);
    for (const name of [item.item.image.file, item.item.thumb]) {
      expect(item.paths[name]).toBe(`users/u1/items/my_${jobId}-0/${name.split('/').pop()}`); // 置き場のパスには、記号を使わない
      expect((await sharp((await files.get(item.paths[name]))!).metadata()).format).toBe('webp');
    }
    expect((await store.getJob('u1', jobId))!.candidates[0].status).toBe('kept');
    expect((await listItems(deps, 'u1')).map((i) => i.id)).toEqual([item.id]);
    // 同じ候補は、2 回は使えない。名前が空なら、企画の名前
    expect(code(await keep(deps, 'u1', jobId, 0, 'x').catch((e) => e))).toBe('refused');
  }, 60_000);
  it('セットの服は、セットの印を引き継ぐ。名前が空・長すぎるときは、整える', async () => {
    const jobId = await made('u1', { kind: 'set', categoryIds: ['トップス', 'アクセサリー'] });
    const a = await keep(deps, 'u1', jobId, 0, '   ');
    expect(a.item.name).toBe('うみのトップス');
    expect(a.set).toEqual({ id: `my:set-${jobId}`, name: 'うみのセット' });
    const b = await keep(deps, 'u1', jobId, 1, 'あ'.repeat(50));
    expect(b.item.name).toHaveLength(20);
    expect(b.set).toEqual(a.set);
  }, 60_000);
  it('「捨てる」: 候補は「捨てた」になり、絵も消える。決めていない候補のある仕事だけが、一覧に残る', async () => {
    const jobId = await made('u1', { kind: 'set', categoryIds: ['トップス', 'アクセサリー'] });
    expect((await listJobs(deps, 'u1')).map((j) => j.id)).toEqual([jobId]);
    await discard(deps, 'u1', jobId, 0);
    expect([...files.files.keys()].some((k) => k.includes(`/jobs/${jobId}/0-`))).toBe(false);
    expect((await listJobs(deps, 'u1'))[0].candidates.map((c) => c.status)).toEqual(['discarded', 'done']);
    await keep(deps, 'u1', jobId, 1, 'かざり');
    expect(await listJobs(deps, 'u1')).toEqual([]);
    expect(code(await discard(deps, 'u1', jobId, 1).catch((e) => e))).toBe('refused');
  }, 60_000);
  it('自分の服を消すと、一覧からも置き場からも消える。ほかの利用者の服は、見えない・消せない', async () => {
    const jobId = await made();
    const item = await keep(deps, 'u1', jobId, 0, 'ふく');
    await signIn(deps, 'u2');
    expect(await listItems(deps, 'u2')).toEqual([]);
    expect(code(await keep(deps, 'u2', jobId, 0, 'x').catch((e) => e))).toBe('refused');
    await deleteItem(deps, 'u2', item.id); // 何も起きない
    expect(await listItems(deps, 'u1')).toHaveLength(1);
    await deleteItem(deps, 'u1', item.id);
    expect(await listItems(deps, 'u1')).toEqual([]);
    expect([...files.files.keys()].some((k) => k.includes('/items/'))).toBe(false);
  }, 60_000);
});
