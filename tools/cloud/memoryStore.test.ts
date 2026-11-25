// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from './memoryStore.ts';
import { CloudError } from './store.ts';
import type { ItemDoc, JobDoc, TradeDoc } from './store.ts';

let store: MemoryStore;
const job = (id: string, createdAt: number, done = false): JobDoc => ({ id, dollId: 'd', theme: 't', styleId: 'anime', done, tickets: 1, createdAt, heartbeat: createdAt, candidates: [] });
const item = (id: string): ItemDoc => ({
  id,
  dollId: 'd',
  item: { id, name: 'ふく', category: 'トップス', image: { file: 'a.webp', canvasW: 10, canvasH: 10, box: { x: 0, y: 0, w: 1, h: 1 } }, thumb: 't.webp' },
  paths: {},
  createdAt: 1,
});

beforeEach(async () => {
  store = new MemoryStore();
  await store.createUser('u1', () => 'AAAAAAAA', 1);
  await store.addTickets('u1', 2, 'gift', 1);
});

describe('chargeAndCreateJob', () => {
  it('足りないと、引かず、仕事も作らない', async () => {
    const error = await store.chargeAndCreateJob('u1', job('j1', 5), 3, 'job:j1', 5).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CloudError);
    expect((error as CloudError).code).toBe('no-tickets');
    expect((await store.getUser('u1'))?.tickets).toBe(2);
    expect(await store.getJob('u1', 'j1')).toBeNull();
  });
  it('引いて、仕事ができ、台帳に残る', async () => {
    expect(await store.chargeAndCreateJob('u1', job('j1', 5), 2, 'job:j1', 5)).toBe(0);
    expect((await store.getUser('u1'))?.tickets).toBe(0);
    expect((await store.getJob('u1', 'j1'))?.id).toBe('j1');
    expect(store.ledger).toContainEqual({ uid: 'u1', count: -2, reason: 'job:j1', at: 5, draws: [{ n: 2 }] });
  });
});

describe('chargeAndCreateJob（やり直し）', () => {
  it('同じ仕事で、もう一度呼ばれても（確定の返事が届かなかったときのやり直し）、引くのは 1 回', async () => {
    expect(await store.chargeAndCreateJob('u1', job('j1', 5), 1, 'job:j1', 5)).toBe(1);
    expect(await store.chargeAndCreateJob('u1', job('j1', 5), 1, 'job:j1', 5)).toBe(1);
    expect((await store.getUser('u1'))?.tickets).toBe(1);
    expect(store.ledger.filter((l) => l.reason === 'job:j1')).toHaveLength(1);
  });
});

describe('updateItem', () => {
  it('無い服は refused', async () => {
    const error = await store.updateItem('u1', 'my:none', (i) => i).catch((e: unknown) => e);
    expect((error as CloudError).code).toBe('refused');
    expect((error as CloudError).message).toBe('この服は見つかりません');
  });
  it('change が 2 回呼ばれても、結果は 1 つ', async () => {
    await store.putItem('u1', { ...item('my:a'), hue: 0 });
    let calls = 0;
    // 1 回目の書き込みの直前に、ほかの書き込みを割り込ませる
    const first = store.updateItem('u1', 'my:a', (i) => {
      calls++;
      return { ...i, hue: (i.hue ?? 0) + 10 };
    });
    await store.putItem('u1', { ...item('my:a'), hue: 100 });
    const result = await first;
    expect(calls).toBe(2);
    expect(result.hue).toBe(110);
    expect((await store.getItem('u1', 'my:a'))?.hue).toBe(110);
  });
  it('change が null なら、書かない', async () => {
    await store.putItem('u1', { ...item('my:a'), hue: 5 });
    expect((await store.updateItem('u1', 'my:a', () => null)).hue).toBe(5);
  });
});

