// @vitest-environment node
// 背景を作る（v0.49.0）: 「つくる」の target { kind: 'background' }。できた背景は、服と同じ置き場に、背景のカテゴリで入る
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BACKGROUND_CATEGORY } from '../../src/cloud/wire.ts';
import { ContentStore } from '../content/manifestEdit.ts';
import type { ImageAi, TextAi } from '../studio/ai.ts';
import { AiError } from '../studio/ai.ts';
import { DollAssets } from '../studio/dollAssets.ts';
import { handleCall } from './api.ts';
import { MemoryFiles, MemoryStore } from './memoryStore.ts';
import { CloudError } from './store.ts';
import type { ItemDoc } from './store.ts';
import { adoptUser, deleteItem, drain, isBackground, listItems, offerHandoff, orderItems, runJob, signIn, startJob, tendJob, EXPIRE_MS, tradeAccept, tradeClaim, tradeJoin, tradeOpen, tradeView, updateItem, workJob } from './studioCore.ts';
import type { CoreDeps } from './studioCore.ts';

let dir: string;
let store: MemoryStore;
let files: MemoryFiles;
let deps: CoreDeps;
let dollId: string;
let otherDollId: string;
let imageCalls: number;
let textCalls: number;
let prompts: string[]; // 文章の AI への頼み
let imagePrompts: string[];
let failImages: boolean;
let blockImages: number; // この回数だけ、内容の決まりで断られる
let imageGate: Promise<void> | null;
let clock: number;
let ids: number;
let words: number;

