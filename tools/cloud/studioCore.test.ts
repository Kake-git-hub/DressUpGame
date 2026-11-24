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
import { ackJob, adoptUser, deleteItem, drain, drainAdopted, EXPIRE_MS, QUEUE_WAIT_MS, REQUEUE_MS, listItems, normalizePhoto, offerHandoff, openJobs, orderItems, runJob, settleRefunds, signIn, startJob, sweep, tendJob, updateItem, workJob } from './studioCore.ts';
import type { CoreDeps } from './studioCore.ts';
import type { CandidateDoc, ItemDoc, JobDoc } from './store.ts';

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
let words: number;
let enqueued: [string, string, number | undefined][]; // 列に入れた仕事（利用者・仕事・何秒あとか）
let enqueueFails: boolean;

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
  words = 0;
  enqueued = [];
  enqueueFails = false;
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
    newWord: () => `word${++words}`,
    enqueue: async (uid, jobId, delaySeconds) => {
      if (enqueueFails) throw new Error('queue down');
      enqueued.push([uid, jobId, delaySeconds]);
    },
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
    expect(await store.listJobs('u1')).toEqual([]);
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

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const twoParts = () => ({ dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'set' as const, categoryIds: ['トップス', 'アクセサリー'] } });
const candidateOf = async (uid: string, jobId: string, index = 0): Promise<CandidateDoc> => (await store.getJob(uid, jobId))!.candidates[index];
const setJob = (uid: string, jobId: string, change: (job: JobDoc) => JobDoc) => store.updateJob(uid, jobId, change);
const refunds = () => store.ledger.filter((l) => l.reason.startsWith('refund'));

describe('生成を始める（列）', () => {
  it('チケットを引き、仕事を作り、列に入れる', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    expect(enqueued).toEqual([['u1', jobId, undefined]]);
    const job = (await store.getJob('u1', jobId))!;
    expect(job.v).toBe(2);
    expect(job.queuedAt).toBe(clock);
    expect(store.ledger).toContainEqual({ uid: 'u1', count: -1, reason: `job:${jobId}`, at: clock });
  });
  it('列に入れられなくても、仕事はできている（あとの入れ直しが拾う）', async () => {
    await userWith('u1', 2);
    enqueueFails = true;
    const { jobId } = await startJob(deps, 'u1', oneTop());
    expect((await store.getJob('u1', jobId))!.done).toBe(false);
    expect((await signIn(deps, 'u1')).tickets).toBe(1);
  });
});

