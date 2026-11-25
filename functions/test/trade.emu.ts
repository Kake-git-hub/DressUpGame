/**
 * 交換の入れ替え（swapTrade）を、置き場の本物（Firestore）で、エミュレーターで確かめる。
 */
import { deleteApp, initializeApp } from 'firebase-admin/app';
import type { App } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ItemDoc, TradeDoc } from '../../tools/cloud/store.ts';
import { FirestoreStore } from '../src/firestoreStore.ts';
import { PROJECT } from './ports.mjs';

let app: App;
let store: FirestoreStore;
let n = 0;
const run = Date.now().toString(36);
const item = (id: string): ItemDoc => ({
  id,
  dollId: 'doll',
  item: { id, name: 'ふく', category: 'トップス', image: { file: 'a.webp', canvasW: 10, canvasH: 10, box: { x: 0, y: 0, w: 1, h: 1 } }, thumb: 't.webp' },
  paths: { 'files/a.webp': 'x/y' },
  set: { id: 's1', name: 'セット' },
  hue: 40,
  order: 3,
  createdAt: 1,
  updatedAt: 3,
});
// 2 人と、それぞれの服 1 点、joined で両方 accepted の交換
async function setup() {
  const k = `${run}-${++n}`;
  const [a, b] = [`ua-${k}`, `ub-${k}`];
  const [ia, ib] = [`my:a-${k}`, `my:b-${k}`];
  await store.createUser(a, () => `A${k}`.toUpperCase(), 1);
  await store.createUser(b, () => `B${k}`.toUpperCase(), 1);
  await store.putItem(a, item(ia));
  await store.putItem(b, item(ib));
  const trade: TradeDoc = {
    id: `t-${k}`,
    status: 'joined',
    a: { uid: a, itemId: ia, accepted: true },
    b: { uid: b, itemId: ib, accepted: true },
    code: `code-${k}`,
    codeAt: 1,
    createdAt: 1,
    joinedAt: 2,
  };
  await store.putTrade(trade);
  return { a, b, ia, ib, trade };
}

beforeAll(() => {
  app = initializeApp({ projectId: PROJECT }, `trade-${run}`);
  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  store = new FirestoreStore(db);
});
afterAll(() => deleteApp(app));

describe('交換（Firestore）', () => {
  it('入れ替わる: 服が動き、set が外れ、order と updatedAt が now になる', async () => {
    const { a, b, ia, ib, trade } = await setup();
    const done = await store.swapTrade(trade.id, 99);
    expect(done).toMatchObject({ status: 'done', endedAt: 99 });
    expect(await store.getItem(a, ia)).toBeNull();
    expect(await store.getItem(b, ib)).toBeNull();
    for (const [uid, id] of [[b, ia], [a, ib]] as const) {
      const moved = await store.getItem(uid, id);
      expect(moved?.set).toBeUndefined();
      expect(moved).toMatchObject({ hue: 40, order: 99, updatedAt: 99, paths: { 'files/a.webp': 'x/y' } });
      expect(moved?.item.name).toBe('ふく');
    }
    expect(await store.getTrade(trade.id)).toMatchObject({ status: 'done' });
  });
  it('片方の服が消えていたら、何も動かさず cancelled（gone）。受け取る側に同じ ID があれば conflict', async () => {
    const gone = await setup();
    await store.deleteItem(gone.b, gone.ib);
    expect(await store.swapTrade(gone.trade.id, 99)).toMatchObject({ status: 'cancelled', reason: 'gone' });
    expect((await store.getItem(gone.a, gone.ia))?.set).toBeDefined();
    expect(await store.getItem(gone.b, gone.ia)).toBeNull();
    expect(await store.getItem(gone.a, gone.ib)).toBeNull();

    const clash = await setup();
    await store.putItem(clash.b, item(clash.ia));
    expect(await store.swapTrade(clash.trade.id, 99)).toMatchObject({ status: 'cancelled', reason: 'conflict' });
    expect(await store.getItem(clash.a, clash.ia)).toMatchObject({ order: 3 });
    expect(await store.getItem(clash.b, clash.ib)).toMatchObject({ order: 3 });
    expect(await store.getItem(clash.a, clash.ib)).toBeNull();
  });
  it('2 回めは何もしない。同時に呼んでも、入れ替えは 1 回', async () => {
    const { a, b, ia, trade } = await setup();
    const results = await Promise.all([store.swapTrade(trade.id, 99), store.swapTrade(trade.id, 100)]);
    expect(results.map((r) => r.status)).toEqual(['done', 'done']);
    const again = await store.swapTrade(trade.id, 200);
    expect(again).toMatchObject({ status: 'done' });
    expect(again.endedAt).toBe(results[0].endedAt);
    expect(await store.getItem(a, ia)).toBeNull();
    expect((await store.getItem(b, ia))?.order).toBe(again.endedAt);
  });
  it('findTradeByCode・updateTrade・setUserTrade', async () => {
    const { a, trade } = await setup();
    expect((await store.findTradeByCode(trade.code))?.id).toBe(trade.id);
    expect(await store.findTradeByCode('nope')).toBeNull();
    expect((await store.updateTrade(trade.id, (t) => ({ ...t, status: 'cancelled', reason: 'cancel' }))).status).toBe('cancelled');
    expect((await store.updateTrade(trade.id, () => null)).reason).toBe('cancel');
    await store.setUserTrade(a, trade.id);
    expect((await store.getUser(a))?.trade).toBe(trade.id);
    await store.setUserTrade(a, null);
    expect((await store.getUser(a))?.trade).toBeUndefined();
  });
});
