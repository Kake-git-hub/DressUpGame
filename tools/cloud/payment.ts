/**
 * 支払い（チケットを買う）のサーバー側の中身。Stripe とのやり取りは PaymentGateway の後ろ（本物は functions/src/stripeGateway.ts）。
 */
import type { PayRefusal, WirePurchase, WireShop } from '../../src/cloud/wire.ts';
import { CloudError } from './store.ts';
import { dayOf, signIn } from './studioCore.ts';
import type { CoreDeps } from './studioCore.ts';
import { addMonthsJst } from './wallet.ts';

export interface Pack {
  id: string; // `${tickets}-${price}`
  tickets: number;
  price: number; // 税込の円
}

export interface CheckoutInput {
  uid: string;
  pack: Pack;
  purchaseExpiresAt: number; // 買ったチケットの期限
  successUrl: string;
  cancelUrl: string;
  sessionExpiresAt: number; // 支払いページの期限
}
export interface PayMeta {
  uid: string;
  pack: string;
  tickets: number;
  price: number;
  expiresAt: number;
  createdAt: number;
}
export type PayEvent =
  // meta = 支払いページに入れておいた中身。purchases が無いときの作り直しに使う
  | { kind: 'completed'; session: string; paid: boolean; paidAt: number; meta?: PayMeta }
  | { kind: 'expired'; session: string }
  // amount = 元の代金（円）、refunded = 返金の累計（円）
  | { kind: 'refunded'; session: string; amount: number; refunded: number }
  | { kind: 'disputed'; session: string }
  | { kind: 'other' };

// 署名が合わない知らせ（hook は 400 を返す）。Stripe への問い合わせの失敗などは、これにしない（hook は 500 で、送り直させる）
export class BadSignatureError extends Error {
  constructor(message = 'bad signature') {
    super(message);
    this.name = 'BadSignatureError';
  }
}

// 知らせの片づき方。orphan / no-user は、払われたのにチケットを足せなかったので、作者が記録を見て手当てする
export type PayOutcome = 'ok' | 'orphan' | 'no-user';

export interface PaymentGateway {
  createCheckout(input: CheckoutInput): Promise<{ id: string; url: string }>;
  getSession(id: string): Promise<{ id: string; paid: boolean; paidAt: number | null; expired: boolean; uid: string | null }>;
  // 署名が違えば BadSignatureError を投げる（それ以外の失敗は、ふつうの Error）。返金・取り消しは、Stripe に聞いて session を引くので、非同期）
  parseEvent(body: Buffer, signature: string): Promise<PayEvent>;
}

export interface PayDeps {
  gateway: PaymentGateway | null;
  salesOpen: boolean;
  packs: Pack[];
  welcomeTickets: number;
  returnUrl: string;
  checkoutsPerDay: number;
}

export const MIN_PRICE = 50; // Stripe の最低額（円）
export const SESSION_MS = 30 * 60 * 1000;

// `10:300,30:800` → パック。正の整数で、値段は 50 円以上。壊れた項目は捨てる
export function parsePacks(text: string): Pack[] {
  const packs: Pack[] = [];
  for (const part of String(text ?? '').split(',')) {
    const m = /^\s*(\d+)\s*:\s*(\d+)\s*$/.exec(part);
    if (!m) continue;
    const tickets = Number(m[1]);
    const price = Number(m[2]);
    if (!Number.isSafeInteger(tickets) || !Number.isSafeInteger(price) || tickets <= 0 || price < MIN_PRICE) continue;
    const id = `${tickets}-${price}`;
    if (!packs.some((p) => p.id === id)) packs.push({ id, tickets, price });
  }
  return packs;
}

const MESSAGES: Record<PayRefusal, string> = {
  login: 'Google でログインすると、チケットを買えます',
  closed: 'いまは、チケットを買えません',
  pack: 'このパックは、いまは買えません',
  limit: '今日は、お支払いを始められる回数の上限に達しました。あした、もう一度ためしてください',
  other: 'この支払いは、あなたのものではありません',
};
// 断る。message の先頭の `pay:{理由}` を、アプリが見分ける
const refuse = (reason: PayRefusal) => new CloudError('refused', `pay:${reason} ${MESSAGES[reason]}`);

const isOpen = (pay: PayDeps | undefined, admin: boolean): pay is PayDeps => !!pay && (pay.salesOpen || admin) && pay.gateway !== null && pay.packs.length > 0;

export async function shop(deps: CoreDeps, uid: string): Promise<WireShop> {
  const user = await signIn(deps, uid);
  const open = isOpen(deps.pay, user.admin);
  const unannounced = await deps.store.listUnannounced(uid);
  return {
    open,
    packs: open ? deps.pay!.packs.map((p) => ({ id: p.id, tickets: p.tickets, price: p.price })) : [],
    announce: unannounced.map((p) => ({ session: p.id, tickets: p.tickets })),
  };
}

