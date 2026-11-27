/**
 * 引き継ぎ（③-b）を、アプリと同じやり方（ウェブ用の SDK）で、エミュレーターの関数を呼んで確かめる。
 * 2 台めの端末 = 匿名の利用者 A。アカウント = 匿名でない利用者 B（エミュレーターで、メールとパスワードの利用者を作る）。
 */
import { deleteApp, initializeApp as initializeAdmin } from 'firebase-admin/app';
import type { App as AdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { deleteApp as deleteClient, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, GoogleAuthProvider, linkWithCredential, signInAnonymously } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ItemView, JobView } from '../../tools/cloud/api.ts';
import type { UserView } from '../../tools/cloud/studioCore.ts';
import { startFakes } from './fakes.ts';
import type { Fakes } from './fakes.ts';
import { PROJECT } from './ports.mjs';

const REGION = 'asia-northeast1';
let fakes: Fakes;
let admin: AdminApp;
const clients: FirebaseApp[] = [];

interface Client {
  uid: string;
  user: User;
  call<T>(data: unknown): Promise<T>;
}
// アプリ 1 つ分。email があれば、メールとパスワードの利用者（匿名でない）として入る
async function client(email?: string): Promise<Client> {
  const app = initializeApp({ projectId: PROJECT, apiKey: 'fake-api-key' }, `adopt-${clients.length}-${Date.now()}`);
  clients.push(app);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  const user = email ? (await createUserWithEmailAndPassword(auth, email, 'password-1234')).user : (await signInAnonymously(auth)).user;
  const studio = httpsCallable(functions, 'studio');
  return { uid: user.uid, user, call: async <T>(data: unknown) => (await studio(data)).data as T };
}
const failure = (e: unknown) => {
  const error = e as { code?: string; details?: { code?: string } };
  return { code: error.code, reason: error.details?.code };
};
const grant = (uid: string, tickets: number) => getAdminFirestore(admin).doc(`users/${uid}`).update({ tickets });
async function finished(me: Client, jobId: string): Promise<JobView> {
  for (let i = 0; i < 45; i++) {
    const { job } = await me.call<{ job: JobView }>({ op: 'job', jobId });
    if (job.done) return job;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('90 秒待っても、仕事が終わりませんでした');
}

beforeAll(async () => {
  fakes = await startFakes();
  admin = initializeAdmin({ projectId: PROJECT }, `adopt-admin-${Date.now()}`);
});
afterAll(async () => {
  await Promise.all(clients.map((app) => deleteClient(app)));
  await deleteApp(admin);
  await fakes.stop();
});

describe('引き継ぎ（エミュレーター）', () => {
  it('匿名の A が offer → 匿名でない B が adopt → B に A のチケットと服。A は空。もう一度 adopt しても変わらない。移した服の絵を取れる', async () => {
    const a = await client();
    await a.call({ op: 'signIn' });
    await grant(a.uid, 2);
    // A の服は、本物の仕事で作る（絵は、A の置き場にできる）
    const started = await a.call<{ jobId: string }>({ op: 'startJob', dollId: fakes.dollId, theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    expect((await finished(a, started.jobId)).candidates[0].status).toBe('kept');
    const [made] = (await a.call<{ items: ItemView[] }>({ op: 'items' })).items;
    const { word } = await a.call<{ word: string }>({ op: 'offer' });
    expect(word).toMatch(/^[0-9a-f]{64}$/);
    expect((await a.call<{ word: string }>({ op: 'offer' })).word).toBe(word);
    // 匿名のうちは、待つ
    expect(await a.call({ op: 'adopt', word })).toEqual({ status: 'wait', tickets: 0, items: 0 });

    const b = await client(`b-${Date.now()}@example.com`);
    const before = await b.call<{ user: UserView; api: number }>({ op: 'signIn' });
    expect(before).toMatchObject({ api: 8, user: { tickets: 0 } });
    expect((await getAdminFirestore(admin).doc(`users/${b.uid}`).get()).data()).toMatchObject({ named: true });
    // 匿名でない利用者は、合い言葉をもらえない
    expect(failure(await b.call({ op: 'offer' }).catch((e) => e))).toMatchObject({ code: 'functions/failed-precondition', reason: 'refused' });

    const adopted = await b.call<{ status: string; tickets: number; items: number; user: UserView }>({ op: 'adopt', word });
    expect(adopted).toMatchObject({ status: 'done', tickets: 1, items: 1, user: { tickets: 1 } });
    expect((await b.call<{ user: UserView }>({ op: 'signIn' })).user.tickets).toBe(1);
    const items = (await b.call<{ items: ItemView[] }>({ op: 'items' })).items;
    expect(items).toEqual([made]);
    expect((await a.call<{ items: ItemView[] }>({ op: 'items' })).items).toEqual([]);
    expect((await a.call<{ user: UserView }>({ op: 'signIn' })).user.tickets).toBe(0);

    // 返事が届かずに、アプリがもう一度呼んだ
    expect(await b.call({ op: 'adopt', word })).toMatchObject({ status: 'done', tickets: 0, items: 0, user: { tickets: 1 } });
    expect((await b.call<{ items: ItemView[] }>({ op: 'items' })).items).toHaveLength(1);

    // 移した服の絵を取れる（絵は A の置き場のまま）
    const got = await b.call<{ item: ItemView; files: Record<string, string> }>({ op: 'itemFiles', id: made.id });
    expect(Object.keys(got.files).sort()).toEqual([made.item.image.file, made.item.thumb].sort());

    // あとから A に入った分は、B の signIn で移る
    await grant(a.uid, 2);
    expect((await b.call<{ user: UserView }>({ op: 'signIn' })).user.tickets).toBe(3);

    // ほかの人（C）が同じ合い言葉を出しても、断る。知らない合い言葉も
    const c = await client(`c-${Date.now()}@example.com`);
    expect(await c.call({ op: 'adopt', word })).toMatchObject({ status: 'used', tickets: 0, items: 0 });
    expect(await c.call({ op: 'adopt', word: 'f'.repeat(64) })).toMatchObject({ status: 'unknown' });

    // B が、移した服を消す → 元の置き場の絵も消える
    await b.call({ op: 'deleteItem', id: made.id });
    expect((await b.call<{ items: ItemView[] }>({ op: 'items' })).items).toEqual([]);
  });

  it('匿名のまま Google と結び付けた利用者（1 台めが、アカウントになる道。uid は同じ）: 匿名でない。offer は断る。ほかの匿名の利用者の合い言葉で adopt → done（wait でない）で、チケットが移る', async () => {
    const first = await client();
    await first.call({ op: 'signIn' });
    // エミュレーターは、署名の無い Google の証明（中身の JSON）を受け付ける
    const sub = `linked-${Date.now()}`;
    const linked = await linkWithCredential(first.user, GoogleAuthProvider.credential(JSON.stringify({ sub, email: `${sub}@example.com`, email_verified: true })));
    expect(linked.user.uid).toBe(first.uid);
    // エミュレーター（firebase-tools 15.37.0）では、結び付けたあとの証明は sign_in_provider: google.com、identities: { email, google.com }。
    // 本物の Firebase で anonymous のままでも、identities で見分ける（callerOfToken のユニットテスト）
    const claims = (await linked.user.getIdTokenResult()).claims as { firebase?: { identities?: Record<string, unknown[]> } };
    expect(claims.firebase?.identities?.['google.com']).toHaveLength(1);

    expect(failure(await first.call({ op: 'offer' }).catch((e) => e))).toMatchObject({ code: 'functions/failed-precondition', reason: 'refused' });
    expect((await first.call<{ api: number }>({ op: 'signIn' })).api).toBe(7);
    expect((await getAdminFirestore(admin).doc(`users/${first.uid}`).get()).data()).toMatchObject({ named: true });

    const second = await client();
    await second.call({ op: 'signIn' });
    await grant(second.uid, 3);
    const { word } = await second.call<{ word: string }>({ op: 'offer' });
    expect(await first.call({ op: 'adopt', word })).toMatchObject({ status: 'done', tickets: 3, items: 0, user: { tickets: 3 } });
    expect((await second.call<{ user: UserView }>({ op: 'signIn' })).user.tickets).toBe(0);
  });
});
