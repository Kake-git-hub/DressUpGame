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
import { deleteItem, discard, keep, listItems, listJobs, normalizePhoto, runJob, signIn, startJob } from './studioCore.ts';
import type { CoreDeps } from './studioCore.ts';

let dir: string;
let store: MemoryStore;
let files: MemoryFiles;
let deps: CoreDeps;
let dollId: string;
let imageCalls: number;
let textCalls: number;
let failImages: boolean;
let imageGate: Promise<void> | null; // 絵ができるのを、ここで待たせる（長くかかる生成のまね）
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
    if (imageGate) await imageGate;
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
    textCalls++;
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
  textCalls = 0;
  failImages = false;
  imageGate = null;
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
  it('チケットが足りないときは、文章の AI（企画）も呼ばない（作者の費用で、ただで呼ばせない）', async () => {
    await userWith('u1', 2);
    const before = textCalls;
    expect(code(await startJob(deps, 'u1', { dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'set', categoryIds: ['トップス', 'ボトムス', 'アクセサリー'] } }).catch((e) => e))).toBe('no-tickets');
    expect(textCalls).toBe(before);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
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
  it('チケットの数が壊れている（数でない）利用者は、0 枚として扱う（ただで作れない）', async () => {
    await userWith('u1', 0);
    (store.users.get('u1') as unknown as { tickets: unknown }).tickets = '10';
    expect(code(await startJob(deps, 'u1', oneTop()).catch((e) => e))).toBe('no-tickets');
    expect(code(await store.charge('u1', 1, 'x', clock).catch((e) => e))).toBe('no-tickets');
    expect(textCalls).toBe(0);
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
  it('1 点に長くかかっていても、作っている間は「動いている」と分かる（呼び直されても、二重に作らない）', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    let release = () => {};
    imageGate = new Promise((resolve) => (release = resolve));
    deps.heartbeatMs = 10;
    const first = runJob(deps, 'u1', jobId);
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    while (imageCalls === 0) await wait(10);
    clock += 100_000;
    await wait(60); // この間に、合図が更新される
    clock += 100_000; // 始めてから 200 秒。合図が無ければ「止まっている」とみなされる長さ
    await runJob(deps, 'u1', jobId);
    expect(imageCalls).toBe(1);
    release();
    await first;
    expect((await store.getJob('u1', jobId))!.candidates[0].status).toBe('done');
    expect(imageCalls).toBe(1);
    // 終わったら、合図は止まる
    const beat = (await store.getJob('u1', jobId))!.heartbeat;
    clock += 5_000;
    await wait(40);
    expect((await store.getJob('u1', jobId))!.heartbeat).toBe(beat);
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
  it('同時に 2 回呼んで、どちらも失敗しても、チケットは 1 回しか戻らない', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    failImages = true;
    await Promise.all([runJob(deps, 'u1', jobId), runJob(deps, 'u1', jobId), runJob(deps, 'u1', jobId)]);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    expect(store.ledger.filter((l) => l.reason.startsWith('refund')).length).toBe(1);
    expect((await store.getJob('u1', jobId))!.tickets).toBe(0);
  }, 60_000);
  it('同じ品目の払い戻しは、何度呼ばれても 1 回だけ（途中で止まって作り直し、また失敗しても、二重に戻らない）', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    // 払い戻しは済んだが、進み具合を書く前に止まった、という状態
    await store.refundOnce('u1', `${jobId}:0`, `refund:${jobId}:0`, clock);
    await store.updateJob('u1', jobId, (job) => ({ ...job, candidates: job.candidates.map((c) => ({ ...c, status: 'working' as const })) }));
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    clock += 200_000;
    failImages = true;
    await runJob(deps, 'u1', jobId);
    expect((await store.getJob('u1', jobId))!.candidates[0].status).toBe('failed');
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
  }, 60_000);
  it('追い越された古い処理（止まったとみなされ、別の処理が作り終えた）が、あとから失敗しても、できた服を壊さない・チケットを戻さない', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    let release = () => {};
    imageGate = new Promise((resolve) => (release = resolve));
    deps.heartbeatMs = 3_600_000; // 合図が止まった古い処理
    const old = runJob(deps, 'u1', jobId);
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    while (imageCalls === 0) await wait(10);
    clock += 200_000;
    imageGate = null;
    await runJob(deps, 'u1', jobId); // 別の処理が引き継いで、作り終える
    const done = (await store.getJob('u1', jobId))!;
    expect(done.candidates[0].status).toBe('done');
    failImages = true; // 古い処理は、このあと失敗する
    release();
    await old;
    const after = (await store.getJob('u1', jobId))!;
    expect(after.candidates[0].status).toBe('done');
    expect(after.tickets).toBe(1);
    expect(await files.get(after.candidates[0].preview!.path)).toBeTruthy();
    expect(await files.get(after.candidates[0].layers!.png!)).toBeTruthy();
    expect((await signIn(deps, 'u1')).tickets).toBe(1);
  }, 60_000);
  it('1 回の呼び出しで進めるのは、決めた時間まで。残りは「止まっている」と知らせて、呼び直しで続きを進める', async () => {
    await userWith('u1', 5);
    const { jobId } = await startJob(deps, 'u1', { dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'set', categoryIds: ['トップス', 'アクセサリー'] } });
    deps.runBudgetMs = 0;
    await runJob(deps, 'u1', jobId);
    const half = (await store.getJob('u1', jobId))!;
    expect(half.candidates.map((c) => c.status)).toEqual(['done', 'waiting']);
    expect(half.done).toBe(false);
    await runJob(deps, 'u1', jobId); // すぐ呼び直しても、続きを進める（だれも作っていない）
    expect((await store.getJob('u1', jobId))!.candidates.map((c) => c.status)).toEqual(['done', 'done']);
    expect((await store.getJob('u1', jobId))!.done).toBe(true);
    expect(imageCalls).toBe(2);
  }, 60_000);
  it('利用者ごとの 1 日の上限: 超えた分は作らずに「できなかった」にして、チケットを戻す（1 人が、みんなの分を使い切らない）。管理者には、かからない', async () => {
    await userWith('u1', 5);
    deps.limits = { perDay: 20, perUserDay: 1, maxAttempts: 1 };
    const { jobId } = await startJob(deps, 'u1', { dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'set', categoryIds: ['トップス', 'アクセサリー'] } });
    await runJob(deps, 'u1', jobId);
    const job = (await store.getJob('u1', jobId))!;
    expect(job.candidates.map((c) => c.status)).toEqual(['done', 'failed']);
    expect(job.candidates[1].notes.join('')).toMatch(/上限/);
    expect(imageCalls).toBe(1);
    expect((await signIn(deps, 'u1')).tickets).toBe(4);
    // ほかの利用者は作れる
    await userWith('u2', 1);
    const other = await startJob(deps, 'u2', oneTop());
    await runJob(deps, 'u2', other.jobId);
    expect((await store.getJob('u2', other.jobId))!.candidates[0].status).toBe('done');
    // 管理者
    const boss = await signIn(deps, 'u3');
    deps.adminCodes = [boss.userCode];
    const a = await startJob(deps, 'u3', { dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'set', categoryIds: ['トップス', 'アクセサリー'] } });
    await runJob(deps, 'u3', a.jobId);
    expect((await store.getJob('u3', a.jobId))!.candidates.map((c) => c.status)).toEqual(['done', 'done']);
  }, 60_000);
  it('管理者として始めた仕事は、途中で管理者でなくなっても、チケットを戻さない（引いていないので）', async () => {
    const boss = await signIn(deps, 'u1');
    deps.adminCodes = [boss.userCode];
    const { jobId } = await startJob(deps, 'u1', oneTop());
    deps.adminCodes = [];
    failImages = true;
    await runJob(deps, 'u1', jobId);
    expect((await store.getJob('u1', jobId))!.candidates[0].status).toBe('failed');
    expect((await signIn(deps, 'u1')).tickets).toBe(0);
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
  it('同じ候補を、同時に 2 回「使う」「捨てる」しても、通るのは 1 回だけ', async () => {
    const jobId = await made();
    const kept = await Promise.all([keep(deps, 'u1', jobId, 0, 'a').then(() => 'ok', code), keep(deps, 'u1', jobId, 0, 'b').then(() => 'ok', code), discard(deps, 'u1', jobId, 0).then(() => 'ok', code)]);
    expect(kept.filter((r) => r === 'ok')).toHaveLength(1);
    expect(kept.filter((r) => r === 'refused')).toHaveLength(2);
    const status = (await store.getJob('u1', jobId))!.candidates[0].status;
    expect(await listItems(deps, 'u1')).toHaveLength(status === 'kept' ? 1 : 0);
    const again = await made('u2');
    const dropped = await Promise.all([discard(deps, 'u2', again, 0).then(() => 'ok', code), discard(deps, 'u2', again, 0).then(() => 'ok', code)]);
    expect(dropped.sort()).toEqual(['ok', 'refused']);
  }, 60_000);
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

describe('顔写真から顔を作る', () => {
  const photoJpeg = () => sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#d0a080' } }).jpeg().toBuffer();
  const face = (photo: Buffer | null, theme = '') => ({ dollId, theme, styleId: 'anime', target: { kind: 'category' as const, categoryId: 'かお' }, photo });
  // 企画・絵を作る AI に渡った画像の数と、指示文を控える
  let planImages: number[];
  let genImages: number[];
  let genPrompts: string[];
  beforeEach(() => {
    planImages = [];
    genImages = [];
    genPrompts = [];
    deps.ai = {
      text: {
        async json<T>(input: { prompt: string; images?: Buffer[]; schema: Record<string, unknown> }): Promise<T> {
          const props = (input.schema.properties ?? {}) as Record<string, unknown>;
          if ('ok' in props) return { ok: true, reason: 'よい' } as T;
          planImages.push(input.images?.length ?? 0);
          return { items: [{ category: 'かお', name: 'わたしのかお', description: 'Big round brown eyes and a small smile.', colors: ['#663300'] }] } as T;
        },
      },
      image: {
        async generate(input) {
          genImages.push(input.images.length);
          genPrompts.push(input.prompt);
          return fakeImage.generate(input);
        },
      },
    };
  });

  it('写真を小さな PNG にして預かり、企画と絵を作る AI に渡す。テーマは無くてもよい。終わったら写真を消す', async () => {
    await userWith('u1', 1);
    const { jobId } = await startJob(deps, 'u1', face(await photoJpeg()));
    expect(planImages).toEqual([1]);
    const job = (await store.getJob('u1', jobId))!;
    expect(job.theme).toBe('写真の顔');
    expect(job.photo).toBe(`users/u1/jobs/${jobId}/photo.png`);
    const saved = (await files.get(job.photo!))!;
    const meta = await sharp(saved).metadata();
    expect(meta.format).toBe('png');
    expect(Math.max(meta.width!, meta.height!)).toBe(768);

    await runJob(deps, 'u1', jobId);
    expect(genImages[0]).toBe(2);
    expect(genPrompts[0]).toMatch(/resemble the person in the photo/);
    expect((await store.getJob('u1', jobId))!.done).toBe(true);
    expect(await files.get(job.photo!)).toBeNull();
  });
  it('写真が無ければ、顔はいつもどおり（ドールの頭だけを渡す）', async () => {
    await userWith('u1', 1);
    const { jobId } = await startJob(deps, 'u1', face(null, 'にっこり'));
    expect(planImages).toEqual([0]);
    expect((await store.getJob('u1', jobId))!.photo).toBeUndefined();
    await runJob(deps, 'u1', jobId);
    expect(genImages[0]).toBe(1);
  });
  it('写真は顔のカテゴリ 1 点のときだけ。画像でない・大きすぎるものは断る。断ったときは、チケットを引かない', async () => {
    await userWith('u1', 3);
    const photo = await photoJpeg();
    expect(code(await startJob(deps, 'u1', { ...oneTop(), photo }).catch((e) => e))).toBe('refused');
    expect(code(await startJob(deps, 'u1', { dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'set', categoryIds: ['かお', 'トップス'] }, photo }).catch((e) => e))).toBe('refused');
    expect(code(await startJob(deps, 'u1', face(Buffer.from('not an image'))).catch((e) => e))).toBe('refused');
    expect(code(await normalizePhoto(Buffer.alloc(4_000_001)).catch((e) => e))).toBe('refused');
    expect((await signIn(deps, 'u1')).tickets).toBe(3);
    expect(planImages).toEqual([]);
  });
});
