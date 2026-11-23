/**
 * 置き場の本物（Firestore・Storage）を、エミュレーターで確かめる。
 * とくに、同時に呼ばれても狂わないこと（チケット・1 日の上限・利用者コード・進み具合）。
 */
import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CloudError } from '../../tools/cloud/store.ts';
import type { ItemDoc, JobDoc } from '../../tools/cloud/store.ts';
import { FirestoreStore } from '../src/firestoreStore.ts';
import { StorageFiles } from '../src/storageFiles.ts';
import { PROJECT } from './ports.mjs';

let app: App;
let store: FirestoreStore;
let files: StorageFiles;
let n = 0;
const run = Date.now().toString(36);
const uid = () => `u-${run}-${++n}`;
const code = (e: unknown) => (e instanceof CloudError ? e.code : `not a CloudError: ${String(e)}`);
const job = (id: string, createdAt: number): JobDoc => ({
  id,
  dollId: 'doll',
  theme: 'うみ',
  styleId: 'anime',
  done: false,
  tickets: 1,
  createdAt,
  heartbeat: createdAt,
  candidates: [{ index: 0, name: 'ふく', categoryId: 'トップス', description: 'A shirt.', colors: ['#c81e28'], status: 'waiting', notes: [] }],
});

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT, storageBucket: `${PROJECT}.appspot.com` }, `adapters-${run}`);
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  store = new FirestoreStore(db);
  files = new StorageFiles(getStorage(app).bucket());
});
afterAll(() => deleteApp(app));