async function dollPng(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="1000"><circle cx="250" cy="80" r="70" fill="#f0c8a8"/><rect x="170" y="175" width="160" height="700" fill="#f0c8a8"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
// 偽の画像生成: 横長の青い絵（背景は、正方形に切り出される）
const fakeImage: ImageAi = {
  async generate(input) {
    imageCalls++;
    imagePrompts.push(input.prompt);
    if (imageGate) await imageGate;
    if (blockImages > 0) {
      blockImages--;
      throw new AiError('内容の決まりで断られました', 422, false, true);
    }
    if (failImages) throw new AiError('Gemini API のエラー（500）: boom');
    return sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#40a0e0' } }).png().toBuffer();
  },
};
// 偽の文章の AI: 背景の企画（名前はテーマから）と、説明の書き直し
const fakeText: TextAi = {
  async json<T>(input: { prompt: string; schema: Record<string, unknown> }): Promise<T> {
    textCalls++;
    prompts.push(input.prompt);
    const props = (input.schema.properties ?? {}) as Record<string, unknown>;
    if ('description' in props) return { description: 'A calm, safe beach.' } as T;
    return { items: [{ name: `はいけい${textCalls}`, description: 'A calm beach at noon.' }] } as T;
  },
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-bg-'));
  const content = new ContentStore(dir);
  await content.init();
  dollId = (await content.addDoll({ name: 'テスト', data: await dollPng() })).id;
  otherDollId = (await content.addDoll({ name: 'べつの子', data: await dollPng() })).id;
  store = new MemoryStore();
  files = new MemoryFiles();
  imageCalls = 0;
  textCalls = 0;
  prompts = [];
  imagePrompts = [];
  failImages = false;
  blockImages = 0;
  imageGate = null;
  clock = 1_000_000;
  ids = 0;
  words = 0;
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
    enqueue: async () => undefined,
  };
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const bg = (forDoll = dollId) => ({ dollId: forDoll, theme: 'うみ', styleId: 'anime', target: { kind: 'background' as const } });
const code = (e: unknown) => (e instanceof CloudError ? e.code : `not a CloudError: ${String(e)}`);
async function userWith(uid: string, tickets: number) {
  await signIn(deps, uid);
  if (tickets > 0) await store.addTickets(uid, tickets, 'test', clock);
}
const tickets = async (uid: string) => (await signIn(deps, uid)).tickets;
const refunds = () => store.ledger.filter((l) => l.reason.startsWith('refund'));
// 背景を 1 枚、作り終える
async function made(uid: string, forDoll = dollId): Promise<ItemDoc> {
  const { jobId } = await startJob(deps, uid, bg(forDoll));
  expect(await runJob(deps, uid, jobId)).toBe('done');
  const id = (await store.getJob(uid, jobId))!.candidates[0].itemId!;
  return (await store.getItem(uid, id))!;
}
// 服 1 点（絵つき）を、じかに置く
async function cloth(uid: string, id: string): Promise<ItemDoc> {
  const folder = `users/${uid}/items/${id.replace(/[^A-Za-z0-9_-]/g, '_')}/`;
  const doc: ItemDoc = {
    id,
    dollId,
    item: { id, name: 'ふく', category: 'トップス', image: { file: 'files/a.webp', canvasW: 10, canvasH: 10, box: { x: 0, y: 0, w: 1, h: 1 } }, thumb: 'files/t.webp' },
    paths: { 'files/a.webp': `${folder}a.webp`, 'files/t.webp': `${folder}t.webp` },
    createdAt: clock,
    hue: 30,
  };
  await store.putItem(uid, doc);
  for (const p of Object.values(doc.paths)) await files.put(p, Buffer.from(p), 'image/webp');
  return doc;
}
function replayTransactions() {
  const real = store.updateJob.bind(store);
  store.updateJob = async (uid, jobId, change) => {
    await real(uid, jobId, change);
    return real(uid, jobId, change);
  };
}

describe('背景を始める（startJob）', () => {
  it('チケットを 1 枚引いて、背景 1 枚の順番待ちの仕事ができる（絵は、まだ作らない。テーマの幅は測らない）', async () => {
    await userWith('u1', 2);
    const { jobId, cost } = await startJob(deps, 'u1', bg());
    expect(cost).toBe(1);
    expect(await tickets('u1')).toBe(1);
    const job = (await store.getJob('u1', jobId))!;
    expect(job).toMatchObject({ dollId, done: false, tickets: 1, styleId: 'anime' });
    expect(job.set).toBeUndefined();
    expect(job.width).toBeUndefined();
    expect(job.candidates).toEqual([expect.objectContaining({ index: 0, categoryId: BACKGROUND_CATEGORY, name: 'はいけい1', description: 'A calm beach at noon.', status: 'waiting' })]);
    expect(imageCalls).toBe(0);
    expect(textCalls).toBe(1); // 企画の 1 回だけ（幅を測る呼び出しは、しない）
    expect(prompts[0]).toContain('Theme: うみ');
  });
  it('チケットが足りないときは、AI を呼ばない（企画も絵も）。何も引かない・作らない', async () => {
    await userWith('u1', 0);
    await expect(startJob(deps, 'u1', bg())).rejects.toSatisfy((e) => code(e) === 'no-tickets');
    expect(textCalls).toBe(0);
    expect(imageCalls).toBe(0);
    expect(await store.listJobs('u1')).toEqual([]);
    expect(store.ledger.filter((l) => l.reason.startsWith('job:'))).toEqual([]);
  });
  it('管理者は、チケットが無くても作れる（残りは変わらず、台帳に残る）', async () => {
    const me = await signIn(deps, 'u1');
    deps.adminCodes = [me.userCode];
    const { jobId } = await startJob(deps, 'u1', bg());
    expect(await tickets('u1')).toBe(0);
    expect(store.ledger.some((l) => l.reason === `admin:job:${jobId}` && l.count === -1)).toBe(true);
    expect((await store.getJob('u1', jobId))!.free).toBe(true);
  });
  it('写真は使えない。知らないドール・空のテーマは断る（どれも、引かない）', async () => {
    await userWith('u1', 2);
    const photo = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#888888' } }).png().toBuffer();
    await expect(startJob(deps, 'u1', { ...bg(), photo })).rejects.toSatisfy((e) => code(e) === 'refused');
    await expect(startJob(deps, 'u1', bg('いない'))).rejects.toSatisfy((e) => code(e) === 'refused');
    await expect(startJob(deps, 'u1', { ...bg(), theme: ' ' })).rejects.toSatisfy((e) => code(e) === 'refused');
    expect(await tickets('u1')).toBe(2);
    expect(await store.listJobs('u1')).toEqual([]);
  });
  it('背景の印（__background）は、服のカテゴリとしては頼めない（ドールに、たまたま同じ名前のカテゴリがあっても）。引かない・作らない', async () => {
    await userWith('u1', 2);
    const manifest = deps.content.manifest;
    deps.content.manifest = async () => {
      const m = await manifest();
      return { ...m, dolls: m.dolls.map((d) => ({ ...d, categories: [...d.categories, { id: '__background', label: 'へんなカテゴリ', menuOrder: 99 }] })) } as typeof m;
    };
    await expect(startJob(deps, 'u1', { dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: '__background' } })).rejects.toSatisfy((e) => code(e) === 'refused');
    await expect(startJob(deps, 'u1', { dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'set', categoryIds: ['トップス', '__background'] } })).rejects.toSatisfy((e) => code(e) === 'refused');
    expect(await tickets('u1')).toBe(2);
    expect(await store.listJobs('u1')).toEqual([]);
  });
  it('企画には、そのドールの、いまある自分の背景の名前だけを伝える（ほかのドール・服の名前は伝えない）', async () => {
    await userWith('u1', 5);
    const first = await made('u1');
    await made('u1', otherDollId);
    await cloth('u1', 'my:x-0-1');
    await startJob(deps, 'u1', bg());
    const line = prompts.at(-1)!.split('\n').find((l) => l.startsWith('Existing background names'))!;
    expect(line).toContain(first.item.name);
    expect(line).not.toContain('はいけい2');
    expect(line).not.toContain('ふく');
  });
  it('「作る」が、確定したあとにもう一度呼ばれても、チケットは 1 回しか引かない（仕事も 1 つ）', async () => {
    await userWith('u1', 2);
    const real = store.chargeAndCreateJob.bind(store);
    store.chargeAndCreateJob = async (uid, job, cost, reason, now) => {
      await real(uid, job, cost, reason, now);
      return real(uid, job, cost, reason, now);
    };
    const { jobId } = await startJob(deps, 'u1', bg());
    expect(await tickets('u1')).toBe(1);
    expect(await store.listJobs('u1')).toHaveLength(1);
    expect(store.ledger.filter((l) => l.reason === `job:${jobId}`)).toHaveLength(1);
  });
});