describe('生成を進める', () => {
  it('できた品目は、その場で自分の服になる（my: の ID、WebP の絵、置き場のパス）。仕事が終わる', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    clock += 5000;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    const job = (await store.getJob('u1', jobId))!;
    expect(job.done).toBe(true);
    expect(job.heartbeat).toBe(clock);
    const c = job.candidates[0];
    expect(c).toMatchObject({ status: 'kept', itemId: `my:${jobId}-0-1`, tries: 1 });
    const items = await listItems(deps, 'u1');
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item).toMatchObject({ id: `my:${jobId}-0-1`, dollId, createdAt: clock, order: clock, updatedAt: clock });
    expect(item.item).toMatchObject({ id: item.id, name: 'うみのトップス', category: 'トップス' });
    expect(item.item.image.canvasW).toBeGreaterThan(1024); // 余白つきの作業用のキャンバス
    expect(item.item.image.file).toMatch(/^files\/[0-9a-f]{16}\.webp$/);
    for (const name of [item.item.image.file, item.item.thumb]) {
      expect(item.paths[name]).toBe(`users/u1/items/my_${jobId}-0-1/${name.split('/').pop()}`); // 置き場のパスには、記号を使わない
      expect((await sharp((await files.get(item.paths[name]))!).metadata()).format).toBe('webp');
    }
    // 候補の絵は、もう置き場に残さない
    expect([...files.files.keys()].filter((k) => k.startsWith('users/u1/jobs/'))).toEqual([]);
    expect(imageCalls).toBe(1);
    expect(store.usage.get(new Date(clock).toISOString().slice(0, 10))).toBe(1);
    // もう一度呼んでも、作り直さない
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect(imageCalls).toBe(1);
    expect(await listItems(deps, 'u1')).toHaveLength(1);
  }, 60_000);
  it('セットは、パーツの数だけ服になり、同じ set が付く', async () => {
    await userWith('u1', 5);
    const { jobId } = await startJob(deps, 'u1', twoParts());
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    const items = await listItems(deps, 'u1');
    expect(items.map((i) => i.item.category).sort()).toEqual(['アクセサリー', 'トップス']);
    for (const item of items) expect(item.set).toEqual({ id: `my:set-${jobId}`, name: 'うみのセット' });
    expect((await store.getJob('u1', jobId))!.candidates.map((c) => c.status)).toEqual(['kept', 'kept']);
  }, 60_000);
  it('できなかった品目は、failed → 払い戻し → refunded: true。服はできない', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    failImages = true;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    const job = (await store.getJob('u1', jobId))!;
    expect(job.done).toBe(true);
    expect(job.tickets).toBe(0);
    expect(job.candidates[0]).toMatchObject({ status: 'failed', refunded: true });
    expect(job.candidates[0].notes.join('')).toMatch(/チケットは戻しました/);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    expect(await listItems(deps, 'u1')).toEqual([]);
  }, 60_000);
  it('failed と書いたあと、払い戻しの前に止まっても、次の呼び出しが戻す（1 回だけ）', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    failImages = true;
    const real = store.refundOnce.bind(store);
    let broken = true;
    store.refundOnce = async (...args) => {
      if (broken) {
        broken = false;
        throw new Error('crashed before the refund');
      }
      return real(...args);
    };
    await expect(runJob(deps, 'u1', jobId)).rejects.toThrow('crashed'); // 列が、間をあけて呼び直す
    expect(await candidateOf('u1', jobId)).toMatchObject({ status: 'failed', refunded: false });
    expect((await signIn(deps, 'u1')).tickets).toBe(1);
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect((await candidateOf('u1', jobId)).refunded).toBe(true);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    await runJob(deps, 'u1', jobId);
    await settleRefunds(deps, 'u1', jobId);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    expect(refunds()).toHaveLength(1);
  }, 60_000);
  it('前の版で払い戻しの済んだ failed（refunded の印なし）は、二重に戻さず、印だけ付ける', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await store.refundOnce('u1', `${jobId}:0`, `refund:${jobId}:0`, clock);
    await setJob('u1', jobId, (job) => ({ ...job, done: true, tickets: 0, candidates: job.candidates.map((c) => ({ ...c, status: 'failed' as const })) }));
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    await settleRefunds(deps, 'u1', jobId);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    expect((await candidateOf('u1', jobId)).refunded).toBe(true);
  });
  it('3 回取りかかって止まった品目は、作らずに打ち切って、払い戻す', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await setJob('u1', jobId, (job) => ({ ...job, heartbeat: clock, candidates: job.candidates.map((c) => ({ ...c, status: 'working' as const, tries: 3 })) }));
    clock += 200_000;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    const job = (await store.getJob('u1', jobId))!;
    expect(job.done).toBe(true);
    expect(job.candidates[0]).toMatchObject({ status: 'failed', refunded: true });
    expect(job.candidates[0].notes.join('')).toMatch(/途中で止まりました.*チケットは戻しました/);
    expect(imageCalls).toBe(0);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    expect(refunds()).toHaveLength(1);
  }, 60_000);
  it('2 回止まった品目は、3 回目に取りかかる（上限の手前）', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await setJob('u1', jobId, (job) => ({ ...job, heartbeat: clock, candidates: job.candidates.map((c) => ({ ...c, status: 'working' as const, tries: 2 })) }));
    clock += 200_000;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect(await candidateOf('u1', jobId)).toMatchObject({ status: 'kept', tries: 3, itemId: `my:${jobId}-0-3` });
  }, 60_000);
  it('その日の上限に達していたら、作らずに「できなかった」にして、チケットを戻す', async () => {
    await userWith('u1', 2);
    deps.limits = { perDay: 0, maxAttempts: 1 };
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await runJob(deps, 'u1', jobId);
    expect(imageCalls).toBe(0);
    expect((await candidateOf('u1', jobId)).notes.join('')).toMatch(/上限/);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
  }, 60_000);
  it('同時に 3 回呼んでも、絵は 1 回、服は 1 点', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    const results = await Promise.all([runJob(deps, 'u1', jobId), runJob(deps, 'u1', jobId), runJob(deps, 'u1', jobId)]);
    expect(results.filter((r) => r === 'done')).toHaveLength(1);
    expect(results.filter((r) => r === 'busy')).toHaveLength(2);
    expect(imageCalls).toBe(1);
    expect(await listItems(deps, 'u1')).toHaveLength(1);
  }, 60_000);
  it("ほかの呼び出しが進めていたら 'busy'（手を出さない）。1 点に長くかかっていても、合図で「動いている」と分かる", async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    let release = () => {};
    imageGate = new Promise((resolve) => (release = resolve));
    deps.heartbeatMs = 10;
    const first = runJob(deps, 'u1', jobId);
    while (imageCalls === 0) await wait(10);
    clock += 100_000;
    await wait(60); // この間に、合図が更新される
    clock += 100_000; // 始めてから 200 秒。合図が無ければ「止まっている」とみなされる長さ
    expect(await runJob(deps, 'u1', jobId)).toBe('busy');
    expect(imageCalls).toBe(1);
    release();
    expect(await first).toBe('done');
    expect((await candidateOf('u1', jobId)).status).toBe('kept');
    expect(imageCalls).toBe(1);
    // 終わったら、合図は止まる
    const beat = (await store.getJob('u1', jobId))!.heartbeat;
    clock += 5_000;
    await wait(40);
    expect((await store.getJob('u1', jobId))!.heartbeat).toBe(beat);
  }, 60_000);
  it('途中で止まっていた仕事（作成中のまま 3 分たった）は、呼び直すと続きを進める', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await setJob('u1', jobId, (job) => ({ ...job, heartbeat: clock, candidates: job.candidates.map((c) => ({ ...c, status: 'working' as const, tries: 1 })) }));
    clock += 60_000; // 1 分: まだ動いているかもしれない
    expect(await runJob(deps, 'u1', jobId)).toBe('busy');
    expect(imageCalls).toBe(0);
    clock += 180_000; // さらに 3 分: 止まっている
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect(imageCalls).toBe(1);
    expect(await candidateOf('u1', jobId)).toMatchObject({ status: 'kept', tries: 2, itemId: `my:${jobId}-0-2` });
  }, 60_000);
  it('同時に 3 回呼んで、失敗しても、チケットは 1 回しか戻らない', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    failImages = true;
    await Promise.all([runJob(deps, 'u1', jobId), runJob(deps, 'u1', jobId), runJob(deps, 'u1', jobId)]);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    expect(refunds()).toHaveLength(1);
    expect((await store.getJob('u1', jobId))!.tickets).toBe(0);
  }, 60_000);
  it('追い越された古い処理が、あとから失敗しても、できた服を壊さない・チケットを戻さない', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    let release = () => {};
    imageGate = new Promise((resolve) => (release = resolve));
    deps.heartbeatMs = 3_600_000; // 合図が止まった古い処理
    const old = runJob(deps, 'u1', jobId);
    while (imageCalls === 0) await wait(10);
    clock += 200_000;
    imageGate = null;
    expect(await runJob(deps, 'u1', jobId)).toBe('done'); // 別の処理が引き継いで、作り終える
    expect(await candidateOf('u1', jobId)).toMatchObject({ status: 'kept', itemId: `my:${jobId}-0-2` });
    failImages = true; // 古い処理は、このあと失敗する
    release();
    await old;
    const after = (await store.getJob('u1', jobId))!;
    expect(after.candidates[0]).toMatchObject({ status: 'kept', itemId: `my:${jobId}-0-2` });
    expect(after.tickets).toBe(1);
    expect((await listItems(deps, 'u1')).map((i) => i.id)).toEqual([`my:${jobId}-0-2`]);
    expect((await signIn(deps, 'u1')).tickets).toBe(1);
  }, 60_000);
  it('追い越された古い処理が、あとからできあがっても、服は 1 点だけ（引き継いだほうの服）', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    let release = () => {};
    imageGate = new Promise((resolve) => (release = resolve));
    deps.heartbeatMs = 3_600_000;
    const old = runJob(deps, 'u1', jobId);
    while (imageCalls === 0) await wait(10);
    clock += 200_000;
    imageGate = null;
    await runJob(deps, 'u1', jobId);
    release();
    await old;
    expect((await listItems(deps, 'u1')).map((i) => i.id)).toEqual([`my:${jobId}-0-2`]);
    expect([...files.files.keys()].filter((k) => k.includes(`my_${jobId}-0-1`))).toEqual([]);
  }, 60_000);
  it('服を保存している最中に追い越されたら、自分が保存した服を消す', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    const real = store.putItem.bind(store);
    store.putItem = async (uid, item) => {
      // 保存の直前に、ほかの呼び出しが引き継いだことにする
      await setJob(uid, jobId, (job) => ({ ...job, runner: 'someone-else' }));
      return real(uid, item);
    };
    expect(await runJob(deps, 'u1', jobId)).toBe('busy');
    expect(await listItems(deps, 'u1')).toEqual([]);
    expect([...files.files.keys()].filter((k) => k.includes('/items/'))).toEqual([]);
    expect(await candidateOf('u1', jobId)).toMatchObject({ status: 'working' });
    expect((await signIn(deps, 'u1')).tickets).toBe(1);
  }, 60_000);
  it("1 回の呼び出しで進めるのは、決めた時間まで。残りがあれば 'more'。呼び直すと続きを進める", async () => {
    await userWith('u1', 5);
    const { jobId } = await startJob(deps, 'u1', twoParts());
    deps.runBudgetMs = 0;
    expect(await runJob(deps, 'u1', jobId)).toBe('more');
    const half = (await store.getJob('u1', jobId))!;
    expect(half.candidates.map((c) => c.status)).toEqual(['kept', 'waiting']);
    expect(half.done).toBe(false);
    expect(await runJob(deps, 'u1', jobId)).toBe('done'); // すぐ呼び直しても、続きを進める（だれも作っていない）
    expect((await store.getJob('u1', jobId))!.candidates.map((c) => c.status)).toEqual(['kept', 'kept']);
    expect(imageCalls).toBe(2);
  }, 60_000);
  it('利用者ごとの 1 日の上限: 超えた分は作らずに「できなかった」にして、チケットを戻す。管理者には、かからない', async () => {
    await userWith('u1', 5);
    deps.limits = { perDay: 20, perUserDay: 1, maxAttempts: 1 };
    const { jobId } = await startJob(deps, 'u1', twoParts());
    await runJob(deps, 'u1', jobId);
    const job = (await store.getJob('u1', jobId))!;
    expect(job.candidates.map((c) => c.status)).toEqual(['kept', 'failed']);
    expect(job.candidates[1].notes.join('')).toMatch(/上限/);
    expect(imageCalls).toBe(1);
    expect((await signIn(deps, 'u1')).tickets).toBe(4);
    // ほかの利用者は作れる
    await userWith('u2', 1);
    const other = await startJob(deps, 'u2', oneTop());
    await runJob(deps, 'u2', other.jobId);
    expect((await candidateOf('u2', other.jobId)).status).toBe('kept');
    // 管理者
    const boss = await signIn(deps, 'u3');
    deps.adminCodes = [boss.userCode];
    const a = await startJob(deps, 'u3', twoParts());
    await runJob(deps, 'u3', a.jobId);
    expect((await store.getJob('u3', a.jobId))!.candidates.map((c) => c.status)).toEqual(['kept', 'kept']);
  }, 60_000);
  it('管理者として始めた仕事は、途中で管理者でなくなっても、チケットを戻さない（引いていないので）', async () => {
    const boss = await signIn(deps, 'u1');
    deps.adminCodes = [boss.userCode];
    const { jobId } = await startJob(deps, 'u1', oneTop());
    deps.adminCodes = [];
    failImages = true;
    await runJob(deps, 'u1', jobId);
    expect(await candidateOf('u1', jobId)).toMatchObject({ status: 'failed', refunded: true });
    expect((await signIn(deps, 'u1')).tickets).toBe(0);
  }, 60_000);
  it('ほかの利用者の仕事は進められない', async () => {
    await userWith('u1', 2);
    await signIn(deps, 'u2');
    const { jobId } = await startJob(deps, 'u1', oneTop());
    expect(code(await runJob(deps, 'u2', jobId).catch((e) => e))).toBe('refused');
    expect(imageCalls).toBe(0);
  });
  it('検品の注意は、服に残る', async () => {
    await userWith('u1', 2);
    deps.limits = { perDay: 20, maxAttempts: 1 };
    deps.ai = {
      image: fakeImage,
      text: {
        async json<T>(input: { system: string; prompt: string; schema: Record<string, unknown> }): Promise<T> {
          const props = (input.schema.properties ?? {}) as Record<string, unknown>;
          if ('ok' in props) return { ok: false, reason: 'そでが みじかい' } as T;
          return fakeText.json(input);
        },
      },
    };
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await runJob(deps, 'u1', jobId);
    const [item] = await listItems(deps, 'u1');
    expect(item.notes!.join(' ')).toMatch(/そでが みじかい/);
    expect((await candidateOf('u1', jobId)).notes).toEqual(item.notes);
  }, 60_000);
});

