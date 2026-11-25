// @vitest-environment node
// Stripe とのやり取りの中身を、通信なしで確かめる（Stripe の部品の checkout.sessions だけ、にせものに差し替える）
import Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { BadSignatureError } from '../../tools/cloud/payment.ts';
import type { PayEvent } from '../../tools/cloud/payment.ts';
import { createStripeGateway } from './stripeGateway.ts';

const SECRET = 'whsec_unit';
const stripe = new Stripe('sk_test_unit');
const create = vi.fn();
const list = vi.fn();
const retrieve = vi.fn();
Object.assign(stripe.checkout.sessions, { create, list, retrieve });
const gateway = createStripeGateway('sk_test_unit', SECRET, stripe);

const CREATED = 1_800_000_000;
const send = async (type: string, object: unknown, secret = SECRET): Promise<PayEvent> => {
  const payload = JSON.stringify({ id: 'evt_1', object: 'event', type, created: CREATED, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return gateway.parseEvent(Buffer.from(payload), header);
};
const meta = { uid: 'u1', pack: '10-300', tickets: '10', expiresAt: '2000000000000', createdAt: '1799999000000' };
const session = (extra: object = {}) => ({ id: 'cs_1', object: 'checkout.session', payment_status: 'paid', amount_total: 300, metadata: meta, ...extra });

describe('parseEvent', () => {
  it('completed（支払い済み）→ paid と meta。paidAt は知らせの時刻', async () => {
    expect(await send('checkout.session.completed', session())).toEqual({
      kind: 'completed',
      session: 'cs_1',
      paid: true,
      paidAt: CREATED * 1000,
      meta: { uid: 'u1', pack: '10-300', tickets: 10, price: 300, expiresAt: 2000000000000, createdAt: 1799999000000 },
    });
  });
  it('completed でも未払い（コンビニ払いの待ち）→ paid false', async () => {
    expect(await send('checkout.session.completed', session({ payment_status: 'unpaid' }))).toMatchObject({ kind: 'completed', paid: false });
  });
  it('async_payment_succeeded → completed', async () => {
    expect(await send('checkout.session.async_payment_succeeded', session())).toMatchObject({ kind: 'completed', session: 'cs_1', paid: true });
  });
  it('metadata が読めない（数でない・足りない・値段が無い）→ meta を付けない', async () => {
    for (const bad of [{ ...meta, tickets: 'x' }, { ...meta, uid: '' }, { ...meta, expiresAt: '1.5' }, {}]) {
      expect(await send('checkout.session.completed', session({ metadata: bad }))).not.toHaveProperty('meta');
    }
    expect(await send('checkout.session.completed', session({ amount_total: null }))).not.toHaveProperty('meta');
  });
  it('expired → expired', async () => {
    expect(await send('checkout.session.expired', session({ payment_status: 'unpaid' }))).toEqual({ kind: 'expired', session: 'cs_1' });
  });
  it('charge.refunded → payment_intent から session を引いて、代金と返金の累計を渡す', async () => {
    list.mockResolvedValueOnce({ data: [{ id: 'cs_9' }] });
    expect(await send('charge.refunded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_1', amount: 300, amount_refunded: 150 })).toEqual({ kind: 'refunded', session: 'cs_9', amount: 300, refunded: 150 });
    expect(list).toHaveBeenLastCalledWith({ payment_intent: 'pi_1', limit: 1 });
  });
  it('charge.dispute.created → disputed（payment_intent が object でも引ける）。見つからなければ other', async () => {
    list.mockResolvedValueOnce({ data: [{ id: 'cs_9' }] });
    expect(await send('charge.dispute.created', { id: 'dp_1', object: 'dispute', payment_intent: { id: 'pi_2' } })).toEqual({ kind: 'disputed', session: 'cs_9' });
    expect(list).toHaveBeenLastCalledWith({ payment_intent: 'pi_2', limit: 1 });
    list.mockResolvedValueOnce({ data: [] });
    expect(await send('charge.refunded', { id: 'ch_2', object: 'charge', payment_intent: 'pi_3', amount: 300, amount_refunded: 300 })).toEqual({ kind: 'other' });
    expect(await send('charge.dispute.created', { id: 'dp_2', object: 'dispute', payment_intent: null })).toEqual({ kind: 'other' });
  });
  it('そのほかの種類 → other', async () => {
    expect(await send('customer.created', { id: 'cus_1', object: 'customer' })).toEqual({ kind: 'other' });
  });
  it('署名が違う・無い → BadSignatureError。問い合わせの失敗は、そのまま（BadSignatureError ではない）', async () => {
    await expect(send('checkout.session.completed', session(), 'whsec_other')).rejects.toBeInstanceOf(BadSignatureError);
    await expect(gateway.parseEvent(Buffer.from('{}'), '')).rejects.toBeInstanceOf(BadSignatureError);
    list.mockRejectedValueOnce(new Error('network down'));
    const failure = await send('charge.refunded', { id: 'ch_3', object: 'charge', payment_intent: 'pi_4', amount: 300, amount_refunded: 300 }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(BadSignatureError);
  });
});

describe('createCheckout / getSession', () => {
  it('Checkout Session の作り方（円・名前・持ち主・metadata・期限は秒）', async () => {
    create.mockResolvedValueOnce({ id: 'cs_new', url: 'https://checkout.stripe.test/cs_new' });
    const now = Date.now();
    const made = await gateway.createCheckout({
      uid: 'u1',
      pack: { id: '10-300', tickets: 10, price: 300 },
      purchaseExpiresAt: 2000000000000,
      successUrl: 'https://app.test/?pay=done&session={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://app.test/?pay=cancel',
      sessionExpiresAt: now + 30 * 60 * 1000,
    });
    expect(made).toEqual({ id: 'cs_new', url: 'https://checkout.stripe.test/cs_new' });
    const params = create.mock.calls[0][0];
    expect(params).toMatchObject({
      mode: 'payment',
      line_items: [{ quantity: 1, price_data: { currency: 'jpy', unit_amount: 300, product_data: { name: 'チケット 10 枚（服 10 点ぶん）' } } }],
      client_reference_id: 'u1',
      metadata: { uid: 'u1', pack: '10-300', tickets: '10', expiresAt: '2000000000000' },
      success_url: 'https://app.test/?pay=done&session={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://app.test/?pay=cancel',
      locale: 'ja',
    });
    expect(params).not.toHaveProperty('payment_method_types');
    expect(Number(params.metadata.createdAt)).toBeGreaterThanOrEqual(now);
    // 作ってから 30 分より先（通信の分の余裕を足す）で、秒の単位
    expect(params.expires_at).toBeGreaterThanOrEqual(Math.floor(now / 1000) + 31 * 60);
    expect(Number.isInteger(params.expires_at)).toBe(true);
  });
  it('URL が無い返事は失敗にする', async () => {
    create.mockResolvedValueOnce({ id: 'cs_x', url: null });
    await expect(gateway.createCheckout({ uid: 'u1', pack: { id: '10-300', tickets: 10, price: 300 }, purchaseExpiresAt: 1, successUrl: 'a', cancelUrl: 'b', sessionExpiresAt: Date.now() })).rejects.toThrow();
  });
  it('getSession: paid・expired・持ち主（client_reference_id、無ければ metadata.uid）', async () => {
    retrieve.mockResolvedValueOnce({ id: 'cs_1', payment_status: 'paid', status: 'complete', client_reference_id: 'u1', metadata: {} });
    expect(await gateway.getSession('cs_1')).toEqual({ id: 'cs_1', paid: true, paidAt: null, expired: false, uid: 'u1' });
    retrieve.mockResolvedValueOnce({ id: 'cs_2', payment_status: 'unpaid', status: 'expired', client_reference_id: null, metadata: { uid: 'u2' } });
    expect(await gateway.getSession('cs_2')).toEqual({ id: 'cs_2', paid: false, paidAt: null, expired: true, uid: 'u2' });
  });
});
