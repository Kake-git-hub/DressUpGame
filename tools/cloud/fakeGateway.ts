/**
 * 支払いの口のにせもの（テストとエミュレーター用）。作った session を覚え、pay・expire で状態を変えられる。
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PayEvent, PaymentGateway } from './payment.ts';

export interface FakeSession {
  id: string;
  uid: string;
  tickets: number;
  price: number;
  successUrl: string;
  cancelUrl: string;
  paid: boolean;
  paidAt: number | null;
  expired: boolean;
}
// にせの署名の鍵。署名は、本文の HMAC-SHA256（16 進）をそのまま stripe-signature の値にする（Stripe の `t=…,v1=…` の形は、まねない）
export const FAKE_WEBHOOK_SECRET = 'whsec_test';
const signBody = (body: string) => createHmac('sha256', FAKE_WEBHOOK_SECRET).update(body).digest('hex');

export interface FakeGateway extends PaymentGateway {
  // 知らせの本文（JSON の文字列）に付ける署名
  sign(body: string): string;
  readonly sessions: Map<string, FakeSession>;
  pay(id: string, paidAt: number): void;
  expire(id: string): void;
}

export function createFakeGateway(): FakeGateway {
  const sessions = new Map<string, FakeSession>();
  let n = 0;
  const must = (id: string): FakeSession => {
    const s = sessions.get(id);
    if (!s) throw new Error(`no such session: ${id}`);
    return s;
  };
  return {
    sessions,
    async createCheckout(input) {
      const id = `cs_fake_${++n}`;
      sessions.set(id, { id, uid: input.uid, tickets: input.pack.tickets, price: input.pack.price, successUrl: input.successUrl, cancelUrl: input.cancelUrl, paid: false, paidAt: null, expired: false });
      return { id, url: `https://pay.test/${id}` };
    },
    async getSession(id) {
      const s = sessions.get(id);
      return s ? { id, paid: s.paid, paidAt: s.paidAt, expired: s.expired, uid: s.uid } : { id, paid: false, paidAt: null, expired: true, uid: null };
    },
    sign: signBody,
    async parseEvent(body, signature) {
      const want = Buffer.from(signBody(body.toString('utf8')));
      const got = Buffer.from(signature);
      if (want.length !== got.length || !timingSafeEqual(want, got)) throw new Error('bad signature');
      return JSON.parse(body.toString('utf8')) as PayEvent;
    },
    pay(id, paidAt) {
      const s = must(id);
      s.paid = true;
      s.paidAt = paidAt;
    },
    expire(id) {
      must(id).expired = true;
    },
  };
}