describe('取り引きのやり直し・途中の失敗（服と払い戻しの、どちらか 1 つで終わる）', () => {
  // Firestore は、確定の返事が届かなかったとき（時間切れなど）、取り引きの中身をもう一度呼ぶ。そのとき、前の回は確定していることがある。
  // そのまね: どの書き換えも、確定したあとに、もう一度呼ぶ
  function replayTransactions() {
    const real = store.updateJob.bind(store);
    store.updateJob = async (uid, jobId, change) => {
      await real(uid, jobId, change);
      return real(uid, jobId, change);
    };
  }
  it('確定したあとに、もう一度呼ばれても、できた服は消えない（服 1 点・絵 1 回・チケット 1 枚）', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    replayTransactions();
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect(await candidateOf('u1', jobId)).toMatchObject({ status: 'kept', itemId: `my:${jobId}-0-1`, tries: 1 });
    expect((await listItems(deps, 'u1')).map((i) => i.id)).toEqual([`my:${jobId}-0-1`]);
    expect(imageCalls).toBe(1);
    expect((await signIn(deps, 'u1')).tickets).toBe(1);
    expect(refunds()).toEqual([]);
  }, 60_000);
  it('セットでも: どの品目も 1 回ずつ作り、全部が服になる', async () => {
    await userWith('u1', 5);
    const { jobId } = await startJob(deps, 'u1', twoParts());
    replayTransactions();
    enqueued.length = 0;
    await workJob(deps, 'u1', jobId);
    const job = (await store.getJob('u1', jobId))!;
    expect(job.done).toBe(true);
    expect(job.candidates.map((c) => [c.status, c.tries])).toEqual([['kept', 1], ['kept', 1]]);
    expect(await listItems(deps, 'u1')).toHaveLength(2);
    expect(imageCalls).toBe(2);
    expect(enqueued).toEqual([]);
  }, 60_000);
  it('できなかったときも: 払い戻しは 1 回', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    replayTransactions();
    failImages = true;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect(await candidateOf('u1', jobId)).toMatchObject({ status: 'failed', refunded: true });
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    expect(refunds()).toHaveLength(1);
  }, 60_000);
  it('止まった仕事の入れ直しも: 列に入れるのは 1 回', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    clock += QUEUE_WAIT_MS + 1000;
    enqueued.length = 0;
    replayTransactions();
    await tendJob(deps, 'u1', (await store.getJob('u1', jobId))!);
    expect(enqueued).toEqual([['u1', jobId, undefined]]);
  });
  it('服を保存したあと、結果を書く所で失敗したら、保存した服は残さない。やり直しで、服は 1 点だけになる', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    const realPut = store.putItem.bind(store);
    const realUpdate = store.updateJob.bind(store);
    let failNext = false;
    let first = true;
    store.putItem = async (uid, item) => {
      await realPut(uid, item);
      // 1 回目だけ: このすぐあとの「結果を書く」が、失敗する
      if (first) failNext = true;
      first = false;
    };
    store.updateJob = async (uid, id, change) => {
      if (failNext) {
        failNext = false;
        throw new Error('store is down');
      }
      return realUpdate(uid, id, change);
    };
    await expect(runJob(deps, 'u1', jobId)).rejects.toThrow('store is down'); // 列が、間をあけて呼び直す
    expect(await listItems(deps, 'u1')).toEqual([]);
    expect([...files.files.keys()].filter((k) => k.includes('/items/'))).toEqual([]);
    clock += 200_000; // 受け持ちの合図がとぎれたあと
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect((await listItems(deps, 'u1')).map((i) => i.id)).toEqual([`my:${jobId}-0-2`]);
    expect((await signIn(deps, 'u1')).tickets).toBe(1);
    expect(refunds()).toEqual([]);
  }, 60_000);
  it('前の回が、服を保存したまま止まっていたら（落ちた、など）、取りかかり直すときに、その服を片付ける', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    // 1 回目: 服を保存した直後に落ちた、という状態を作る
    await store.putItem('u1', { id: `my:${jobId}-0-1`, dollId, item: { id: `my:${jobId}-0-1`, name: 'のこりもの', category: 'トップス', image: { file: 'files/a.webp', canvasW: 10, canvasH: 10, box: { x: 0, y: 0, w: 1, h: 1 } }, thumb: 'files/t.webp' }, paths: {}, createdAt: clock });
    await files.put(`users/u1/items/my_${jobId}-0-1/a.webp`, Buffer.from('x'), 'image/webp');
    await setJob('u1', jobId, (job) => ({ ...job, heartbeat: clock, runner: 'dead', candidates: job.candidates.map((c) => ({ ...c, status: 'working' as const, tries: 1 })) }));
    clock += 200_000;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect((await listItems(deps, 'u1')).map((i) => i.id)).toEqual([`my:${jobId}-0-2`]);
    expect([...files.files.keys()].filter((k) => k.includes(`my_${jobId}-0-1`))).toEqual([]);
  }, 60_000);
  it('できなかった品目でも、前の回が残した服は片付ける（服と払い戻しの両方にならない）', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await store.putItem('u1', { id: `my:${jobId}-0-1`, dollId, item: { id: `my:${jobId}-0-1`, name: 'のこりもの', category: 'トップス', image: { file: 'files/a.webp', canvasW: 10, canvasH: 10, box: { x: 0, y: 0, w: 1, h: 1 } }, thumb: 'files/t.webp' }, paths: {}, createdAt: clock });
    await setJob('u1', jobId, (job) => ({ ...job, heartbeat: clock, runner: 'dead', candidates: job.candidates.map((c) => ({ ...c, status: 'working' as const, tries: 3 })) }));
    clock += 200_000;
    expect(await runJob(deps, 'u1', jobId)).toBe('done'); // 3 回止まったので、打ち切り
    expect(await candidateOf('u1', jobId)).toMatchObject({ status: 'failed', refunded: true });
    expect(await listItems(deps, 'u1')).toEqual([]);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
  }, 60_000);
  it('「作る」が、確定したあとにもう一度呼ばれても、チケットは 1 回しか引かない（仕事も 1 つ）', async () => {
    await userWith('u1', 2);
    const real = store.chargeAndCreateJob.bind(store);
    store.chargeAndCreateJob = async (uid, job, cost, reason, now) => {
      await real(uid, job, cost, reason, now);
      return real(uid, job, cost, reason, now);
    };
    const { jobId, cost } = await startJob(deps, 'u1', oneTop());
    expect(cost).toBe(1);
    expect((await signIn(deps, 'u1')).tickets).toBe(1);
    expect(await store.listJobs('u1')).toHaveLength(1);
    expect(store.ledger.filter((l) => l.reason === `job:${jobId}`)).toHaveLength(1);
  });
});

