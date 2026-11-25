// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { handleCall } from './api.ts';
import { createFakeGateway } from './fakeGateway.ts';
import type { FakeGateway } from './fakeGateway.ts';
import { MemoryFiles, MemoryStore } from './memoryStore.ts';
import { checkout, handlePayEvent, parsePacks, purchase, shop, shopAck } from './payment.ts';
import type { PayDeps, PayEvent } from './payment.ts';
import { CloudError } from './store.ts';
import { signIn } from './studioCore.ts';
import type { CoreDeps } from './studioCore.ts';
import { addMonthsJst } from './wallet.ts';

let store: MemoryStore;
let gateway: FakeGateway;
let deps: CoreDeps;
let pay: PayDeps;
let clock: number;

const named = { anonymous: false };
const anon = { anonymous: true };
const input = (pack = '10-300') => ({ pack, adultAt: 111, agreedAt: 222 });
const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof CloudError ? `${e.code}:${e.message.split(' ')[0]}` : `other:${String(e)}`;
  }
  return 'no error';
};
const bought = async (uid = 'u1', pack = '10-300') => {
  const made = await checkout(deps, uid, named, input(pack));
  gateway.pay(made.session, clock);
  return made.session;
};
const done = (session: string): PayEvent => ({ kind: 'completed', session, paid: true, paidAt: clock });
const tickets = async (uid = 'u1') => (await signIn(deps, uid)).tickets;
const rows = (reason: RegExp) => store.ledger.filter((r) => reason.test(r.reason));

beforeEach(async () => {
  store = new MemoryStore();
  gateway = createFakeGateway();
  clock = Date.UTC(2026, 10, 25, 3, 0, 0);
  pay = { gateway, salesOpen: true, packs: parsePacks('10:300,30:800'), welcomeTickets: 0, returnUrl: 'https://app.test/DressUpGame/', checkoutsPerDay: 10 };
  deps = {
    store,
    files: new MemoryFiles(),
    ai: { text: null, image: null } as never,
    content: {} as never,
    adminCodes: [],
    limits: { perDay: 20, maxAttempts: 1 },
    now: () => clock,
    newId: () => 'id',
    newWord: () => 'word',
    enqueue: async () => {},
    pay,
  };
  await signIn(deps, 'u1');
});

describe('パック', () => {
  it('parsePacks: 壊れた項目と 50 円未満は捨てる', () => {
    expect(parsePacks('10:300, 30:800,x:1,5:10')).toEqual([
      { id: '10-300', tickets: 10, price: 300 },
      { id: '30-800', tickets: 30, price: 800 },
    ]);
    expect(parsePacks('')).toEqual([]);
    expect(parsePacks('0:300,10:300,10:300')).toEqual([{ id: '10-300', tickets: 10, price: 300 }]);
  });
});

describe('checkout', () => {
  it('匿名は pay:login、売っていなければ pay:closed（管理者なら作れる）、gateway が無ければ closed', async () => {
    expect(await refusal(checkout(deps, 'u1', anon, input()))).toBe('refused:pay:login');
    pay.salesOpen = false;
    expect(await refusal(checkout(deps, 'u1', named, input()))).toBe('refused:pay:closed');
    deps.adminCodes.push((await store.getUser('u1'))!.userCode);
    expect((await checkout(deps, 'u1', named, input())).session).toMatch(/^cs_fake_/);
    pay.salesOpen = true;
    pay.gateway = null;
    deps.adminCodes.length = 0;
    expect(await refusal(checkout(deps, 'u1', named, input()))).toBe('refused:pay:closed');
  });
  it('無いパックは pay:pack、11 回めは pay:limit', async () => {
    expect(await refusal(checkout(deps, 'u1', named, input('99-1')))).toBe('refused:pay:pack');
    for (let i = 0; i < 10; i++) await checkout(deps, 'u1', named, input());
    expect(await refusal(checkout(deps, 'u1', named, input()))).toBe('refused:pay:limit');
    clock += 24 * 3600 * 1000;
    await checkout(deps, 'u1', named, input());
  });
  it('期限は 6 か月あと。purchases に、同意の時刻も残る。URL を渡す', async () => {
    const made = await checkout(deps, 'u1', named, input());
    expect(made.expiresAt).toBe(addMonthsJst(clock, 6));
    expect(await store.getPurchase(made.session)).toMatchObject({ uid: 'u1', pack: '10-300', tickets: 10, price: 300, status: 'open', adultAt: 111, agreedAt: 222, createdAt: clock, expiresAt: made.expiresAt });
    expect(gateway.sessions.get(made.session)).toMatchObject({ successUrl: 'https://app.test/DressUpGame/?pay=done&session={CHECKOUT_SESSION_ID}', cancelUrl: 'https://app.test/DressUpGame/?pay=cancel' });
  });
});