describe('背景を作る（runJob）', () => {
  it('できた背景は、そのドールの自分の背景になる（1024 の WebP と、小さいサムネイル）。チケットは 1 枚だけ', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', { ...bg(), styleId: 'pastel' });
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    const job = (await store.getJob('u1', jobId))!;
    expect(job.done).toBe(true);
    expect(job.candidates[0]).toMatchObject({ status: 'kept', itemId: `my:${jobId}-0-1`, tries: 1 });
    const items = await listItems(deps, 'u1');
    expect(items).toHaveLength(1);
    const doc = items[0];
    expect(isBackground(doc)).toBe(true);
    expect(doc).toMatchObject({ id: `my:${jobId}-0-1`, dollId, hue: 0, item: { name: 'はいけい1', category: BACKGROUND_CATEGORY } });
    expect(doc.set).toBeUndefined();
    expect(doc.fit).toBeUndefined();
    const main = files.files.get(doc.paths[doc.item.image.file])!;
    const thumb = files.files.get(doc.paths[doc.item.thumb])!;
    expect(main.contentType).toBe('image/webp');
    expect(await sharp(main.data).metadata()).toMatchObject({ format: 'webp', width: 1024, height: 1024 });
    expect(doc.item.image).toMatchObject({ canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 1024, h: 1024 } });
    const t = await sharp(thumb.data).metadata();
    expect(t.format).toBe('webp');
    expect(Math.max(t.width!, t.height!)).toBe(192);
    expect(Object.values(doc.paths).every((p) => p.startsWith(`users/u1/items/`))).toBe(true);
    expect(imageCalls).toBe(1);
    expect(imagePrompts[0]).toContain('A calm beach at noon.');
    expect(imagePrompts[0]).toContain('Art style:'); // 仕事の絵柄で描く
    expect(await tickets('u1')).toBe(1);
    expect(refunds()).toEqual([]);
  });
  it('できなかったら、チケットは 1 回だけ戻る（failed → 払い戻し → refunded）。背景も絵も残らない', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', bg());
    expect(await tickets('u1')).toBe(1);
    failImages = true;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    const job = (await store.getJob('u1', jobId))!;
    expect(job).toMatchObject({ done: true, tickets: 0 });
    expect(job.candidates[0]).toMatchObject({ status: 'failed', refunded: true });
    expect(job.candidates[0].notes[0]).toContain('チケットは戻しました');
    expect(await tickets('u1')).toBe(2);
    expect(refunds()).toHaveLength(1);
    expect(await listItems(deps, 'u1')).toEqual([]);
    expect([...files.files.keys()]).toEqual([]);
    // もう一度呼ばれても、戻すのは 1 回
    await runJob(deps, 'u1', jobId);
    expect(await tickets('u1')).toBe(2);
    expect(refunds()).toHaveLength(1);
  });
  it('内容の決まりで断られたら、説明を書き直して、1 回だけ作り直す', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', bg());
    blockImages = 1;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect(imageCalls).toBe(2);
    expect(imagePrompts[1]).toContain('A calm, safe beach.');
    expect(await listItems(deps, 'u1')).toHaveLength(1);
    expect(await tickets('u1')).toBe(1);
  });
  it('その日の上限に達していたら、絵を作らずに「できなかった」にして、チケットを戻す', async () => {
    await userWith('u1', 2);
    deps.limits.perDay = 0;
    const { jobId } = await startJob(deps, 'u1', bg());
    await runJob(deps, 'u1', jobId);
    expect(imageCalls).toBe(0);
    expect((await store.getJob('u1', jobId))!.candidates[0]).toMatchObject({ status: 'failed', refunded: true });
    expect(await tickets('u1')).toBe(2);
  });
  it('同時に 3 回呼んでも、絵は 1 回、背景は 1 枚', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', bg());
    const results = await Promise.all([runJob(deps, 'u1', jobId), runJob(deps, 'u1', jobId), runJob(deps, 'u1', jobId)]);
    expect(results.filter((r) => r === 'done')).toHaveLength(1);
    expect(imageCalls).toBe(1);
    expect(await listItems(deps, 'u1')).toHaveLength(1);
  });
  it('3 回取りかかって止まった背景は、作らずに打ち切って、払い戻す', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', bg());
    await store.updateJob('u1', jobId, (job) => ({ ...job, candidates: job.candidates.map((c) => ({ ...c, tries: 3 })) }));
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect(imageCalls).toBe(0);
    expect((await store.getJob('u1', jobId))!.candidates[0]).toMatchObject({ status: 'failed', refunded: true });
    expect(await tickets('u1')).toBe(2);
  });
  it('24 時間たった背景の仕事は、打ち切って払い戻す（tendJob）', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', bg());
    clock += EXPIRE_MS + 1000;
    const job = await tendJob(deps, 'u1', (await store.getJob('u1', jobId))!);
    expect(job.done).toBe(true);
    expect(job.candidates[0]).toMatchObject({ status: 'failed', refunded: true });
    expect(await tickets('u1')).toBe(2);
  });
  it('追い越された古い呼び出しが、あとからできあがっても、背景は 1 枚だけ', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', bg());
    let open!: () => void;
    imageGate = new Promise((resolve) => (open = resolve));
    deps.heartbeatMs = 1_000_000;
    const slow = runJob(deps, 'u1', jobId);
    await new Promise((r) => setTimeout(r, 50));
    clock += 200_000; // 止まったとみなされる
    imageGate = null;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    open();
    expect(await slow).toBe('busy');
    const items = await listItems(deps, 'u1');
    expect(items.map((i) => i.id)).toEqual([`my:${jobId}-0-2`]);
    expect(await tickets('u1')).toBe(1);
    expect(refunds()).toEqual([]);
    // 古い呼び出しの絵は、置き場に残らない
    expect([...files.files.keys()].every((k) => k.includes(`my_${jobId}-0-2`))).toBe(true);
  });
});

