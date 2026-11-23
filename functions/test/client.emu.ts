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
  it('ひととおり: 利用者 → チケット不足 → 作る → 自分の服になる → 端末の控えに合わせる → 名前・色 → 見た印 → 消す', async () => {
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
    expect(job.candidates[0]).toMatchObject({ status: 'kept', name: 'うみのトップス', itemId: `my:${jobId}-0-1` });
    expect(seenTickets[seenTickets.length - 1]).toBe(1);

    // 別の端末（控えが空）で開いたつもり: サーバーの一覧から、絵ごと取り込む
    const library = memoryLibrary();
    expect(await syncLibrary(backend, library, user.userCode)).toEqual({ added: 1, removed: 0, failed: 0, updated: 0 });
    const copy = library.items.get(job.candidates[0].itemId!)!;
    expect(copy).toMatchObject({ dollId: fakes.dollId, owner: user.userCode, hue: 0, notes: [], item: { name: 'うみのトップス' } });
    expect(copy.files[copy.item.image.file].type).toBe('image/webp');
    expect(copy.files[copy.item.image.file].size).toBeGreaterThan(100);

    // ほかの端末で名前と色を変えたつもり: 合わせると、控えの名前と色だけが変わる
    const changed = await backend.updateMyItem(copy.id, { name: 'うみのふく', hue: 120 });
    expect(changed).toMatchObject({ hue: 120, item: { name: 'うみのふく' } });
    expect(await syncLibrary(backend, library, user.userCode)).toEqual({ added: 0, removed: 0, failed: 0, updated: 1 });
    expect(library.items.get(copy.id)).toMatchObject({ hue: 120, item: { name: 'うみのふく' } });
    expect(library.items.get(copy.id)!.files[copy.item.image.file]).toBe(copy.files[copy.item.image.file]);

    // 見た印を付けるまでは、開くたびに出る
    expect((await backend.openJobs()).map((j) => j.id)).toEqual([jobId]);
    await backend.ackJob(jobId);
    expect(await backend.openJobs()).toEqual([]);

    // 消すと、次に合わせたとき、控えからも消える
    await backend.deleteMyItem(copy.id);
    expect(await syncLibrary(backend, library, user.userCode)).toEqual({ added: 0, removed: 1, failed: 0, updated: 0 });
    await expect(backend.fetchMyItem(copy.id)).rejects.toMatchObject({ code: 'refused' });
  });

  it('「作る」の返事のあと、アプリを閉じても（何も聞かなくても）、服になる。開き直すと、見ていない仕事として出る', async () => {
    const { backend, transport } = connect();
    const user = await backend.signIn();
    await grant(user.userCode, 1);
    // 始めるだけ（このあと、アプリは閉じられたつもり。進み具合も聞かない）
    const { jobId } = await transport.call<{ jobId: string }>({ op: 'startJob', ...top(fakes.dollId) });
    await expect.poll(async () => (await backend.listMyItems()).length, { timeout: 60_000, interval: 2000 }).toBe(1);
    // 開き直した（別の部品）
    const reopened = createRemoteBackend(transport, { pollMs: 300 });
    const open = await reopened.openJobs();
    expect(open.map((j) => j.id)).toEqual([jobId]);
    expect(open[0]).toMatchObject({ done: true, candidates: [{ status: 'kept' }] });
  });

  it('ほかの利用者（ほかの端末）の仕事や服は、見えない・直せない', async () => {
    const mine = connect().backend;
    const user = await mine.signIn();
    await grant(user.userCode, 1);
    const { jobId } = await mine.startJob(top(fakes.dollId));
    const job = await finished(mine, jobId);
    const itemId = job.candidates[0].itemId!;
    const other = connect().backend;
    expect((await other.signIn()).userCode).not.toBe(user.userCode);
    expect(await other.listMyItems()).toEqual([]);
    expect(await other.openJobs()).toEqual([]);
    await expect(other.fetchMyItem(itemId)).rejects.toMatchObject({ code: 'refused' });
    await expect(other.updateMyItem(itemId, { hue: 10 })).rejects.toMatchObject({ code: 'refused' });
    await expect(other.ackJob(jobId)).rejects.toMatchObject({ code: 'refused' });
  });
});
