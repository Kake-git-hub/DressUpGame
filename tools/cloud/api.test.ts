// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentStore } from '../content/manifestEdit.ts';
import type { ImageAi, TextAi } from '../studio/ai.ts';
import { callerOfToken, handleCall } from './api.ts';
import type { ItemView, JobView } from './api.ts';
import { MemoryFiles, MemoryStore } from './memoryStore.ts';
import { createPublicContent } from './publicContent.ts';
import { CloudError } from './store.ts';
import { runJob } from './studioCore.ts';
import type { CoreDeps, UserView } from './studioCore.ts';

let dir: string;
let store: MemoryStore;
let deps: CoreDeps;
let dollId: string;
let clock: number;
let fetched: string[];

const doll = () =>
  sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="500" height="1000">
    <circle cx="250" cy="80" r="70" fill="#f0c8a8"/><rect x="225" y="140" width="50" height="40" fill="#f0c8a8"/>
    <rect x="170" y="175" width="160" height="330" fill="#f0c8a8"/>
    <rect x="60" y="180" width="60" height="330" fill="#f0c8a8" transform="rotate(12 90 180)"/>
    <rect x="380" y="180" width="60" height="330" fill="#f0c8a8" transform="rotate(-12 410 180)"/>
    <rect x="170" y="500" width="70" height="480" fill="#f0c8a8"/><rect x="260" y="500" width="70" height="480" fill="#f0c8a8"/>
  </svg>`),
  )
    .png()
    .toBuffer();
const fakeImage: ImageAi = {
  async generate(input) {
    const w = (await sharp(input.images[0]).metadata()).width!;
    const cloth = await sharp({ create: { width: Math.round(w * 0.24), height: Math.round(w * 0.2), channels: 3, background: '#c81e28' } }).png().toBuffer();
    return sharp(input.images[0]).composite([{ input: cloth, left: Math.round(w * 0.38), top: Math.round(w * 0.22) }]).png().toBuffer();
  },
};
const fakeText: TextAi = {
  async json<T>(input: { schema: Record<string, unknown> }): Promise<T> {
    const props = (input.schema.properties ?? {}) as Record<string, unknown>;
    if ('ok' in props) return { ok: true, reason: 'ok' } as T;
    return { items: [{ category: 'トップス', name: 'うみのシャツ', description: 'A red shirt.', colors: ['#c81e28'] }] } as T;
  },
};
// 素材フォルダを、公開されている置き場のように返す fetch
const contentFetch = (async (input: string | URL) => {
  const file = decodeURIComponent(new URL(String(input)).pathname.replace(/^\/content\//, ''));
  fetched.push(file);
  try {
    return new Response(await fs.readFile(path.join(dir, file)));
  } catch {
    return new Response('not found', { status: 404 });
  }
}) as unknown as typeof fetch;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cloud-api-'));
  const content = new ContentStore(dir);
  await content.init();
  dollId = (await content.addDoll({ name: 'テスト', data: await doll() })).id;
  store = new MemoryStore();
  clock = 2_000_000;
  fetched = [];
  enqueued = [];
  let ids = 0;
  deps = {
    store,
    files: new MemoryFiles(),
    ai: { text: fakeText, image: fakeImage },
    content: createPublicContent('https://example.test/content/', contentFetch, () => clock),
    adminCodes: [],
    limits: { perDay: 20, maxAttempts: 1 },
    now: () => clock,
    newId: () => `job${++ids}`,
    newWord: () => `word${++ids}`,
    enqueue: async (uid, jobId) => {
      enqueued.push(`${uid}/${jobId}`);
    },
  };
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

let enqueued: string[] = [];
const call = <T>(uid: string, data: unknown) => handleCall(deps, uid, data) as Promise<T>;
const codeOf = (e: unknown) => (e instanceof CloudError ? e.code : `not a CloudError: ${String(e)}`);

describe('アプリからの呼び出し', () => {
  it('ひととおり: 利用者 → 始める → 進める → 進み具合 → 自分の服（絵つきで取れる）→ 消す', async () => {
    const { user, api } = await call<{ user: UserView; api: number }>('u1', { op: 'signIn' });
    expect(user.tickets).toBe(0);
    expect(api).toBe(3); // 3 = 引き継ぎ（offer・adopt）もできるサーバー
    await store.addTickets('u1', 3, 'test', clock);
    const started = await call<{ jobId: string; cost: number; user: UserView }>('u1', { op: 'startJob', dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    expect(started).toMatchObject({ cost: 1, user: { tickets: 2 } });
    // 公開されている素材から、一覧を読んでいる
    expect(fetched).toContain('manifest.json');
    await runJob(deps, 'u1', started.jobId);
    const { job } = await call<{ job: JobView }>('u1', { op: 'job', jobId: started.jobId });
    expect(job).toMatchObject({ id: started.jobId, done: true });
    expect(job.candidates[0].itemId).toBe(`my:${started.jobId}-0-1`);
    expect(job.candidates[0]).toMatchObject({ status: 'kept', name: 'うみのシャツ' });
    // アプリには、AI への指示や置き場のパスは渡さない
    expect(JSON.stringify(job)).not.toMatch(/red shirt|users\/u1/);
    const { items } = await call<{ items: ItemView[] }>('u1', { op: 'items' });
    expect(items).toHaveLength(1);
    const kept = await call<{ item: ItemView; files: Record<string, string> }>('u1', { op: 'itemFiles', id: items[0].id });
    expect(kept.item).toMatchObject({ id: `my:${started.jobId}-0-1`, dollId, item: { name: 'うみのシャツ', category: 'トップス' } });
    expect(Object.keys(kept.files).sort()).toEqual([kept.item.item.image.file, kept.item.item.thumb].sort());
    expect((await sharp(Buffer.from(kept.files[kept.item.item.image.file], 'base64')).metadata()).format).toBe('webp');
    expect(JSON.stringify(kept.item)).not.toMatch(/users\/u1/);
    expect(kept.item).toMatchObject({ hue: 0, order: clock, updatedAt: clock, notes: [] });
    // 終わった仕事は、見た印を付けるまで出る
    expect((await call<{ jobs: JobView[] }>('u1', { op: 'jobs' })).jobs.map((j) => j.id)).toEqual([started.jobId]);
    expect(await call('u1', { op: 'ack', jobId: started.jobId })).toEqual({ ok: true });
    expect((await call<{ jobs: JobView[] }>('u1', { op: 'jobs' })).jobs).toEqual([]);
    // 名前と色を変える
    clock += 10;
    const changed = await call<{ item: ItemView }>('u1', { op: 'updateItem', id: kept.item.id, name: 'ふく', hue: 90 });
    expect(changed.item).toMatchObject({ item: { name: 'ふく' }, hue: 90, updatedAt: clock });
    kept.item = changed.item;
    const ordered = await call<{ items: ItemView[] }>('u1', { op: 'orderItems', ids: [kept.item.id] });
    expect(ordered.items.map((i) => i.id)).toEqual([kept.item.id]);
    kept.item = ordered.items[0];
    const again = await call<{ item: ItemView; files: Record<string, string> }>('u1', { op: 'itemFiles', id: kept.item.id });
    expect(again).toEqual({ item: kept.item, files: kept.files });
    await call('u1', { op: 'deleteItem', id: kept.item.id });
    expect((await call<{ items: ItemView[] }>('u1', { op: 'items' })).items).toEqual([]);
  }, 60_000);

  it('ほかの利用者の仕事・絵・服は、見えない', async () => {
    await call('u1', { op: 'signIn' });
    await store.addTickets('u1', 3, 'test', clock);
    const started = await call<{ jobId: string }>('u1', { op: 'startJob', dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    await runJob(deps, 'u1', started.jobId);
    const [mine] = (await call<{ items: ItemView[] }>('u1', { op: 'items' })).items;
    await call('u2', { op: 'signIn' });
    for (const data of [{ op: 'job', jobId: started.jobId }, { op: 'ack', jobId: started.jobId }, { op: 'itemFiles', id: mine.id }, { op: 'updateItem', id: mine.id, name: 'x' }, { op: 'orderItems', ids: [mine.id] }, ]) {
      expect(codeOf(await call('u2', data).catch((e) => e))).toBe('refused');
    }
    expect((await call<{ items: ItemView[] }>('u2', { op: 'items' })).items).toEqual([]);
    expect((await call<{ jobs: JobView[] }>('u2', { op: 'jobs' })).jobs).toEqual([]);
  }, 60_000);

  it('形の違う呼び出しは断る（落ちない）', async () => {
    for (const data of [null, 'x', {}, { op: 'nope' }, { op: 'job' }, { op: 'job', jobId: 5 }, { op: 'keep', jobId: 'a', index: 0 }, { op: 'discard', jobId: 'a', index: 0 }, { op: 'preview', jobId: 'a', index: 0 }, { op: 'startJob', dollId, theme: 'x', styleId: 'anime', target: { kind: 'other' } }, { op: 'startJob', dollId, theme: 'x', styleId: 'anime', target: null }, { op: 'itemFiles', id: 'x'.repeat(300) }, { op: 'ack' }, { op: 'updateItem', id: 'my:a', hue: '90' }, { op: 'updateItem', id: 'my:a', name: 5 }, { op: 'updateItem', id: 'my:a' }, { op: 'orderItems', ids: 'my:a' }, { op: 'orderItems', ids: [1, 2] }, { op: 'orderItems', ids: Array.from({ length: 501 }, (_, i) => `my:${i}`) }]) {
      expect(codeOf(await call('u1', data).catch((e) => e))).toBe('refused');
    }
  });

  it('進み具合を聞かれたとき、止まっている仕事は、列に入れ直す（列で待っているはずなら、5 分たってから）', async () => {
    await call('u1', { op: 'signIn' });
    await store.addTickets('u1', 1, 'test', clock);
    const started = await call<{ jobId: string }>('u1', { op: 'startJob', dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    expect(enqueued).toEqual([`u1/${started.jobId}`]);
    await call('u1', { op: 'job', jobId: started.jobId });
    expect(enqueued).toHaveLength(1); // 列に入れたばかり
    clock += 31_000;
    await call('u1', { op: 'job', jobId: started.jobId });
    expect(enqueued).toHaveLength(1); // 列で待っているだけかもしれないので、まだ入れ直さない
    clock += 300_000;
    await call('u1', { op: 'job', jobId: started.jobId });
    expect(enqueued).toHaveLength(2);
    await call('u1', { op: 'jobs' });
    expect(enqueued).toHaveLength(2);
  });

  it('前の版の候補: 「できた」は作成中として、「捨てた」は除いて返す', async () => {
    await call('u1', { op: 'signIn' });
    const candidate = (index: number, status: 'done' | 'discarded' | 'kept') => ({ index, name: `ふく${index}`, categoryId: 'トップス', description: 'A top.', colors: [], status, notes: [] });
    await store.createJob('u1', { id: 'old', dollId, theme: 'うみ', styleId: 'anime', done: true, tickets: 3, createdAt: clock, heartbeat: clock, candidates: [candidate(0, 'done'), candidate(1, 'discarded'), candidate(2, 'kept')] });
    const { job } = await call<{ job: JobView }>('u1', { op: 'job', jobId: 'old' });
    expect(job.candidates.map((c) => [c.index, c.status])).toEqual([[0, 'working'], [2, 'kept']]);
    expect(job.done).toBe(false); // まだ服にしていない候補がある
  });
});

describe('引き継ぎ（③-b）: offer・adopt', () => {
  const named = { anonymous: false };
  const anon = { anonymous: true };
  const callAs = <T>(uid: string, data: unknown, caller: { anonymous: boolean }) => handleCall(deps, uid, data, caller) as Promise<T>;

  it('signIn の返事の api は 3。匿名でない signIn で named の印が付く（匿名・既定では付かない）', async () => {
    expect((await call<{ api: number }>('a1', { op: 'signIn' })).api).toBe(3);
    expect((await callAs<{ api: number }>('a1', { op: 'signIn' }, anon)).api).toBe(3);
    expect((await store.getUser('a1'))!.named).toBeUndefined();
    const answer = await callAs<{ user: UserView; api: number }>('g1', { op: 'signIn' }, named);
    expect(answer).toMatchObject({ api: 3, user: { tickets: 0, admin: false } });
    expect((await store.getUser('g1'))!.named).toBe(true);
  });

  it('offer は匿名の利用者だけ（{ word }）。adopt は、匿名なら wait。匿名でなければ、移して user も返す', async () => {
    await call('a1', { op: 'signIn' });
    await store.addTickets('a1', 3, 'test', clock);
    expect(codeOf(await callAs('g1', { op: 'offer' }, named).catch((e) => e))).toBe('refused');
    const { word } = await callAs<{ word: string }>('a1', { op: 'offer' }, anon);
    expect(typeof word).toBe('string');
    expect((await call<{ word: string }>('a1', { op: 'offer' })).word).toBe(word); // 既定は匿名
    expect(await callAs('a1', { op: 'adopt', word }, anon)).toEqual({ status: 'wait', tickets: 0, items: 0 });
    expect((await store.getUser('a1'))!.tickets).toBe(3);
    const adopted = await callAs<{ status: string; tickets: number; items: number; user: UserView }>('g1', { op: 'adopt', word }, named);
    expect(adopted).toMatchObject({ status: 'done', tickets: 3, items: 0, user: { tickets: 3 } });
    expect(await callAs('g1', { op: 'adopt', word }, named)).toMatchObject({ status: 'done', tickets: 0, items: 0, user: { tickets: 3 } });
    expect(await callAs('g2', { op: 'adopt', word }, named)).toMatchObject({ status: 'used' });
    expect(await callAs('g2', { op: 'adopt', word: 'nope' }, named)).toMatchObject({ status: 'unknown' });
    for (const data of [{ op: 'adopt' }, { op: 'adopt', word: 5 }, { op: 'adopt', word: '' }, { op: 'adopt', word: 'x'.repeat(101) }]) {
      expect(codeOf(await callAs('g1', data, named).catch((e) => e))).toBe('refused');
    }
  });

  it('あとから元に入ったチケットは、先の匿名でない signIn で移る', async () => {
    await call('a1', { op: 'signIn' });
    const { word } = await call<{ word: string }>('a1', { op: 'offer' });
    await callAs('g1', { op: 'adopt', word }, named);
    await store.addTickets('a1', 2, 'grant', clock);
    expect((await callAs<{ user: UserView }>('g1', { op: 'signIn' }, anon)).user.tickets).toBe(0); // 匿名としての呼び出しでは、移さない
    expect((await callAs<{ user: UserView }>('g1', { op: 'signIn' }, named)).user.tickets).toBe(2);
    expect((await store.getUser('a1'))!.tickets).toBe(0);
  });

  it('移すのに失敗しても、signIn は通る', async () => {
    await call('a1', { op: 'signIn' });
    const { word } = await call<{ word: string }>('a1', { op: 'offer' });
    await callAs('g1', { op: 'adopt', word }, named);
    await store.addTickets('a1', 2, 'grant', clock);
    store.moveTickets = async () => {
      throw new Error('store is down');
    };
    expect((await callAs<{ user: UserView; api: number }>('g1', { op: 'signIn' }, named)).api).toBe(3);
  });

  it('名前のある利用者（1 台めとして結び付けた）の合い言葉は、使えない（refused）', async () => {
    await call('a1', { op: 'signIn' });
    await store.addTickets('a1', 2, 'test', clock);
    const { word } = await call<{ word: string }>('a1', { op: 'offer' });
    await callAs('a1', { op: 'signIn' }, named); // そのあと、Google と結び付けた
    expect(await callAs('g1', { op: 'adopt', word }, named)).toMatchObject({ status: 'refused', tickets: 0 });
    expect((await store.getUser('a1'))!.tickets).toBe(2);
  });
});

describe('呼んだ人が匿名か（Firebase の証明から）', () => {
  it('匿名 = sign_in_provider が anonymous（または無い）で、しかも、結び付けた提供元（identities の中の、空でない一覧）が無い', () => {
    expect(callerOfToken({ firebase: { sign_in_provider: 'anonymous' } })).toEqual({ anonymous: true });
    expect(callerOfToken({ firebase: { sign_in_provider: 'anonymous', identities: {} } })).toEqual({ anonymous: true });
    expect(callerOfToken({ firebase: { identities: {} } })).toEqual({ anonymous: true });
    expect(callerOfToken({ firebase: { sign_in_provider: 'anonymous', identities: { 'google.com': [] } } })).toEqual({ anonymous: true });
    expect(callerOfToken({})).toEqual({ anonymous: true });
    expect(callerOfToken(undefined)).toEqual({ anonymous: true });
    expect(callerOfToken(null)).toEqual({ anonymous: true });
  });
  it('匿名のまま Google と結び付けた（証明の sign_in_provider は anonymous のまま、identities に google.com）→ 匿名でない', () => {
    expect(callerOfToken({ firebase: { sign_in_provider: 'anonymous', identities: { 'google.com': ['123'] } } })).toEqual({ anonymous: false });
    expect(callerOfToken({ firebase: { identities: { 'google.com': ['123'], email: ['someone@example.com'] } } })).toEqual({ anonymous: false });
  });
  it('Google・メールとパスワードでのログイン → 匿名でない', () => {
    expect(callerOfToken({ firebase: { sign_in_provider: 'google.com', identities: { 'google.com': ['123'] } } })).toEqual({ anonymous: false });
    expect(callerOfToken({ firebase: { sign_in_provider: 'password', identities: { email: ['b@example.com'] } } })).toEqual({ anonymous: false });
    expect(callerOfToken({ firebase: { sign_in_provider: 'password' } })).toEqual({ anonymous: false });
  });
});

describe('公開されている素材を読む', () => {
  it('一覧は 1 分だけ覚える。絵は、読んだものを覚えておく。無い絵は null、届かないときは Error', async () => {
    const content = createPublicContent('https://example.test/content', contentFetch, () => clock);
    const manifest = await content.manifest();
    await content.manifest();
    expect(fetched.filter((f) => f === 'manifest.json')).toHaveLength(1);
    clock += 61_000;
    await content.manifest();
    expect(fetched.filter((f) => f === 'manifest.json')).toHaveLength(2);
    const dollDoc = manifest.dolls[0];
    await content.assets.dollTemplate(dollDoc);
    await content.assets.hiTemplate(dollDoc); // studio/masters/ に無い → ふつうの型
    await content.assets.workData(dollDoc); // 型紙が無い → 輪郭から推定
    await content.assets.dollTemplate(dollDoc);
    expect(fetched.filter((f) => f === dollDoc.image.file)).toHaveLength(1);
    const broken = createPublicContent('https://example.test/content/', (async () => new Response('x', { status: 500 })) as unknown as typeof fetch);
    await expect(broken.manifest()).rejects.toThrow(/読めません/);
    await expect(broken.assets.dollTemplate(dollDoc)).rejects.toThrow(/読めません/);
  });
});