describe('前の版の「できた」候補', () => {
  // 前の版は、できた絵を置き場に入れ、「使う」を待っていた。その絵から、服にする
  async function legacyDone(withPicture: boolean): Promise<string> {
    await userWith('u1', 5);
    const made = await startJob(deps, 'u1', oneTop());
    await runJob(deps, 'u1', made.jobId);
    const [item] = await listItems(deps, 'u1');
    // できた服の絵を、作業用のキャンバスに置き直す（前の版の「保存用の絵」と同じ形）
    const { canvasW, canvasH, box } = item.item.image;
    const cut = await sharp((await files.get(item.paths[item.item.image.file]))!).resize(box.w, box.h, { fit: 'fill' }).png().toBuffer();
    const png = await sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: cut, left: box.x, top: box.y }]).png().toBuffer();
    await deleteItem(deps, 'u1', item.id);
    const jobId = 'old1';
    const path = `users/u1/jobs/${jobId}/0-png.png`;
    if (withPicture) await files.put(path, png, 'image/png');
    await store.createJob('u1', {
      id: jobId,
      dollId,
      theme: 'うみ',
      styleId: 'anime',
      done: true,
      tickets: 1,
      createdAt: clock,
      heartbeat: clock,
      candidates: [{ index: 0, name: 'むかしのふく', categoryId: 'トップス', description: 'A red top.', colors: [], status: 'done', notes: [], preview: { path: `users/u1/jobs/${jobId}/0-preview.png`, canvasW, canvasH, box }, layers: { png: path } }],
    });
    return jobId;
  }
  it('絵が残っていれば、自分の服になる（服の ID は、前の版と同じ形）', async () => {
    const jobId = await legacyDone(true);
    const before = imageCalls;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect(imageCalls).toBe(before);
    const job = (await store.getJob('u1', jobId))!;
    expect(job.v).toBe(2);
    expect(job.candidates[0]).toMatchObject({ status: 'kept', itemId: `my:${jobId}-0` });
    const [item] = await listItems(deps, 'u1');
    expect(item).toMatchObject({ id: `my:${jobId}-0` });
    expect(item.item.name).toBe('むかしのふく');
    expect([...files.files.keys()].filter((k) => k.startsWith(`users/u1/jobs/${jobId}/`))).toEqual([]);
  }, 60_000);
  it('絵が無くなっていれば、できなかった扱い（チケットは、前の版で使った扱いのまま。戻さない）', async () => {
    const jobId = await legacyDone(false);
    const tickets = (await signIn(deps, 'u1')).tickets;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect(await candidateOf('u1', jobId)).toMatchObject({ status: 'failed', refunded: true });
    expect((await signIn(deps, 'u1')).tickets).toBe(tickets);
    expect(await listItems(deps, 'u1')).toEqual([]);
  }, 60_000);
});

describe('列の関数の中身（workJob）', () => {
  it('終わったら、列に入れ直さない', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    enqueued.length = 0;
    await workJob(deps, 'u1', jobId);
    expect(enqueued).toEqual([]);
    expect((await store.getJob('u1', jobId))!.done).toBe(true);
  }, 60_000);
  it('ほかの呼び出しが進めていたら、60 秒あとに呼ばれるよう、列に入れ直す', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await setJob('u1', jobId, (job) => ({ ...job, heartbeat: clock, runner: 'other', candidates: job.candidates.map((c) => ({ ...c, status: 'working' as const, tries: 1 })) }));
    enqueued.length = 0;
    await workJob(deps, 'u1', jobId);
    expect(enqueued).toEqual([['u1', jobId, 60]]);
    expect(imageCalls).toBe(0);
  });
  it('持ち時間切れで残りがあれば、すぐ列に入れ直す', async () => {
    await userWith('u1', 5);
    const { jobId } = await startJob(deps, 'u1', twoParts());
    enqueued.length = 0;
    deps.runBudgetMs = 0;
    await workJob(deps, 'u1', jobId);
    expect(enqueued).toEqual([['u1', jobId, 0]]);
  }, 60_000);
});

