// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ContentStore } from '../content/manifestEdit.ts';
import type { ImageAi, TextAi } from '../studio/ai.ts';
import { handleCall } from './api.ts';
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
  };
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

const call = <T>(uid: string, data: unknown) => handleCall(deps, uid, data) as Promise<T>;
const codeOf = (e: unknown) => (e instanceof CloudError ? e.code : `not a CloudError: ${String(e)}`);

describe('アプリからの呼び出し', () => {
  it('ひととおり: 利用者 → 始める → 進める → 進み具合と絵 → 使う（絵つきで返る）→ 自分の服 → 消す', async () => {
    const { user } = await call<{ user: UserView }>('u1', { op: 'signIn' });
    expect(user.tickets).toBe(0);
    await store.addTickets('u1', 3, 'test', clock);
    const started = await call<{ jobId: string; cost: number; user: UserView }>('u1', { op: 'startJob', dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    expect(started).toMatchObject({ cost: 1, user: { tickets: 2 } });
    // 公開されている素材から、一覧を読んでいる
    expect(fetched).toContain('manifest.json');
    await runJob(deps, 'u1', started.jobId);
    const { job } = await call<{ job: JobView }>('u1', { op: 'job', jobId: started.jobId });
    expect(job).toMatchObject({ id: started.jobId, done: true, stalled: false });
    expect(job.candidates[0]).toMatchObject({ status: 'done', name: 'うみのシャツ' });
    expect(job.candidates[0].preview!.box.w).toBeGreaterThan(50);
    // アプリには、AI への指示や置き場のパスは渡さない
    expect(JSON.stringify(job)).not.toMatch(/red shirt|users\/u1/);
    const preview = await call<{ data: string; contentType: string }>('u1', { op: 'preview', jobId: started.jobId, index: 0 });
    expect((await sharp(Buffer.from(preview.data, 'base64')).metadata()).format).toBe('png');
    expect((await call<{ jobs: JobView[] }>('u1', { op: 'jobs' })).jobs).toHaveLength(1);
    const kept = await call<{ item: ItemView; files: Record<string, string>; user: UserView }>('u1', { op: 'keep', jobId: started.jobId, index: 0, name: 'ふく' });
    expect(kept.item).toMatchObject({ id: `my:${started.jobId}-0`, dollId, item: { name: 'ふく', category: 'トップス' } });
    expect(Object.keys(kept.files).sort()).toEqual([kept.item.item.image.file, kept.item.item.thumb].sort());
    expect((await sharp(Buffer.from(kept.files[kept.item.item.image.file], 'base64')).metadata()).format).toBe('webp');
    expect(JSON.stringify(kept.item)).not.toMatch(/users\/u1/);
    expect((await call<{ jobs: JobView[] }>('u1', { op: 'jobs' })).jobs).toEqual([]);
    expect((await call<{ items: ItemView[] }>('u1', { op: 'items' })).items.map((i) => i.id)).toEqual([kept.item.id]);
    expect(Object.keys((await call<{ files: Record<string, string> }>('u1', { op: 'itemFiles', id: kept.item.id })).files)).toHaveLength(2);
    await call('u1', { op: 'deleteItem', id: kept.item.id });
    expect((await call<{ items: ItemView[] }>('u1', { op: 'items' })).items).toEqual([]);
  }, 60_000);

  it('ほかの利用者の仕事・絵・服は、見えない', async () => {
    await call('u1', { op: 'signIn' });
    await store.addTickets('u1', 3, 'test', clock);
    const started = await call<{ jobId: string }>('u1', { op: 'startJob', dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    await runJob(deps, 'u1', started.jobId);
    const kept = await call<{ item: ItemView }>('u1', { op: 'keep', jobId: started.jobId, index: 0, name: 'ふく' });
    await call('u2', { op: 'signIn' });
    for (const data of [{ op: 'job', jobId: started.jobId }, { op: 'preview', jobId: started.jobId, index: 0 }, { op: 'itemFiles', id: kept.item.id }, { op: 'discard', jobId: started.jobId, index: 0 }]) {
      expect(codeOf(await call('u2', data).catch((e) => e))).toBe('refused');
    }
    expect((await call<{ items: ItemView[] }>('u2', { op: 'items' })).items).toEqual([]);
    expect((await call<{ jobs: JobView[] }>('u2', { op: 'jobs' })).jobs).toEqual([]);
  }, 60_000);

  it('形の違う呼び出しは断る（落ちない）', async () => {
    for (const data of [null, 'x', {}, { op: 'nope' }, { op: 'job' }, { op: 'job', jobId: 5 }, { op: 'keep', jobId: 'a', index: -1 }, { op: 'keep', jobId: 'a', index: 1.5 }, { op: 'startJob', dollId, theme: 'x', styleId: 'anime', target: { kind: 'other' } }, { op: 'startJob', dollId, theme: 'x', styleId: 'anime', target: null }, { op: 'itemFiles', id: 'x'.repeat(300) }]) {
      expect(codeOf(await call('u1', data).catch((e) => e))).toBe('refused');
    }
  });

  it('止まっている仕事は、stalled で知らせる', async () => {
    await call('u1', { op: 'signIn' });
    await store.addTickets('u1', 1, 'test', clock);
    const started = await call<{ jobId: string }>('u1', { op: 'startJob', dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    expect((await call<{ job: JobView }>('u1', { op: 'job', jobId: started.jobId })).job.stalled).toBe(false);
    clock += 200_000;
    expect((await call<{ job: JobView }>('u1', { op: 'job', jobId: started.jobId })).job.stalled).toBe(true);
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
