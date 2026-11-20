/**
 * アプリの「本物の裏側」（src/cloud/remoteBackend.ts + firebaseTransport.ts）を、エミュレーターの関数につないで確かめる。
 * アプリの画面が呼ぶのと同じ形（StudioBackend）で、ひととおり動かす。
 */
import { deleteApp, initializeApp as initializeAdmin } from 'firebase-admin/app';
import type { App as AdminApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { connectAuthEmulator } from 'firebase/auth';
import { connectFunctionsEmulator } from 'firebase/functions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MyItem, StudioBackend, StudioJob } from '../../src/cloud/backend.ts';
import { createFirebaseTransport } from '../../src/cloud/firebaseTransport.ts';
import type { Library } from '../../src/cloud/library.ts';
import { createRemoteBackend } from '../../src/cloud/remoteBackend.ts';
import type { StudioTransport } from '../../src/cloud/remoteBackend.ts';
import { syncLibrary } from '../../src/cloud/sync.ts';
import { startFakes } from './fakes.ts';
import type { Fakes } from './fakes.ts';
import { PROJECT } from './ports.mjs';

let fakes: Fakes;
let admin: AdminApp;
let n = 0;

function connect(): { backend: StudioBackend; transport: StudioTransport } {
  const transport = createFirebaseTransport({
    config: { projectId: PROJECT, apiKey: 'fake-api-key' },
    appName: `app-${Date.now()}-${++n}`,
    connect: (auth, functions) => {
      connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      connectFunctionsEmulator(functions, '127.0.0.1', 5001);
    },
  });
  return { transport, backend: createRemoteBackend(transport, { pollMs: 300 }) };
}
async function grant(userCode: string, tickets: number) {
  const db = getFirestore(admin);
  const uid = ((await db.doc(`userCodes/${userCode}`).get()).data() as { uid: string }).uid;
  await db.doc(`users/${uid}`).update({ tickets });
}
// 仕事が終わるまで、進み具合を見る
const finished = (backend: StudioBackend, jobId: string) =>
  new Promise<StudioJob>((resolve) => {
    const stop = backend.watchJob(jobId, (job) => {
      if (!job.done) return;
      stop();
      resolve(job);
    });
  });
// 端末の控えの代わり（メモリの中）
function memoryLibrary(): Library & { items: Map<string, MyItem> } {
  const items = new Map<string, MyItem>();
  return {
    items,
    all: async () => [...items.values()],
    put: async (item) => void items.set(item.id, item),
    remove: async (id) => void items.delete(id),
  };
}
const top = (dollId: string) => ({ dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category' as const, categoryId: 'トップス' } });

beforeAll(async () => {
  fakes = await startFakes();
  admin = initializeAdmin({ projectId: PROJECT }, `client-admin-${Date.now()}`);
});
afterAll(async () => {
  await deleteApp(admin);
  await fakes.stop();
});

describe('アプリの本物の裏側（エミュレーター）', () => {
  it('ひととおり: 利用者 → チケット不足 → 作る → できた絵 → 使う → 端末の控えに合わせる → 消す', async () => {
    const { backend } = connect();
    const seenTickets: number[] = [];
    backend.onUser((u) => seenTickets.push(u.tickets));
    const user = await backend.signIn();
    expect(user).toMatchObject({ tickets: 0, admin: false });

    await expect(backend.startJob(top(fakes.dollId))).rejects.toMatchObject({ name: 'Error', code: 'no-tickets', message: expect.stringContaining('チケットが足りません') });

    await grant(user.userCode, 2);
    const { jobId, cost } = await backend.startJob(top(fakes.dollId));
    expect(cost).toBe(1);
    const job = await finished(backend, jobId);
    expect(job.candidates).toHaveLength(1);
    expect(job.candidates[0]).toMatchObject({ status: 'done', name: 'うみのトップス' });
    expect(job.candidates[0].preview!.url).toMatch(/^data:image\/png;base64,/);
    expect(seenTickets[seenTickets.length - 1]).toBe(1);
    expect((await backend.pendingJobs()).map((j) => j.id)).toEqual([jobId]);

    const item = await backend.keep(jobId, 0, 'うみのふく');
    expect(item).toMatchObject({ id: `my:${jobId}-0`, dollId: fakes.dollId, owner: user.userCode, item: { name: 'うみのふく' } });
    expect(item.files[item.item.image.file].type).toBe('image/webp');
    expect(item.files[item.item.image.file].size).toBeGreaterThan(100);
    expect(await backend.pendingJobs()).toEqual([]);

    // 別の端末（控えが空）で開いたつもり: サーバーの一覧から、絵ごと取り込む
    const library = memoryLibrary();
    expect(await syncLibrary(backend, library, user.userCode)).toEqual({ added: 1, removed: 0, failed: 0 });
    const copy = library.items.get(item.id)!;
    expect(copy.owner).toBe(user.userCode);
    expect(Buffer.from(await copy.files[copy.item.thumb].arrayBuffer()).equals(Buffer.from(await item.files[item.item.thumb].arrayBuffer()))).toBe(true);

    // 消すと、次に合わせたとき、控えからも消える
    await backend.deleteMyItem(item.id);
    expect(await syncLibrary(backend, library, user.userCode)).toEqual({ added: 0, removed: 1, failed: 0 });
    await expect(backend.fetchMyItem(item.id)).rejects.toMatchObject({ code: 'refused' });
  });

  it('作っている途中で閉じた分（「進める」が呼ばれていない仕事）は、開き直して見始めると、続きが進む', async () => {
    const { backend, transport } = connect();
    const user = await backend.signIn();
    await grant(user.userCode, 1);
    // 始めるだけ（アプリが、進める前に閉じられたつもり）
    const { jobId } = await transport.call<{ jobId: string }>({ op: 'startJob', ...top(fakes.dollId) });
    // 開き直した（別の部品）
    const reopened = createRemoteBackend(transport, { pollMs: 300 });
    const pending = await reopened.pendingJobs();
    expect(pending.map((j) => j.id)).toEqual([jobId]);
    expect(pending[0].done).toBe(false);
    const job = await finished(reopened, jobId);
    expect(job.candidates[0].status).toBe('done');
    await reopened.discard(jobId, 0);
    expect(await reopened.pendingJobs()).toEqual([]);
  });

  it('ほかの利用者（ほかの端末）の仕事や服は、見えない', async () => {
    const mine = connect().backend;
    const user = await mine.signIn();
    await grant(user.userCode, 1);
    const { jobId } = await mine.startJob(top(fakes.dollId));
    await finished(mine, jobId);
    const item = await mine.keep(jobId, 0, 'ふく');
    const other = connect().backend;
    expect((await other.signIn()).userCode).not.toBe(user.userCode);
    expect(await other.listMyItems()).toEqual([]);
    expect(await other.pendingJobs()).toEqual([]);
    await expect(other.fetchMyItem(item.id)).rejects.toMatchObject({ code: 'refused' });
    await expect(other.keep(jobId, 0, 'x')).rejects.toMatchObject({ code: 'refused' });
  });
});
