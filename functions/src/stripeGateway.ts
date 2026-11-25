/**
 * 支払いの口の本物（Stripe）。中身の決まりは tools/cloud/payment.ts の PaymentGateway。
 * 支払いの方法（カード・コンビニなど）は、Stripe の管理画面の既定に任せる（ここでは指定しない）。
 */
import Stripe from 'stripe';
import { BadSignatureError } from '../../tools/cloud/payment.ts';
import type { CheckoutInput, PayEvent, PaymentGateway } from '../../tools/cloud/payment.ts';
import { SESSION_MS } from '../../tools/cloud/payment.ts';

// Stripe の支払いページの期限は「作ってから 30 分より先」でなければならない。通信の分だけ余裕を足す
const MIN_SESSION_MS = SESSION_MS + 60_000;

const asInt = (value: unknown): number => (typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN);
const idOf = (value: string | { id: string } | null | undefined): string | null => (typeof value === 'string' ? value : (value?.id ?? null));

// 支払いページの metadata と代金から、買った中身を読む（支払いの記録が残っていないときの作り直し用）。読めなければ省く
function metaOf(session: Stripe.Checkout.Session): { uid: string; pack: string; tickets: number; price: number; expiresAt: number; createdAt: number } | undefined {
  const m = session.metadata ?? {};
  const meta = { uid: m.uid ?? '', pack: m.pack ?? '', tickets: asInt(m.tickets), price: session.amount_total ?? NaN, expiresAt: asInt(m.expiresAt), createdAt: asInt(m.createdAt) };
  return meta.uid && meta.pack && Number.isSafeInteger(meta.tickets) && Number.isSafeInteger(meta.price) && Number.isSafeInteger(meta.expiresAt) && Number.isSafeInteger(meta.createdAt) ? meta : undefined;
}

// client は、テストで差し替える用
export function createStripeGateway(secretKey: string, webhookSecret: string, client?: Stripe): PaymentGateway {
  const stripe = client ?? new Stripe(secretKey);

  // 返金・取り消しの知らせは payment_intent しか持たないので、支払いページを引く
  async function sessionOfIntent(intent: string | { id: string } | null | undefined): Promise<string | null> {
    const id = idOf(intent);
    if (!id) return null;
    const found = await stripe.checkout.sessions.list({ payment_intent: id, limit: 1 });
    return found.data[0]?.id ?? null;
  }

  return {
    async createCheckout(input: CheckoutInput) {
      const { uid, pack } = input;
      const now = Date.now();
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{ quantity: 1, price_data: { currency: 'jpy', unit_amount: pack.price, product_data: { name: `チケット ${pack.tickets} 枚（服 ${pack.tickets} 点ぶん）` } } }],
        client_reference_id: uid,
        metadata: { uid, pack: pack.id, tickets: String(pack.tickets), expiresAt: String(input.purchaseExpiresAt), createdAt: String(now) },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        expires_at: Math.ceil(Math.max(input.sessionExpiresAt, now + MIN_SESSION_MS) / 1000),
        locale: 'ja',
      });
      if (!session.url) throw new Error('Stripe が支払いページの URL を返しませんでした');
      return { id: session.id, url: session.url };
    },

    async getSession(id) {
      const s = await stripe.checkout.sessions.retrieve(id);
      return { id: s.id, paid: s.payment_status === 'paid', paidAt: null, expired: s.status === 'expired', uid: s.client_reference_id ?? s.metadata?.uid ?? null };
    },

    async parseEvent(body, signature): Promise<PayEvent> {
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
      } catch (error) {
        // 署名の確かめの失敗だけ BadSignatureError にする（このあとの Stripe への問い合わせの失敗は、そのまま投げる）
        throw new BadSignatureError(String(error));
      }
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded': {
          const s = event.data.object;
          const meta = metaOf(s);
          return { kind: 'completed', session: s.id, paid: s.payment_status === 'paid', paidAt: event.created * 1000, ...(meta ? { meta } : {}) };
        }
        case 'checkout.session.expired':
          return { kind: 'expired', session: event.data.object.id };
        case 'charge.refunded': {
          const c = event.data.object;
          const session = await sessionOfIntent(c.payment_intent);
          return session ? { kind: 'refunded', session, amount: c.amount, refunded: c.amount_refunded } : { kind: 'other' };
        }
        case 'charge.dispute.created': {
          const session = await sessionOfIntent(event.data.object.payment_intent);
          return session ? { kind: 'disputed', session } : { kind: 'other' };
        }
        default:
          return { kind: 'other' };
      }
    },
  };
}