export async function checkout(
  deps: CoreDeps,
  uid: string,
  caller: { anonymous: boolean },
  input: { pack: string; adultAt: number; agreedAt: number },
): Promise<{ session: string; url: string; expiresAt: number }> {
  if (caller.anonymous) throw refuse('login');
  const user = await signIn(deps, uid);
  const pay = deps.pay;
  if (!isOpen(pay, user.admin)) throw refuse('closed');
  const gateway = pay.gateway!;
  const pack = pay.packs.find((p) => p.id === input.pack);
  if (!pack) throw refuse('pack');
  const now = deps.now();
  try {
    await deps.store.countCheckout(uid, dayOf(now), pay.checkoutsPerDay);
  } catch (e) {
    if (e instanceof CloudError && e.code === 'limit') throw refuse('limit');
    throw e;
  }
  const expiresAt = addMonthsJst(now, 6);
  const made = await gateway.createCheckout({
    uid,
    pack,
    purchaseExpiresAt: expiresAt,
    successUrl: `${pay.returnUrl}?pay=done&session={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${pay.returnUrl}?pay=cancel`,
    sessionExpiresAt: now + SESSION_MS,
  });
  await deps.store.putPurchase({
    id: made.id,
    uid,
    pack: pack.id,
    tickets: pack.tickets,
    price: pack.price,
    status: 'open',
    createdAt: now,
    expiresAt,
    adultAt: input.adultAt,
    agreedAt: input.agreedAt,
  });
  return { session: made.id, url: made.url, expiresAt };
}

// 支払い済みにして、財布に足す（知らせと、アプリの聞き直しの、どちらが先でも 1 回だけ）
export async function fulfill(deps: CoreDeps, session: string, paidAt: number): Promise<number> {
  const done = await deps.store.fulfillPurchase(session, paidAt, deps.now());
  return done?.added ?? 0;
}

export async function purchase(deps: CoreDeps, uid: string, session: string): Promise<WirePurchase> {
  await signIn(deps, uid);
  let p = await deps.store.getPurchase(session);
  if (!p || p.uid !== uid) throw refuse('other');
  let added = 0;
  const gateway = deps.pay?.gateway;
  if (p.status === 'open' && gateway) {
    const asked = await gateway.getSession(session);
    if (asked.uid !== uid) throw refuse('other'); // 念のため: Stripe 側の持ち主も確かめる
    if (asked.paid) added = await fulfill(deps, session, asked.paidAt ?? deps.now());
    else if (asked.expired) await deps.store.expirePurchase(session);
    p = (await deps.store.getPurchase(session)) ?? p;
  }
  return { status: p.status, added, tickets: p.tickets };
}

export async function shopAck(deps: CoreDeps, uid: string, session: string): Promise<void> {
  const p = await deps.store.getPurchase(session);
  if (!p || p.uid !== uid) throw refuse('other');
  await deps.store.markAnnounced(session);
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

// 払われたのに purchases が無い（作る途中で書き損ねた）とき、支払いページに入れておいた中身から作り直す。中身が合わなければ作らない
async function restore(deps: CoreDeps, session: string, meta: PayMeta | undefined): Promise<void> {
  if (!meta || (await deps.store.getPurchase(session))) return;
  const ok = meta.uid && positive(meta.tickets) && positive(meta.price) && positive(meta.createdAt) && meta.expiresAt > meta.createdAt && meta.pack === `${meta.tickets}-${meta.price}`;
  if (!ok) return;
  await deps.store.putPurchase({ id: session, uid: meta.uid, pack: meta.pack, tickets: meta.tickets, price: meta.price, status: 'open', createdAt: meta.createdAt, expiresAt: meta.expiresAt, adultAt: 0, agreedAt: 0 });
}

// 知らせを 1 つ片づける。利用者がもういない（refused）ときは、足しようが無いので投げずに 'no-user' を返す（呼び直させない）
export async function handlePayEvent(deps: CoreDeps, event: PayEvent): Promise<PayOutcome> {
  try {
    return await handle(deps, event);
  } catch (e) {
    if (e instanceof CloudError && e.code === 'refused') return 'no-user';
    throw e;
  }
}

async function handle(deps: CoreDeps, event: PayEvent): Promise<PayOutcome> {
  switch (event.kind) {
    case 'completed':
      if (event.paid) {
        await restore(deps, event.session, event.meta);
        // 払われたのに purchases が無く、作り直せもしない
        if (!(await deps.store.getPurchase(event.session))) return 'orphan';
        await fulfill(deps, event.session, event.paidAt);
      }
      return 'ok';
    case 'expired':
      await deps.store.expirePurchase(event.session);
      return 'ok';
    case 'refunded':
    case 'disputed': {
      const p = await deps.store.getPurchase(event.session);
      if (!p) return 'ok';
      // 知らせの順が入れ替わったときは、先に足してから引く
      if (p.status !== 'paid') await fulfill(deps, event.session, deps.now());
      const target =
        event.kind === 'disputed' ? p.tickets : event.amount > 0 ? Math.min(p.tickets, Math.ceil((p.tickets * event.refunded) / event.amount)) : 0;
      await deps.store.reclaimPurchase(event.session, target, deps.now());
      return 'ok';
    }
    default:
      return 'ok';
  }
}

// ようこそ: 設定の枚数を、最初のログインで 1 回だけ配る（0 枚の設定のあいだは、何も書かない）。配った枚数
export async function welcome(deps: CoreDeps, uid: string): Promise<number> {
  const n = deps.pay?.welcomeTickets ?? 0;
  if (!(n > 0)) return 0;
  return deps.store.markWelcome(uid, n, deps.now());
}