describe('足す（知らせとアプリの聞き直し）', () => {
  it('completed を 2 回 + purchase 1 回 → lot は 1 つ、台帳 buy: は 1 行', async () => {
    const session = await bought();
    await handlePayEvent(deps, done(session));
    await handlePayEvent(deps, done(session));
    const view = await purchase(deps, 'u1', session);
    expect(view).toEqual({ status: 'paid', added: 0, tickets: 10 });
    expect((await store.getWallet('u1', clock)).lots).toHaveLength(1);
    expect(await tickets()).toBe(10);
    expect(rows(/^buy:/)).toHaveLength(1);
  });
  it('purchase が先でも 1 回だけ（足したのは purchase、あとの知らせは何もしない）', async () => {
    const session = await bought();
    expect(await purchase(deps, 'u1', session)).toEqual({ status: 'paid', added: 10, tickets: 10 });
    await handlePayEvent(deps, done(session));
    expect(await tickets()).toBe(10);
    expect(rows(/^buy:/)).toHaveLength(1);
  });
  it('取り引きを確定後にやり直しても同じ（replayTransactions）', async () => {
    const realFulfill = store.fulfillPurchase.bind(store);
    store.fulfillPurchase = async (id, paidAt, now) => {
      await realFulfill(id, paidAt, now);
      return realFulfill(id, paidAt, now);
    };
    const realReclaim = store.reclaimPurchase.bind(store);
    store.reclaimPurchase = async (id, target, now) => {
      await realReclaim(id, target, now);
      return realReclaim(id, target, now);
    };
    const session = await bought();
    await handlePayEvent(deps, done(session));
    await handlePayEvent(deps, done(session));
    await purchase(deps, 'u1', session);
    expect((await store.getWallet('u1', clock)).lots).toHaveLength(1);
    expect(rows(/^buy:/)).toHaveLength(1);
    await handlePayEvent(deps, { kind: 'refunded', session, amount: 300, refunded: 150 });
    expect(await tickets()).toBe(5);
    expect(rows(/^refund-paid:/)).toHaveLength(1);
  });
  it('まだなら open のまま。expired の知らせで expired。30 分のあとに払えたら、足す', async () => {
    const session = (await checkout(deps, 'u1', named, input())).session;
    expect(await purchase(deps, 'u1', session)).toEqual({ status: 'open', added: 0, tickets: 10 });
    gateway.expire(session);
    expect(await purchase(deps, 'u1', session)).toEqual({ status: 'expired', added: 0, tickets: 10 });
    await handlePayEvent(deps, done(session));
    expect(await tickets()).toBe(10);
    expect((await store.getPurchase(session))!.status).toBe('paid');
    const second = (await checkout(deps, 'u1', named, input())).session;
    await handlePayEvent(deps, { kind: 'expired', session: second });
    expect((await store.getPurchase(second))!.status).toBe('expired');
  });
  it('purchases の無い知らせは何もしない。別の uid の purchase は pay:other', async () => {
    await handlePayEvent(deps, done('cs_unknown'));
    await handlePayEvent(deps, { kind: 'disputed', session: 'cs_unknown' });
    await handlePayEvent(deps, { kind: 'other' });
    const session = await bought();
    await signIn(deps, 'u2');
    expect(await refusal(purchase(deps, 'u2', session))).toBe('refused:pay:other');
    expect(await refusal(purchase(deps, 'u1', 'cs_none'))).toBe('refused:pay:other');
    expect(await refusal(shopAck(deps, 'u2', session))).toBe('refused:pay:other');
  });
});

describe('払われたのに purchases が無いとき', () => {
  const meta = () => ({ uid: 'u1', pack: '10-300', tickets: 10, price: 300, expiresAt: addMonthsJst(clock, 6), createdAt: clock - 1000 });
  it('知らせの meta から purchases を作り直して足す（2 回めは足さない）', async () => {
    const event: PayEvent = { kind: 'completed', session: 'cs_lost', paid: true, paidAt: clock, meta: meta() };
    await handlePayEvent(deps, event);
    await handlePayEvent(deps, event);
    expect(await tickets()).toBe(10);
    expect(await store.getPurchase('cs_lost')).toMatchObject({ uid: 'u1', status: 'paid', tickets: 10, price: 300, adultAt: 0, agreedAt: 0 });
  });
  it('meta が合わない（枚数と値段が pack と違う・期限が作成より前）なら作らない', async () => {
    await handlePayEvent(deps, { kind: 'completed', session: 'cs_a', paid: true, paidAt: clock, meta: { ...meta(), tickets: 11 } });
    await handlePayEvent(deps, { kind: 'completed', session: 'cs_b', paid: true, paidAt: clock, meta: { ...meta(), expiresAt: clock - 2000 } });
    expect(await store.getPurchase('cs_a')).toBeNull();
    expect(await store.getPurchase('cs_b')).toBeNull();
    expect(await tickets()).toBe(0);
  });
  it('利用者がもういなくても、知らせは投げずに終わる', async () => {
    await handlePayEvent(deps, { kind: 'completed', session: 'cs_ghost', paid: true, paidAt: clock, meta: { ...meta(), uid: 'ghost' } });
  });
});