describe('自分の服を消す', () => {
  it('一覧からも置き場からも消える。ほかの利用者の服は、見えない・消せない', async () => {
    await userWith('u1', 5);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    await runJob(deps, 'u1', jobId);
    const [item] = await listItems(deps, 'u1');
    await signIn(deps, 'u2');
    expect(await listItems(deps, 'u2')).toEqual([]);
    await deleteItem(deps, 'u2', item.id); // 何も起きない
    expect(await listItems(deps, 'u1')).toHaveLength(1);
    await deleteItem(deps, 'u1', item.id);
    expect(await listItems(deps, 'u1')).toEqual([]);
    expect([...files.files.keys()].some((k) => k.includes('/items/'))).toBe(false);
  }, 60_000);
});

describe('止まった仕事の手当て（tendJob）', () => {
  const jobOf = async (uid: string, jobId: string) => (await store.getJob(uid, jobId))!;
  it('列に入れてあるはずの仕事（まだ始まっていないだけかもしれない）は、5 分たってから、念のため入れ直す', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    enqueued.length = 0;
    expect([REQUEUE_MS, QUEUE_WAIT_MS]).toEqual([30_000, 300_000]);
    // 列がこみあっていて、まだ呼ばれていないだけ、のことがある。何度も聞かれても、列に同じ仕事を積み上げない
    for (let i = 0; i < 20; i++) {
      clock += 14_000;
      await tendJob(deps, 'u1', await jobOf('u1', jobId));
    }
    expect(enqueued).toEqual([]);
    clock += 30_000; // 始めてから 5 分をこえた
    const tended = await tendJob(deps, 'u1', await jobOf('u1', jobId));
    expect(enqueued).toEqual([['u1', jobId, undefined]]);
    expect(tended.queuedAt).toBe(clock);
    clock += 60_000;
    await tendJob(deps, 'u1', await jobOf('u1', jobId));
    expect(enqueued).toHaveLength(1);
  });
  it('進んでいる最中の仕事・終わった仕事は、入れ直さない', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    clock += QUEUE_WAIT_MS + 1000;
    await setJob('u1', jobId, (job) => ({ ...job, heartbeat: clock, runner: 'r', candidates: job.candidates.map((c) => ({ ...c, status: 'working' as const, tries: 1 })) }));
    enqueued.length = 0;
    await tendJob(deps, 'u1', await jobOf('u1', jobId));
    expect(enqueued).toEqual([]);
    // 合図がとぎれたら（150 秒より古い）、止まっている
    clock += 151_000;
    await tendJob(deps, 'u1', await jobOf('u1', jobId));
    expect(enqueued).toHaveLength(1);
    await setJob('u1', jobId, (job) => ({ ...job, done: true, candidates: job.candidates.map((c) => ({ ...c, status: 'kept' as const })) }));
    clock += QUEUE_WAIT_MS + 1000;
    await tendJob(deps, 'u1', await jobOf('u1', jobId));
    expect(enqueued).toHaveLength(1);
  });
  it('列に入れられなかったと分かっている仕事は、30 秒おきに入れ直す（「作る」のとき・入れ直しのとき、どちらの失敗でも）', async () => {
    await userWith('u1', 2);
    enqueueFails = true;
    const { jobId } = await startJob(deps, 'u1', oneTop());
    expect((await jobOf('u1', jobId)).queueFailed).toBe(true);
    clock += 10_000;
    await tendJob(deps, 'u1', await jobOf('u1', jobId)); // まだ 30 秒たっていない
    clock += 21_000;
    await tendJob(deps, 'u1', await jobOf('u1', jobId)); // 入れ直そうとして、また失敗（落ちない）
    expect((await jobOf('u1', jobId)).queueFailed).toBe(true);
    enqueueFails = false;
    enqueued.length = 0;
    clock += 10_000;
    await tendJob(deps, 'u1', await jobOf('u1', jobId));
    expect(enqueued).toEqual([]);
    clock += 21_000;
    await tendJob(deps, 'u1', await jobOf('u1', jobId));
    expect(enqueued).toEqual([['u1', jobId, undefined]]);
    expect((await jobOf('u1', jobId)).queueFailed).toBeUndefined();
  });
  it('24 時間たった仕事は、残りを failed にして払い戻し、終わりにする（できた服は、そのまま）', async () => {
    await userWith('u1', 5);
    const { jobId } = await startJob(deps, 'u1', twoParts());
    deps.runBudgetMs = 0;
    expect(await runJob(deps, 'u1', jobId)).toBe('more');
    expect((await signIn(deps, 'u1')).tickets).toBe(3);
    clock += EXPIRE_MS - 1000;
    expect((await tendJob(deps, 'u1', await jobOf('u1', jobId))).done).toBe(false);
    clock += 2000;
    enqueued.length = 0;
    const job = await tendJob(deps, 'u1', await jobOf('u1', jobId));
    expect(job.done).toBe(true);
    expect(job.runner).toBeUndefined();
    expect(job.tickets).toBe(1);
    expect(job.candidates.map((c) => c.status)).toEqual(['kept', 'failed']);
    expect(job.candidates[1]).toMatchObject({ refunded: true, notes: ['時間内に作れませんでした。チケットは戻しました'] });
    expect((await signIn(deps, 'u1')).tickets).toBe(4);
    expect(await listItems(deps, 'u1')).toHaveLength(1);
    expect(enqueued).toEqual([]); // 終わったので、もう列には入れない
    // もう一度手当てしても、二重に戻さない
    await tendJob(deps, 'u1', await jobOf('u1', jobId));
    expect((await signIn(deps, 'u1')).tickets).toBe(4);
  }, 60_000);
  it('打ち切ったあとに、古い呼び出しができあがっても、服は残らない（払い戻しと服の両方は起きない）', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    let release = () => {};
    imageGate = new Promise((resolve) => (release = resolve));
    deps.heartbeatMs = 3_600_000;
    const old = runJob(deps, 'u1', jobId);
    while (imageCalls === 0) await wait(10);
    clock += EXPIRE_MS + 1;
    const job = await tendJob(deps, 'u1', await jobOf('u1', jobId));
    expect(job.candidates[0]).toMatchObject({ status: 'failed', refunded: true });
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    release();
    expect(await old).toBe('busy');
    expect(await listItems(deps, 'u1')).toEqual([]);
    expect([...files.files.keys()].filter((k) => k.includes('/items/'))).toEqual([]);
    expect((await signIn(deps, 'u1')).tickets).toBe(2);
    expect(refunds()).toHaveLength(1);
  }, 60_000);
});