describe('背景の仕事の、取り引きのやり直し', () => {
  it('確定したあとに、もう一度呼ばれても: 背景 1 枚・絵 1 回・チケット 1 枚', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', bg());
    replayTransactions();
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect((await store.getJob('u1', jobId))!.candidates[0]).toMatchObject({ status: 'kept', itemId: `my:${jobId}-0-1`, tries: 1 });
    expect((await listItems(deps, 'u1')).map((i) => i.id)).toEqual([`my:${jobId}-0-1`]);
    expect(imageCalls).toBe(1);
    expect(await tickets('u1')).toBe(1);
    expect(refunds()).toEqual([]);
  });
  it('できなかったときも: 払い戻しは 1 回', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', bg());
    replayTransactions();
    failImages = true;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect((await store.getJob('u1', jobId))!.candidates[0]).toMatchObject({ status: 'failed', refunded: true });
    expect(await tickets('u1')).toBe(2);
    expect(refunds()).toHaveLength(1);
  });
  it('背景を保存したあと、結果を書く所で失敗したら、保存した背景は残さない。やり直しで、1 枚だけになる', async () => {
    await userWith('u1', 2);
    const { jobId } = await startJob(deps, 'u1', bg());
    const real = store.updateJob.bind(store);
    let calls = 0;
    store.updateJob = async (uid, id, change) => {
      // 受け持つ（1 回め）のあとの、結果を書く呼び出しを、1 回だけ失敗させる
      if (++calls === 2) throw new Error('書けませんでした');
      return real(uid, id, change);
    };
    await expect(runJob(deps, 'u1', jobId)).rejects.toThrow('書けませんでした');
    expect(await listItems(deps, 'u1')).toEqual([]);
    expect([...files.files.keys()]).toEqual([]);
    store.updateJob = real;
    clock += 200_000;
    expect(await runJob(deps, 'u1', jobId)).toBe('done');
    expect((await listItems(deps, 'u1')).map((i) => i.id)).toEqual([`my:${jobId}-0-2`]);
    expect(await tickets('u1')).toBe(1);
    expect(refunds()).toEqual([]);
  });
});