describe('取り戻す', () => {
  it('refunded（10 枚・3 枚使用・半額）→ 残り 2 枚。同じ知らせをもう 1 回 → 変わらない', async () => {
    const session = await bought();
    await handlePayEvent(deps, done(session));
    await store.charge('u1', 3, 'job', clock);
    const event: PayEvent = { kind: 'refunded', session, amount: 300, refunded: 150 };
    await handlePayEvent(deps, event);
    expect(await tickets()).toBe(2);
    await handlePayEvent(deps, event);
    expect(await tickets()).toBe(2);
    expect(rows(/^refund-paid:/)).toEqual([expect.objectContaining({ count: -5 })]);
    // 返金が増えたら、増えた分だけ（全額 = 目標 10、あと 5 枚ぶんだが、残りは 2 枚）
    await handlePayEvent(deps, { kind: 'refunded', session, amount: 300, refunded: 300 });
    expect(await tickets()).toBe(0);
    expect((await store.getPurchase(session))!.reclaimed).toBe(10);
  });
  it('refunded が completed より先 → 足してから引く（残り 5）', async () => {
    const session = (await checkout(deps, 'u1', named, input())).session;
    await handlePayEvent(deps, { kind: 'refunded', session, amount: 300, refunded: 150 });
    expect(await tickets()).toBe(5);
    await handlePayEvent(deps, done(session));
    expect(await tickets()).toBe(5);
  });
  it('disputed → その lot の残り 0（配った分は残る）', async () => {
    await store.addTickets('u1', 4, 'grant', clock);
    const session = await bought();
    await handlePayEvent(deps, done(session));
    await handlePayEvent(deps, { kind: 'disputed', session });
    expect((await store.getWallet('u1', clock)).lots[0].left).toBe(0);
    expect(await tickets()).toBe(4);
  });
});

describe('purchase の持ち主の確かめ', () => {
  it('Stripe 側の uid が呼んだ人と違えば pay:other（足さない）', async () => {
    const session = await bought();
    gateway.sessions.get(session)!.uid = 'u2';
    expect(await refusal(purchase(deps, 'u1', session))).toBe('refused:pay:other');
    expect(await tickets()).toBe(0);
  });
});

describe('shop', () => {
  it('open の条件（売る設定 か 管理者、gateway、パック）と announce・shopAck', async () => {
    expect(await shop(deps, 'u1')).toEqual({ open: true, packs: [{ id: '10-300', tickets: 10, price: 300 }, { id: '30-800', tickets: 30, price: 800 }], announce: [] });
    pay.salesOpen = false;
    expect((await shop(deps, 'u1')).open).toBe(false);
    deps.adminCodes.push((await store.getUser('u1'))!.userCode);
    expect((await shop(deps, 'u1')).open).toBe(true);
    pay.packs = [];
    expect((await shop(deps, 'u1')).open).toBe(false);
    pay.packs = parsePacks('10:300');
    delete deps.pay;
    expect(await shop(deps, 'u1')).toEqual({ open: false, packs: [], announce: [] });
    deps.pay = pay;
  });
  it('足された支払いが announce に出て、shopAck のあとは出ない', async () => {
    const session = await bought();
    expect((await shop(deps, 'u1')).announce).toEqual([]); // まだ足していない
    await handlePayEvent(deps, done(session));
    expect((await shop(deps, 'u1')).announce).toEqual([{ session, tickets: 10 }]);
    await shopAck(deps, 'u1', session);
    expect((await shop(deps, 'u1')).announce).toEqual([]);
  });
});

describe('ようこそ', () => {
  const signNamed = (uid: string) => handleCall(deps, uid, { op: 'signIn' }, named) as Promise<{ user: { free: number }; welcome?: number }>;
  it('名前のある signIn を 2 回 → free +3 は 1 回。返事の welcome は 1 回めだけ', async () => {
    pay.welcomeTickets = 3;
    const first = await signNamed('w1');
    expect(first).toMatchObject({ welcome: 3, user: { free: 3, tickets: 3 } });
    const second = await signNamed('w1');
    expect(second.welcome).toBeUndefined();
    expect(second.user.free).toBe(3);
    expect(rows(/^welcome$/)).toHaveLength(1);
  });
  it('0 枚の設定なら welcomed を書かない（あとで枚数を決めたら、配れる）。匿名には配らない', async () => {
    await signNamed('w1');
    expect((await store.getUser('w1'))!.welcomed).toBeUndefined();
    pay.welcomeTickets = 3;
    await handleCall(deps, 'w2', { op: 'signIn' }, anon);
    expect((await store.getUser('w2'))!.welcomed).toBeUndefined();
    expect((await store.getUser('w2'))!.tickets).toBe(0);
    expect((await signNamed('w1')).welcome).toBe(3);
  });
  it('配るのに失敗しても signIn は通る', async () => {
    pay.welcomeTickets = 3;
    store.markWelcome = async () => {
      throw new Error('store is down');
    };
    expect(await signNamed('w1')).toMatchObject({ user: { free: 0 } });
  });
});