describe('見回り（sweep）', () => {
  it('終わっていない仕事だけを手当てする（どの利用者の分も）', async () => {
    await userWith('u1', 2);
    await userWith('u2', 2);
    const a = await startJob(deps, 'u1', oneTop());
    const b = await startJob(deps, 'u2', oneTop());
    await setJob('u2', b.jobId, (job) => ({ ...job, done: true, candidates: job.candidates.map((c) => ({ ...c, status: 'kept' as const })) }));
    clock += QUEUE_WAIT_MS + 1000;
    enqueued.length = 0;
    expect(await sweep(deps)).toBe(1);
    expect(enqueued).toEqual([['u1', a.jobId, undefined]]);
  });
});

describe('見ていない仕事（openJobs・ackJob）', () => {
  it('見た仕事は出ない。終わっていない仕事は、見た印を付けられない（出続ける）', async () => {
    await userWith('u1', 5);
    const first = await startJob(deps, 'u1', oneTop());
    await runJob(deps, 'u1', first.jobId);
    clock += 1000;
    const second = await startJob(deps, 'u1', oneTop());
    expect((await openJobs(deps, 'u1')).map((j) => j.id)).toEqual([second.jobId, first.jobId]);
    await ackJob(deps, 'u1', second.jobId); // まだ終わっていない
    await ackJob(deps, 'u1', first.jobId);
    expect((await openJobs(deps, 'u1')).map((j) => j.id)).toEqual([second.jobId]);
    expect((await store.getJob('u1', second.jobId))!.seen).toBeUndefined();
    // ほかの利用者には見えない・付けられない
    await signIn(deps, 'u2');
    expect(await openJobs(deps, 'u2')).toEqual([]);
    expect(code(await ackJob(deps, 'u2', first.jobId).catch((e) => e))).toBe('refused');
  }, 60_000);
  it('聞かれたとき、止まっている仕事は列に入れ直す', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', oneTop());
    clock += QUEUE_WAIT_MS + 1000;
    enqueued.length = 0;
    await openJobs(deps, 'u1');
    expect(enqueued).toEqual([['u1', jobId, undefined]]);
  });
  it('前の版の、全部決まった仕事（v なし）は出ない。「できた」の残っている仕事は出て、列に入る', async () => {
    await userWith('u1', 2);
    const old = (status: 'kept' | 'done', id: string): JobDoc => ({
      id,
      dollId,
      theme: 'うみ',
      styleId: 'anime',
      done: true,
      tickets: 1,
      createdAt: clock - 100_000,
      heartbeat: clock - 100_000,
      candidates: [{ index: 0, name: 'ふく', categoryId: 'トップス', description: 'A top.', colors: [], status, notes: [] }],
    });
    await store.createJob('u1', old('kept', 'decided'));
    await store.createJob('u1', old('done', 'pending'));
    expect((await openJobs(deps, 'u1')).map((j) => j.id)).toEqual(['pending']);
    expect(enqueued).toEqual([['u1', 'pending', undefined]]);
  });
});