describe('自分の背景: 一覧・名前・消す', () => {
  it('一覧には、作ったドールの背景として出る（ほかのドールの背景・服と、まざらない）', async () => {
    await userWith('u1', 5);
    const a = await made('u1');
    const b = await made('u1', otherDollId);
    await cloth('u1', 'my:x-0-1');
    const all = await listItems(deps, 'u1');
    const backgroundsOf = (forDoll: string) => all.filter((i) => isBackground(i) && i.dollId === forDoll).map((i) => i.id);
    expect(backgroundsOf(dollId)).toEqual([a.id]);
    expect(backgroundsOf(otherDollId)).toEqual([b.id]);
    expect(all.filter((i) => !isBackground(i)).map((i) => i.id)).toEqual(['my:x-0-1']);
    // ほかの利用者には、見えない
    await userWith('u2', 0);
    expect(await listItems(deps, 'u2')).toEqual([]);
  });
  it('名前は変えられる', async () => {
    await userWith('u1', 2);
    const a = await made('u1');
    clock += 1000;
    const next = await updateItem(deps, 'u1', a.id, { name: 'ゆうやけの うみ' });
    expect(next.item.name).toBe('ゆうやけの うみ');
    expect(next.updatedAt).toBe(clock);
    expect(isBackground(next)).toBe(true);
  });
  it('色（hue）・はじめの位置（fit）は、背景には付けない（頼まれても、変えずに返す。背景は壊れない）', async () => {
    await userWith('u1', 2);
    const a = await made('u1');
    clock += 1000;
    const same = await updateItem(deps, 'u1', a.id, { hue: 90, fit: { x: 30, y: -12, scale: 1.4, rotation: 15 } });
    expect(same).toEqual(a);
    expect(await store.getItem('u1', a.id)).toEqual(a);
    // 名前と一緒に頼まれたら、名前だけ変わる
    const named = await updateItem(deps, 'u1', a.id, { name: 'あたらしい なまえ', hue: 90, fit: { x: 30, y: 0, scale: 1, rotation: 0 } });
    expect(named).toMatchObject({ hue: 0, item: { name: 'あたらしい なまえ', category: BACKGROUND_CATEGORY } });
    expect(named.fit).toBeUndefined();
    // アプリからの呼び出し（api）でも同じ
    const viaApi = (await handleCall(deps, 'u1', { op: 'updateItem', id: a.id, hue: 45 })) as { item: { hue: number; fit?: unknown } };
    expect(viaApi.item.hue).toBe(0);
    expect((await store.getItem('u1', a.id))!.hue).toBe(0);
  });
  it('並び順を変えても、背景は壊れない', async () => {
    await userWith('u1', 3);
    const a = await made('u1');
    const b = await made('u1');
    clock += 1000;
    await orderItems(deps, 'u1', [a.id, b.id]);
    expect((await store.getItem('u1', a.id))!.order).toBeGreaterThan((await store.getItem('u1', b.id))!.order!);
    expect(isBackground((await store.getItem('u1', a.id))!)).toBe(true);
  });
  it('消すと、一覧からも置き場（絵とサムネイル）からも消える。ほかの背景の絵は、消えない', async () => {
    await userWith('u1', 3);
    const a = await made('u1');
    const b = await made('u1');
    expect([...files.files.keys()]).toHaveLength(4);
    await deleteItem(deps, 'u1', a.id);
    expect((await listItems(deps, 'u1')).map((i) => i.id)).toEqual([b.id]);
    expect([...files.files.keys()].sort()).toEqual(Object.values(b.paths).sort());
    // ほかの利用者は、消せない
    await userWith('u2', 0);
    await deleteItem(deps, 'u2', b.id);
    expect(await store.getItem('u1', b.id)).not.toBeNull();
  });
});

