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