describe('自分の服を直す', () => {
  const put = (uid: string, id: string, createdAt: number) =>
    store.putItem(uid, {
      id,
      dollId,
      item: { id, name: 'もとのなまえ', category: 'トップス', image: { file: 'files/a.webp', canvasW: 10, canvasH: 10, box: { x: 0, y: 0, w: 1, h: 1 } }, thumb: 'files/t.webp' },
      paths: {},
      createdAt,
      hue: 0,
      order: createdAt,
      updatedAt: createdAt,
    });
  it('名前は 20 文字まで（空なら変えない）。色は -180〜180 の整数に収める。変えたら updatedAt が進む', async () => {
    await put('u1', 'my:a', 100);
    clock += 5;
    const renamed = await updateItem(deps, 'u1', 'my:a', { name: `  ${'あ'.repeat(30)}  ` });
    expect(renamed.item.name).toBe('あ'.repeat(20));
    expect(renamed.updatedAt).toBe(clock);
    expect((await updateItem(deps, 'u1', 'my:a', { name: '   ' })).item.name).toBe('あ'.repeat(20));
    expect((await updateItem(deps, 'u1', 'my:a', { hue: 45.6 })).hue).toBe(46);
    expect((await updateItem(deps, 'u1', 'my:a', { hue: 999 })).hue).toBe(180);
    expect((await updateItem(deps, 'u1', 'my:a', { hue: -999 })).hue).toBe(-180);
    expect((await updateItem(deps, 'u1', 'my:a', { hue: Number.NaN })).hue).toBe(-180);
    // 何も変わらなければ、updatedAt は進まない
    const before = (await store.getItem('u1', 'my:a'))!.updatedAt;
    clock += 5;
    expect((await updateItem(deps, 'u1', 'my:a', { hue: -180 })).updatedAt).toBe(before);
  });
  it('ほかの利用者の服・無い服は refused', async () => {
    await put('u1', 'my:a', 100);
    expect(code(await updateItem(deps, 'u2', 'my:a', { name: 'x' }).catch((e) => e))).toBe('refused');
    expect(code(await updateItem(deps, 'u1', 'my:none', { hue: 1 }).catch((e) => e))).toBe('refused');
    expect((await store.getItem('u1', 'my:a'))!.item.name).toBe('もとのなまえ');
  });
  it('並び順: 先頭ほど order が大きい。あとから作った服は、その前に来る', async () => {
    await put('u1', 'my:a', 100);
    await put('u1', 'my:b', 200);
    await put('u1', 'my:c', 300);
    clock += 10;
    const ordered = await orderItems(deps, 'u1', ['my:a', 'my:c', 'my:b']);
    expect(ordered.map((i) => i.id)).toEqual(['my:a', 'my:c', 'my:b']);
    expect(ordered.map((i) => i.order)).toEqual([clock, clock - 1, clock - 2]);
    expect(ordered.every((i) => i.updatedAt === clock)).toBe(true);
    clock += 10;
    await put('u1', 'my:d', clock);
    const sorted = (await listItems(deps, 'u1')).sort((x, y) => (y.order ?? 0) - (x.order ?? 0)).map((i) => i.id);
    expect(sorted).toEqual(['my:d', 'my:a', 'my:c', 'my:b']);
  });
  it('並び順: 自分の服でない ID・同じ ID の重なり・空・多すぎは refused（何も変えない）', async () => {
    await put('u1', 'my:a', 100);
    await put('u1', 'my:b', 200);
    for (const ids of [['my:a', 'my:none'], ['my:a', 'my:a'], [], Array.from({ length: 501 }, (_, i) => `my:${i}`)]) {
      expect(code(await orderItems(deps, 'u1', ids).catch((e) => e))).toBe('refused');
    }
    expect((await store.getItem('u1', 'my:a'))!.order).toBe(100);
  });
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

describe('引き継ぎ（③-b）: 合い言葉で、匿名の利用者のチケットと服を、アカウントへ移す', () => {
  // 匿名の利用者 A の服（絵は、A の置き場にある）
  const ownItem = async (uid: string, id: string, createdAt: number, extra: Partial<ItemDoc> = {}): Promise<ItemDoc> => {
    const folder = `users/${uid}/items/${id.replace(/[^A-Za-z0-9_-]/g, '_')}/`;
    const doc: ItemDoc = {
      id,
      dollId,
      item: { id, name: `ふく${createdAt}`, category: 'トップス', image: { file: 'files/a.webp', canvasW: 10, canvasH: 10, box: { x: 0, y: 0, w: 1, h: 1 } }, thumb: 'files/t.webp' },
      paths: { 'files/a.webp': `${folder}a.webp`, 'files/t.webp': `${folder}t.webp` },
      createdAt,
      hue: 30,
      order: createdAt + 5,
      updatedAt: createdAt,
      ...extra,
    };
    await store.putItem(uid, doc);
    for (const path of Object.values(doc.paths)) await files.put(path, Buffer.from(path), 'image/webp');
    return doc;
  };
  const ids = async (uid: string) => (await listItems(deps, uid)).map((i) => i.id).sort();
  const tickets = async (uid: string) => (await store.getUser(uid))!.tickets;
  // A（匿名。チケット 3 枚・服 2 点）と、B（アカウント。チケット 5 枚・服 1 点）。A が合い言葉をもらう
  async function twoUsers(): Promise<{ word: string; mine: ItemDoc[] }> {
    await userWith('A', 3);
    await userWith('B', 5);
    const mine = [await ownItem('A', 'my:old1-0-1', 100), await ownItem('A', 'my:old2-0', 200)];
    await ownItem('B', 'my:b1-0-1', 300);
    return { word: await offerHandoff(deps, 'A'), mine };
  }

  it('offerHandoff: 同じ利用者には、使われるまで同じ合い言葉（乱数は deps.newWord）', async () => {
    await userWith('A', 0);
    const word = await offerHandoff(deps, 'A');
    expect(word).toBe('word1');
    expect(await offerHandoff(deps, 'A')).toBe(word);
    expect(await offerHandoff(deps, 'C')).toBe('word2'); // 初めての利用者でも、作ってから
  });

  it('adoptUser の答え: 知らない合い言葉 → unknown。ほかの人が使った → used。自分の合い言葉 → done（何もしない）。元が名前のある利用者 → refused', async () => {
    const { word } = await twoUsers();
    expect(await adoptUser(deps, 'B', 'nope')).toEqual({ status: 'unknown', tickets: 0, items: 0 });
    expect(await adoptUser(deps, 'A', word)).toEqual({ status: 'done', tickets: 0, items: 0 });
    expect(await store.getUser('A')).not.toHaveProperty('movedTo');
    await store.markUser('A', { named: true });
    expect(await adoptUser(deps, 'B', word)).toEqual({ status: 'refused', tickets: 0, items: 0 });
    expect(await tickets('A')).toBe(3);
    expect(await ids('A')).toHaveLength(2);
    expect(await store.getUser('A')).not.toHaveProperty('movedTo');
    // 印を外して、B が使う → C が同じ合い言葉を出すと used
    store.users.get('A')!.named = undefined;
    expect((await adoptUser(deps, 'B', word)).status).toBe('done');
    await userWith('C', 0);
    expect(await adoptUser(deps, 'C', word)).toEqual({ status: 'used', tickets: 0, items: 0 });
    expect(await tickets('C')).toBe(0);
  });

  it('移す: チケットは足され、服は両方。ID・名前・色・並び順・作った時刻・絵のパスは、そのまま。印と覚えが残る', async () => {
    const { word, mine } = await twoUsers();
    expect(await adoptUser(deps, 'B', word)).toEqual({ status: 'done', tickets: 3, items: 2 });
    expect(await tickets('A')).toBe(0);
    expect(await tickets('B')).toBe(8);
    expect(await ids('A')).toEqual([]);
    expect(await ids('B')).toEqual(['my:b1-0-1', 'my:old1-0-1', 'my:old2-0']);
    for (const doc of mine) expect(await store.getItem('B', doc.id)).toEqual(doc);
    expect(store.ledger.filter((l) => l.reason.startsWith('adopt:'))).toEqual([
      { uid: 'A', count: -3, reason: 'adopt:out:B', at: clock },
      { uid: 'B', count: 3, reason: 'adopt:in:A', at: clock },
    ]);
    expect(await store.getUser('A')).toMatchObject({ movedTo: 'B' });
    expect(await store.getUser('B')).toMatchObject({ adopted: ['A'] });
    expect(await store.getHandoff(word)).toMatchObject({ uid: 'A', usedBy: 'B' });
    // 絵は、動かさない（A の置き場のまま。B から取れる）
    for (const path of Object.values(mine[0].paths)) expect(await files.get(path)).not.toBeNull();
  });

  it('同じ合い言葉で、もう一度 adoptUser（返事が届かずに、アプリがもう一度呼んだ）→ 0・0。数は変わらない。残りがあれば、移る', async () => {
    const { word } = await twoUsers();
    await adoptUser(deps, 'B', word);
    expect(await adoptUser(deps, 'B', word)).toEqual({ status: 'done', tickets: 0, items: 0 });
    expect(await tickets('B')).toBe(8);
    expect(await ids('B')).toHaveLength(3);
    // あとから A に入った分（作者が、古い利用者コードに配った）も、もう一度出せば移る
    await store.addTickets('A', 2, 'grant', clock);
    expect(await adoptUser(deps, 'B', word)).toEqual({ status: 'done', tickets: 2, items: 0 });
    expect(await tickets('B')).toBe(10);
  });

  it('取り引きのやり直し: どの書き換えも、確定のあとにもう一度呼ばれる → チケットも服も、1 回ぶん', async () => {
    const { word } = await twoUsers();
    // 書き換えの操作を、どれも 2 回ずつ呼ぶ（Firestore が、確定の返事が届かなかった取り引きを、もう一度呼ぶのと同じ）
    for (const name of ['moveTickets', 'moveItem', 'markUser', 'addAdopted', 'offerHandoff', 'useHandoff', 'updateJob', 'addTickets', 'refundOnce'] as const) {
      const real = (store[name] as (...args: unknown[]) => Promise<unknown>).bind(store);
      (store as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
        await real(...args);
        return real(...args);
      };
    }
    expect((await adoptUser(deps, 'B', word)).status).toBe('done');
    expect(await adoptUser(deps, 'B', word)).toMatchObject({ status: 'done' });
    expect(await tickets('A')).toBe(0);
    expect(await tickets('B')).toBe(8);
    expect(await ids('A')).toEqual([]);
    expect(await ids('B')).toEqual(['my:b1-0-1', 'my:old1-0-1', 'my:old2-0']);
    expect(store.ledger.filter((l) => l.reason.startsWith('adopt:'))).toHaveLength(2);
    expect((await store.getUser('B'))!.adopted).toEqual(['A']);
    // やり直しの中で、合い言葉がもう一度作られても、利用者の合い言葉は 1 つ
    expect(await offerHandoff(deps, 'A')).not.toBe(word);
  });

  it('元の利用者の仕事が、進んでいる途中: できた服は、まだ移さない。終わったら（workJob の終わり）移る。できなかった分の払い戻しも、移る', async () => {
    await userWith('A', 5);
    await userWith('B', 0);
    const { jobId } = await startJob(deps, 'A', twoParts());
    deps.runBudgetMs = 0;
    expect(await runJob(deps, 'A', jobId)).toBe('more'); // 1 点めは、もう服になった。2 点めは順番待ち
    const madeId = `my:${jobId}-0-1`;
    expect(await ids('A')).toEqual([madeId]);
    const word = await offerHandoff(deps, 'A');
    expect(await adoptUser(deps, 'B', word)).toEqual({ status: 'done', tickets: 3, items: 0 });
    expect(await ids('A')).toEqual([madeId]); // 進めている途中の仕事が、やり直しで消すことがあるので
    expect(await drain(deps, 'A', 'B')).toEqual({ tickets: 0, items: 0 });
    delete deps.runBudgetMs;
    failImages = true; // 2 点めは、できない → A に 1 枚戻る
    await workJob(deps, 'A', jobId);
    expect((await store.getJob('A', jobId))!.done).toBe(true);
    expect(await ids('A')).toEqual([]);
    expect(await ids('B')).toEqual([madeId]);
    expect(await tickets('A')).toBe(0);
    expect(await tickets('B')).toBe(4);
    expect(files.files.has((await store.getItem('B', madeId))!.paths[(await store.getItem('B', madeId))!.item.image.file])).toBe(true);
  }, 60_000);

  it('workJob が投げても、移す。移すのに失敗しても、仕事の結果は変えない', async () => {
    await userWith('A', 2);
    await userWith('B', 0);
    const { jobId } = await startJob(deps, 'A', oneTop());
    const word = await offerHandoff(deps, 'A');
    await adoptUser(deps, 'B', word);
    await store.addTickets('A', 1, 'grant', clock);
    // 仕事が見つからない（投げる）
    await expect(workJob(deps, 'A', 'none')).rejects.toThrow();
    expect(await tickets('B')).toBe(2);
    // 移す所が落ちても、仕事は終わる
    await store.addTickets('A', 1, 'grant', clock);
    const realMove = store.moveTickets.bind(store);
    store.moveTickets = async () => {
      throw new Error('store is down');
    };
    await workJob(deps, 'A', jobId);
    expect((await store.getJob('A', jobId))!.done).toBe(true);
    store.moveTickets = realMove;
    expect(await tickets('A')).toBe(1);
  }, 60_000);

  it('終わった仕事でも、仕事の「できた服」でない服（前の回の残り物）は、移さない。仕事の無い服は、移す', async () => {
    await userWith('A', 0);
    await userWith('B', 0);
    const done: JobDoc = { id: 'jd', dollId, theme: 'うみ', styleId: 'anime', done: true, tickets: 1, createdAt: 1, heartbeat: 1, v: 2, candidates: [{ index: 0, name: 'ふく', categoryId: 'トップス', description: '', colors: [], status: 'kept', notes: [], tries: 2, itemId: 'my:jd-0-2' }, { index: 1, name: 'ふく', categoryId: 'トップス', description: '', colors: [], status: 'failed', notes: [], tries: 1, refunded: true }] };
    await store.createJob('A', done);
    // 前の版の仕事（kept でも itemId が無い）
    await store.createJob('A', { ...done, id: 'legacy', v: undefined, candidates: [{ ...done.candidates[0], itemId: undefined }] });
    await ownItem('A', 'my:jd-0-1', 1); // 残り物（片付けられる前）
    await ownItem('A', 'my:jd-0-2', 2);
    await ownItem('A', 'my:jd-1-1', 3); // できなかった品目の残り物
    await ownItem('A', 'my:legacy-0', 4);
    await ownItem('A', 'my:gone-0-1', 5); // 仕事が見つからない
    const word = await offerHandoff(deps, 'A');
    expect(await adoptUser(deps, 'B', word)).toMatchObject({ items: 3 });
    expect(await ids('B')).toEqual(['my:gone-0-1', 'my:jd-0-2', 'my:legacy-0']);
    expect(await ids('A')).toEqual(['my:jd-0-1', 'my:jd-1-1']);
  });

  it('drainAdopted: あとから元に入ったチケット・終わった仕事の服を、新しい順に 5 人まで移す。ほかへ移った元からは、取らない', async () => {
    await userWith('B', 0);
    for (const from of ['A1', 'A2', 'A3', 'A4', 'A5', 'A6']) {
      await userWith(from, 0);
      await adoptUser(deps, 'B', await offerHandoff(deps, from));
      await store.addTickets(from, 1, 'grant', clock);
    }
    await userWith('A7', 0);
    await userWith('C', 0);
    await adoptUser(deps, 'B', await offerHandoff(deps, 'A7'));
    await adoptUser(deps, 'C', await offerHandoff(deps, 'A7')); // A7 は、そのあと C へ
    await store.addTickets('A7', 4, 'grant', clock);
    await drainAdopted(deps, 'B');
    expect(await tickets('B')).toBe(4); // A3〜A6（A7 は C のもの。A1・A2 は古い）
    expect(await tickets('A7')).toBe(4);
    expect(await tickets('A1')).toBe(1);
    await drainAdopted(deps, 'nobody'); // いない利用者でも落ちない
  });

  it('元が、あとから名前のある利用者になっていたら、移さない', async () => {
    const { word } = await twoUsers();
    await adoptUser(deps, 'B', word);
    await store.addTickets('A', 2, 'grant', clock);
    await store.markUser('A', { named: true });
    expect(await drain(deps, 'A', 'B')).toEqual({ tickets: 0, items: 0 });
    expect(await tickets('A')).toBe(2);
  });

  it('移した服を、先の利用者が消す → 元の置き場の絵も消える。ほかの服の絵は、消えない', async () => {
    const { word, mine } = await twoUsers();
    await ownItem('A', 'my:old1-0-12', 400); // 名前の似た、別の服（移さない）
    await store.createJob('A', { id: 'old1', dollId, theme: '', styleId: 'anime', done: true, tickets: 0, createdAt: 1, heartbeat: 1, v: 2, candidates: [{ index: 0, name: '', categoryId: 'トップス', description: '', colors: [], status: 'kept', notes: [], itemId: 'my:old1-0-1' }] });
    await adoptUser(deps, 'B', word);
    expect(await ids('B')).toContain('my:old1-0-1');
    await deleteItem(deps, 'B', 'my:old1-0-1');
    for (const path of Object.values(mine[0].paths)) expect(await files.get(path)).toBeNull();
    for (const path of Object.values(mine[1].paths)) expect(await files.get(path)).not.toBeNull();
    expect([...files.files.keys()].filter((k) => k.includes('my_old1-0-12/'))).toHaveLength(2);
    expect([...files.files.keys()].filter((k) => k.startsWith('users/B/'))).toHaveLength(2);
  });
});
