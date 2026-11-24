/**
 * Firebase の口（AuthPort の本物）のテスト。Firebase の部品は、全部差し替える（通信は出ない）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
  const auth = { currentUser: null as null | { uid: string; providerData: { providerId: string; email: string | null }[] }, authStateReady: vi.fn(async () => undefined) };
  const credentialCalls: unknown[] = [];
  const customParams: unknown[] = [];
  const credentialFromError = vi.fn((error: unknown): unknown => ({ fake: 'stashed', from: error }));
  return {
    credentialFromError,
    auth,
    credentialCalls,
    customParams,
    initializeApp: vi.fn(() => ({})),
    getAuth: vi.fn(() => auth),
    signInAnonymously: vi.fn(async () => undefined),
    linkWithPopup: vi.fn(async () => undefined),
    signInWithPopup: vi.fn(async () => undefined),
    linkWithCredential: vi.fn(async () => undefined),
    signInWithCredential: vi.fn(async () => undefined),
    signOut: vi.fn(async () => undefined),
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => vi.fn(async () => ({ data: { ok: true } }))),
  };
});

vi.mock('firebase/app', () => ({ initializeApp: m.initializeApp }));
vi.mock('firebase/functions', () => ({ getFunctions: m.getFunctions, httpsCallable: m.httpsCallable }));
vi.mock('firebase/auth', () => ({
  getAuth: m.getAuth,
  signInAnonymously: m.signInAnonymously,
  linkWithPopup: m.linkWithPopup,
  signInWithPopup: m.signInWithPopup,
  linkWithCredential: m.linkWithCredential,
  signInWithCredential: m.signInWithCredential,
  signOut: m.signOut,
  GoogleAuthProvider: class {
    setCustomParameters(params: unknown) {
      m.customParams.push(params);
    }
  },
  OAuthProvider: class {
    providerId: string;
    constructor(providerId: string) {
      this.providerId = providerId;
    }
    static credentialFromError(error: unknown) {
      return m.credentialFromError(error);
    }
    credential(input: unknown) {
      m.credentialCalls.push([this.providerId, input]);
      return { fake: 'credential', input };
    }
  },
}));

import { createAuthPort, createFirebaseTransport, lookupClientId } from '../cloud/firebaseTransport';
import { GOOGLE_CLIENT_ID } from '../cloud/firebaseConfig';

const AUTH_URI = 'https://accounts.google.com/o/oauth2/auth?client_id=123-abc.apps.googleusercontent.com&x=1';
const jsonResponse = (body: unknown, status = 200) => ({ ok: status === 200, status, json: async () => body }) as unknown as Response;

beforeEach(() => {
  vi.clearAllMocks();
  m.credentialCalls.length = 0;
  m.customParams.length = 0;
  m.credentialFromError.mockImplementation((error: unknown) => ({ fake: 'stashed', from: error }));
  m.auth.currentUser = { uid: 'u1', providerData: [] };
});

describe('lookupClientId', () => {
  it('authUri の client_id を返す。呼ぶ URL と本体も決まっている', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ authUri: AUTH_URI }));
    const id = await lookupClientId(fetchImpl as unknown as typeof fetch, 'KEY', 'https://x.example/app/');
    expect(id).toBe('123-abc.apps.googleusercontent.com');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=KEY');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ providerId: 'google.com', continueUri: 'https://x.example/app/' });
  });
  it('200 でない・投げる・authUri が無い／URL でない → null', async () => {
    expect(await lookupClientId((async () => jsonResponse({ error: { message: 'OPERATION_NOT_ALLOWED' } }, 400)) as unknown as typeof fetch, 'K', 'u')).toBeNull();
    expect(await lookupClientId((async () => { throw new Error('net'); }) as unknown as typeof fetch, 'K', 'u')).toBeNull();
    expect(await lookupClientId((async () => jsonResponse({})) as unknown as typeof fetch, 'K', 'u')).toBeNull();
    expect(await lookupClientId((async () => jsonResponse({ authUri: 'not a url' })) as unknown as typeof fetch, 'K', 'u')).toBeNull();
    expect(await lookupClientId((async () => jsonResponse({ authUri: 'https://accounts.google.com/o/oauth2/auth?x=1' })) as unknown as typeof fetch, 'K', 'u')).toBeNull();
  });
});

describe('口の本物', () => {
  const portOf = async () => createFirebaseTransport({ appName: 'port-test' }).auth();

  it('popup(link) は、何も待たずに、その場で linkWithPopup を呼ぶ（窓を止められないため）', async () => {
    const port = await portOf();
    const pending = port.popup('link'); // await しない
    expect(m.linkWithPopup).toHaveBeenCalledTimes(1);
    expect(m.linkWithPopup.mock.calls[0]).toEqual([m.auth.currentUser, expect.anything()]);
    expect(m.customParams).toEqual([{ prompt: 'select_account' }]);
    await expect(pending).resolves.toBeUndefined();
  });
  it('popup(signin) は signInWithPopup。currentUser が無い link は、窓を開かずに失敗する（入るに化けない）', async () => {
    const port = await portOf();
    const pending = port.popup('signin');
    expect(m.signInWithPopup).toHaveBeenCalledTimes(1);
    expect((m.signInWithPopup.mock.calls as unknown[][])[0][0]).toBe(m.auth);
    await pending;
    m.auth.currentUser = null;
    const second = port.popup('link');
    await expect(second).rejects.toEqual({ code: 'auth/no-current-user' });
    expect(m.signInWithPopup).toHaveBeenCalledTimes(1);
    expect(m.linkWithPopup).not.toHaveBeenCalled();
  });
  it('popup の失敗は、Firebase のエラーのまま返る（code を段取りが読む）', async () => {
    const port = await portOf();
    m.linkWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    await expect(port.popup('link')).rejects.toMatchObject({ code: 'auth/popup-blocked' });
  });
  it('withToken は、証明と元の乱数から credential を作って、結び付ける／入る', async () => {
    const port = await portOf();
    await port.withToken('link', 't', 'n');
    expect(m.credentialCalls).toEqual([['google.com', { idToken: 't', rawNonce: 'n' }]]);
    expect(m.linkWithCredential).toHaveBeenCalledTimes(1);
    expect((m.linkWithCredential.mock.calls as unknown[][])[0][0]).toBe(m.auth.currentUser);
    await port.withToken('signin', 't2', 'n2');
    expect(m.signInWithCredential).toHaveBeenCalledTimes(1);
    expect((m.signInWithCredential.mock.calls as unknown[][])[0][0]).toBe(m.auth);
    m.auth.currentUser = null;
    await expect(port.withToken('link', 't3', 'n3')).rejects.toEqual({ code: 'auth/no-current-user' });
    expect(m.signInWithCredential).toHaveBeenCalledTimes(1);
    expect(m.linkWithCredential).toHaveBeenCalledTimes(1);
  });
  describe('signInWithStashed（「もう使われている」と断られたときの証明で入る）', () => {
    const taken = { code: 'auth/credential-already-in-use', customData: { email: 'a@example.com' } };

    it('結び付けが断られていなければ、false。signInWithCredential は呼ばない', async () => {
      const port = await portOf();
      expect(await port.signInWithStashed()).toBe(false);
      expect(m.signInWithCredential).not.toHaveBeenCalled();
    });
    it('popup(link) が credential-already-in-use で落ちたあと: 落とし方はそのまま、証明で入る。2 回めは false', async () => {
      const port = await portOf();
      m.linkWithPopup.mockRejectedValueOnce(taken);
      await expect(port.popup('link')).rejects.toBe(taken);
      expect(m.credentialFromError).toHaveBeenCalledWith(taken);
      expect(await port.signInWithStashed()).toBe(true);
      expect(m.signInWithCredential).toHaveBeenCalledTimes(1);
      expect(m.signInWithCredential.mock.calls[0]).toEqual([m.auth, { fake: 'stashed', from: taken }]);
      expect(await port.signInWithStashed()).toBe(false);
      expect(m.signInWithCredential).toHaveBeenCalledTimes(1);
    });
    it('withToken(link) が credential-already-in-use で落ちたあとも、同じ', async () => {
      const port = await portOf();
      m.linkWithCredential.mockRejectedValueOnce(taken);
      await expect(port.withToken('link', 't', 'n')).rejects.toBe(taken);
      expect(await port.signInWithStashed()).toBe(true);
      expect(m.signInWithCredential).toHaveBeenCalledTimes(1);
      expect(m.signInWithCredential.mock.calls[0]).toEqual([m.auth, { fake: 'stashed', from: taken }]);
    });
    it('ほかの失敗では、覚えない', async () => {
      const port = await portOf();
      m.linkWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
      await expect(port.popup('link')).rejects.toMatchObject({ code: 'auth/popup-blocked' });
      m.linkWithCredential.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
      await expect(port.withToken('link', 't', 'n')).rejects.toMatchObject({ code: 'auth/network-request-failed' });
      expect(m.credentialFromError).not.toHaveBeenCalled();
      expect(await port.signInWithStashed()).toBe(false);
    });
    it('signin の失敗では、覚えない（結び付けの断りだけ）', async () => {
      const port = await portOf();
      m.signInWithPopup.mockRejectedValueOnce(taken);
      await expect(port.popup('signin')).rejects.toBe(taken);
      expect(m.credentialFromError).not.toHaveBeenCalled();
      expect(await port.signInWithStashed()).toBe(false);
    });
    it('証明が返らなければ（credentialFromError が null）、false', async () => {
      const port = await portOf();
      m.credentialFromError.mockReturnValueOnce(null);
      m.linkWithPopup.mockRejectedValueOnce(taken);
      await expect(port.popup('link')).rejects.toBe(taken);
      expect(await port.signInWithStashed()).toBe(false);
      expect(m.signInWithCredential).not.toHaveBeenCalled();
    });
    it('証明を取る処理が投げても、元の失敗がそのまま返る', async () => {
      const port = await portOf();
      m.credentialFromError.mockImplementationOnce(() => {
        throw new Error('boom');
      });
      m.linkWithPopup.mockRejectedValueOnce(taken);
      await expect(port.popup('link')).rejects.toBe(taken);
      expect(await port.signInWithStashed()).toBe(false);
    });
    it('入れなければ（signInWithCredential が失敗）、投げる。覚えは捨てる', async () => {
      const port = await portOf();
      m.linkWithPopup.mockRejectedValueOnce(taken);
      await expect(port.popup('link')).rejects.toBe(taken);
      m.signInWithCredential.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
      await expect(port.signInWithStashed()).rejects.toMatchObject({ code: 'auth/network-request-failed' });
      expect(await port.signInWithStashed()).toBe(false);
    });
    it('新しく結び付けを始めたら、前の覚えは捨てる（古い証明で入らない）', async () => {
      const port = await portOf();
      m.linkWithPopup.mockRejectedValueOnce(taken);
      await expect(port.popup('link')).rejects.toBe(taken);
      await port.popup('link'); // 今度は成功
      expect(await port.signInWithStashed()).toBe(false);
    });
  });
  it('current は、providerData の Google を読む', async () => {
    const port = await portOf();
    expect(port.current()).toEqual({ kind: 'guest' });
    m.auth.currentUser = { uid: 'u1', providerData: [{ providerId: 'google.com', email: 'a@example.com' }] };
    expect(port.current()).toEqual({ kind: 'google', email: 'a@example.com' });
    m.auth.currentUser = { uid: 'u1', providerData: [{ providerId: 'google.com', email: null }] };
    expect(port.current()).toEqual({ kind: 'google', email: '' });
    m.auth.currentUser = null;
    expect(port.current()).toEqual({ kind: 'guest' });
  });
  it('signOut のあとの call() は、もう一度、匿名のログインをする', async () => {
    const transport = createFirebaseTransport({ appName: 'signout-test' });
    m.auth.currentUser = null;
    await transport.call({ op: 'signIn' });
    expect(m.signInAnonymously).toHaveBeenCalledTimes(1);
    const port = await transport.auth();
    await port.signOut();
    expect(m.signOut).toHaveBeenCalledTimes(1);
    m.auth.currentUser = null;
    await transport.call({ op: 'signIn' });
    expect(m.signInAnonymously).toHaveBeenCalledTimes(2);
  });
  it('clientId は、設定（GOOGLE_CLIENT_ID）の値。調べに行かない', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ authUri: AUTH_URI }));
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const port = await portOf();
      expect(await port.clientId()).toBe(GOOGLE_CLIENT_ID);
      expect(GOOGLE_CLIENT_ID).toBe('389373249780-na1putbqacl36ste99du074tm5hojb8d.apps.googleusercontent.com');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('設定の値が空なら、1 回だけ調べて覚える', async () => {
    const fetchSpy = vi.fn(async () => jsonResponse({ authUri: AUTH_URI }));
    const port = createAuthPort({ auth: m.auth as never, resetSignIn: () => undefined, fetchImpl: fetchSpy as unknown as typeof fetch, apiKey: 'K', clientId: '', continueUri: 'u' });
    expect(await port.clientId()).toBe('123-abc.apps.googleusercontent.com');
    expect(await port.clientId()).toBe('123-abc.apps.googleusercontent.com');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it('設定に client_id があれば、調べに行かない', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ authUri: AUTH_URI }));
    const port = createAuthPort({ auth: m.auth as never, resetSignIn: () => undefined, fetchImpl: fetchImpl as unknown as typeof fetch, apiKey: 'K', clientId: 'configured', continueUri: 'u' });
    expect(await port.clientId()).toBe('configured');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
