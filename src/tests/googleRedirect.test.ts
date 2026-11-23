/**
 * ログイン方法 2（画面を移る）の純粋な部分のテスト。端末の置き場（local / session）はメモリの中。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  buildAuthUrl,
  captureReturn,
  clearReturn,
  GOOGLE_AUTH_URL,
  hasReturn,
  LOGIN_TTL_MS,
  nonceOf,
  parseReturn,
  PENDING_KEY,
  randomToken,
  readReturn,
  redirectUriOf,
  RETURN_KEY,
  savePending,
  sha256Hex,
} from '../cloud/googleRedirect';
import type { PendingLogin } from '../cloud/googleRedirect';

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
const jwt = (payload: unknown) => `x.${b64url(JSON.stringify(payload))}.x`;

const RAW = 'raw-nonce-0123456789abcdef01234567';
const pending = (over: Partial<PendingLogin> = {}): PendingLogin => ({ state: 's1', rawNonce: RAW, intent: 'link', at: 1000, ...over });

describe('sha256Hex・randomToken', () => {
  it('sha256Hex は、16 進の SHA-256', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('randomToken は、16 進 32 文字で、呼ぶたびに違う', () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('redirectUriOf・buildAuthUrl', () => {
  it('origin と base をつなぐ', () => {
    expect(redirectUriOf('https://kake-git-hub.github.io', '/DressUpGame/')).toBe('https://kake-git-hub.github.io/DressUpGame/');
  });
  it('Google へ移る URL に、決まりの項目が入る', () => {
    const url = new URL(buildAuthUrl({ clientId: 'c-1.apps.googleusercontent.com', redirectUri: 'https://x.example/app/', state: 'st', nonce: 'nn' }));
    expect(url.origin + url.pathname).toBe(GOOGLE_AUTH_URL);
    expect(url.searchParams.get('client_id')).toBe('c-1.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe('https://x.example/app/');
    expect(url.searchParams.get('state')).toBe('st');
    expect(url.searchParams.get('nonce')).toBe('nn');
    expect(url.searchParams.get('response_type')).toBe('id_token');
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('prompt')).toBe('select_account');
  });
});

describe('parseReturn', () => {
  it('証明つきの戻りを読む', () => {
    expect(parseReturn('#state=s1&id_token=aaa.bbb.ccc')).toEqual({ state: 's1', idToken: 'aaa.bbb.ccc' });
  });
  it('エラーつきの戻りを読む', () => {
    expect(parseReturn('#error=access_denied&state=s1')).toEqual({ state: 's1', error: 'access_denied' });
  });
  it('ログインの戻りでなければ null', () => {
    expect(parseReturn('')).toBeNull();
    expect(parseReturn('#foo')).toBeNull();
    expect(parseReturn('#id_token=x')).toBeNull();
    expect(parseReturn('#state=s1')).toBeNull();
  });
});

describe('captureReturn', () => {
  const env = (hash: string, session: ReturnType<typeof memoryStore> | null) => {
    const replaceState = vi.fn();
    return { replaceState, env: { location: { hash, pathname: '/DressUpGame/', search: '?studio=fake' }, history: { replaceState }, session } };
  };
  it('戻りなら、URL から # を消し（search は残す）、session に置く', () => {
    const session = memoryStore();
    const { replaceState, env: e } = env('#state=s1&id_token=a.b.c', session);
    expect(captureReturn(e)).toBe(true);
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(replaceState.mock.calls[0][2]).toBe('/DressUpGame/?studio=fake');
    expect(JSON.parse(session.data.get(RETURN_KEY)!)).toEqual({ state: 's1', idToken: 'a.b.c' });
    expect(hasReturn(session)).toBe(true);
  });
  it('戻りでない # には、触らない', () => {
    const session = memoryStore();
    const { replaceState, env: e } = env('#foo', session);
    expect(captureReturn(e)).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(session.data.size).toBe(0);
  });
  it('session が無くても・書けなくても、URL からは消す', () => {
    const none = env('#state=s1&id_token=a.b.c', null);
    expect(captureReturn(none.env)).toBe(true);
    expect(none.replaceState).toHaveBeenCalledTimes(1);
    const broken = { ...memoryStore(), setItem: () => { throw new Error('full'); } };
    const failing = env('#state=s1&id_token=a.b.c', broken as unknown as ReturnType<typeof memoryStore>);
    expect(captureReturn(failing.env)).toBe(true);
    expect(failing.replaceState).toHaveBeenCalledTimes(1);
  });
});

describe('readReturn・clearReturn', () => {
  const NOW = 2000;
  async function setup(returned: object | null, saved: PendingLogin | null) {
    const session = memoryStore(returned ? { [RETURN_KEY]: JSON.stringify(returned) } : {});
    const local = memoryStore();
    if (saved) savePending(local, saved);
    return { session, local, env: { session, local, now: () => NOW } };
  }
  const goodToken = async () => jwt({ nonce: await sha256Hex(RAW), email: 'a@example.com' });

  it('戻りが無ければ null', async () => {
    const { env } = await setup(null, pending());
    expect(await readReturn(env)).toBeNull();
  });
  it('覚えが無ければ none', async () => {
    const { env } = await setup({ state: 's1', idToken: await goodToken() }, null);
    expect(await readReturn(env)).toEqual({ ok: false, reason: 'none' });
  });
  it('state が違えば mismatch', async () => {
    const { env } = await setup({ state: 'other', idToken: await goodToken() }, pending());
    expect(await readReturn(env)).toEqual({ ok: false, reason: 'mismatch' });
  });
  it('10 分をすぎていれば expired', async () => {
    const { env } = await setup({ state: 's1', idToken: await goodToken() }, pending({ at: NOW - LOGIN_TTL_MS - 1 }));
    expect(await readReturn(env)).toEqual({ ok: false, reason: 'expired' });
  });
  it('error つきなら、その語を返す', async () => {
    const { env } = await setup({ state: 's1', error: 'access_denied' }, pending());
    expect(await readReturn(env)).toEqual({ ok: false, reason: 'error', error: 'access_denied' });
  });
  it('nonce が合わなければ mismatch', async () => {
    const { env } = await setup({ state: 's1', idToken: jwt({ nonce: 'wrong' }) }, pending());
    expect(await readReturn(env)).toEqual({ ok: false, reason: 'mismatch' });
  });
  it('全部合えば ok。2 回読んでも同じ（消さない）', async () => {
    const idToken = await goodToken();
    const { env } = await setup({ state: 's1', idToken }, pending({ intent: 'signin' }));
    const expected = { ok: true, idToken, rawNonce: RAW, intent: 'signin' };
    expect(await readReturn(env)).toEqual(expected);
    expect(await readReturn(env)).toEqual(expected);
    expect(hasReturn(env.session)).toBe(true);
  });
  it('clearReturn で、戻りも覚えも消える', async () => {
    const { env } = await setup({ state: 's1', idToken: await goodToken() }, pending());
    clearReturn(env);
    expect(hasReturn(env.session)).toBe(false);
    expect(env.local.data.has(PENDING_KEY)).toBe(false);
    expect(await readReturn(env)).toBeNull();
  });
});

describe('nonceOf', () => {
  it('JWT のまん中から nonce を取る（日本語が入っていても）', () => {
    expect(nonceOf(jwt({ nonce: 'abc' }))).toBe('abc');
    expect(nonceOf(jwt({ name: 'たろう', nonce: 'def' }))).toBe('def');
  });
  it('壊れていれば null', () => {
    expect(nonceOf('x')).toBeNull();
    expect(nonceOf('a.b.c')).toBeNull();
    expect(nonceOf(jwt({ email: 'a@example.com' }))).toBeNull();
  });
});