describe('listOpenJobs', () => {
  it('done の仕事は入らない・古い順・limit で切る', async () => {
    await store.createUser('u2', () => 'BBBBBBBB', 1);
    await store.createJob('u1', job('new', 30));
    await store.createJob('u2', job('old', 10));
    await store.createJob('u1', job('mid', 20));
    await store.createJob('u1', job('finished', 5, true));
    expect((await store.listOpenJobs(10)).map((r) => `${r.uid}/${r.job.id}`)).toEqual(['u2/old', 'u1/mid', 'u1/new']);
    expect((await store.listOpenJobs(2)).map((r) => r.job.id)).toEqual(['old', 'mid']);
  });
});

describe('引き継ぎ（③-b）: チケットと服を移す・合い言葉・利用者の印', () => {
  beforeEach(async () => {
    await store.createUser('u2', () => 'BBBBBBBB', 1);
    await store.addTickets('u1', 1, 'gift', 1); // u1 は 3 枚
  });
  it('moveTickets: 全部を移し、台帳に出た・入ったを残す。もう一度呼ぶと 0 で、何も書かない', async () => {
    await store.addTickets('u2', 4, 'gift', 1);
    const rows = store.ledger.length;
    expect(await store.moveTickets('u1', 'u2', 7)).toBe(3);
    expect((await store.getUser('u1'))?.tickets).toBe(0);
    expect((await store.getUser('u2'))?.tickets).toBe(7);
    expect(store.ledger.slice(rows)).toEqual([
      { uid: 'u1', count: -3, reason: 'adopt:out:u2', at: 7 },
      { uid: 'u2', count: 3, reason: 'adopt:in:u1', at: 7 },
    ]);
    // 確定の返事が届かずに、もう一度呼ばれた
    expect(await store.moveTickets('u1', 'u2', 8)).toBe(0);
    expect((await store.getUser('u2'))?.tickets).toBe(7);
    expect(store.ledger).toHaveLength(rows + 2);
  });
  it('moveTickets: 移す先がいなければ refused（何も変えない）。元が名前のある利用者なら、移さない', async () => {
    expect((await store.moveTickets('u1', 'nobody', 1).catch((e: unknown) => e) as CloudError).code).toBe('refused');
    expect((await store.getUser('u1'))?.tickets).toBe(3);
    await store.markUser('u1', { named: true });
    expect(await store.moveTickets('u1', 'u2', 1)).toBe(0);
    expect((await store.getUser('u1'))?.tickets).toBe(3);
  });
  it('moveItem: 移る（中身はそのまま）。元に無いと false。先に同じ ID があれば、書かずに元から消すだけ', async () => {
    const a = { ...item('my:a'), hue: 40, order: 9, paths: { 'files/a.webp': 'users/u1/items/my_a/a.webp' } };
    await store.putItem('u1', a);
    expect(await store.moveItem('u1', 'u2', 'my:a')).toBe(true);
    expect(await store.getItem('u1', 'my:a')).toBeNull();
    expect(await store.getItem('u2', 'my:a')).toEqual(a);
    expect(await store.moveItem('u1', 'u2', 'my:a')).toBe(false);
    await store.putItem('u1', { ...a, hue: -10 });
    expect(await store.moveItem('u1', 'u2', 'my:a')).toBe(true);
    expect(await store.getItem('u1', 'my:a')).toBeNull();
    expect((await store.getItem('u2', 'my:a'))?.hue).toBe(40);
  });
  it('offerHandoff: 同じ利用者は、使っていない間は同じ合い言葉。使われたら、新しい合い言葉', async () => {
    let n = 0;
    const make = () => `w${++n}`;
    const first = await store.offerHandoff('u1', make, 5);
    expect(await store.offerHandoff('u1', make, 6)).toBe(first);
    expect(await store.getHandoff(first)).toEqual({ uid: 'u1', createdAt: 5 });
    expect((await store.getUser('u1'))?.handoff).toBe(first);
    expect(await store.offerHandoff('u2', make, 6)).not.toBe(first);
    await store.claimHandoff(first, 'u9');
    const next = await store.offerHandoff('u1', make, 7);
    expect(next).not.toBe(first);
    expect(await store.getHandoff('nope')).toBeNull();
  });
  it('claimHandoff: 知らない合い言葉 → unknown。初めて → 使った人を書いて、元の uid。同じ人がもう一度 → ok（書き直さない）。ほかの人 → used（最初の人のまま）', async () => {
    const word = await store.offerHandoff('u1', () => 'w1', 5);
    expect(await store.claimHandoff('nope', 'u9')).toEqual({ status: 'unknown' });
    expect(store.handoffs.has('nope')).toBe(false);
    expect(await store.claimHandoff(word, 'u9')).toEqual({ status: 'ok', uid: 'u1' });
    expect(await store.getHandoff(word)).toEqual({ uid: 'u1', createdAt: 5, usedBy: 'u9' });
    // 確定の返事が届かずに、もう一度（同じ人）
    expect(await store.claimHandoff(word, 'u9')).toEqual({ status: 'ok', uid: 'u1' });
    expect(await store.claimHandoff(word, 'u8')).toEqual({ status: 'used' });
    expect(await store.getHandoff(word)).toEqual({ uid: 'u1', createdAt: 5, usedBy: 'u9' });
  });
  it('claimHandoff: 2 人が同時に押さえても、押さえられるのは 1 人だけ', async () => {
    const word = await store.offerHandoff('u1', () => 'w1', 5);
    const results = await Promise.all(['u7', 'u8', 'u9'].map((by) => store.claimHandoff(word, by)));
    expect(results.filter((r) => r.status === 'ok')).toEqual([{ status: 'ok', uid: 'u1' }]);
    expect(results.filter((r) => r.status === 'used')).toHaveLength(2);
  });
  it('markUser・addAdopted: 同じ値なら書かない。adopted は重ならず、20 件まで（古いものから落とす）', async () => {
    await store.markUser('u1', { movedTo: 'u2' });
    await store.markUser('u1', { movedTo: 'u2' });
    await store.markUser('u2', { named: true });
    expect(await store.getUser('u1')).toMatchObject({ movedTo: 'u2' });
    expect(await store.getUser('u2')).toMatchObject({ named: true });
    for (let i = 0; i < 22; i++) await store.addAdopted('u2', `a${i}`);
    await store.addAdopted('u2', 'a21');
    const adopted = (await store.getUser('u2'))?.adopted ?? [];
    expect(adopted).toHaveLength(20);
    expect(adopted[0]).toBe('a2');
    expect(adopted.at(-1)).toBe('a21');
    // もう一度もらった元は、新しい側へ
    await store.addAdopted('u2', 'a5');
    expect((await store.getUser('u2'))?.adopted?.slice(-2)).toEqual(['a21', 'a5']);
    expect(new Set((await store.getUser('u2'))?.adopted).size).toBe(20);
  });
});

