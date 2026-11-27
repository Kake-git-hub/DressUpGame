/**
 * サーバーの関数を、アプリと同じやり方（ウェブ用の SDK、匿名のログイン）で呼んで確かめる。
 * 素材と Gemini は偽物（fakes.ts）。Firestore・Storage・Auth・Functions はエミュレーター。
 */
import { deleteApp, initializeApp as initializeAdmin } from 'firebase-admin/app';
import type { App as AdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { deleteApp as deleteClient, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDoc, getFirestore, setDoc } from 'firebase/firestore/lite';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { connectStorageEmulator, getBytes, getStorage, ref, uploadBytes } from 'firebase/storage';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ItemView, JobView } from '../../tools/cloud/api.ts';
import type { UserView } from '../../tools/cloud/studioCore.ts';
import { startFakes } from './fakes.ts';
import type { Fakes } from './fakes.ts';
import { ADMIN_CODE, PROJECT } from './ports.mjs';

const REGION = 'asia-northeast1';
let fakes: Fakes;
let admin: AdminApp;
const clients: FirebaseApp[] = [];

interface Client {
  app: FirebaseApp;
  uid: string;
  call<T>(data: unknown): Promise<T>;
  // 仕事が終わるまで待つ（アプリは「進める」を呼ばない。サーバーの列が進める）
  finished(jobId: string): Promise<JobView>;
}
// アプリ 1 つ分（利用者 1 人分）。login: false なら、ログインしないまま
async function client(login = true): Promise<Client> {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake-api-key', storageBucket: `${PROJECT}.appspot.com` }, `client-${clients.length}-${Date.now()}`);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  const uid = login ? (await signInAnonymously(auth)).user.uid : '';
  const studio = httpsCallable(functions, 'studio');
  const call = async <T>(data: unknown) => (await studio(data)).data as T;
  return {
    app,
    uid,
    call,
    finished: async (jobId) => {
      for (let i = 0; i < 45; i++) {
        const { job } = await call<{ job: JobView }>({ op: 'job', jobId });
        if (job.done) return job;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      throw new Error('90 秒待っても、仕事が終わりませんでした（列が、生成を進める関数を呼んでいない？）');
    },
  };
}
// 失敗の形: 関数の決まった印（functions/…）と、利用者に伝える理由の印（details.code）
const failure = (e: unknown) => {
  const error = e as { code?: string; details?: { code?: string }; message?: string };
  return { code: error.code, reason: error.details?.code, message: error.message };
};
const grant = (uid: string, tickets: number) => getAdminFirestore(admin).doc(`users/${uid}`).update({ tickets });
const top = (dollId: string) => ({ op: 'startJob', dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });

beforeAll(async () => {
  fakes = await startFakes();
  admin = initializeAdmin({ projectId: PROJECT }, `callable-admin-${Date.now()}`);
});
afterAll(async () => {
  await Promise.all(clients.map((app) => deleteClient(app)));
  await deleteApp(admin);
  await fakes.stop();
});

describe('サーバーの関数（エミュレーター）', () => {
  it('ログインしていない呼び出しは断る。アプリからは、生成を進める関数を呼べない', async () => {
    const anonymous = await client(false);
    expect(failure(await anonymous.call({ op: 'signIn' }).catch((e) => e)).code).toBe('functions/unauthenticated');
    // 前の版の「進める」（studioRun）は、もう無い
    const me = await client();
    const old = httpsCallable(getFunctions(me.app, REGION), 'studioRun');
    expect(failure(await old({ jobId: 'x' }).catch((e) => e)).code).toMatch(/not-found|internal/);
  });

  it('ひととおり: 利用者 → チケット不足で断られる → 作る → 何も呼ばなくても服になる → 見た印 → 名前・色・順番 → 消す', async () => {
    const me = await client();
    const { user, api } = await me.call<{ user: UserView; api: number }>({ op: 'signIn' });
    expect(user).toMatchObject({ tickets: 0, admin: false });
    expect(user.userCode).toMatch(/^[A-Z2-9]{8}$/);
    expect(api).toBe(8);

    // チケットが無い: 断られ、文章の AI も呼ばれない
    const textBefore = fakes.gemini.text;
    expect(failure(await me.call(top(fakes.dollId)).catch((e) => e))).toMatchObject({ code: 'functions/failed-precondition', reason: 'no-tickets' });
    expect(fakes.gemini.text).toBe(textBefore);

    await grant(me.uid, 3);
    const imagesBefore = fakes.gemini.image;
    const started = await me.call<{ jobId: string; cost: number; user: UserView }>({ op: 'startJob', dollId: fakes.dollId, theme: 'うみ', styleId: 'manga', target: { kind: 'set', categoryIds: ['トップス', 'アクセサリー'] } });
    expect(started).toMatchObject({ cost: 2, user: { tickets: 1 } });

    // セット 2 点: 列が進めて、どちらも自分の服になる
    const job = await me.finished(started.jobId);
    expect(job.set).toMatchObject({ name: 'うみのセット' });
    expect(fakes.gemini.image - imagesBefore).toBe(2);
    expect(job.candidates.map((c) => c.status)).toEqual(['kept', 'kept']);

    const { items } = await me.call<{ items: ItemView[] }>({ op: 'items' });
    expect(items.map((i) => i.id).sort()).toEqual(job.candidates.map((c) => c.itemId).sort());
    for (const item of items) expect(item).toMatchObject({ dollId: fakes.dollId, set: { name: 'うみのセット' }, hue: 0, notes: [] });
    const first = await me.call<{ item: ItemView; files: Record<string, string> }>({ op: 'itemFiles', id: items[0].id });
    expect((await sharp(Buffer.from(first.files[first.item.item.image.file], 'base64')).metadata()).format).toBe('webp');

    // 見た印を付けるまでは、開くたびに出る
    expect((await me.call<{ jobs: JobView[] }>({ op: 'jobs' })).jobs.map((j) => j.id)).toEqual([started.jobId]);
    await me.call({ op: 'ack', jobId: started.jobId });
    expect((await me.call<{ jobs: JobView[] }>({ op: 'jobs' })).jobs).toEqual([]);

    // 名前・色・順番
    const changed = await me.call<{ item: ItemView }>({ op: 'updateItem', id: items[0].id, name: 'うみのふく', hue: 500 });
    expect(changed.item).toMatchObject({ item: { name: 'うみのふく' }, hue: 180 });
    const ordered = await me.call<{ items: ItemView[] }>({ op: 'orderItems', ids: [items[1].id, items[0].id] });
    expect(ordered.items[0].order).toBeGreaterThan(ordered.items[1].order);

    // ほかの利用者からは、仕事も服も見えない・直せない
    const other = await client();
    await other.call({ op: 'signIn' });
    for (const data of [{ op: 'job', jobId: started.jobId }, { op: 'ack', jobId: started.jobId }, { op: 'itemFiles', id: items[0].id }, { op: 'updateItem', id: items[0].id, name: 'x' }, { op: 'orderItems', ids: [items[0].id] }]) {
      expect(failure(await other.call(data).catch((e) => e)).reason).toBe('refused');
    }
    expect((await other.call<{ items: ItemView[] }>({ op: 'items' })).items).toEqual([]);

    // アプリからは、自分のデータでも、Firestore と Storage を直接は読み書きできない（決まりで断る）
    const db = getFirestore(me.app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    expect(failure(await getDoc(doc(db, `users/${me.uid}`)).catch((e) => e)).code).toBe('permission-denied');
    expect(failure(await setDoc(doc(db, `users/${me.uid}`), { tickets: 999 }, { merge: true }).catch((e) => e)).code).toBe('permission-denied');
    expect(failure(await getDoc(doc(db, 'system/config')).catch((e) => e)).code).toBe('permission-denied');
    const storage = getStorage(me.app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
    expect(failure(await getBytes(ref(storage, `users/${me.uid}/items/x/a.webp`)).catch((e) => e)).code).toBe('storage/unauthorized');
    expect(failure(await uploadBytes(ref(storage, `users/${me.uid}/x.png`), new Uint8Array([1, 2, 3])).catch((e) => e)).code).toBe('storage/unauthorized');
    expect((await me.call<{ user: UserView }>({ op: 'signIn' })).user.tickets).toBe(1);

    await me.call({ op: 'deleteItem', id: items[0].id });
    expect((await me.call<{ items: ItemView[] }>({ op: 'items' })).items.map((i) => i.id)).toEqual([items[1].id]);
  });

  it('絵ができなかったら「できなかった」になり、チケットが戻る', async () => {
    const me = await client();
    await me.call({ op: 'signIn' });
    await grant(me.uid, 1);
    fakes.gemini.failImages = true;
    try {
      const started = await me.call<{ jobId: string; user: UserView }>(top(fakes.dollId));
      expect(started.user.tickets).toBe(0);
      const job = await me.finished(started.jobId);
      expect(job).toMatchObject({ done: true, tickets: 0 });
      expect(job.candidates[0].status).toBe('failed');
      expect(job.candidates[0].notes.join('')).not.toBe('');
    } finally {
      fakes.gemini.failImages = false;
    }
    // 払い戻しは、「できなかった」と書いたすぐあと
    await expect.poll(async () => (await me.call<{ user: UserView }>({ op: 'signIn' })).user.tickets, { timeout: 20_000 }).toBe(1);
    expect((await me.call<{ items: ItemView[] }>({ op: 'items' })).items).toEqual([]);
  });

  it('2 つの仕事を続けて始めても、どちらも服になる（絵は 1 回ずつ）', async () => {
    const me = await client();
    await me.call({ op: 'signIn' });
    await grant(me.uid, 2);
    const before = fakes.gemini.image;
    const [a, b] = await Promise.all([me.call<{ jobId: string }>(top(fakes.dollId)), me.call<{ jobId: string }>(top(fakes.dollId))]);
    const jobs = await Promise.all([me.finished(a.jobId), me.finished(b.jobId)]);
    expect(jobs.map((j) => j.candidates[0].status)).toEqual(['kept', 'kept']);
    expect(fakes.gemini.image - before).toBe(2);
    expect((await me.call<{ items: ItemView[] }>({ op: 'items' })).items).toHaveLength(2);
  });

  it('管理者（system/config の利用者コード）は、チケットが無くても作れる', async () => {
    const boss = await client();
    // 利用者コードを決めて、先に利用者を作っておく
    const db = getAdminFirestore(admin);
    await db.doc(`users/${boss.uid}`).set({ userCode: ADMIN_CODE, tickets: 0, createdAt: 1 });
    await db.doc(`userCodes/${ADMIN_CODE}`).set({ uid: boss.uid });
    expect((await boss.call<{ user: UserView }>({ op: 'signIn' })).user).toEqual({ userCode: ADMIN_CODE, tickets: 0, free: 0, lots: [], admin: true });
    const started = await boss.call<{ jobId: string; cost: number; user: UserView }>(top(fakes.dollId));
    expect(started).toMatchObject({ cost: 1, user: { tickets: 0 } });
    expect((await boss.finished(started.jobId)).candidates[0].status).toBe('kept');
  });

  it('形の違う呼び出しは、理由つきで断る（落ちない）', async () => {
    const me = await client();
    for (const data of [null, {}, { op: 'nope' }, { op: 'job', jobId: 5 }, { op: 'job', jobId: 'a/b' }, { op: 'itemFiles', id: '__x__' }, { op: 'keep', jobId: 'a', index: 0 }, { op: 'orderItems', ids: 'x' }]) {
      expect(failure(await me.call(data).catch((e) => e))).toMatchObject({ code: 'functions/failed-precondition', reason: 'refused' });
    }
  });
});
