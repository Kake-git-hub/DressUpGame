/**
 * ログイン方法 2（Google の画面へ移って、戻って来る）の純粋な部分。
 *
 * Firebase は import しない（「つくる」を開いていない端末の読み込みに入れないため）。
 * 戻りの中身（id_token・state）は、きろく・console に出さない。
 */

export const PENDING_KEY = 'dressup_login_pending'; // localStorage: 行く前に覚えるもの（ホーム画面アプリで、戻ったときに消えていないように）
export const RETURN_KEY = 'dressup_login_return'; // sessionStorage: 戻って来た中身（使い終わるまで。自動の更新で読み込み直されても残す）
export const LOGIN_TTL_MS = 600_000; // 10 分
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

export type LoginIntent = 'link' | 'signin'; // 結び付ける / 入る
// 合わせるときの行き来の段階。silent = 画面なしで入る 2 回めの行き来、chooser = アカウントを選ぶ画面つきの 3 回め。無ければ、最初の行き来
export type LoginStep = 'silent' | 'chooser';
export interface PendingLogin {
  state: string;
  rawNonce: string;
  intent: LoginIntent;
  at: number;
  step?: LoginStep;
}
export interface LoginReturn {
  state: string;
  idToken?: string;
  error?: string;
}
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function randomToken(bytes = 16): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function redirectUriOf(origin: string, baseUrl: string): string {
  return origin + baseUrl;
}

export function buildAuthUrl(input: { clientId: string; redirectUri: string; state: string; nonce: string; prompt?: 'none' | 'select_account'; loginHint?: string }): string {
  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('state', input.state);
  url.searchParams.set('prompt', input.prompt ?? 'select_account');
  if (input.loginHint) url.searchParams.set('login_hint', input.loginHint);
  return url.toString();
}

// ログインの戻りでない # （アプリのほかの用途・よその # ）は、null にして、触らない
export function parseReturn(hash: string): LoginReturn | null {
  const text = hash.startsWith('#') ? hash.slice(1) : hash;
  if (!text) return null;
  const params = new URLSearchParams(text);
  const state = params.get('state');
  if (!state) return null;
  const idToken = params.get('id_token');
  if (idToken) return { state, idToken };
  const error = params.get('error');
  if (error) return { state, error };
  return null;
}

// 読み書きは、置き場が使えなくても落ちないように包む
const read = (store: Store | null, key: string): string | null => {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
};
const write = (store: Store | null, key: string, value: string): void => {
  try {
    store?.setItem(key, value);
  } catch {
    // 置けなくても落ちない（そのときは、戻りは使えず、あとで「もう一度」になる）
  }
};
const remove = (store: Store | null, key: string): void => {
  try {
    store?.removeItem(key);
  } catch {
    // 消せなくても落ちない
  }
};

// 起動のいちばん最初に呼ぶ。戻りなら、URL から # を消して（きろく・共有・履歴に残さない。search は残す）、中身を session に置く
export function captureReturn(env: { location: Pick<Location, 'hash' | 'pathname' | 'search'>; history: Pick<History, 'replaceState'>; session: Store | null }): boolean {
  const parsed = parseReturn(env.location.hash);
  if (!parsed) return false;
  try {
    env.history.replaceState(null, '', env.location.pathname + env.location.search);
  } catch {
    // URL を直せなくても、中身は取り込む
  }
  write(env.session, RETURN_KEY, JSON.stringify(parsed));
  return true;
}

export function hasReturn(session: Store | null): boolean {
  return read(session, RETURN_KEY) !== null;
}

export function savePending(local: Store | null, pending: PendingLogin): void {
  write(local, PENDING_KEY, JSON.stringify(pending));
}

const isIntent = (v: unknown): v is LoginIntent => v === 'link' || v === 'signin';
const isStep = (v: unknown): v is LoginStep => v === 'silent' || v === 'chooser';
function readPending(local: Store | null): PendingLogin | null {
  try {
    const value = JSON.parse(read(local, PENDING_KEY) ?? 'null') as Partial<PendingLogin> | null;
    if (value && typeof value.state === 'string' && typeof value.rawNonce === 'string' && isIntent(value.intent) && typeof value.at === 'number') {
      // step が壊れていたら、無いものとして扱う（最初の行き来）
      return { state: value.state, rawNonce: value.rawNonce, intent: value.intent, at: value.at, ...(isStep(value.step) ? { step: value.step } : {}) };
    }
  } catch {
    // 壊れた覚えは、無いものとして扱う
  }
  return null;
}
function readReturned(session: Store | null): LoginReturn | null {
  try {
    const value = JSON.parse(read(session, RETURN_KEY) ?? 'null') as Partial<LoginReturn> | null;
    if (value && typeof value.state === 'string' && (typeof value.idToken === 'string' || typeof value.error === 'string')) return value as LoginReturn;
  } catch {
    // 壊れた戻りは、無いものとして扱う
  }
  return null;
}

// error のとき、step と intent は、覚えの state が合っていたときだけ付く（どの行き来が断られたか分かるように）
export type ReturnCheck =
  | { ok: true; idToken: string; rawNonce: string; intent: LoginIntent; step?: LoginStep }
  | { ok: false; reason: 'none' | 'mismatch' | 'expired' | 'error'; error?: string; step?: LoginStep; intent?: LoginIntent };

// error の語は、きろくに書くので、英数字と _ だけを通す（40 文字まで）
const safeWord = (text: string): string => text.replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);

// 待っている戻りを、確かめて返す（消さない。読み込み直しをはさんでも残す）。戻りが無ければ null
export async function readReturn(env: { session: Store | null; local: Store | null; now: () => number }): Promise<ReturnCheck | null> {
  if (!hasReturn(env.session)) return null;
  const returned = readReturned(env.session);
  const saved = readPending(env.local);
  if (!returned || !saved) return { ok: false, reason: 'none' };
  if (returned.state !== saved.state) return { ok: false, reason: 'mismatch' };
  if (env.now() - saved.at > LOGIN_TTL_MS) return { ok: false, reason: 'expired' };
  const step = saved.step ? { step: saved.step } : {};
  if (returned.error !== undefined || !returned.idToken) return { ok: false, reason: 'error', error: safeWord(returned.error ?? ''), intent: saved.intent, ...step };
  const nonce = nonceOf(returned.idToken);
  if (!nonce || nonce !== (await sha256Hex(saved.rawNonce))) return { ok: false, reason: 'mismatch' };
  return { ok: true, idToken: returned.idToken, rawNonce: saved.rawNonce, intent: saved.intent, ...step };
}

export function clearReturn(env: { session: Store | null; local: Store | null }): void {
  remove(env.session, RETURN_KEY);
  remove(env.local, PENDING_KEY);
}

// JWT のまん中（base64url の JSON。UTF-8）の、文字の項目。読めなければ null
function claimOf(idToken: string, name: 'nonce' | 'sub'): string | null {
  try {
    const middle = idToken.split('.')[1];
    if (!middle) return null;
    const base64 = middle.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
    const value = (JSON.parse(json) as Record<string, unknown>)[name];
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

export const nonceOf = (idToken: string): string | null => claimOf(idToken, 'nonce');
// Google の番号（sub）。2 回めの行き来で、1 回めに選んだアカウントを指定する login_hint に使う。きろくには出さない
export const subOf = (idToken: string): string | null => claimOf(idToken, 'sub');