describe('背景の交換', () => {
  async function swap(aItem: string, bItem: string) {
    const { tradeId, code: word } = await tradeOpen(deps, 'ua', aItem);
    await tradeClaim(deps, 'ub', word);
    await tradeJoin(deps, 'ub', tradeId, bItem);
    clock += 1000;
    await tradeAccept(deps, 'ua', tradeId);
    return { tradeId, done: await tradeAccept(deps, 'ub', tradeId) };
  }
  it('背景と服を入れ替える: 持ち主だけが替わる（同じドール・背景のまま。絵も読める）', async () => {
    await userWith('ua', 2);
    await userWith('ub', 0);
    const mine = await made('ua');
    await cloth('ub', 'my:y-0-1');
    const { tradeId, done } = await swap(mine.id, 'my:y-0-1');
    expect(done).toMatchObject({ status: 'done', receivedId: mine.id });
    expect(await store.getItem('ua', mine.id)).toBeNull();
    const moved = (await store.getItem('ub', mine.id))!;
    expect(moved).toMatchObject({ dollId, item: { category: BACKGROUND_CATEGORY, name: mine.item.name }, paths: mine.paths });
    expect(isBackground(moved)).toBe(true);
    expect(await store.getItem('ua', 'my:y-0-1')).toMatchObject({ item: { category: 'トップス' } });
    // 交換の画面には、背景のカテゴリとサムネイルが届く
    const view = await tradeView(deps, 'ua', tradeId);
    expect(view.mine).toMatchObject({ id: mine.id, categoryId: BACKGROUND_CATEGORY, dollId, thumbType: 'image/webp' });
    expect(view.mine!.thumb.length).toBeGreaterThan(0);
    // もらった人が、絵ごと取れる（絵は、元の人の置き場のまま）
    const got = (await handleCall(deps, 'ub', { op: 'itemFiles', id: mine.id })) as { files: Record<string, string> };
    expect(Object.keys(got.files).sort()).toEqual([mine.item.image.file, mine.item.thumb].sort());
    // もらった人が消すと、元の置き場の絵も消える
    await deleteItem(deps, 'ub', mine.id);
    expect([...files.files.keys()].some((k) => k.includes(mine.id.replace(/[^A-Za-z0-9_-]/g, '_')))).toBe(false);
  });
  it('背景と背景を入れ替える', async () => {
    await userWith('ua', 2);
    await userWith('ub', 2);
    const a = await made('ua');
    const b = await made('ub', otherDollId);
    const { done } = await swap(a.id, b.id);
    expect(done.status).toBe('done');
    expect((await listItems(deps, 'ua')).map((i) => [i.id, i.dollId, isBackground(i)])).toEqual([[b.id, otherDollId, true]]);
    expect((await listItems(deps, 'ub')).map((i) => [i.id, i.dollId, isBackground(i)])).toEqual([[a.id, dollId, true]]);
  });
  it('作っている途中の背景は、交換に出せない', async () => {
    await userWith('ua', 2);
    const { jobId } = await startJob(deps, 'ua', bg());
    let open!: () => void;
    imageGate = new Promise((resolve) => (open = resolve));
    const running = runJob(deps, 'ua', jobId);
    await new Promise((r) => setTimeout(r, 50));
    await expect(tradeOpen(deps, 'ua', `my:${jobId}-0-1`)).rejects.toSatisfy((e) => code(e) === 'refused');
    open();
    await running;
    await expect(tradeOpen(deps, 'ua', `my:${jobId}-0-1`)).resolves.toMatchObject({ tradeId: expect.any(String) });
  });
});