describe('交換', () => {
  const joined = (over: Partial<TradeDoc> = {}): TradeDoc => ({
    id: 't1',
    status: 'joined',
    a: { uid: 'u1', itemId: 'my:a', accepted: true },
    b: { uid: 'u2', itemId: 'my:b', accepted: true },
    code: 'code-1',
    codeAt: 1,
    createdAt: 1,
    joinedAt: 2,
    ...over,
  });
  const mine = (id: string, extra: Partial<ItemDoc> = {}): ItemDoc => ({
    ...item(id),
    hue: 40,
    paths: { 'files/a.webp': 'x/y' },
    set: { id: 's1', name: 'セット' },
    order: 3,
    updatedAt: 3,
    ...extra,
  });
  beforeEach(async () => {
    await store.createUser('u2', () => 'BBBBBBBB', 1);
    await store.putItem('u1', mine('my:a'));
    await store.putItem('u2', mine('my:b'));
    await store.putTrade(joined());
  });

  it('swapTrade moves both items and drops set', async () => {
    const done = await store.swapTrade('t1', 99);
    expect(done).toMatchObject({ status: 'done', endedAt: 99 });
    expect(await store.getItem('u1', 'my:a')).toBeNull();
    expect(await store.getItem('u2', 'my:b')).toBeNull();
    for (const [uid, id] of [['u2', 'my:a'], ['u1', 'my:b']] as const) {
      const moved = await store.getItem(uid, id);
      expect(moved?.set).toBeUndefined();
      expect(moved).toMatchObject({ hue: 40, order: 99, updatedAt: 99, paths: { 'files/a.webp': 'x/y' } });
      expect(moved?.item.name).toBe('ふく');
      expect(moved?.createdAt).toBe(1);
    }
    expect(await store.getTrade('t1')).toMatchObject({ status: 'done' });
  });
  it('swapTrade aborts when an item vanished', async () => {
    await store.deleteItem('u2', 'my:b');
    const result = await store.swapTrade('t1', 99);
    expect(result).toMatchObject({ status: 'cancelled', reason: 'gone', endedAt: 99 });
    expect((await store.getItem('u1', 'my:a'))?.set).toBeDefined();
    expect(await store.getItem('u2', 'my:a')).toBeNull();
    expect(await store.getItem('u1', 'my:b')).toBeNull();
    expect((await store.getTrade('t1'))?.reason).toBe('gone');
  });
  it('swapTrade conflict', async () => {
    await store.putItem('u2', mine('my:a'));
    const result = await store.swapTrade('t1', 99);
    expect(result).toMatchObject({ status: 'cancelled', reason: 'conflict' });
    expect(await store.getItem('u1', 'my:a')).toMatchObject({ order: 3, set: { id: 's1' } });
    expect(await store.getItem('u2', 'my:b')).toMatchObject({ order: 3, set: { id: 's1' } });
    expect(await store.getItem('u1', 'my:b')).toBeNull();
  });
  it('swapTrade twice is a no-op', async () => {
    const first = await store.swapTrade('t1', 99);
    const second = await store.swapTrade('t1', 200);
    expect(second).toEqual(first);
    expect(await store.getItem('u2', 'my:a')).toMatchObject({ order: 99 });
  });
  it('swapTrade does nothing until both accepted', async () => {
    await store.putTrade(joined({ b: { uid: 'u2', itemId: 'my:b' } }));
    expect((await store.swapTrade('t1', 99)).status).toBe('joined');
    expect(await store.getItem('u1', 'my:a')).not.toBeNull();
  });
  it('findTradeByCode・updateTrade・setUserTrade', async () => {
    expect((await store.findTradeByCode('code-1'))?.id).toBe('t1');
    expect(await store.findTradeByCode('nope')).toBeNull();
    expect((await store.updateTrade('t1', (t) => ({ ...t, status: 'cancelled', reason: 'cancel' }))).status).toBe('cancelled');
    expect((await store.updateTrade('t1', () => null)).reason).toBe('cancel');
    await store.setUserTrade('u1', 't1');
    expect((await store.getUser('u1'))?.trade).toBe('t1');
    await store.setUserTrade('u1', null);
    expect((await store.getUser('u1'))?.trade).toBeUndefined();
  });
  it('countTrade: 上限で limit（日が変われば数え直す）', async () => {
    await store.countTrade('u1', '2026-11-25', 2);
    await store.countTrade('u1', '2026-11-25', 2);
    await expect(store.countTrade('u1', '2026-11-25', 2)).rejects.toMatchObject({ code: 'limit' });
    await store.countTrade('u1', '2026-11-26', 2);
    await store.countTrade('u2', '2026-11-25', 2);
  });
});

