/**
 * ログインの段取り（account.ts）のテスト。Firebase の口（AuthPort）は偽物、端末の置き場はメモリの中。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '../cloud/backend';
import type { AdoptAnswer, MyItem, StudioBackend, StudioUser } from '../cloud/backend';
import {
  ADMIN_NOTE,
  ADOPT_KEY,
  BACKLOG_KEY,
  BACKLOG_MAX,
  completeRedirect,
  createAccount,
  deviceEmpty,
  forgetAccount,
  intentFor,
  LOGIN_MESSAGES,
  noAccount,
  NOTICE_KEY,
  OFFER_TTL_MS,
  outcomeOf,
  readAdopt,
  resumeAdopt,
  settleLogin,
  takeNotice,
} from '../cloud/account';
import type { AccountEnv, AdoptPending, AuthPort, LoginOutcome, LoginResult, SettleDeps } from '../cloud/account';
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
    s.port.current.mockReturnValue({ kind: 'google', email: 'a@example.com', name: 'エー' });
    expect(await s.account.prepare()).toEqual({ kind: 'google', email: 'a@example.com', name: 'エー' });
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
      offerHandoff: vi.fn(async () => {
        throw new BackendError('offline', 'つながりません');
      }),
      adopt: vi.fn(),
      account: { finishRedirect, signInWithStashed: vi.fn(async () => false), startRedirect: vi.fn() },
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
  it('taken（合い言葉がもらえなかった）→ 文を返す。何も消さない', async () => {
    const b = build({ outcome: 'taken', saved: 'link' });
    expect(await b.run()).toBe(LOGIN_MESSAGES.taken);
    expect(b.library.ids()).toEqual(['my:a1', 'my:b1']);
    expect(b.reload).not.toHaveBeenCalled();
  });
  it('効いている offered の覚えがあれば、空でなくても、いつも signin（link に直さない）。覚えが無ければ、いままでどおり', async () => {
    const withRecord = build({ outcome: 'linked', saved: 'signin', tickets: 2 });
    withRecord.local.setItem(ADOPT_KEY, JSON.stringify({ word: 'w', from: 'OLD1', stage: 'offered', at: Date.now() }));
    await withRecord.run();
    expect(withRecord.asked).toEqual(['signin']);
    const expired = build({ outcome: 'linked', saved: 'signin', tickets: 2 });
    expired.local.setItem(ADOPT_KEY, JSON.stringify({ word: 'w', from: 'OLD1', stage: 'offered', at: Date.now() - OFFER_TTL_MS - 1000 }));
    await expired.run();
    expect(expired.asked).toEqual(['link']);
    const switched = build({ outcome: 'linked', saved: 'signin', tickets: 2 });
    switched.local.setItem(ADOPT_KEY, JSON.stringify({ word: 'w', from: 'OLD1', stage: 'switched', at: Date.now() }));
    await switched.run();
    expect(switched.asked).toEqual(['link']);
  });
  it('switched で、offered の覚えがあれば、settleLogin を通る: adopt して、合わせた文を置いて、読み込み直す', async () => {
    const b = build({ outcome: 'switched', saved: 'signin', tickets: 3 });
    b.local.setItem(ADOPT_KEY, JSON.stringify({ word: 'w', from: 'OLD1', stage: 'offered', at: Date.now() }));
    (b.backend.adopt as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'done', tickets: 3, items: 1 });
    expect(await b.run()).toBeNull();
    expect(b.backend.adopt).toHaveBeenCalledWith('w');
    expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES.merged);
    expect(b.library.ids()).toEqual(['my:b1']);
    expect(b.local.data.has(ADOPT_KEY)).toBe(false);
    expect(b.reload).toHaveBeenCalledTimes(1);
  });
  it('taken のとき、行き来の戻りの step は settleLogin に渡る（silent の戻りの taken は、次の行き来を始めない）', async () => {
    const b = build({ outcome: 'taken', saved: 'signin' });
    b.finishRedirect.mockImplementationOnce(async (intentNow) => {
      await intentNow('signin');
      return { outcome: 'taken', step: 'silent' } as LoginResult;
    });
    expect(await b.run()).toBe(LOGIN_MESSAGES.taken);
    expect(b.backend.offerHandoff).not.toHaveBeenCalled();
    expect(b.backend.account.startRedirect).not.toHaveBeenCalled();
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

describe('readAdopt・intentFor（合わせる途中の覚え）', () => {
  const NOW = 5_000_000;
  const put = (local: ReturnType<typeof memoryStore>, over: Partial<AdoptPending> & { raw?: string } = {}) => {
    const { raw, ...rest } = over;
    local.setItem(ADOPT_KEY, raw ?? JSON.stringify({ word: 'w-1', from: 'OLD1', stage: 'offered', at: NOW - 1000, ...rest }));
  };
  it('覚えが無い・壊れている・形が違う → null', () => {
    const local = memoryStore();
    expect(readAdopt(local, NOW)).toBeNull();
    expect(readAdopt(null, NOW)).toBeNull();
    for (const raw of ['{こわれた', 'null', '[]', '{"word":"w","from":"A","stage":"other","at":1}', '{"word":1,"from":"A","stage":"offered","at":1}', '{"word":"w","from":"A","stage":"offered"}']) {
      put(local, { raw });
      expect(readAdopt(local, NOW)).toBeNull();
    }
  });
  it('効いている offered は、そのまま返る（hint・admin も）', () => {
    const local = memoryStore();
    put(local, { hint: 'sub-1', admin: true });
    expect(readAdopt(local, NOW)).toEqual({ word: 'w-1', from: 'OLD1', stage: 'offered', at: NOW - 1000, hint: 'sub-1', admin: true });
    put(local);
    expect(readAdopt(local, NOW)).toEqual({ word: 'w-1', from: 'OLD1', stage: 'offered', at: NOW - 1000 });
  });
  it('offered は 10 分まで効く。過ぎたら、捨てて null（保存からも消える）', () => {
    const local = memoryStore();
    put(local, { at: NOW - OFFER_TTL_MS });
    expect(readAdopt(local, NOW)).not.toBeNull(); // ちょうど 10 分は、まだ効く
    put(local, { at: NOW - OFFER_TTL_MS - 1 });
    expect(readAdopt(local, NOW)).toBeNull();
    expect(local.data.has(ADOPT_KEY)).toBe(false);
  });
  it('switched は、時間がたっても、adopt が最後の返事をするまで残る', () => {
    const local = memoryStore();
    put(local, { stage: 'switched', at: NOW - 30 * 24 * 3600_000 });
    expect(readAdopt(local, NOW)?.stage).toBe('switched');
    expect(local.data.has(ADOPT_KEY)).toBe(true);
  });
  it('intentFor: 空なら入る。空でなければ結び付ける。ただし、効いている offered があれば入る', () => {
    const local = memoryStore();
    expect(intentFor(true, local, NOW)).toBe('signin');
    expect(intentFor(false, local, NOW)).toBe('link');
    expect(intentFor(false, null, NOW)).toBe('link');
    put(local);
    expect(intentFor(false, local, NOW)).toBe('signin');
    expect(intentFor(true, local, NOW)).toBe('signin');
    put(local, { at: NOW - OFFER_TTL_MS - 1 }); // 過ぎた offered は、無いのと同じ
    expect(intentFor(false, local, NOW)).toBe('link');
    put(local, { stage: 'switched' }); // switched は、入るの決め手にしない
    expect(intentFor(false, local, NOW)).toBe('link');
  });
});

describe('settleLogin（ログインの結果の仕上げ）', () => {
  const WORD = 'handoff-word-secret-0123456789';
  const HINT = 'google-sub-hint-555';
  const BEFORE: StudioUser = { userCode: 'OLD1', tickets: 3, admin: false };
  const never = () => new Promise<LoginResult>(() => undefined);
  const answer = (status: AdoptAnswer['status'], tickets = 0, items = 0): AdoptAnswer => ({ status, tickets, items });

  function build(over: { word?: string } = {}) {
    secrets.push(WORD, HINT);
    const session = memoryStore();
    const local = memoryStore({ [NEW_KEY]: '["my:a1"]', [ACKED_KEY]: '["j1"]' });
    const library = memoryLibrary([myItem('my:a1', 'OLD1'), myItem('my:a2', 'OLD1'), myItem('my:b1', 'BBBB'), myItem('my:n1')]);
    const account = {
      signInWithStashed: vi.fn(async () => true),
      startRedirect: vi.fn<(intent: LoginIntent, options?: { step?: 'silent' | 'chooser'; hint?: string }) => Promise<LoginResult>>(never),
    };
    const backend = {
      offerHandoff: vi.fn(async () => over.word ?? WORD),
      adopt: vi.fn(async (word: string): Promise<AdoptAnswer> => (void word, answer('done', 3, 2))),
      account,
    };
    let t = 2_000_000;
    const reload = vi.fn();
    const deps: SettleDeps = { backend: backend as unknown as StudioBackend, library, session, local, now: () => t, reload, note: (...parts) => void lines.push(parts.join(' ')) };
    const record = (): AdoptPending | null => JSON.parse(local.data.get(ADOPT_KEY) ?? 'null') as AdoptPending | null;
    const plant = (pending: Partial<AdoptPending> = {}) => local.setItem(ADOPT_KEY, JSON.stringify({ word: WORD, from: 'OLD1', stage: 'offered', at: t - 1000, ...pending }));
    return { deps, backend, account, session, local, library, reload, record, plant, advance: (ms: number) => (t += ms) };
  }
  type Built = ReturnType<typeof build>;
  const settle = (b: Built, result: LoginResult, method: 'popup' | 'redirect' = 'redirect', before: StudioUser | null = BEFORE) => settleLogin(b.deps, result, method, before);

  describe('linked', () => {
    it('そのまま返す。覚えが無ければ、何も起きない', async () => {
      const b = build();
      expect(await settle(b, { outcome: 'linked' })).toEqual({ outcome: 'linked' });
      expect(b.reload).not.toHaveBeenCalled();
      expect(b.backend.offerHandoff).not.toHaveBeenCalled();
    });
    it('効いている offered の覚えがあれば、捨てる（合わせる途中で、結び付けが通った）', async () => {
      const b = build();
      b.plant();
      expect(await settle(b, { outcome: 'linked' })).toEqual({ outcome: 'linked' });
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
    });
    it('switched の覚えは、捨てない（adopt の返事が来るまで残す）', async () => {
      const b = build();
      b.plant({ stage: 'switched' });
      await settle(b, { outcome: 'linked' });
      expect(b.record()?.stage).toBe('switched');
    });
  });

  describe('taken（もう使われている）', () => {
    it('合い言葉をもらい、覚えを書く（offered・元の利用者コード・hint）。きろくに offer ok', async () => {
      const b = build();
      b.account.signInWithStashed.mockResolvedValue(false);
      void settle(b, { outcome: 'taken', hint: HINT });
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(1));
      expect(b.record()).toEqual({ word: WORD, from: 'OLD1', stage: 'offered', at: 2_000_000, hint: HINT });
      expect(lines).toContain('offer ok');
    });
    it('管理者の端末なら、覚えに admin を付ける', async () => {
      const b = build();
      b.account.signInWithStashed.mockResolvedValue(false);
      void settle(b, { outcome: 'taken' }, 'redirect', { ...BEFORE, admin: true });
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(1));
      expect(b.record()).toEqual({ word: WORD, from: 'OLD1', stage: 'offered', at: 2_000_000, admin: true });
    });
    it('サーバーが古い（old-server）→ taken-old-server。覚えは書かない・先へ進まない', async () => {
      const b = build();
      b.backend.offerHandoff.mockRejectedValue(new BackendError('old-server', 'サーバーが古い'));
      expect(await settle(b, { outcome: 'taken' })).toEqual({ outcome: 'taken-old-server' });
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
      expect(b.account.signInWithStashed).not.toHaveBeenCalled();
      expect(b.account.startRedirect).not.toHaveBeenCalled();
      expect(lines).toContain('offer old-server');
      expect(lines).toContain('result taken-old-server');
    });
    it.each([
      ['つながらない（BackendError）', () => new BackendError('offline', 'つながりません')],
      ['そのほかの例外', () => new Error('x')],
    ])('合い言葉がもらえない（%s）→ taken。覚えは書かない・先へ進まない。きろくに offer failed', async (_name, make) => {
      const b = build();
      b.backend.offerHandoff.mockRejectedValue(make());
      expect(await settle(b, { outcome: 'taken' })).toEqual({ outcome: 'taken' });
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
      expect(b.account.startRedirect).not.toHaveBeenCalled();
      expect(lines).toContain('offer failed');
    });
    it('ログイン前の利用者が聞けなかったとき（before が null）は、元が分からないので、合わせない（taken）', async () => {
      const b = build();
      expect(await settle(b, { outcome: 'taken' }, 'redirect', null)).toEqual({ outcome: 'taken' });
      expect(b.backend.offerHandoff).not.toHaveBeenCalled();
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
      expect(lines).toContain('offer failed');
    });
    it('断りと一緒に返った証明で入れる → きろくに switch stashed。画面を移らず、そのまま adopt まで進む（合わさって、読み込み直す）', async () => {
      const b = build();
      expect(await settle(b, { outcome: 'taken', hint: HINT })).toBeNull();
      expect(b.account.signInWithStashed).toHaveBeenCalledTimes(1);
      expect(b.account.startRedirect).not.toHaveBeenCalled();
      expect(b.backend.adopt).toHaveBeenCalledWith(WORD);
      expect(lines).toContain('switch stashed');
      expect(lines).toContain('adopt ok tickets=3 items=2');
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES.merged);
      expect(b.reload).toHaveBeenCalledTimes(1);
    });
    it('方法 2 で、証明が返らない（false）→ 画面なしの行き来を始める（signin・step silent・hint）。きろくに switch silent', async () => {
      const b = build();
      b.account.signInWithStashed.mockResolvedValue(false);
      const pending = settle(b, { outcome: 'taken', hint: HINT });
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(1));
      expect(b.account.startRedirect).toHaveBeenCalledWith('signin', { step: 'silent', hint: HINT });
      expect(lines).toContain('switch silent');
      expect(b.reload).not.toHaveBeenCalled();
      expect(b.backend.adopt).not.toHaveBeenCalled();
      // 画面が移ったとき、startRedirect は返らない。返らない間、settleLogin も返らない（null を返さない・何も続けない）
      let settled = false;
      void pending.then(() => (settled = true));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);
    });
    it('方法 2 で、証明で入ろうとして投げた → 画面なしの行き来（投げたことは、表に出さない）', async () => {
      const b = build();
      b.account.signInWithStashed.mockRejectedValue({ code: 'auth/network-request-failed', customData: { email: 'a@example.com' } });
      void settle(b, { outcome: 'taken', hint: HINT });
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(1));
      expect(b.account.startRedirect).toHaveBeenCalledWith('signin', { step: 'silent', hint: HINT });
      expect(b.backend.adopt).not.toHaveBeenCalled();
    });
    it('hint が無ければ、hint なしで画面なしの行き来を始める', async () => {
      const b = build();
      b.account.signInWithStashed.mockResolvedValue(false);
      void settle(b, { outcome: 'taken' });
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(1));
      expect(b.account.startRedirect).toHaveBeenCalledWith('signin', { step: 'silent' });
    });
    it('画面を移れなかった（startRedirect が返った）ときは、その結果を返す', async () => {
      const b = build();
      b.account.signInWithStashed.mockResolvedValue(false);
      b.account.startRedirect.mockResolvedValue({ outcome: 'not-ready' });
      expect(await settle(b, { outcome: 'taken', hint: HINT })).toEqual({ outcome: 'not-ready' });
      expect(b.record()?.stage).toBe('offered'); // 覚えは残る（10 分以内に、押し直せる）
    });
    it('方法 1（小さい窓）で、証明が返らない → press-again。覚え（offered）を残す。画面は移らない', async () => {
      const b = build();
      b.account.signInWithStashed.mockResolvedValue(false);
      expect(await settle(b, { outcome: 'taken', hint: HINT }, 'popup')).toEqual({ outcome: 'press-again' });
      expect(b.account.startRedirect).not.toHaveBeenCalled();
      expect(b.record()).toMatchObject({ word: WORD, from: 'OLD1', stage: 'offered' });
      expect(lines).toContain('result press-again');
    });
    it('方法 1 でも、証明が返れば（stashed）その場で入って合わさる', async () => {
      const b = build();
      expect(await settle(b, { outcome: 'taken' }, 'popup')).toBeNull();
      expect(b.backend.adopt).toHaveBeenCalledTimes(1);
      expect(b.reload).toHaveBeenCalledTimes(1);
    });
    it('行き来の戻り（step が付いた taken）では、もう合い言葉をもらわず、次の行き来も始めない（そのまま返す）', async () => {
      for (const step of ['silent', 'chooser'] as const) {
        const b = build();
        expect(await settle(b, { outcome: 'taken', step })).toEqual({ outcome: 'taken', step });
        expect(b.backend.offerHandoff).not.toHaveBeenCalled();
        expect(b.account.signInWithStashed).not.toHaveBeenCalled();
        expect(b.account.startRedirect).not.toHaveBeenCalled();
      }
    });
  });

  describe('積み残し（作りかけの合い言葉を、新しい合わせで失わない）', () => {
    const WORD_A = 'handoff-word-A-secret-aaaa';
    const backlog = (b: Built): Array<{ word: string; from: string }> => JSON.parse(b.local.data.get(BACKLOG_KEY) ?? '[]') as Array<{ word: string; from: string }>;
    const byWord = (b: Built, table: Record<string, AdoptAnswer | 'throw'>) =>
      b.backend.adopt.mockImplementation(async (word: string) => {
        const value = table[word];
        if (value === 'throw') throw new Error('offline');
        return value ?? answer('done', 1, 1);
      });

    it('A の switched が残ったまま、ログアウトして D で合わせても、A の合い言葉も adopt される（端到端）', async () => {
      const b = build({ word: 'handoff-word-D-secret-dddd' });
      secrets.push(WORD_A, 'handoff-word-D-secret-dddd');
      // A の合わせは、通信が切れて終わらなかった
      b.plant({ word: WORD_A, from: 'OLD1', stage: 'switched' });
      // ログアウトして匿名の D になり、また結び付ける → taken
      b.account.signInWithStashed.mockResolvedValue(false);
      void settle(b, { outcome: 'taken' }, 'redirect', { userCode: 'DDDD', tickets: 1, admin: false });
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(1));
      expect(backlog(b)).toEqual([{ word: WORD_A, from: 'OLD1' }]);
      expect(b.record()).toMatchObject({ word: 'handoff-word-D-secret-dddd', from: 'DDDD', stage: 'offered' });
      // 画面なしの行き来が戻って、入れた → adopt（D の分と、A の積み残し）
      expect(await settle(b, { outcome: 'switched', step: 'silent' }, 'redirect', { userCode: 'DDDD', tickets: 1, admin: false })).toBeNull();
      expect(b.backend.adopt).toHaveBeenCalledWith('handoff-word-D-secret-dddd');
      expect(b.backend.adopt).toHaveBeenCalledWith(WORD_A);
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
      expect(b.local.data.has(BACKLOG_KEY)).toBe(false);
      expect(b.library.ids()).toEqual(['my:b1', 'my:n1']); // A（OLD1）の服は、控えから外れた
      expect(lines.filter((line) => line === 'adopt ok tickets=3 items=2')).toHaveLength(2);
    });
    it('積み残しは最大 5 件。あふれたら、古いものから捨てる', async () => {
      const b = build();
      b.local.setItem(BACKLOG_KEY, JSON.stringify(Array.from({ length: BACKLOG_MAX }, (_, i) => ({ word: `old-${i}`, from: `F${i}` }))));
      b.plant({ stage: 'switched' });
      b.account.signInWithStashed.mockResolvedValue(false);
      void settle(b, { outcome: 'taken' });
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(1));
      const list = backlog(b);
      expect(list).toHaveLength(BACKLOG_MAX);
      expect(list.map((entry) => entry.word)).toEqual(['old-1', 'old-2', 'old-3', 'old-4', WORD]);
    });
    it('offered の覚えは、積み残しに入れない（まだ入っていない）', async () => {
      const b = build();
      b.plant({ stage: 'offered' });
      b.account.signInWithStashed.mockResolvedValue(false);
      void settle(b, { outcome: 'taken' });
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(1));
      expect(b.local.data.has(BACKLOG_KEY)).toBe(false);
    });
    it('積み残しが wait なら残す。used・unknown・refused なら捨てる。落ちたら残す', async () => {
      const b = build();
      b.plant();
      b.local.setItem(
        BACKLOG_KEY,
        JSON.stringify([
          { word: 'w-wait', from: 'F1' },
          { word: 'w-used', from: 'F2' },
          { word: 'w-unknown', from: 'F3' },
          { word: 'w-refused', from: 'F4' },
          { word: 'w-down', from: 'F5' },
        ]),
      );
      byWord(b, { 'w-wait': answer('wait'), 'w-used': answer('used'), 'w-unknown': answer('unknown'), 'w-refused': answer('refused'), 'w-down': 'throw' });
      await settle(b, { outcome: 'switched' });
      expect(backlog(b)).toEqual([
        { word: 'w-wait', from: 'F1' },
        { word: 'w-down', from: 'F5' },
      ]);
      expect(lines).toEqual(expect.arrayContaining(['adopt used', 'adopt unknown', 'adopt refused', 'adopt later']));
      expect(b.library.ids()).toHaveLength(2); // 現在の覚え（done）の OLD1 だけ外れた。積み残しの捨てた分は、控えを外さない
    });
    it('積み残しの合い言葉は、きろくに出さない（done の分も）', async () => {
      const b = build();
      secrets.push('w-secret-bl');
      b.plant();
      b.local.setItem(BACKLOG_KEY, JSON.stringify([{ word: 'w-secret-bl', from: 'BBBB' }]));
      await settle(b, { outcome: 'switched' });
      expect(b.library.ids()).toEqual(['my:n1']); // BBBB の服も外れた
      expect(b.local.data.has(BACKLOG_KEY)).toBe(false);
    });
    it('置き場が書けなくても、投げない（積み残しが書けなければ、合わせに進まず taken のまま返す）', async () => {
      const b = build();
      b.plant({ stage: 'switched' });
      const original = b.local.setItem;
      b.local.setItem = (key: string, value: string) => {
        if (key === BACKLOG_KEY) throw new Error('quota');
        original(key, value);
      };
      await expect(settle(b, { outcome: 'taken' })).resolves.toEqual({ outcome: 'taken' });
      expect(b.record()).toMatchObject({ word: WORD, stage: 'switched' }); // 元の覚えは、そのまま
      expect(lines).toContain('offer failed');
      // 入れたあとの積み残しの書き戻しが失敗しても、投げない
      b.local.setItem = (key: string, value: string) => {
        if (key === BACKLOG_KEY) throw new Error('quota');
        original(key, value);
      };
      original(BACKLOG_KEY, JSON.stringify([{ word: 'w-x', from: 'F' }]));
      byWord(b, { 'w-x': answer('wait') });
      await expect(settle(b, { outcome: 'switched' })).resolves.toBeNull();
    });
  });

  describe('画面なしの行き来（step: silent）が switched でなかった', () => {
    it.each([
      ['Google が画面が要ると断った', { outcome: 'failed', step: 'silent' }],
      ['access_denied（cancelled）', { outcome: 'cancelled', step: 'silent' }],
      ['証明を渡して失敗', { outcome: 'failed', code: 'auth/network-request-failed', step: 'silent' }],
    ] as Array<[string, LoginResult]>)('%s → 選ぶ画面つきの行き来（signin・step chooser）。きろくに switch chooser', async (_name, result) => {
      const b = build();
      b.plant({ hint: HINT });
      void settle(b, result);
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(1));
      expect(b.account.startRedirect).toHaveBeenCalledWith('signin', { step: 'chooser' });
      expect(lines).toContain('switch chooser');
      expect(b.reload).not.toHaveBeenCalled();
      expect(b.backend.adopt).not.toHaveBeenCalled();
    });
    it('画面を移れなければ、その結果を返す', async () => {
      const b = build();
      b.plant();
      b.account.startRedirect.mockResolvedValue({ outcome: 'not-ready' });
      expect(await settle(b, { outcome: 'failed', step: 'silent' })).toEqual({ outcome: 'not-ready' });
    });
  });

  describe('行き来は最大 3 回（最初・画面なし・選ぶ画面）で止まる', () => {
    it('最初が taken → 画面なし（失敗）→ 選ぶ画面（キャンセル）: startRedirect は 2 回だけ。3 回めは始めない。結果は cancelled のまま', async () => {
      const b = build();
      b.account.signInWithStashed.mockResolvedValue(false);
      // 1 回めの戻り（taken）
      void settle(b, { outcome: 'taken', hint: HINT });
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(1));
      expect(b.account.startRedirect.mock.calls[0]).toEqual(['signin', { step: 'silent', hint: HINT }]);
      // 2 回めの戻り（Google が画面なしを断った）
      void settle(b, { outcome: 'failed', step: 'silent' });
      await vi.waitFor(() => expect(b.account.startRedirect).toHaveBeenCalledTimes(2));
      expect(b.account.startRedirect.mock.calls[1]).toEqual(['signin', { step: 'chooser' }]);
      // 3 回めの戻り（選ぶ画面で「キャンセル」）
      expect(await settle(b, { outcome: 'cancelled', step: 'chooser' })).toEqual({ outcome: 'cancelled', step: 'chooser' });
      expect(b.account.startRedirect).toHaveBeenCalledTimes(2);
      expect(b.backend.offerHandoff).toHaveBeenCalledTimes(1);
      expect(b.account.signInWithStashed).toHaveBeenCalledTimes(1);
      expect(b.backend.adopt).not.toHaveBeenCalled();
      expect(b.reload).not.toHaveBeenCalled();
      expect(b.library.ids()).toContain('my:a1'); // 匿名のまま。何も変わらない
    });
    it.each([
      ['failed', { outcome: 'failed', step: 'chooser' }],
      ['taken', { outcome: 'taken', step: 'chooser' }],
      ['not-ready', { outcome: 'not-ready', step: 'chooser' }],
    ] as Array<[string, LoginResult]>)('選ぶ画面の戻りが switched でなければ（%s）、何も始めずに、そのまま返す', async (_name, result) => {
      const b = build();
      b.plant();
      expect(await settle(b, result)).toEqual(result);
      expect(b.account.startRedirect).not.toHaveBeenCalled();
      expect(b.backend.offerHandoff).not.toHaveBeenCalled();
      expect(b.reload).not.toHaveBeenCalled();
    });
  });

  describe('switched（入れた）', () => {
    it('覚えが無い → いままでどおり: 入る前の利用者の服だけ外し、知らせ switched を置いて、読み込み直す。adopt は呼ばない', async () => {
      const b = build();
      expect(await settle(b, { outcome: 'switched' })).toBeNull();
      expect(b.library.ids()).toEqual(['my:b1', 'my:n1']);
      expect(b.local.data.has(NEW_KEY)).toBe(false);
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES.switched);
      expect(b.reload).toHaveBeenCalledTimes(1);
      expect(b.backend.adopt).not.toHaveBeenCalled();
    });
    it('覚えが無く、入る前の利用者が聞けなかったら、何も消さずに読み込み直す', async () => {
      const b = build();
      expect(await settle(b, { outcome: 'switched' }, 'redirect', null)).toBeNull();
      expect(b.library.ids()).toHaveLength(4);
      expect(b.reload).toHaveBeenCalledTimes(1);
    });
    it('覚えがある → adopt の前に、段階を switched に書き直す（adopt の途中で落ちても、次の起動でやり直せる）', async () => {
      const b = build();
      b.plant({ hint: HINT });
      let during: AdoptPending | null = null;
      b.backend.adopt.mockImplementation(async () => {
        during = b.record();
        return answer('done', 1, 1);
      });
      await settle(b, { outcome: 'switched' });
      expect(during).toMatchObject({ word: WORD, from: 'OLD1', stage: 'switched' });
    });
    it('done → 覚えを消す・元の利用者の服だけ控えから外す・知らせ merged・きろく（adopt ok tickets=N items=M・result merged）・読み込み直す', async () => {
      const b = build();
      b.plant();
      expect(await settle(b, { outcome: 'switched' })).toBeNull();
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
      expect(b.library.ids()).toEqual(['my:b1', 'my:n1']);
      expect(b.local.data.has(NEW_KEY)).toBe(false);
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES.merged);
      expect(b.reload).toHaveBeenCalledTimes(1);
      expect(lines).toContain('adopt ok tickets=3 items=2');
      expect(lines).toContain('result merged');
    });
    it('done で、覚えの admin が true → 知らせの文に ADMIN_NOTE が足される', async () => {
      const b = build();
      b.plant({ admin: true });
      await settle(b, { outcome: 'switched' });
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES.merged + ADMIN_NOTE);
    });
    it.each(['used', 'unknown', 'refused'] as const)('%s → 覚えを消す・知らせ switched・きろく adopt %s。端末の控えは外さない・読み込み直す', async (status) => {
      const b = build();
      b.plant({ admin: true });
      b.backend.adopt.mockResolvedValue(answer(status));
      expect(await settle(b, { outcome: 'switched' })).toBeNull();
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES.switched);
      expect(b.library.ids()).toHaveLength(4);
      expect(b.reload).toHaveBeenCalledTimes(1);
      expect(lines).toContain(`adopt ${status}`);
    });
    it('adopt が落ちた（つながらない）→ 覚えは switched のまま残る・控えの服は外さない（NEW の印も）・知らせ merge-later・きろく adopt later・読み込み直す', async () => {
      const b = build();
      b.plant();
      b.backend.adopt.mockRejectedValue(new BackendError('offline', 'つながりません', { uncertain: true }));
      expect(await settle(b, { outcome: 'switched' })).toBeNull();
      expect(b.record()).toMatchObject({ word: WORD, from: 'OLD1', stage: 'switched' });
      expect(b.library.ids()).toEqual(['my:a1', 'my:a2', 'my:b1', 'my:n1']); // 端末の服が残る
      expect(b.local.data.has(NEW_KEY)).toBe(true);
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES['merge-later']);
      expect(b.reload).toHaveBeenCalledTimes(1);
      expect(lines).toContain('adopt later');
      expect(lines).toContain('result merge-later');
    });
    it('adopt が wait（まだ匿名）→ adopt が落ちたのと同じ（覚えを残し、控えは外さず、merge-later）', async () => {
      const b = build();
      b.plant();
      b.backend.adopt.mockResolvedValue(answer('wait'));
      await settle(b, { outcome: 'switched' });
      expect(b.record()?.stage).toBe('switched');
      expect(b.library.ids()).toHaveLength(4);
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES['merge-later']);
    });
    it('merge-later で、覚えの admin が true → 知らせの文に ADMIN_NOTE が足される', async () => {
      const b = build();
      b.plant({ admin: true });
      b.backend.adopt.mockRejectedValue(new Error('offline'));
      await settle(b, { outcome: 'switched' });
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES['merge-later'] + ADMIN_NOTE);
    });
    it('端末の控えが読めなくても（done のあと）、知らせを置いて、読み込み直す', async () => {
      const b = build();
      b.plant();
      b.library.all = async () => Promise.reject(new Error('idb'));
      await settle(b, { outcome: 'switched' });
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES.merged);
      expect(b.reload).toHaveBeenCalledTimes(1);
    });
    it('10 分を過ぎた offered の覚えは、捨てる（覚えが無いのと同じ。adopt は呼ばない）', async () => {
      const b = build();
      b.plant({ at: 2_000_000 - OFFER_TTL_MS - 1 });
      await settle(b, { outcome: 'switched' });
      expect(b.backend.adopt).not.toHaveBeenCalled();
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES.switched);
    });
    it('前から残っている switched の覚え（ログアウトをはさんでも消さない）は、次に入ったアカウントに合わさる', async () => {
      const b = build();
      b.plant({ stage: 'switched', at: 2_000_000 - 3 * 24 * 3600_000 });
      await settle(b, { outcome: 'switched' });
      expect(b.backend.adopt).toHaveBeenCalledWith(WORD);
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
      expect(b.session.data.get(NOTICE_KEY)).toBe(LOGIN_MESSAGES.merged);
    });
  });

  describe('ほか（何もしない）', () => {
    it.each([
      { outcome: 'cancelled' },
      { outcome: 'not-ready' },
      { outcome: 'no-popup' },
      { outcome: 'failed' },
      { outcome: 'failed', code: 'auth/network-request-failed' },
      { outcome: 'cancelled', step: 'chooser' },
    ] as LoginResult[])('%j → そのまま返す。バックエンドも端末も触らない', async (result) => {
      const b = build();
      b.plant();
      const before = b.local.data.get(ADOPT_KEY);
      expect(await settle(b, result)).toEqual(result);
      expect(b.local.data.get(ADOPT_KEY)).toBe(before);
      expect(b.library.ids()).toHaveLength(4);
      expect(b.reload).not.toHaveBeenCalled();
      expect(b.backend.offerHandoff).not.toHaveBeenCalled();
      expect(b.backend.adopt).not.toHaveBeenCalled();
      expect(b.account.startRedirect).not.toHaveBeenCalled();
    });
  });

  it('文: 新しい 4 つの結果と、書き換えた taken の文', () => {
    expect(LOGIN_MESSAGES.merged).toBe('Google のアカウントでログインしました。この端末のチケットと服を、アカウントに合わせました');
    expect(LOGIN_MESSAGES['merge-later']).toBe('Google のアカウントでログインしました。この端末のチケットと服は、インターネットにつながったときに、合わせます');
    expect(LOGIN_MESSAGES['taken-old-server']).toBe('この Google のアカウントは、ほかの端末で使われています。サーバーが古い版のため、まだ合わせられません（作者が載せ直す必要があります）');
    expect(LOGIN_MESSAGES['press-again']).toBe('もう一度「小さい窓でログイン」を押すと、この端末のチケットと服を合わせて、ログインします');
    expect(LOGIN_MESSAGES.taken).toBe('この Google のアカウントは、ほかの端末で使われています。合わせる準備ができませんでした。少し待ってから、もう一度ログインしてください');
    expect(ADMIN_NOTE).toBe('（この端末は管理者でしたが、合わせたので、管理者の印が外れました。Firebase の画面で、管理者の利用者コードを、いまの利用者コードに書き換えてください。手順書 2-11）');
  });
});

describe('resumeAdopt（起動のとき、もう一度 adopt）', () => {
  const WORD = 'handoff-word-secret-resume-77';
  function build() {
    secrets.push(WORD);
    const session = memoryStore();
    const local = memoryStore({ [NEW_KEY]: '["my:a1"]' });
    const library = memoryLibrary([myItem('my:a1', 'OLD1'), myItem('my:b1', 'BBBB')]);
    const prepare = vi.fn(async (): Promise<{ kind: 'guest' } | { kind: 'google'; email: string }> => ({ kind: 'guest' }));
    const backend = { adopt: vi.fn(async (word: string): Promise<AdoptAnswer> => (void word, { status: 'done', tickets: 3, items: 1 })), account: { prepare } };
    const reload = vi.fn();
    const deps: SettleDeps = { backend: backend as unknown as StudioBackend, library, session, local, now: () => 9_000_000, reload, note: (...parts) => void lines.push(parts.join(' ')) };
    const plant = (stage: AdoptPending['stage'], at = 8_900_000) => local.setItem(ADOPT_KEY, JSON.stringify({ word: WORD, from: 'OLD1', stage, at }));
    return { deps, backend, prepare, local, library, reload, plant };
  }
  it('覚えが無ければ、何もしない（バックエンドに聞かない）→ null', async () => {
    const b = build();
    expect(await resumeAdopt(b.deps)).toBeNull();
    expect(b.backend.adopt).not.toHaveBeenCalled();
  });
  it('offered の覚えでは、何もしない（まだ入っていない）', async () => {
    const b = build();
    b.plant('offered');
    expect(await resumeAdopt(b.deps)).toBeNull();
    expect(b.backend.adopt).not.toHaveBeenCalled();
    expect(b.local.data.has(ADOPT_KEY)).toBe(true);
  });
  it('switched で done → 覚えを消す・元の利用者の服を外す・「この端末のチケットと服を、アカウントに合わせました」を返す。読み込み直さない', async () => {
    const b = build();
    b.plant('switched', 1); // 古くても、switched は効く
    expect(await resumeAdopt(b.deps)).toBe('この端末のチケットと服を、アカウントに合わせました');
    expect(b.backend.adopt).toHaveBeenCalledWith(WORD);
    expect(b.local.data.has(ADOPT_KEY)).toBe(false);
    expect(await b.library.all().then((all) => all.map((i) => i.id))).toEqual(['my:b1']);
    expect(b.local.data.has(NEW_KEY)).toBe(false);
    expect(b.reload).not.toHaveBeenCalled();
    expect(lines).toContain('adopt ok tickets=3 items=1');
  });
  it.each(['used', 'unknown', 'refused'] as const)('%s → 覚えを消す・null。控えは外さない', async (status) => {
    const b = build();
    b.plant('switched');
    b.backend.adopt.mockResolvedValue({ status, tickets: 0, items: 0 });
    expect(await resumeAdopt(b.deps)).toBeNull();
    expect(b.local.data.has(ADOPT_KEY)).toBe(false);
    expect((await b.library.all()).length).toBe(2);
    expect(lines).toContain(`adopt ${status}`);
  });
  it.each([
    ['落ちた'],
    ['wait'],
  ])('%s → 何も変えない（覚えは残る・控えの服は残る）→ null', async (name) => {
    const b = build();
    b.plant('switched');
    if (name === '落ちた') b.backend.adopt.mockRejectedValue(new BackendError('offline', 'つながりません'));
    else b.backend.adopt.mockResolvedValue({ status: 'wait', tickets: 0, items: 0 });
    expect(await resumeAdopt(b.deps)).toBeNull();
    expect(b.local.data.has(ADOPT_KEY)).toBe(true);
    expect((await b.library.all()).length).toBe(2);
    expect(b.local.data.has(NEW_KEY)).toBe(true);
  });
  describe('offered のまま、もう Google に入っていた（入った直後にページが落ちた）', () => {
    const googleNow = (b: ReturnType<typeof build>) => b.prepare.mockResolvedValue({ kind: 'google', email: 'a@example.com' });
    it('offered + Google → switched に書き直して adopt する（合わさったら、知らせの文）', async () => {
      const b = build();
      googleNow(b);
      b.plant('offered');
      expect(await resumeAdopt(b.deps)).toBe('この端末のチケットと服を、アカウントに合わせました');
      expect(b.backend.adopt).toHaveBeenCalledWith(WORD);
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
    });
    it('adopt が wait なら、switched として残る（次の起動で、また adopt）', async () => {
      const b = build();
      googleNow(b);
      b.plant('offered');
      b.backend.adopt.mockResolvedValue({ status: 'wait', tickets: 0, items: 0 });
      expect(await resumeAdopt(b.deps)).toBeNull();
      expect(JSON.parse(b.local.data.get(ADOPT_KEY) ?? 'null')).toMatchObject({ word: WORD, stage: 'switched' });
    });
    it('offered + 匿名 → 何もしない（覚えもそのまま）', async () => {
      const b = build();
      b.plant('offered');
      expect(await resumeAdopt(b.deps)).toBeNull();
      expect(b.prepare).toHaveBeenCalled();
      expect(b.backend.adopt).not.toHaveBeenCalled();
      expect(JSON.parse(b.local.data.get(ADOPT_KEY) ?? 'null')).toMatchObject({ stage: 'offered', at: 8_900_000 });
    });
    it('10 分を過ぎた offered + Google でも、adopt する（期限で捨てる前に見る）', async () => {
      const b = build();
      googleNow(b);
      b.plant('offered', 9_000_000 - OFFER_TTL_MS - 5_000);
      expect(await resumeAdopt(b.deps)).toBe('この端末のチケットと服を、アカウントに合わせました');
      expect(b.backend.adopt).toHaveBeenCalledWith(WORD);
    });
    it('10 分を過ぎた offered + 匿名 → いつもの期限どおり、捨てる', async () => {
      const b = build();
      b.plant('offered', 9_000_000 - OFFER_TTL_MS - 5_000);
      expect(await resumeAdopt(b.deps)).toBeNull();
      expect(b.backend.adopt).not.toHaveBeenCalled();
      expect(b.local.data.has(ADOPT_KEY)).toBe(false);
    });
    it('prepare が投げたら、何もしない（覚えもそのまま。期限で捨てることもしない）', async () => {
      const b = build();
      b.prepare.mockRejectedValue(new Error('offline'));
      b.plant('offered', 9_000_000 - OFFER_TTL_MS - 5_000);
      expect(await resumeAdopt(b.deps)).toBeNull();
      expect(b.backend.adopt).not.toHaveBeenCalled();
      expect(b.local.data.has(ADOPT_KEY)).toBe(true);
    });
  });
  describe('積み残し', () => {
    it('覚えが無くても、積み残しだけあれば、adopt する。done なら、控えを外して文を返し、積み残しを消す', async () => {
      const b = build();
      b.local.setItem(BACKLOG_KEY, JSON.stringify([{ word: 'w-bl', from: 'OLD1' }]));
      expect(await resumeAdopt(b.deps)).toBe('この端末のチケットと服を、アカウントに合わせました');
      expect(b.backend.adopt).toHaveBeenCalledWith('w-bl');
      expect(b.local.data.has(BACKLOG_KEY)).toBe(false);
      expect((await b.library.all()).map((i) => i.id)).toEqual(['my:b1']);
    });
    it('積み残しが wait / 落ちた → 残す。文は無い', async () => {
      const b = build();
      b.local.setItem(BACKLOG_KEY, JSON.stringify([{ word: 'w-1', from: 'OLD1' }, { word: 'w-2', from: 'OLD1' }]));
      b.backend.adopt.mockImplementation(async (word: string) => {
        if (word === 'w-2') throw new Error('offline');
        return { status: 'wait' as const, tickets: 0, items: 0 };
      });
      expect(await resumeAdopt(b.deps)).toBeNull();
      expect(JSON.parse(b.local.data.get(BACKLOG_KEY) ?? 'null')).toHaveLength(2);
      expect(lines).toContain('adopt later');
    });
    it('switched の覚えと積み残しの両方を adopt する', async () => {
      const b = build();
      b.plant('switched');
      b.local.setItem(BACKLOG_KEY, JSON.stringify([{ word: 'w-bl', from: 'BBBB' }]));
      await resumeAdopt(b.deps);
      expect(b.backend.adopt.mock.calls.map((call) => call[0])).toEqual([WORD, 'w-bl']);
    });
  });
  it('同時に 2 回呼ばれても（StrictMode）、adopt は 1 回', async () => {
    const b = build();
    b.plant('switched');
    const [first, second] = await Promise.all([resumeAdopt(b.deps), resumeAdopt(b.deps)]);
    expect(first).toBe(second);
    expect(b.backend.adopt).toHaveBeenCalledTimes(1);
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
