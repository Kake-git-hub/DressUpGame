/**
 * 支払いの口のにせもの（テストとエミュレーター用）。作った session を覚え、pay・expire で状態を変えられる。
 */
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
export interface FakeGateway extends PaymentGateway {
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
    parseEvent(body, signature) {
      if (signature !== 'fake') throw new Error('bad signature');
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
