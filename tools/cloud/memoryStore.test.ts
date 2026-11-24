// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from './memoryStore.ts';
import { CloudError } from './store.ts';
import type { ItemDoc, JobDoc } from './store.ts';

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
    expect(store.ledger).toContainEqual({ uid: 'u1', count: -2, reason: 'job:j1', at: 5 });
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
    await store.useHandoff(first, 'u9');
    await store.useHandoff(first, 'u9');
    expect(await store.getHandoff(first)).toEqual({ uid: 'u1', createdAt: 5, usedBy: 'u9' });
    // ほかの人が、あとから使っても、最初の人のまま
    await store.useHandoff(first, 'u8');
    expect((await store.getHandoff(first))?.usedBy).toBe('u9');
    const next = await store.offerHandoff('u1', make, 7);
    expect(next).not.toBe(first);
    expect(await store.getHandoff('nope')).toBeNull();
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