describe('Firestore の置き場', () => {
  it('利用者: 初めてなら作る。2 回目は同じ。利用者コードから引ける', async () => {
    const u = uid();
    expect(await store.getUser(u)).toBeNull();
    const made = await store.createUser(u, () => `C${run}A`.toUpperCase(), 5);
    expect(made).toEqual({ userCode: `C${run}A`.toUpperCase(), tickets: 0, createdAt: 5 });
    expect(await store.createUser(u, () => 'OTHER', 9)).toEqual(made);
    expect(await store.getUser(u)).toEqual(made);
    expect(await store.findUidByCode(made.userCode)).toBe(u);
    expect(await store.findUidByCode('NOBODY00')).toBeNull();
    expect(await store.findUidByCode('')).toBeNull();
  });

  it('利用者コードは重ならない（同時に作っても、同じコードが出たら作り直す）', async () => {
    // どの利用者も、まず同じコードを出す
    const users = Array.from({ length: 6 }, uid);
    const made = await Promise.all(
      users.map((u, i) => {
        let calls = 0;
        return store.createUser(u, () => (calls++ % 2 === 0 ? `SAME${run}`.toUpperCase() : `U${i}X${run}${calls}`.toUpperCase()), 1);
      }),
    );
    expect(new Set(made.map((m) => m.userCode)).size).toBe(6);
    for (const [i, u] of users.entries()) expect(await store.findUidByCode(made[i].userCode)).toBe(u);
  });

  it('チケット: 3 枚しか無いのに、同時に 8 回引いても、通るのは 3 回だけ（残りは 0、台帳は 3 行）', async () => {
    const u = uid();
    await store.createUser(u, () => `T${u}`.toUpperCase(), 1);
    expect(await store.addTickets(u, 3, 'grant', 2)).toBe(3);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.charge(u, 1, `job:${i}`, 3).then(() => 'ok', code)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r === 'no-tickets')).toHaveLength(5);
    expect((await store.getUser(u))!.tickets).toBe(0);
    const ledger = await getFirestore(app).collection(`users/${u}/ledger`).get();
    expect(ledger.docs.map((d) => d.data().count as number).sort()).toEqual([-1, -1, -1, 3]);
    // 台帳に書くだけ（残りは変えない）
    await store.note(u, -2, 'admin:job', 4);
    expect((await store.getUser(u))!.tickets).toBe(0);
    // いない利用者
    expect(code(await store.charge('nobody', 1, 'x', 1).catch((e) => e))).toBe('refused');
    expect(code(await store.addTickets('nobody', 1, 'x', 1).catch((e) => e))).toBe('refused');
  });

  it('払い戻しは、同じ品目では 1 回だけ（同時に 6 回呼んでも、1 枚しか戻らない）。別の品目は、別に戻る', async () => {
    const u = uid();
    await store.createUser(u, () => `R${u}`.toUpperCase(), 1);
    const results = await Promise.all(Array.from({ length: 6 }, () => store.refundOnce(u, 'job1:0', 'refund:job1:0', 2)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.getUser(u))!.tickets).toBe(1);
    expect(await store.refundOnce(u, 'job1:0', 'refund:job1:0', 3)).toBe(false);
    expect(await store.refundOnce(u, 'job1:1', 'refund:job1:1', 3)).toBe(true);
    expect((await store.getUser(u))!.tickets).toBe(2);
    expect(code(await store.refundOnce('nobody', 'x', 'x', 1).catch((e) => e))).toBe('refused');
  });

  it('チケットの数が壊れている（管理画面で、文字にしてしまった）利用者は、0 枚として扱う。足すと、数に直る', async () => {
    const u = uid();
    await store.createUser(u, () => `B${u}`.toUpperCase(), 1);
    await getFirestore(app).doc(`users/${u}`).update({ tickets: '10' });
    expect(code(await store.charge(u, 1, 'job', 2).catch((e) => e))).toBe('no-tickets');
    expect(await store.addTickets(u, 2, 'grant', 3)).toBe(2);
    expect((await store.getUser(u))!.tickets).toBe(2);
  });

  it('1 日の上限: 同時に 9 枚たのんでも、上限の 4 枚まで', async () => {
    const day = `2099-01-${run}`;
    const results = await Promise.all(Array.from({ length: 9 }, () => store.spendImage(day, 4).then(() => 'ok', code)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(4);
    expect(results.filter((r) => r === 'limit')).toHaveLength(5);
    expect(code(await store.spendImage(day, 4).catch((e) => e))).toBe('limit');
  });

  it('仕事: 作る・読む・書き換える（同時の書き換えが、どれも消えない）・新しい順の一覧', async () => {
    const u = uid();
    await store.createJob(u, job('a', 10));
    await store.createJob(u, job('b', 30));
    await store.createJob(u, job('c', 20));
    expect(await store.getJob(u, 'a')).toEqual(job('a', 10));
    expect(await store.getJob(u, 'zzz')).toBeNull();
    expect((await store.listJobs(u)).map((j) => j.id)).toEqual(['b', 'c', 'a']);
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        store.updateJob(u, 'a', (current) => {
          current.candidates[0].notes.push(`n${i}`);
          return current;
        }),
      ),
    );
    expect((await store.getJob(u, 'a'))!.candidates[0].notes.sort()).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5']);
    // change が null を返したら、書かない（中身を書き換えていても）
    const kept = await store.updateJob(u, 'a', (current) => {
      current.done = true;
      return null;
    });
    expect(kept.done).toBe(false);
    expect((await store.getJob(u, 'a'))!.done).toBe(false);
    expect(code(await store.updateJob(u, 'zzz', (c) => c).catch((e) => e))).toBe('refused');
    // ほかの利用者からは見えない
    expect(await store.getJob(uid(), 'a')).toBeNull();
  });

  it('自分の服: 置く・読む・作った順の一覧・消す。undefined の入った内容や、記号の入った ID でも落ちない', async () => {
    const u = uid();
    const item = (id: string, createdAt: number): ItemDoc => ({
      id,
      dollId: 'doll',
      item: { id, name: 'ふく', category: 'トップス', image: { file: 'files/a.webp', canvasW: 10, canvasH: 20, box: { x: 1, y: 2, w: 3, h: 4 } }, thumb: 'files/t.webp', layer: undefined },
      paths: { 'files/a.webp': `users/${u}/items/x/a.webp`, 'files/t.webp': `users/${u}/items/x/t.webp` },
      createdAt,
    });
    await store.putItem(u, item('my:job1-0', 20));
    await store.putItem(u, item('my:job1-1', 10));
    const stored = (await store.getItem(u, 'my:job1-0'))!;
    expect(stored.paths['files/a.webp']).toBe(`users/${u}/items/x/a.webp`);
    expect(stored.item.image.box).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect((await store.listItems(u)).map((i) => i.id)).toEqual(['my:job1-1', 'my:job1-0']);
    for (const odd of ['a/b', '..', '.', '__x__', 'あ い']) {
      expect(await store.getItem(u, odd)).toBeNull();
      await store.deleteItem(u, odd);
    }
    await store.deleteItem(u, 'my:job1-0');
    expect((await store.listItems(u)).map((i) => i.id)).toEqual(['my:job1-1']);
  });
});

