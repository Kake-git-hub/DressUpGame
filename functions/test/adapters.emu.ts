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
import type { CloudStore, ItemDoc, JobDoc } from '../../tools/cloud/store.ts';
import { adoptUser } from '../../tools/cloud/studioCore.ts';
import type { CoreDeps } from '../../tools/cloud/studioCore.ts';
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
    const results = await Promise.all(Array.from({ length: 6 }, () => store.refundOnce(u, 'job1:0', 0, undefined, 'refund:job1:0', 2)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await store.getUser(u))!.tickets).toBe(1);
    expect(await store.refundOnce(u, 'job1:0', 0, undefined, 'refund:job1:0', 3)).toBe(false);
    expect(await store.refundOnce(u, 'job1:1', 1, undefined, 'refund:job1:1', 3)).toBe(true);
    expect((await store.getUser(u))!.tickets).toBe(2);
    expect(code(await store.refundOnce('nobody', 'x', 0, undefined, 'x', 1).catch((e) => e))).toBe('refused');
  });

  describe('財布', () => {
    const lot = (id: string, left: number, expiresAt: number) => ({ id, count: 3, left, boughtAt: 1, expiresAt });
    const newUser = async (free: number, lots: ReturnType<typeof lot>[]) => {
      const u = uid();
      await store.createUser(u, () => `W${u}`.toUpperCase(), 1);
      const n = free + lots.reduce((s, l) => s + l.left, 0);
      await getFirestore(app).doc(`users/${u}`).update({ free, lots, tickets: n, ticketsWritten: n });
      return u;
    };
    const ledgerOf = async (u: string) => (await getFirestore(app).collection(`users/${u}/ledger`).get()).docs.map((d) => d.data());

    it('古い形（tickets だけ）の利用者は、引くと free になる', async () => {
      const u = uid();
      await store.createUser(u, () => `W${u}`.toUpperCase(), 1);
      await getFirestore(app).doc(`users/${u}`).update({ tickets: 3 });
      expect(await store.charge(u, 1, 'job:x', 5)).toBe(2);
      expect(await store.getUser(u)).toMatchObject({ tickets: 2, free: 2, ticketsWritten: 2 });
    });
    it('手で tickets を書き換えた差は、財布に取り込む', async () => {
      const u = await newUser(1, [lot('p1', 2, 100)]);
      await getFirestore(app).doc(`users/${u}`).update({ tickets: 6 });
      expect(await store.addTickets(u, 0, 'x', 5)).toBe(6);
      expect(await store.getWallet(u, 5)).toMatchObject({ free: 4, lots: [{ id: 'p1', left: 2 }] });
    });
    it('chargeAndCreateJob: 期限の近い lot から引き、draws を残す。やり直しは二重に引かない', async () => {
      const u = await newUser(1, [lot('late', 2, 200), lot('soon', 1, 100)]);
      expect(await store.chargeAndCreateJob(u, job('jw', 5), 2, 'job:jw', 5)).toBe(2);
      expect((await store.getJob(u, 'jw'))!.draws).toEqual([{ lot: 'soon', n: 1 }, { lot: 'late', n: 1 }]);
      expect(await store.chargeAndCreateJob(u, job('jw', 5), 2, 'job:jw', 6)).toBe(2);
      expect((await ledgerOf(u)).filter((r) => r.reason === 'job:jw')).toHaveLength(1);
    });
    it('切れた lot は、引く前に落とし、expire の行を残す', async () => {
      const u = await newUser(1, [lot('gone', 2, 10)]);
      expect(code(await store.charge(u, 2, 'job:x', 20).catch((e) => e))).toBe('no-tickets');
      expect(await store.charge(u, 1, 'job:y', 20)).toBe(0);
      expect(await ledgerOf(u)).toContainEqual({ count: -2, reason: 'expire:gone', at: 20 });
      expect((await store.getUser(u))!.lots).toEqual([]);
    });
    it('refundOnce: lot に戻す（to を残す）。lot が切れていたら free へ', async () => {
      const u = await newUser(0, [lot('p1', 2, 100)]);
      await store.chargeAndCreateJob(u, job('jr', 5), 2, 'job:jr', 5);
      const draws = (await store.getJob(u, 'jr'))!.draws;
      expect(await store.refundOnce(u, 'jr:0', 0, draws, 'refund:jr:0', 6)).toBe(true);
      expect(await store.refundOnce(u, 'jr:0', 0, draws, 'refund:jr:0', 7)).toBe(false);
      expect(await store.getWallet(u, 8)).toMatchObject({ free: 0, lots: [{ id: 'p1', left: 1 }] });
      expect(await ledgerOf(u)).toContainEqual({ count: 1, reason: 'refund:jr:0', at: 6, to: 'p1' });
      expect(await store.refundOnce(u, 'jr:1', 1, draws, 'refund:jr:1', 200)).toBe(true); // p1 は切れた
      expect(await store.getWallet(u, 200)).toEqual({ free: 1, lots: [] });
      expect(await ledgerOf(u)).toContainEqual({ count: 1, reason: 'refund:jr:1', at: 200, to: 'free' });
    });
    it('moveTickets: 買った分は、期限のまま移る', async () => {
      const from = await newUser(1, [lot('p1', 2, 100), lot('gone', 1, 10)]);
      const to = await newUser(0, []);
      expect(await store.moveTickets(from, to, 50)).toBe(3);
      expect(await store.getWallet(to, 50)).toEqual({ free: 1, lots: [lot('p1', 2, 100)] });
      expect(await store.getWallet(from, 50)).toEqual({ free: 0, lots: [] });
      expect(await store.moveTickets(from, to, 51)).toBe(0);
    });
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

describe('Firestore の置き場（③-b 引き継ぎ）', () => {
  const shirt = (id: string, createdAt: number): ItemDoc => ({
    id,
    dollId: 'doll',
    item: { id, name: 'ふく', category: 'トップス', image: { file: 'files/a.webp', canvasW: 10, canvasH: 20, box: { x: 1, y: 2, w: 3, h: 4 } }, thumb: 'files/t.webp' },
    paths: { 'files/a.webp': `users/x/items/${id}/a.webp` },
    createdAt,
    hue: 25,
    order: createdAt + 1,
  });
  const ledgerOf = async (u: string) => (await getFirestore(app).collection(`users/${u}/ledger`).get()).docs.map((d) => d.data() as { count: number; reason: string });
  async function pair(tickets: number): Promise<[string, string]> {
    const a = uid();
    const b = uid();
    await store.createUser(a, () => `A${a}`.toUpperCase(), 1);
    await store.createUser(b, () => `B${b}`.toUpperCase(), 1);
    if (tickets > 0) await store.addTickets(a, tickets, 'grant', 1);
    return [a, b];
  }

  it('moveTickets: 全部を移し、台帳に出た・入ったを残す。もう一度は 0。移す先がいなければ refused。元が named なら移さない', async () => {
    const [a, b] = await pair(3);
    await store.addTickets(b, 2, 'grant', 1);
    expect(await store.moveTickets(a, b, 9)).toBe(3);
    expect(await store.moveTickets(a, b, 9)).toBe(0);
    expect((await store.getUser(a))!.tickets).toBe(0);
    expect((await store.getUser(b))!.tickets).toBe(5);
    expect((await ledgerOf(a)).filter((l) => l.reason.startsWith('adopt:'))).toEqual([{ count: -3, reason: `adopt:out:${b}`, at: 9 }]);
    expect((await ledgerOf(b)).filter((l) => l.reason.startsWith('adopt:'))).toEqual([{ count: 3, reason: `adopt:in:${a}`, at: 9 }]);
    expect(code(await store.moveTickets(a, 'nobody', 1).catch((e) => e))).toBe('refused');
    await store.addTickets(a, 1, 'grant', 1);
    await store.markUser(a, { named: true });
    expect(await store.moveTickets(a, b, 1)).toBe(0);
    expect((await store.getUser(a))!.tickets).toBe(1);
  });

  it('moveTickets: 同時に 6 回移し、その間に元へ 4 回足しても、無くならず、2 重にもならない（本物の取り引きのやり直し）', async () => {
    const [a, b] = await pair(3);
    const moved = await Promise.all([...Array.from({ length: 6 }, () => store.moveTickets(a, b, 2)), ...Array.from({ length: 4 }, () => store.addTickets(a, 1, 'refund', 2).then(() => 0))]);
    const last = await store.moveTickets(a, b, 3);
    expect(moved.reduce((x, y) => x + y, 0) + last).toBe(7);
    expect((await store.getUser(a))!.tickets).toBe(0);
    expect((await store.getUser(b))!.tickets).toBe(7);
    expect((await ledgerOf(b)).reduce((x, l) => x + l.count, 0)).toBe(7);
  });

  it('moveItem: 中身はそのまま移る。元に無いと false。先に同じ ID があれば、書かずに元から消す。同時に 5 回でも、移るのは 1 回', async () => {
    const [a, b] = await pair(0);
    const doc = shirt('my:j1-0-1', 10);
    await store.putItem(a, doc);
    expect(await store.moveItem(a, b, doc.id)).toBe(true);
    expect(await store.getItem(a, doc.id)).toBeNull();
    expect(await store.getItem(b, doc.id)).toEqual(doc);
    expect(await store.moveItem(a, b, doc.id)).toBe(false);
    await store.putItem(a, { ...doc, hue: -40 });
    expect(await store.moveItem(a, b, doc.id)).toBe(true);
    expect((await store.getItem(b, doc.id))!.hue).toBe(25);
    const other = shirt('my:j2-0-1', 20);
    await store.putItem(a, other);
    const results = await Promise.all(Array.from({ length: 5 }, () => store.moveItem(a, b, other.id)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await store.getItem(b, other.id)).toEqual(other);
    expect(await store.listItems(a)).toEqual([]);
  });

  it('合い言葉: 使われるまで同じ。使われたら新しい。usedBy は最初の人のまま。同時に 5 回もらっても 1 つ。印と覚え', async () => {
    const [a, b] = await pair(0);
    let n = 0;
    const make = () => `${a}-w${++n}`;
    const words = await Promise.all(Array.from({ length: 5 }, () => store.offerHandoff(a, make, 4)));
    expect(new Set(words).size).toBe(1);
    const [word] = words;
    expect(await store.getHandoff(word)).toEqual({ uid: a, createdAt: 4 });
    expect((await store.getUser(a))!.handoff).toBe(word);
    expect(await store.claimHandoff(word, b)).toEqual({ status: 'ok', uid: a });
    expect(await store.claimHandoff(word, b)).toEqual({ status: 'ok', uid: a }); // 同じ人のやり直し
    expect(await store.claimHandoff(word, 'someone-else')).toEqual({ status: 'used' });
    expect(await store.getHandoff(word)).toEqual({ uid: a, createdAt: 4, usedBy: b });
    expect(await store.offerHandoff(a, make, 5)).not.toBe(word);
    expect(await store.getHandoff('nope')).toBeNull();
    expect(await store.claimHandoff('nope', b)).toEqual({ status: 'unknown' });
    expect(await store.getHandoff('nope')).toBeNull(); // 無い合い言葉を、作らない
    await store.markUser(a, { movedTo: b });
    await store.markUser(a, { movedTo: b });
    expect(await store.getUser(a)).toMatchObject({ movedTo: b });
    for (let i = 0; i < 22; i++) await store.addAdopted(b, `x${i}`);
    await store.addAdopted(b, 'x3');
    const adopted = (await store.getUser(b))!.adopted!;
    expect(adopted).toHaveLength(20);
    expect(adopted.slice(-2)).toEqual(['x21', 'x3']);
    expect(code(await store.markUser('nobody', { named: true }).catch((e) => e))).toBe('refused');
  });

  it('adoptUser を本物の置き場で: どの書き換えも、確定のあとにもう一度呼ばれても（replayTransactions と同じ）、チケットも服も 1 回ぶん', async () => {
    const [a, b] = await pair(3);
    await store.addTickets(b, 1, 'grant', 1);
    await store.putItem(a, shirt('my:j1-0-1', 10));
    await store.putItem(a, shirt('my:j2-0', 11));
    await store.putItem(b, shirt('my:j9-0-1', 12));
    // 書き換えの操作を、どれも 2 回ずつ呼ぶ置き場
    const replay = Object.create(store) as CloudStore;
    for (const name of ['moveTickets', 'moveItem', 'markUser', 'addAdopted', 'offerHandoff', 'claimHandoff', 'createUser'] as const) {
      const real = (store[name] as (...args: unknown[]) => Promise<unknown>).bind(store);
      (replay as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
        await real(...args);
        return real(...args);
      };
    }
    let words = 0;
    const deps = { store: replay, adminCodes: [], now: () => 50, newWord: () => `${a}-r${++words}` } as unknown as CoreDeps;
    const word = await replay.offerHandoff(a, deps.newWord, 50);
    expect((await adoptUser(deps, b, word)).status).toBe('done');
    expect(await adoptUser(deps, b, word)).toEqual({ status: 'done', tickets: 0, items: 0 });
    expect((await store.getUser(a))!.tickets).toBe(0);
    expect((await store.getUser(b))!.tickets).toBe(4);
    expect((await store.listItems(a)).map((i) => i.id)).toEqual([]);
    expect((await store.listItems(b)).map((i) => i.id)).toEqual(['my:j1-0-1', 'my:j2-0', 'my:j9-0-1']);
    expect((await ledgerOf(b)).filter((l) => l.reason.startsWith('adopt:'))).toHaveLength(1);
    expect((await store.getUser(b))!.adopted).toEqual([a]);
    expect(await store.getHandoff(word)).toMatchObject({ usedBy: b });
  });

  it('adoptUser を同時に 4 回（アプリのやり直しと、2 つのタブ）: チケットも服も 1 回ぶん', async () => {
    const [a, b] = await pair(5);
    await store.putItem(a, shirt('my:j1-0-1', 10));
    const deps = { store, adminCodes: [], now: () => 60, newWord: () => `${a}-c` } as unknown as CoreDeps;
    const word = await store.offerHandoff(a, deps.newWord, 60);
    const results = await Promise.all(Array.from({ length: 4 }, () => adoptUser(deps, b, word)));
    expect(results.every((r) => r.status === 'done')).toBe(true);
    expect(results.reduce((x, r) => x + r.tickets, 0)).toBe(5);
    expect(results.reduce((x, r) => x + r.items, 0)).toBe(1);
    expect((await store.getUser(b))!.tickets).toBe(5);
    expect((await store.listItems(b)).map((i) => i.id)).toEqual(['my:j1-0-1']);
  });

  it('2 つのアカウントが、同じ合い言葉で同時に adoptUser: 1 つだけ done、もう 1 つは used。元のチケットと服は、全部 done の側へ', async () => {
    for (let round = 0; round < 3; round++) {
      const [a, b] = await pair(4);
      const c = uid();
      await store.createUser(c, () => `C${c}`.toUpperCase(), 1);
      const ids = ['my:j1-0-1', 'my:j2-0-1', 'my:j3-0', 'my:j4-0-1', 'my:j5-0-1'];
      for (const [i, id] of ids.entries()) await store.putItem(a, shirt(id, 10 + i));
      const deps = { store, adminCodes: [], now: () => 70, newWord: () => `${a}-x` } as unknown as CoreDeps;
      const word = await store.offerHandoff(a, deps.newWord, 70);
      const [rb, rc] = await Promise.all([adoptUser(deps, b, word), adoptUser(deps, c, word)]);
      expect([rb.status, rc.status].sort()).toEqual(['done', 'used']);
      const [winner, loser, won, lost] = rb.status === 'done' ? [b, c, rb, rc] : [c, b, rc, rb];
      expect(won).toEqual({ status: 'done', tickets: 4, items: 5 });
      expect(lost).toEqual({ status: 'used', tickets: 0, items: 0 });
      expect((await store.getUser(winner))!.tickets).toBe(4);
      expect((await store.getUser(loser))!.tickets).toBe(0);
      expect((await store.getUser(a))!.tickets).toBe(0);
      expect((await store.listItems(winner)).map((i) => i.id)).toEqual(ids);
      expect(await store.listItems(loser)).toEqual([]);
      expect(await store.listItems(a)).toEqual([]);
      expect(await store.getUser(a)).toMatchObject({ movedTo: winner });
      expect(await store.getHandoff(word)).toMatchObject({ usedBy: winner });
      expect((await store.getUser(loser))!.adopted).toBeUndefined();
    }
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
