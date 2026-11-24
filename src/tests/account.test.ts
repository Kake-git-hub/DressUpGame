/**
 * ログインの段取り（account.ts）のテスト。Firebase の口（AuthPort）は偽物、端末の置き場はメモリの中。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '../cloud/backend';
import type { MyItem, StudioBackend } from '../cloud/backend';
import {
  completeRedirect,
  createAccount,
  deviceEmpty,
  forgetAccount,
  LOGIN_MESSAGES,
  noAccount,
  NOTICE_KEY,
  outcomeOf,
  takeNotice,
} from '../cloud/account';
import type { AccountEnv, AuthPort, LoginOutcome, LoginResult } from '../cloud/account';
import { hasReturn, PENDING_KEY, RETURN_KEY, savePending, sha256Hex } from '../cloud/googleRedirect';
import type { LoginIntent } from '../cloud/googleRedirect';
import type { Library } from '../cloud/library';
import { ACKED_KEY, NEW_KEY } from '../cloud/session';

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}
const b64url = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (payload: unknown) => `h.${b64url(JSON.stringify(payload))}.s`;
const deferred = <T = void>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
};

// きろくに、メールアドレスや証明・state・nonce が入っていないことを、どのテストでも確かめる
let lines: string[] = [];
let secrets: string[] = [];
beforeEach(() => {
  lines = [];
  secrets = [];
});
afterEach(() => {
  const all = lines.join('\n');
  expect(all).not.toContain('@');
  for (const secret of secrets) expect(all).not.toContain(secret);
});

function fakePort() {
  return {
    current: vi.fn((): ReturnType<AuthPort['current']> => ({ kind: 'guest' })),
    popup: vi.fn<AuthPort['popup']>(async () => undefined),
    withToken: vi.fn<AuthPort['withToken']>(async () => undefined),
    signInWithStashed: vi.fn<AuthPort['signInWithStashed']>(async () => true),
    signOut: vi.fn(async (): Promise<void> => undefined),
    clientId: vi.fn(async (): Promise<string | null> => 'client-1.apps.googleusercontent.com'),
  };
}
function setup() {
  const session = memoryStore();
  const local = memoryStore();
  const goTo = vi.fn();
  let t = 1_000_000;
  const env: AccountEnv = { redirectUri: 'https://x.example/app/', goTo, session, local, now: () => t, note: (...parts) => void lines.push(parts.join(' ')) };
  const port = fakePort();
  const makePort = vi.fn(async () => port as AuthPort);
  const account = createAccount(makePort, env);
  return { account, port, makePort, env, session, local, goTo, advance: (ms: number) => (t += ms) };
}
// Google から戻って来た状態を作る（覚え + 戻りの中身）
async function plantReturn(s: ReturnType<typeof setup>, over: { intent?: LoginIntent; state?: string; returnState?: string; at?: number; error?: string; nonce?: string; step?: 'silent' | 'chooser'; sub?: string } = {}) {
  const rawNonce = 'raw-nonce-secret-0123456789abcdef';
  const state = over.state ?? 'state-secret-123';
  const idToken = jwt({ nonce: over.nonce ?? (await sha256Hex(rawNonce)), email: 'a@example.com', ...(over.sub ? { sub: over.sub } : {}) });
  secrets.push(rawNonce, state, idToken);
  if (over.at !== -1) savePending(s.local, { state, rawNonce, intent: over.intent ?? 'link', at: over.at ?? s.env.now(), ...(over.step ? { step: over.step } : {}) });
  s.session.setItem(RETURN_KEY, JSON.stringify(over.error ? { state: over.returnState ?? state, error: over.error } : { state: over.returnState ?? state, idToken }));
  return { rawNonce, idToken, state };
}

describe('outcomeOf（結果の分け方）', () => {
  const table: Array<[string, LoginOutcome]> = [
    ['auth/credential-already-in-use', 'taken'],
    ['auth/email-already-in-use', 'taken'],
    ['auth/popup-closed-by-user', 'cancelled'],
    ['auth/cancelled-popup-request', 'cancelled'],
    ['auth/user-cancelled', 'cancelled'],
    ['auth/operation-not-allowed', 'not-ready'],
    ['auth/unauthorized-domain', 'not-ready'],
    ['auth/configuration-not-found', 'not-ready'],
    ['auth/admin-restricted-operation', 'not-ready'],
    ['auth/popup-blocked', 'no-popup'],
    ['auth/operation-not-supported-in-this-environment', 'no-popup'],
    ['auth/web-storage-unsupported', 'no-popup'],
    ['auth/network-request-failed', 'failed'],
  ];
  it.each(table)('%s → %s', (code, outcome) => {
    expect(outcomeOf({ code })).toEqual({ outcome, code });
  });
  it('メールアドレスは、結果のどこにも出ない', () => {
    const result = outcomeOf({ code: 'auth/credential-already-in-use', customData: { email: 'a@example.com' }, message: '… a@example.com …' });
    expect(result).toEqual({ outcome: 'taken', code: 'auth/credential-already-in-use' });
    expect(JSON.stringify(result)).not.toContain('@');
  });
  it('code が無い・auth/ でないものは failed（code 無し）', () => {
    expect(outcomeOf(new Error('x'))).toEqual({ outcome: 'failed' });
    expect(outcomeOf(null)).toEqual({ outcome: 'failed' });
    expect(outcomeOf({ code: 123 })).toEqual({ outcome: 'failed' });
    expect(outcomeOf({ code: 'storage/x' })).toEqual({ outcome: 'failed' });
  });
});

describe('prepare・logout', () => {
  it('prepare は、いまの利用者を返す。失敗は、そのまま投げる（次に、もう一度できる）', async () => {
    const s = setup();
    s.port.current.mockReturnValue({ kind: 'google', email: 'a@example.com' });
    expect(await s.account.prepare()).toEqual({ kind: 'google', email: 'a@example.com' });
    const failing = vi.fn().mockRejectedValueOnce(new BackendError('offline', 'つながりません')).mockResolvedValue(fakePort());
    const account = createAccount(failing, s.env);
    await expect(account.prepare()).rejects.toBeInstanceOf(BackendError);
    expect(await account.prepare()).toEqual({ kind: 'guest' });
  });
  it('logout は signOut だけ。きろくに out を残す', async () => {
    const s = setup();
    await s.account.logout();
    expect(s.port.signOut).toHaveBeenCalledTimes(1);
    expect(lines).toContain('out');
  });
  it('logout が失敗したら、投げる（きろくに out は残らない）', async () => {
    const s = setup();
    s.port.signOut.mockRejectedValue({ code: 'auth/network-request-failed' });
    await expect(s.account.logout()).rejects.toBeTruthy();
    expect(lines).not.toContain('out');
  });
  it('noAccount は、何もしない仮のもの', async () => {
    expect(await noAccount.prepare()).toEqual({ kind: 'guest' });
    expect(await noAccount.canRedirect()).toBe(false);
    expect(await noAccount.loginWithPopup('link')).toEqual({ outcome: 'not-ready' });
    expect(await noAccount.startRedirect('link')).toEqual({ outcome: 'not-ready' });
    expect(await noAccount.startRedirect('signin', { step: 'silent', hint: 'h' })).toEqual({ outcome: 'not-ready' });
    expect(await noAccount.signInWithStashed()).toBe(false);
    expect(await noAccount.finishRedirect(async (i) => i)).toBeNull();
    await expect(noAccount.logout()).resolves.toBeUndefined();
  });
});

describe('loginWithPopup（方法 1）', () => {
  it('prepare の前は not-ready で、窓は開かない', async () => {
    const s = setup();
    expect(await s.account.loginWithPopup('link')).toEqual({ outcome: 'not-ready' });
    expect(s.port.popup).not.toHaveBeenCalled();
  });
  it('呼んだ、その場で（何も待たずに）窓を開く', async () => {
    const s = setup();
    await s.account.prepare();
    const pending = s.account.loginWithPopup('link');
    expect(s.port.popup).toHaveBeenCalledTimes(1);
    expect(s.port.popup).toHaveBeenCalledWith('link');
    expect(await pending).toEqual({ outcome: 'linked' });
    expect(lines).toEqual(['start popup', 'result linked']);
  });
  it('入る（signin）の成功は switched', async () => {
    const s = setup();
    await s.account.prepare();
    expect(await s.account.loginWithPopup('signin')).toEqual({ outcome: 'switched' });
  });
  it('窓が開かなかった・もう使われている、は結果の文字と code をきろくに残す', async () => {
    const s = setup();
    await s.account.prepare();
    s.port.popup.mockRejectedValueOnce({ code: 'auth/popup-blocked', customData: { email: 'a@example.com' } });
    expect(await s.account.loginWithPopup('link')).toEqual({ outcome: 'no-popup', code: 'auth/popup-blocked' });
    s.port.popup.mockRejectedValueOnce({ code: 'auth/credential-already-in-use', customData: { email: 'a@example.com' } });
    expect((await s.account.loginWithPopup('link')).outcome).toBe('taken');
    expect(lines).toContain('result no-popup code=auth/popup-blocked');
    expect(lines).toContain('result taken code=auth/credential-already-in-use');
  });
  it('同期で投げられても、結果にする', async () => {
    const s = setup();
    await s.account.prepare();
    s.port.popup.mockImplementationOnce(() => {
      throw { code: 'auth/operation-not-supported-in-this-environment' };
    });
    expect((await s.account.loginWithPopup('link')).outcome).toBe('no-popup');
  });
  it('1 回めが終わる前の 2 回めは、窓を開き直さず、同じ結果を返す', async () => {
    const s = setup();
    await s.account.prepare();
    const gate = deferred();
    s.port.popup.mockReturnValueOnce(gate.promise);
    const first = s.account.loginWithPopup('link');
    const second = s.account.loginWithPopup('link');
    gate.resolve();
    expect(await first).toEqual({ outcome: 'linked' });
    expect(await second).toEqual({ outcome: 'linked' });
    expect(s.port.popup).toHaveBeenCalledTimes(1);
    // 終わったあとは、また開ける
    await s.account.loginWithPopup('link');
    expect(s.port.popup).toHaveBeenCalledTimes(2);
  });
});

describe('startRedirect（方法 2 の行き）', () => {
  it('client_id が分からなければ not-ready。移らず、覚えも書かない', async () => {
    const s = setup();
    s.port.clientId.mockResolvedValue(null);
    expect(await s.account.canRedirect()).toBe(false);
    expect(await s.account.startRedirect('link')).toEqual({ outcome: 'not-ready' });
    expect(s.goTo).not.toHaveBeenCalled();
    expect(s.local.data.has(PENDING_KEY)).toBe(false);
    expect(lines).toContain('result not-ready');
  });
  it('分かれば、覚えを書いて Google へ移る（返らない）', async () => {
    const s = setup();
    expect(await s.account.canRedirect()).toBe(true);
    void s.account.startRedirect('signin');
    await vi.waitFor(() => expect(s.goTo).toHaveBeenCalledTimes(1));
    const pending = JSON.parse(s.local.data.get(PENDING_KEY)!) as { state: string; rawNonce: string; intent: string; at: number };
    secrets.push(pending.state, pending.rawNonce);
    expect(pending.intent).toBe('signin');
    expect(pending.at).toBe(s.env.now());
    const url = new URL(s.goTo.mock.calls[0][0] as string);
    expect(url.searchParams.get('state')).toBe(pending.state);
    expect(url.searchParams.get('nonce')).toBe(await sha256Hex(pending.rawNonce));
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.example/app/');
    expect(url.searchParams.get('client_id')).toBe('client-1.apps.googleusercontent.com');
    expect(lines).toContain('start redirect');
  });
  it('移る処理が投げたら、failed で返る', async () => {
    const s = setup();
    s.goTo.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect((await s.account.startRedirect('link')).outcome).toBe('failed');
  });
  it('戻るボタンで戻って来たら（bfcache）、待ちを解いて cancelled。覚えを消し、もう一度押せる', async () => {
    const s = setup();
    let restored: () => void = () => undefined;
    s.env.onRestored = (listener) => {
      restored = listener;
    };
    let settled: LoginResult | null = null;
    void s.account.startRedirect('link').then((r) => (settled = r));
    await vi.waitFor(() => expect(s.goTo).toHaveBeenCalledTimes(1));
    expect(s.local.data.has(PENDING_KEY)).toBe(true);
    expect(settled).toBeNull();
    restored();
    await vi.waitFor(() => expect(settled).toEqual({ outcome: 'cancelled' }));
    expect(s.local.data.has(PENDING_KEY)).toBe(false);
    expect(lines).toContain('result cancelled');
    void s.account.startRedirect('link'); // 押し直せる（前の待ちを返さない）
    await vi.waitFor(() => expect(s.goTo).toHaveBeenCalledTimes(2));
  });
});

describe('startRedirect の step（合わせるときの 2・3 回めの行き来）', () => {
  const go = async (s: ReturnType<typeof setup>, intent: LoginIntent, options?: { step?: 'silent' | 'chooser'; hint?: string }) => {
    void s.account.startRedirect(intent, options);
    await vi.waitFor(() => expect(s.goTo).toHaveBeenCalledTimes(1));
    const url = new URL(s.goTo.mock.calls[0][0] as string);
    const pending = JSON.parse(s.local.data.get(PENDING_KEY)!) as { state: string; rawNonce: string; intent: string; step?: string };
    secrets.push(pending.state, pending.rawNonce);
    return { url, pending };
  };
  it('step が無ければ、いままでどおり（select_account・login_hint なし・覚えに step なし・きろくは start redirect）', async () => {
    const s = setup();
    const { url, pending } = await go(s, 'link');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.has('login_hint')).toBe(false);
    expect(Object.keys(pending)).not.toContain('step');
    expect(lines).toContain('start redirect');
  });
  it('silent: prompt=none と login_hint。覚えに step、きろくは start redirect silent（hint は出ない）', async () => {
    const s = setup();
    secrets.push('hint-sub-12345');
    const { url, pending } = await go(s, 'signin', { step: 'silent', hint: 'hint-sub-12345' });
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.get('login_hint')).toBe('hint-sub-12345');
    expect(pending).toMatchObject({ intent: 'signin', step: 'silent' });
    expect(lines).toContain('start redirect silent');
    expect(lines).not.toContain('start redirect');
  });
  it('silent で hint が無ければ、login_hint は付けない', async () => {
    const s = setup();
    const { url } = await go(s, 'signin', { step: 'silent' });
    expect(url.searchParams.get('prompt')).toBe('none');
    expect(url.searchParams.has('login_hint')).toBe(false);
  });
  it('chooser: 選ぶ画面つき（login_hint なし）。覚えに step、きろくは start redirect chooser', async () => {
    const s = setup();
    const { url, pending } = await go(s, 'signin', { step: 'chooser', hint: 'ignored-hint' });
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.has('login_hint')).toBe(false);
    expect(pending).toMatchObject({ intent: 'signin', step: 'chooser' });
    expect(lines).toContain('start redirect chooser');
  });
});

describe('signInWithStashed（口へ渡すだけ）', () => {
  it('prepare の前でも、口を用意して、口の結果をそのまま返す', async () => {
    const s = setup();
    expect(await s.account.signInWithStashed()).toBe(true);
    expect(s.makePort).toHaveBeenCalledTimes(1);
    expect(s.port.signInWithStashed).toHaveBeenCalledTimes(1);
    s.port.signInWithStashed.mockResolvedValueOnce(false);
    expect(await s.account.signInWithStashed()).toBe(false);
    expect(s.makePort).toHaveBeenCalledTimes(1);
  });
  it('入れなければ、投げる', async () => {
    const s = setup();
    s.port.signInWithStashed.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    await expect(s.account.signInWithStashed()).rejects.toMatchObject({ code: 'auth/network-request-failed' });
  });
});

describe('結び付けの途中で読み込み直された（auth/provider-already-linked）', () => {
  it('方法 1: link で provider-already-linked は、linked（成功）。signin では failed のまま', async () => {
    const s = setup();
    await s.account.prepare();
    s.port.popup.mockRejectedValueOnce({ code: 'auth/provider-already-linked' });
    expect(await s.account.loginWithPopup('link')).toEqual({ outcome: 'linked' });
    s.port.popup.mockRejectedValueOnce({ code: 'auth/provider-already-linked' });
    expect((await s.account.loginWithPopup('signin')).outcome).toBe('failed');
  });
  it('方法 2 の戻り: link で provider-already-linked は、linked。戻りは消える', async () => {
    const s = setup();
    await plantReturn(s, { intent: 'link' });
    s.port.withToken.mockRejectedValueOnce({ code: 'auth/provider-already-linked' });
    expect(await s.account.finishRedirect(async (saved) => saved)).toEqual({ outcome: 'linked' });
    expect(s.session.data.has(RETURN_KEY)).toBe(false);
  });
});

describe('finishRedirect（方法 2 の戻り）', () => {
  const keep = async (i: LoginIntent) => i;
  it('戻りが無ければ null。口は作らない', async () => {
    const s = setup();
    expect(await s.account.finishRedirect(keep)).toBeNull();
    expect(s.makePort).not.toHaveBeenCalled();
  });
  it('正しい戻りなら、証明を 1 回渡して、戻りと覚えを消す', async () => {
    const s = setup();
    const { rawNonce, idToken } = await plantReturn(s, { intent: 'link' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'linked' });
    expect(s.port.withToken).toHaveBeenCalledTimes(1);
    expect(s.port.withToken).toHaveBeenCalledWith('link', idToken, rawNonce);
    expect(hasReturn(s.session)).toBe(false);
    expect(s.local.data.has(PENDING_KEY)).toBe(false);
    expect(lines).toEqual(['back ok', 'result linked']);
  });
  it('覚えが signin でも、intentNow が link を返せば link で渡す', async () => {
    const s = setup();
    await plantReturn(s, { intent: 'signin' });
    const intentNow = vi.fn(async (saved: LoginIntent) => (saved === 'signin' ? ('link' as const) : saved));
    expect(await s.account.finishRedirect(intentNow)).toEqual({ outcome: 'linked' });
    expect(intentNow).toHaveBeenCalledWith('signin');
    expect(s.port.withToken.mock.calls[0][0]).toBe('link');
  });
  it('signin のままなら switched', async () => {
    const s = setup();
    await plantReturn(s, { intent: 'signin' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'switched' });
  });
  it.each([
    ['state が違う', { returnState: 'other-state' }, 'back mismatch'],
    ['期限切れ', { at: 1_000_000 - 700_000 }, 'back expired'],
    ['覚えが無い', { at: -1 }, 'back none'],
    ['nonce が違う', { nonce: 'wrong' }, 'back mismatch'],
  ])('%s → failed。Firebase は呼ばず、戻りは消える', async (_name, over, line) => {
    const s = setup();
    await plantReturn(s, over);
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'failed' });
    expect(s.port.withToken).not.toHaveBeenCalled();
    expect(s.makePort).not.toHaveBeenCalled();
    expect(hasReturn(s.session)).toBe(false);
    expect(lines).toContain(line);
  });
  it('Google の「キャンセル」は cancelled', async () => {
    const s = setup();
    await plantReturn(s, { error: 'access_denied' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'cancelled' });
    expect(s.port.withToken).not.toHaveBeenCalled();
    expect(lines).toContain('back error=access_denied');
  });
  it('そのほかの error は failed', async () => {
    const s = setup();
    await plantReturn(s, { error: 'server_error' });
    expect((await s.account.finishRedirect(keep))?.outcome).toBe('failed');
  });
  it('もう使われている → taken（code つき）。メールは出ない', async () => {
    const s = setup();
    await plantReturn(s);
    s.port.withToken.mockRejectedValue({ code: 'auth/credential-already-in-use', customData: { email: 'a@example.com' } });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'taken', code: 'auth/credential-already-in-use' });
    expect(hasReturn(s.session)).toBe(false);
  });
  it('step: どの行き来の戻りかを、結果に付ける（成功・失敗・Google の断り）。無ければ付かない', async () => {
    const s = setup();
    await plantReturn(s, { intent: 'signin', step: 'silent' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'switched', step: 'silent' });
    await plantReturn(s, { intent: 'signin', step: 'chooser' });
    s.port.withToken.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'failed', code: 'auth/network-request-failed', step: 'chooser' });
    await plantReturn(s, { intent: 'signin' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'switched' });
  });
  it('Google が断った戻り（error）にも step が付く。access_denied は cancelled、ほかは failed', async () => {
    const s = setup();
    await plantReturn(s, { intent: 'signin', step: 'silent', error: 'interaction_required' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'failed', step: 'silent' });
    expect(lines).toContain('back error=interaction_required');
    await plantReturn(s, { intent: 'signin', step: 'chooser', error: 'access_denied' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'cancelled', step: 'chooser' });
    await plantReturn(s, { intent: 'link', error: 'access_denied' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'cancelled' });
  });
  it('taken のとき、だけ hint（証明の sub）を返す。きろくには出ない', async () => {
    const s = setup();
    secrets.push('google-sub-9876');
    await plantReturn(s, { sub: 'google-sub-9876' });
    s.port.withToken.mockRejectedValueOnce({ code: 'auth/credential-already-in-use' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'taken', code: 'auth/credential-already-in-use', hint: 'google-sub-9876' });
    // 成功のときは、hint を返さない
    await plantReturn(s, { sub: 'google-sub-9876' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'linked' });
    // sub が証明に無ければ、hint は付かない
    await plantReturn(s);
    s.port.withToken.mockRejectedValueOnce({ code: 'auth/credential-already-in-use' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'taken', code: 'auth/credential-already-in-use' });
  });
  it('step と hint は、一緒に付く（silent で taken）', async () => {
    const s = setup();
    await plantReturn(s, { intent: 'signin', step: 'silent', sub: 'abc-sub' });
    s.port.withToken.mockRejectedValueOnce({ code: 'auth/credential-already-in-use' });
    expect(await s.account.finishRedirect(keep)).toEqual({ outcome: 'taken', code: 'auth/credential-already-in-use', step: 'silent', hint: 'abc-sub' });
  });
  it('口の用意に失敗しても failed。戻りは消える', async () => {
    const s = setup();
    await plantReturn(s);
    const account = createAccount(async () => {
      throw new BackendError('offline', 'つながりません');
    }, s.env);
    expect(await account.finishRedirect(keep)).toEqual({ outcome: 'failed' });
    expect(hasReturn(s.session)).toBe(false);
  });
  it('同時に 2 回呼んでも、証明は 1 回だけ使う（同じ結果）', async () => {
    const s = setup();
    await plantReturn(s);
    const gate = deferred();
    s.port.withToken.mockReturnValueOnce(gate.promise);
    const first = s.account.finishRedirect(keep);
    const second = s.account.finishRedirect(keep);
    await vi.waitFor(() => expect(s.port.withToken).toHaveBeenCalledTimes(1));
    gate.resolve();
    expect(await first).toEqual({ outcome: 'linked' });
    expect(await second).toEqual({ outcome: 'linked' });
    expect(s.port.withToken).toHaveBeenCalledTimes(1);
  });
  it('証明を渡している途中では、戻りは消えない（読み込み直されても残る）', async () => {
    const s = setup();
    await plantReturn(s);
    const gate = deferred();
    s.port.withToken.mockReturnValueOnce(gate.promise);
    const running = s.account.finishRedirect(keep);
    await vi.waitFor(() => expect(s.port.withToken).toHaveBeenCalledTimes(1));
    expect(hasReturn(s.session)).toBe(true);
    gate.resolve();
    await running;
    expect(hasReturn(s.session)).toBe(false);
  });
});

describe('deviceEmpty（この端末が空か）', () => {
  const backend = (over: { tickets?: number; admin?: boolean; items?: number; jobs?: number; signInFails?: boolean } = {}) =>
    ({
      signIn: async () => {
        if (over.signInFails) throw new BackendError('offline', 'つながりません');
        return { userCode: 'AAAA', tickets: over.tickets ?? 0, admin: over.admin ?? false };
      },
      listMyItems: async () => Array.from({ length: over.items ?? 0 }, (_, i) => ({ id: `my:${i}` })),
      openJobs: async () => Array.from({ length: over.jobs ?? 0 }, (_, i) => ({ id: `j${i}` })),
    }) as unknown as Pick<StudioBackend, 'signIn' | 'listMyItems' | 'openJobs'>;
  it('チケット 0・服 0・仕事 0・管理者でない → 空', async () => expect(await deviceEmpty(backend())).toBe(true));
  it('チケットがあれば空でない', async () => expect(await deviceEmpty(backend({ tickets: 1 }))).toBe(false));
  it('服があれば空でない', async () => expect(await deviceEmpty(backend({ items: 1 }))).toBe(false));
  it('仕事があれば空でない', async () => expect(await deviceEmpty(backend({ jobs: 1 }))).toBe(false));
  it('管理者は、チケット 0 でも空でない', async () => expect(await deviceEmpty(backend({ admin: true }))).toBe(false));
  it('聞けなければ空でない', async () => expect(await deviceEmpty(backend({ signInFails: true }))).toBe(false));
});

function memoryLibrary(items: MyItem[]): Library & { ids(): string[] } {
  const map = new Map(items.map((i) => [i.id, i]));
  return {
    ids: () => [...map.keys()],
    all: async () => [...map.values()],
    put: async (item) => void map.set(item.id, item),
    remove: async (id) => void map.delete(id),
  };
}
const myItem = (id: string, owner?: string): MyItem => ({
  id,
  dollId: 'd',
  item: { id, name: id, category: 'トップス', image: { file: 'image', canvasW: 1, canvasH: 1, box: { x: 0, y: 0, w: 1, h: 1 } }, thumb: 'thumb' },
  files: {},
  createdAt: 1,
  hue: 0,
  order: 1,
  updatedAt: 1,
  notes: [],
  ...(owner ? { owner } : {}),
});

describe('forgetAccount（端末の控えから外す）', () => {
  it('その利用者コードの服だけを外し、NEW の印と見た仕事の覚えを消す', async () => {
    const library = memoryLibrary([myItem('my:a1', 'AAAA'), myItem('my:a2', 'AAAA'), myItem('my:b1', 'BBBB'), myItem('my:n1')]);
    const local = memoryStore({ [NEW_KEY]: '["my:a1"]', [ACKED_KEY]: '["j1"]', other: 'keep' });
    await forgetAccount(library, 'AAAA', local);
    expect(library.ids()).toEqual(['my:b1', 'my:n1']);
    expect(local.data.has(NEW_KEY)).toBe(false);
    expect(local.data.has(ACKED_KEY)).toBe(false);
    expect(local.data.get('other')).toBe('keep');
  });
});

describe('completeRedirect（戻りの仕上げ）', () => {
  function build(over: { outcome?: LoginOutcome | null; tickets?: number; saved?: LoginIntent } = {}) {
    const session = memoryStore();
    const local = memoryStore({ [NEW_KEY]: '["my:a1"]', [ACKED_KEY]: '["j1"]' });
    const library = memoryLibrary([myItem('my:a1', 'OLD1'), myItem('my:b1', 'BBBB')]);
    const asked: LoginIntent[] = [];
    const finishRedirect = vi.fn(async (intentNow: (saved: LoginIntent) => Promise<LoginIntent>) => {
      if (over.outcome === null) return null;
      asked.push(await intentNow(over.saved ?? 'signin'));
      return { outcome: over.outcome ?? 'linked' };
    });
    const backend = {
      signIn: vi.fn(async () => ({ userCode: 'OLD1', tickets: over.tickets ?? 0, admin: false })),
      listMyItems: async () => [],
      openJobs: async () => [],
      account: { finishRedirect },
    } as unknown as StudioBackend;
    const reload = vi.fn();
    if (over.outcome !== null) session.setItem(RETURN_KEY, '{"state":"s","idToken":"a.b.c"}');
    return { backend, library, session, local, reload, finishRedirect, asked, run: () => completeRedirect({ backend, library, session, local, reload }) };
  }
  it('戻りが無ければ null', async () => {
    const b = build({ outcome: null });
    expect(await b.run()).toBeNull();
    expect(b.reload).not.toHaveBeenCalled();
  });
  it('linked → 文を返す。読み込み直さない・消さない', async () => {
    const b = build({ outcome: 'linked', saved: 'link' });
    expect(await b.run()).toBe(LOGIN_MESSAGES.linked);
    expect(b.reload).not.toHaveBeenCalled();
    expect(b.library.ids()).toEqual(['my:a1', 'my:b1']);
  });
  it('switched → 入る前の利用者の服を外し、文を置いて、読み込み直す（返り値は null）', async () => {
    const b = build({ outcome: 'switched', saved: 'signin' });
    expect(await b.run()).toBeNull();
    expect(b.library.ids()).toEqual(['my:b1']);
    expect(b.local.data.has(NEW_KEY)).toBe(false);
    expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES.switched);
    expect(b.reload).toHaveBeenCalledTimes(1);
  });
  it('switched でも、入る前の利用者が聞けなければ、何も消さない', async () => {
    const b = build({ outcome: 'switched' });
    (b.backend.signIn as ReturnType<typeof vi.fn>).mockRejectedValue(new BackendError('offline', 'つながりません'));
    expect(await b.run()).toBeNull();
    expect(b.library.ids()).toEqual(['my:a1', 'my:b1']);
    expect(b.reload).toHaveBeenCalledTimes(1);
  });
  it('taken → 文を返す。何も消さない', async () => {
    const b = build({ outcome: 'taken', saved: 'link' });
    expect(await b.run()).toBe(LOGIN_MESSAGES.taken);
    expect(b.library.ids()).toEqual(['my:a1', 'my:b1']);
    expect(b.reload).not.toHaveBeenCalled();
  });
  it('intentNow: 覚えが signin で、空でなければ link。空なら signin', async () => {
    const notEmpty = build({ outcome: 'linked', saved: 'signin', tickets: 2 });
    await notEmpty.run();
    expect(notEmpty.asked).toEqual(['link']);
    const empty = build({ outcome: 'linked', saved: 'signin', tickets: 0 });
    await empty.run();
    expect(empty.asked).toEqual(['signin']);
  });
  it('同時に 2 回呼んでも、受け取りは 1 回（読み込み直しも 1 回）', async () => {
    const b = build({ outcome: 'switched', saved: 'signin' });
    await Promise.all([b.run(), b.run()]);
    expect(b.finishRedirect).toHaveBeenCalledTimes(1);
    expect(b.reload).toHaveBeenCalledTimes(1);
  });
});

describe('takeNotice', () => {
  it('読むと消える', () => {
    const session = memoryStore({ [NOTICE_KEY]: 'こんにちは' });
    expect(takeNotice(session)).toBe('こんにちは');
    expect(takeNotice(session)).toBeNull();
    expect(takeNotice(null)).toBeNull();
  });
});