describe('Firestore の置き場（v0.35.0 で足した操作）', () => {
  it('chargeAndCreateJob: 足りないと、引かず、仕事も作らない。足りれば、引いて、仕事ができ、台帳に残る', async () => {
    const u = uid();
    await store.createUser(u, () => `C${u}`.toUpperCase(), 1);
    await store.addTickets(u, 2, 'grant', 2);
    expect(code(await store.chargeAndCreateJob(u, job('big', 5), 3, 'job:big', 5).catch((e) => e))).toBe('no-tickets');
    expect((await store.getUser(u))!.tickets).toBe(2);
    expect(await store.getJob(u, 'big')).toBeNull();
    expect(await store.chargeAndCreateJob(u, job('ok', 6), 2, 'job:ok', 6)).toBe(0);
    expect((await store.getJob(u, 'ok'))!.id).toBe('ok');
    const ledger = await getFirestore(app).collection(`users/${u}/ledger`).get();
    expect(ledger.docs.map((d) => d.data().count as number).sort()).toEqual([-2, 2]);
    expect(code(await store.chargeAndCreateJob('nobody', job('x', 1), 1, 'x', 1).catch((e) => e))).toBe('refused');
  });

  it('chargeAndCreateJob: 3 枚しか無いのに同時に 8 回 → 通るのは 3 回、仕事も 3 つ', async () => {
    const u = uid();
    await store.createUser(u, () => `D${u}`.toUpperCase(), 1);
    await store.addTickets(u, 3, 'grant', 2);
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => store.chargeAndCreateJob(u, job(`j${i}`, 10 + i), 1, `job:j${i}`, 3).then(() => 'ok', code)));
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r === 'no-tickets')).toHaveLength(5);
    expect((await store.getUser(u))!.tickets).toBe(0);
    expect(await store.listJobs(u)).toHaveLength(3);
  });

  it('updateItem: 無い服は refused。同時の書き換えが、どれも消えない。null なら書かない', async () => {
    const u = uid();
    const item: ItemDoc = {
      id: 'my:a',
      dollId: 'doll',
      item: { id: 'my:a', name: 'ふく', category: 'トップス', image: { file: 'files/a.webp', canvasW: 10, canvasH: 20, box: { x: 1, y: 2, w: 3, h: 4 } }, thumb: 'files/t.webp' },
      paths: {},
      createdAt: 1,
      hue: 0,
    };
    expect(code(await store.updateItem(u, 'my:a', (i) => i).catch((e) => e))).toBe('refused');
    await store.putItem(u, item);
    await Promise.all(Array.from({ length: 6 }, () => store.updateItem(u, 'my:a', (current) => ({ ...current, hue: (current.hue ?? 0) + 10 }))));
    expect((await store.getItem(u, 'my:a'))!.hue).toBe(60);
    expect((await store.updateItem(u, 'my:a', () => null)).hue).toBe(60);
  });

  it('listOpenJobs: done の仕事は入らない・古い順・limit で切る（どの利用者の分も）', async () => {
    const a = uid();
    const b = uid();
    // ほかのテストの仕事より古い時刻にして、先頭に来るようにする
    await store.createJob(a, job('open-new', -10));
    await store.createJob(b, job('open-old', -30));
    await store.createJob(a, { ...job('finished', -40), done: true });
    const found = (await store.listOpenJobs(500)).filter((r) => r.uid === a || r.uid === b).map((r) => `${r.uid === a ? 'a' : 'b'}/${r.job.id}`);
    expect(found).toEqual(['b/open-old', 'a/open-new']);
    expect((await store.listOpenJobs(1)).map((r) => r.job.id)).toEqual(['open-old']);
  });
});

describe('Storage の置き場', () => {
  it('置く・読む（無ければ null）・prefix でまとめて消す（ほかは残る）', async () => {
    const base = `users/${uid()}`;
    await files.put(`${base}/jobs/j1/0-png.png`, Buffer.from('one'), 'image/png');
    await files.put(`${base}/jobs/j1/0-hide.png`, Buffer.from('two'), 'image/png');
    await files.put(`${base}/jobs/j1/1-png.png`, Buffer.from('three'), 'image/png');
    expect((await files.get(`${base}/jobs/j1/0-png.png`))!.toString()).toBe('one');
    expect(await files.get(`${base}/jobs/j1/9-png.png`)).toBeNull();
    await files.removeAll(`${base}/jobs/j1/0-`);
    expect(await files.get(`${base}/jobs/j1/0-png.png`)).toBeNull();
    expect(await files.get(`${base}/jobs/j1/0-hide.png`)).toBeNull();
    expect((await files.get(`${base}/jobs/j1/1-png.png`))!.toString()).toBe('three');
    await files.removeAll(`${base}/nothing/`); // 無くても落ちない
    await expect(files.removeAll('')).rejects.toThrow();
  });
});
