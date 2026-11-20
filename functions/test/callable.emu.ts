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
  run(jobId: string): Promise<unknown>;
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
  const studioRun = httpsCallable(functions, 'studioRun', { timeout: 300_000 });
  return {
    app,
    uid,
    call: async <T>(data: unknown) => (await studio(data)).data as T,
    run: async (jobId) => (await studioRun({ jobId })).data,
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
  // 管理者の利用者コード（関数は、この設定を 1 分おぼえる。関数を初めて呼ぶ前に書いておく）
  await getAdminFirestore(admin).doc('system/config').set({ adminCodes: `nobody, ${ADMIN_CODE.toLowerCase()}`, imagesPerDay: 50 });
});
afterAll(async () => {
  await Promise.all(clients.map((app) => deleteClient(app)));
  await deleteApp(admin);
  await fakes.stop();
});

describe('サーバーの関数（エミュレーター）', () => {
  it('ログインしていない呼び出しは断る', async () => {
    const anonymous = await client(false);
    expect(failure(await anonymous.call({ op: 'signIn' }).catch((e) => e)).code).toBe('functions/unauthenticated');
    expect(failure(await anonymous.run('x').catch((e) => e)).code).toBe('functions/unauthenticated');
  });

  it('ひととおり: 利用者 → チケット不足で断られる → 始める → 進める → 絵 → 使う → 捨てる → 自分の服 → 消す', async () => {
    const me = await client();
    const { user } = await me.call<{ user: UserView }>({ op: 'signIn' });
    expect(user).toMatchObject({ tickets: 0, admin: false });
    expect(user.userCode).toMatch(/^[A-Z2-9]{8}$/);

    // チケットが無い: 断られ、文章の AI も呼ばれない
    const textBefore = fakes.gemini.text;
    expect(failure(await me.call(top(fakes.dollId)).catch((e) => e))).toMatchObject({ code: 'functions/failed-precondition', reason: 'no-tickets' });
    expect(fakes.gemini.text).toBe(textBefore);

    await grant(me.uid, 3);
    const started = await me.call<{ jobId: string; cost: number; user: UserView }>({ op: 'startJob', dollId: fakes.dollId, theme: 'うみ', styleId: 'manga', target: { kind: 'set', categoryIds: ['トップス', 'アクセサリー'] } });
    expect(started).toMatchObject({ cost: 2, user: { tickets: 1 } });
    expect((await me.call<{ job: JobView }>({ op: 'job', jobId: started.jobId })).job).toMatchObject({ done: false, set: { name: 'うみのセット' } });

    const imagesBefore = fakes.gemini.image;
    expect(await me.run(started.jobId)).toEqual({ ok: true });
    expect(fakes.gemini.image - imagesBefore).toBe(2);
    const { job } = await me.call<{ job: JobView }>({ op: 'job', jobId: started.jobId });
    expect(job.done).toBe(true);
    expect(job.candidates.map((c) => c.status)).toEqual(['done', 'done']);
    expect(job.candidates[0].preview!.box.w).toBeGreaterThan(50);

    const preview = await me.call<{ data: string; contentType: string }>({ op: 'preview', jobId: started.jobId, index: 0 });
    expect((await sharp(Buffer.from(preview.data, 'base64')).metadata()).format).toBe('png');

    const kept = await me.call<{ item: ItemView; files: Record<string, string>; user: UserView }>({ op: 'keep', jobId: started.jobId, index: 0, name: 'うみのふく' });
    expect(kept.item).toMatchObject({ id: `my:${started.jobId}-0`, dollId: fakes.dollId, item: { name: 'うみのふく', category: 'トップス' }, set: { name: 'うみのセット' } });
    expect((await sharp(Buffer.from(kept.files[kept.item.item.image.file], 'base64')).metadata()).format).toBe('webp');
    // 同じ候補を、もう一度は使えない
    expect(failure(await me.call({ op: 'keep', jobId: started.jobId, index: 0, name: 'x' }).catch((e) => e)).reason).toBe('refused');

    expect((await me.call<{ jobs: JobView[] }>({ op: 'jobs' })).jobs.map((j) => j.id)).toEqual([started.jobId]);
    await me.call({ op: 'discard', jobId: started.jobId, index: 1 });
    expect((await me.call<{ jobs: JobView[] }>({ op: 'jobs' })).jobs).toEqual([]);

    expect((await me.call<{ items: ItemView[] }>({ op: 'items' })).items.map((i) => i.id)).toEqual([kept.item.id]);
    const again = await me.call<{ files: Record<string, string> }>({ op: 'itemFiles', id: kept.item.id });
    expect(again.files).toEqual(kept.files);

    // ほかの利用者からは、仕事も服も見えない
    const other = await client();
    await other.call({ op: 'signIn' });
    expect(failure(await other.call({ op: 'job', jobId: started.jobId }).catch((e) => e)).reason).toBe('refused');
    expect(failure(await other.call({ op: 'itemFiles', id: kept.item.id }).catch((e) => e)).reason).toBe('refused');
    expect(failure(await other.run(started.jobId).catch((e) => e)).reason).toBe('refused');
    expect((await other.call<{ items: ItemView[] }>({ op: 'items' })).items).toEqual([]);

    // アプリからは、自分のデータでも、Firestore と Storage を直接は読み書きできない（決まりで断る）
    const db = getFirestore(me.app);
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
    expect(failure(await getDoc(doc(db, `users/${me.uid}`)).catch((e) => e)).code).toBe('permission-denied');
    expect(failure(await setDoc(doc(db, `users/${me.uid}`), { tickets: 999 }, { merge: true }).catch((e) => e)).code).toBe('permission-denied');
    expect(failure(await getDoc(doc(db, 'system/config')).catch((e) => e)).code).toBe('permission-denied');
    const storage = getStorage(me.app);
    connectStorageEmulator(storage, '127.0.0.1', 9199);
    expect(failure(await getBytes(ref(storage, `users/${me.uid}/jobs/${started.jobId}/0-png.png`)).catch((e) => e)).code).toBe('storage/unauthorized');
    expect(failure(await uploadBytes(ref(storage, `users/${me.uid}/x.png`), new Uint8Array([1, 2, 3])).catch((e) => e)).code).toBe('storage/unauthorized');
    expect((await me.call<{ user: UserView }>({ op: 'signIn' })).user.tickets).toBe(1);

    await me.call({ op: 'deleteItem', id: kept.item.id });
    expect((await me.call<{ items: ItemView[] }>({ op: 'items' })).items).toEqual([]);
  });

  it('絵ができなかったら「できなかった」になり、チケットが戻る', async () => {
    const me = await client();
    await me.call({ op: 'signIn' });
    await grant(me.uid, 1);
    const started = await me.call<{ jobId: string; user: UserView }>(top(fakes.dollId));
    expect(started.user.tickets).toBe(0);
    fakes.gemini.failImages = true;
    try {
      await me.run(started.jobId);
    } finally {
      fakes.gemini.failImages = false;
    }
    const { job, user } = await me.call<{ job: JobView; user: UserView }>({ op: 'job', jobId: started.jobId });
    expect(job).toMatchObject({ done: true, tickets: 0 });
    expect(job.candidates[0].status).toBe('failed');
    expect(job.candidates[0].notes.join('')).not.toBe('');
    expect(user.tickets).toBe(1);
  });

  it('管理者（system/config の利用者コード）は、チケットが無くても作れる', async () => {
    const boss = await client();
    // 利用者コードを決めて、先に利用者を作っておく
    const db = getAdminFirestore(admin);
    await db.doc(`users/${boss.uid}`).set({ userCode: ADMIN_CODE, tickets: 0, createdAt: 1 });
    await db.doc(`userCodes/${ADMIN_CODE}`).set({ uid: boss.uid });
    expect((await boss.call<{ user: UserView }>({ op: 'signIn' })).user).toEqual({ userCode: ADMIN_CODE, tickets: 0, admin: true });
    const started = await boss.call<{ jobId: string; cost: number; user: UserView }>(top(fakes.dollId));
    expect(started).toMatchObject({ cost: 1, user: { tickets: 0 } });
  });

  it('形の違う呼び出しは、理由つきで断る（落ちない）', async () => {
    const me = await client();
    for (const data of [null, {}, { op: 'nope' }, { op: 'job', jobId: 5 }, { op: 'job', jobId: 'a/b' }, { op: 'itemFiles', id: '__x__' }]) {
      expect(failure(await me.call(data).catch((e) => e))).toMatchObject({ code: 'functions/failed-precondition', reason: 'refused' });
    }
    expect(failure(await me.run('nothing').catch((e) => e)).reason).toBe('refused');
  });
});