describe('背景の引き継ぎ（2 台めの端末を、アカウントに合わせる）', () => {
  it('背景も、服と一緒に、アカウントへ移る（ドール・絵のパスは、そのまま）', async () => {
    await userWith('A', 3);
    await userWith('B', 0);
    const mine = await made('A');
    await cloth('A', 'my:x-0-1');
    const word = await offerHandoff(deps, 'A');
    expect(await adoptUser(deps, 'B', word)).toEqual({ status: 'done', tickets: 2, items: 2 });
    expect(await listItems(deps, 'A')).toEqual([]);
    const moved = (await store.getItem('B', mine.id))!;
    expect(moved).toEqual(mine);
    expect(files.files.has(moved.paths[moved.item.image.file])).toBe(true);
  });
  it('背景の仕事が進んでいる途中は、まだ移さない。終わったら（workJob の終わり）移る。できなかった分の払い戻しも、移る', async () => {
    await userWith('A', 2);
    await userWith('B', 0);
    const { jobId } = await startJob(deps, 'A', bg());
    const word = await offerHandoff(deps, 'A');
    expect(await adoptUser(deps, 'B', word)).toEqual({ status: 'done', tickets: 1, items: 0 });
    await workJob(deps, 'A', jobId);
    expect(await listItems(deps, 'A')).toEqual([]);
    expect((await listItems(deps, 'B')).map((i) => i.id)).toEqual([`my:${jobId}-0-1`]);
    expect(await drain(deps, 'A', 'B')).toEqual({ tickets: 0, items: 0 });
    // できなかった仕事: 戻った 1 枚も、移る
    await store.addTickets('A', 1, 'test', clock);
    const second = await startJob(deps, 'A', bg());
    failImages = true;
    await workJob(deps, 'A', second.jobId);
    expect((await store.getUser('A'))!.tickets).toBe(0);
    expect(await tickets('B')).toBe(2);
  });
  it('取り引きのやり直し: 移す操作が、どれも 2 回ずつ呼ばれても、背景は 1 枚ぶん', async () => {
    await userWith('A', 2);
    await userWith('B', 0);
    const mine = await made('A');
    const word = await offerHandoff(deps, 'A');
    for (const name of ['moveTickets', 'moveItem', 'markUser', 'addAdopted', 'claimHandoff'] as const) {
      const real = (store[name] as (...args: unknown[]) => Promise<unknown>).bind(store);
      (store as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
        await real(...args);
        return real(...args);
      };
    }
    expect((await adoptUser(deps, 'B', word)).status).toBe('done');
    expect((await listItems(deps, 'B')).map((i) => i.id)).toEqual([mine.id]);
    expect(await listItems(deps, 'A')).toEqual([]);
    expect(await tickets('B')).toBe(1);
  });
});

describe('アプリからの呼び出し（api）', () => {
  it("startJob の target { kind: 'background' } を受け取り、進み具合・一覧・絵に、背景のカテゴリで出る", async () => {
    await userWith('u1', 2);
    const started = (await handleCall(deps, 'u1', { op: 'startJob', dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'background' } })) as { jobId: string; cost: number; user: { tickets: number } };
    expect(started).toMatchObject({ cost: 1, user: { tickets: 1 } });
    await runJob(deps, 'u1', started.jobId);
    const { job } = (await handleCall(deps, 'u1', { op: 'job', jobId: started.jobId })) as { job: { done: boolean; candidates: { categoryId: string; status: string; itemId?: string }[] } };
    expect(job.done).toBe(true);
    expect(job.candidates).toEqual([expect.objectContaining({ categoryId: BACKGROUND_CATEGORY, status: 'kept', itemId: `my:${started.jobId}-0-1` })]);
    const { items } = (await handleCall(deps, 'u1', { op: 'items' })) as { items: { id: string; dollId: string; item: { category: string; image: { file: string }; thumb: string } }[] };
    expect(items).toEqual([expect.objectContaining({ id: `my:${started.jobId}-0-1`, dollId, item: expect.objectContaining({ category: BACKGROUND_CATEGORY }) })]);
    const got = (await handleCall(deps, 'u1', { op: 'itemFiles', id: items[0].id })) as { files: Record<string, string> };
    expect(Object.keys(got.files).sort()).toEqual([items[0].item.image.file, items[0].item.thumb].sort());
    expect((await sharp(Buffer.from(got.files[items[0].item.image.file], 'base64')).metadata()).format).toBe('webp');
  });
  it('target の形がおかしければ断る', async () => {
    await userWith('u1', 2);
    await expect(handleCall(deps, 'u1', { op: 'startJob', dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'backgrounds' } })).rejects.toSatisfy((e) => code(e) === 'refused');
    expect(await tickets('u1')).toBe(2);
  });
});