describe('財布', () => {
  const lot = (id: string, left: number, expiresAt: number) => ({ id, count: 3, left, boughtAt: 1, expiresAt });
  const withLots = (uid: string, free: number, lots: ReturnType<typeof lot>[]) => {
    const n = free + lots.reduce((s, l) => s + l.left, 0);
    Object.assign(store.users.get(uid)!, { free, lots, tickets: n, ticketsWritten: n });
  };
  it('古い形（tickets だけ）の利用者から引くと、free になる', async () => {
    await store.createUser('old', () => 'OLDOLDOL', 1);
    store.users.get('old')!.tickets = 3;
    expect(await store.charge('old', 1, 'job:x', 5)).toBe(2);
    expect(await store.getUser('old')).toMatchObject({ tickets: 2, free: 2, ticketsWritten: 2 });
  });
  it('手で tickets を書き換えた差は、財布に取り込む', async () => {
    withLots('u1', 1, [lot('p1', 2, 100)]);
    store.users.get('u1')!.tickets = 6; // +3
    expect(await store.addTickets('u1', 0, 'x', 5)).toBe(6);
    expect(await store.getWallet('u1', 5)).toMatchObject({ free: 4, lots: [{ id: 'p1', left: 2 }] });
  });
  it('chargeAndCreateJob: 期限の近い lot から引き、job.draws に残す。台帳にも', async () => {
    withLots('u1', 1, [lot('late', 2, 200), lot('soon', 1, 100)]);
    expect(await store.chargeAndCreateJob('u1', job('j1', 5), 2, 'job:j1', 5)).toBe(2);
    expect((await store.getJob('u1', 'j1'))!.draws).toEqual([{ lot: 'soon', n: 1 }, { lot: 'late', n: 1 }]);
    expect(store.ledger).toContainEqual({ uid: 'u1', count: -2, reason: 'job:j1', at: 5, draws: [{ lot: 'soon', n: 1 }, { lot: 'late', n: 1 }] });
    // やり直し: いまの残りを返し、二重に引かない
    expect(await store.chargeAndCreateJob('u1', job('j1', 5), 2, 'job:j1', 6)).toBe(2);
  });
  it('切れた lot は、引く前に落とし、台帳に expire の行を残す（足りなければ引かない）', async () => {
    withLots('u1', 1, [lot('gone', 2, 10)]);
    const error = await store.charge('u1', 2, 'job:x', 20).catch((e: unknown) => e);
    expect((error as CloudError).code).toBe('no-tickets');
    expect(await store.charge('u1', 1, 'job:y', 20)).toBe(0);
    expect(store.ledger).toContainEqual({ uid: 'u1', count: -2, reason: 'expire:gone', at: 20 });
    expect((await store.getUser('u1'))!.lots).toEqual([]);
  });
  it('refundOnce: lot に戻す。同じ key は 1 回だけ。台帳に to', async () => {
    withLots('u1', 0, [lot('p1', 2, 100)]);
    await store.chargeAndCreateJob('u1', job('j1', 5), 2, 'job:j1', 5);
    const draws = (await store.getJob('u1', 'j1'))!.draws;
    expect(await store.refundOnce('u1', 'j1:0', 0, draws, 'refund:j1:0', 6)).toBe(true);
    expect(await store.refundOnce('u1', 'j1:0', 0, draws, 'refund:j1:0', 7)).toBe(false);
    expect(await store.getWallet('u1', 8)).toMatchObject({ free: 0, lots: [{ id: 'p1', left: 1 }] });
    expect(store.ledger).toContainEqual({ uid: 'u1', count: 1, reason: 'refund:j1:0', at: 6, to: 'p1' });
  });
  it('refundOnce: lot が切れていたら free へ', async () => {
    withLots('u1', 0, [lot('p1', 2, 100)]);
    await store.chargeAndCreateJob('u1', job('j1', 5), 2, 'job:j1', 5);
    const draws = (await store.getJob('u1', 'j1'))!.draws;
    expect(await store.refundOnce('u1', 'j1:0', 0, draws, 'refund:j1:0', 200)).toBe(true);
    expect(await store.getWallet('u1', 200)).toEqual({ free: 1, lots: [] });
    expect(store.ledger).toContainEqual({ uid: 'u1', count: 1, reason: 'refund:j1:0', at: 200, to: 'free' });
  });
  it('moveTickets: 買った分は、期限のまま移る。切れた分は移さない', async () => {
    await store.createUser('u2', () => 'BBBBBBBB', 1);
    withLots('u1', 1, [lot('p1', 2, 100), lot('gone', 1, 10)]);
    expect(await store.moveTickets('u1', 'u2', 50)).toBe(3);
    expect(await store.getWallet('u2', 50)).toEqual({ free: 1, lots: [lot('p1', 2, 100)] });
    expect(await store.getWallet('u1', 50)).toEqual({ free: 0, lots: [] });
  });
});
