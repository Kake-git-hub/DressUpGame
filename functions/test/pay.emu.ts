/**
 * 支払いの知らせの関数 stripeHook を、エミュレーターで確かめる（本物の Stripe には通信しない）。
 * エミュレーターでは STUDIO_TEST_FAKE_PAY=1 で、にせの口になる。署名は、にせの鍵 whsec_test の HMAC（tools/cloud/fakeGateway.ts）。
 */
import { deleteApp, initializeApp as initializeAdmin } from 'firebase-admin/app';
import type { App as AdminApp } from 'firebase-admin/app';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { deleteApp as deleteClient, initializeApp } from 'firebase/app';
import type { FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeGateway } from '../../tools/cloud/fakeGateway.ts';
import type { PayEvent } from '../../tools/cloud/payment.ts';
import type { UserView } from '../../tools/cloud/studioCore.ts';
import { PROJECT } from './ports.mjs';

const REGION = 'asia-northeast1';
const HOOK = `http://127.0.0.1:5001/${PROJECT}/${REGION}/stripeHook`;
const signer = createFakeGateway();
let admin: AdminApp;
let app: FirebaseApp;
let uid: string;
let call: (data: unknown) => Promise<unknown>;

const tickets = async () => ((await call({ op: 'signIn' })) as { user: UserView }).user.tickets;
const post = (body: string, signature = signer.sign(body)) => fetch(HOOK, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body });
const completed = (session: string): PayEvent => ({ kind: 'completed', session, paid: true, paidAt: Date.now() });
const open = (session: string) =>
  getAdminFirestore(admin).doc(`purchases/${session}`).set({ id: session, uid, pack: '10-300', tickets: 10, price: 300, status: 'open', createdAt: Date.now(), expiresAt: Date.now() + 86_400_000, adultAt: 1, agreedAt: 1 });

beforeAll(async () => {
  admin = initializeAdmin({ projectId: PROJECT }, `pay-admin-${Date.now()}`);
  app = initializeApp({ projectId: PROJECT, apiKey: 'fake-api-key' }, `pay-client-${Date.now()}`);
  const auth = getAuth(app);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const functions = getFunctions(app, REGION);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  uid = (await signInAnonymously(auth)).user.uid;
  const studio = httpsCallable(functions, 'studio');
  call = async (data) => (await studio(data)).data;
  await call({ op: 'signIn' });
});
afterAll(async () => {
  await deleteClient(app);
  await deleteApp(admin);
});

describe('stripeHook（エミュレーター）', () => {
  it('正しい署名の completed → チケットが増える。同じ本文をもう 1 回 → 増えない', async () => {
    await open('cs_hook_1');
    expect(await tickets()).toBe(0);
    const body = JSON.stringify(completed('cs_hook_1'));
    expect((await post(body)).status).toBe(200);
    expect(await tickets()).toBe(10);
    expect((await post(body)).status).toBe(200);
    expect(await tickets()).toBe(10);
  });
  it('署名が違う・無い → 400 で、増えない', async () => {
    await open('cs_hook_2');
    const body = JSON.stringify(completed('cs_hook_2'));
    expect((await post(body, 'deadbeef')).status).toBe(400);
    expect((await post(body, '')).status).toBe(400);
    expect(await tickets()).toBe(10);
  });
  it('署名が正しくても、本文を書き換えたら 400', async () => {
    await open('cs_hook_3');
    const signature = signer.sign(JSON.stringify(completed('cs_hook_3')));
    expect((await post(JSON.stringify(completed('cs_hook_other')), signature)).status).toBe(400);
    expect(await tickets()).toBe(10);
  });
  it('POST 以外は 405', async () => {
    expect((await fetch(HOOK)).status).toBe(405);
  });
});
