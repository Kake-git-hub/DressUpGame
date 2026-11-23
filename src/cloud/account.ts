/// <reference types="vite/client" />
/**
 * ログインの段取り（Google のアカウントに、結び付ける・入る・ログアウトする）。
 *
 * Firebase は import しない。Firebase に触る所は、小さい口（AuthPort）に閉じ込める（本物は firebaseTransport.ts、偽物は fakeAuth.ts）。
 * この段取りは、本物と偽物の両方で同じものを使う（E2E が、本物と同じ段取りを通るように）。
 * きろく（env.note）・結果には、メールアドレス・証明・state・nonce を出さない。Firebase の失敗は、code（auth/…）の文字だけを取り出す。
 */
import { diag } from '../services/diag';
import type { StudioBackend } from './backend';
import { buildAuthUrl, clearReturn, hasReturn, randomToken, readReturn, savePending, sha256Hex } from './googleRedirect';
import type { LoginIntent } from './googleRedirect';
import { redirectUriOf } from './googleRedirect';
import type { Library } from './library';
import { ACKED_KEY, NEW_KEY } from './session';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type AccountInfo = { kind: 'guest' } | { kind: 'google'; email: string };
export type LoginOutcome = 'linked' | 'switched' | 'taken' | 'cancelled' | 'not-ready' | 'no-popup' | 'failed';
export interface LoginResult {
  outcome: LoginOutcome;
  code?: string; // auth/… の語だけ（きろく用）
}

export const LOGIN_MESSAGES: Record<LoginOutcome, string> = {
  linked: 'Google のアカウントでログインしました',
  switched: 'Google のアカウントでログインしました',
  taken: 'この Google のアカウントは、ほかの端末で使われています。この端末のチケットと服を合わせるのは、次の版でできるようになります',
  cancelled: 'ログインを やめました',
  'not-ready': 'Google のログインの準備が、まだできていません（作者の設定待ちです）',
  'no-popup': '小さい窓を開けませんでした。方法 2 を試してください',
  failed: 'ログインできませんでした。少し待ってから、もう一度ためしてください',
};

// Firebase を包んだ口。失敗は、{ code: 'auth/…' } を持つ例外（Firebase のエラーそのままでよい）
export interface AuthPort {
  current(): AccountInfo;
  popup(intent: LoginIntent): Promise<void>; // 呼ばれた、その場で窓を開く（中で、先に何も待たない）
  withToken(intent: LoginIntent, idToken: string, rawNonce: string): Promise<void>;
  signOut(): Promise<void>;
  clientId(): Promise<string | null>; // 方法 2 の client_id。分からなければ null
}

export interface StudioAccount {
  prepare(): Promise<AccountInfo>; // 口を用意する（Firebase の読み込み・いまの利用者）。失敗は BackendError のまま投げる
  canRedirect(): Promise<boolean>; // 方法 2 の client_id が分かった
  loginWithPopup(intent: LoginIntent): Promise<LoginResult>; // prepare が済んでいなければ { outcome: 'not-ready' }
  startRedirect(intent: LoginIntent): Promise<LoginResult>; // うまくいけば、画面が移る（返らない）
  // 待っている戻りがあれば、受け取る。無ければ null。intentNow: 覚えていた intent を見て、いま使う intent を返す
  finishRedirect(intentNow: (saved: LoginIntent) => Promise<LoginIntent>): Promise<LoginResult | null>;
  logout(): Promise<void>; // signOut だけ（端末の控えは、呼ぶ側が forgetAccount）
}

export interface AccountEnv {
  redirectUri: string;
  goTo(url: string): void; // 本物: location.assign。偽物: にせの戻り
  session: Store | null; // sessionStorage
  local: Store | null; // localStorage
  now(): number;
  note(...parts: string[]): void; // きろく（既定は diag.note('login', ...)）
  onRestored?(listener: () => void): void; // 戻るボタンで、ページが（bfcache から）また出されたとき、呼ぶ
}

// 「つくる」を、まだ口が無い所に差しておく仮のもの（何もしない）
export const noAccount: StudioAccount = {
  prepare: async () => ({ kind: 'guest' }),
  canRedirect: async () => false,
  loginWithPopup: async () => ({ outcome: 'not-ready' }),
  startRedirect: async () => ({ outcome: 'not-ready' }),
  finishRedirect: async () => null,
  logout: async () => undefined,
};

// きろくに書く語は、英数字と少しの記号だけを通す（長さも切る）
const safeCode = (code: string): string => code.replace(/[^A-Za-z0-9/_-]/g, '').slice(0, 60);

const TAKEN = new Set(['auth/credential-already-in-use', 'auth/email-already-in-use']);
const CANCELLED = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);
const NOT_READY = new Set(['auth/operation-not-allowed', 'auth/unauthorized-domain', 'auth/configuration-not-found', 'auth/admin-restricted-operation']);
const NO_POPUP = new Set(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/web-storage-unsupported']);

// 失敗を、結果に分ける。Firebase のエラーには customData.email などが入っていることがあるので、code の文字だけを取り出す
export function outcomeOf(error: unknown): LoginResult {
  const raw = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (typeof raw !== 'string' || !raw.startsWith('auth/')) return { outcome: 'failed' };
  const code = safeCode(raw);
  if (TAKEN.has(code)) return { outcome: 'taken', code };
  if (CANCELLED.has(code)) return { outcome: 'cancelled', code };
  if (NOT_READY.has(code)) return { outcome: 'not-ready', code };
  if (NO_POPUP.has(code)) return { outcome: 'no-popup', code };
  return { outcome: 'failed', code };
}

const CODE_NOTED = new Set<LoginOutcome>(['failed', 'not-ready', 'no-popup', 'taken']);

export function createAccount(port: () => Promise<AuthPort>, env: AccountEnv): StudioAccount {
  let portPromise: Promise<AuthPort> | null = null;
  let ready: AuthPort | null = null;
  let popupRunning: Promise<LoginResult> | null = null;
  let redirectRunning: Promise<LoginResult> | null = null;
  let finishing: Promise<LoginResult | null> | null = null;

  // 口は 1 回だけ作る。失敗したら、次に、もう一度作れるように覚えを捨てる
  const getPort = (): Promise<AuthPort> => {
    portPromise ??= port().catch((error: unknown) => {
      portPromise = null;
      throw error;
    });
    return portPromise;
  };
  const noteResult = (result: LoginResult): LoginResult => {
    env.note('result', result.outcome, ...(result.code && CODE_NOTED.has(result.outcome) ? [`code=${result.code}`] : []));
    return result;
  };
  const succeeded = (intent: LoginIntent): LoginResult => ({ outcome: intent === 'link' ? 'linked' : 'switched' });
  // 結び付けの途中で読み込み直されると、同じ証明がもう一度渡って、Firebase は「もう結び付いている」と答える。結び付いているので、成功
  const alreadyLinked = (intent: LoginIntent, error: unknown): boolean =>
    intent === 'link' && typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'auth/provider-already-linked';
  const failedOrLinked = (intent: LoginIntent, error: unknown): LoginResult => noteResult(alreadyLinked(intent, error) ? succeeded(intent) : outcomeOf(error));

  const finish = async (intentNow: (saved: LoginIntent) => Promise<LoginIntent>): Promise<LoginResult | null> => {
    const check = await readReturn({ session: env.session, local: env.local, now: env.now });
    if (!check) return null;
    // 結果が出たら（成功でも失敗でも）戻りを消す。使っている途中で読み込み直されても、戻りは残る
    let intent = check.ok ? check.intent : 'signin';
    try {
      if (!check.ok) {
        env.note('back', check.reason === 'error' ? `error=${check.error ?? ''}` : check.reason);
        return noteResult({ outcome: check.reason === 'error' && check.error === 'access_denied' ? 'cancelled' : 'failed' });
      }
      env.note('back', 'ok');
      const auth = await getPort();
      try {
        intent = await intentNow(check.intent);
      } catch {
        // 聞けなければ、覚えていたとおりにする
      }
      await auth.withToken(intent, check.idToken, check.rawNonce);
      return noteResult(succeeded(intent));
    } catch (error) {
      return failedOrLinked(intent, error);
    } finally {
      clearReturn({ session: env.session, local: env.local });
    }
  };

  return {
    async prepare() {
      const auth = await getPort();
      ready = auth;
      return auth.current();
    },
    async canRedirect() {
      return (await (await getPort()).clientId()) !== null;
    },
    // async にしない: ボタンの onClick の中で呼ばれて、その場で窓を開くため（何かを待ってからだと、ブラウザが窓を止める）
    loginWithPopup(intent) {
      if (!ready) return Promise.resolve({ outcome: 'not-ready' });
      if (popupRunning) return popupRunning;
      env.note('start', 'popup');
      let opened: Promise<void>;
      try {
        opened = ready.popup(intent);
      } catch (error) {
        opened = Promise.reject(error);
      }
      const running: Promise<LoginResult> = opened.then(
        () => noteResult(succeeded(intent)),
        (error: unknown) => failedOrLinked(intent, error),
      );
      popupRunning = running;
      void running.then(() => {
        if (popupRunning === running) popupRunning = null;
      });
      return running;
    },
    startRedirect(intent) {
      if (redirectRunning) return redirectRunning;
      const running = (async (): Promise<LoginResult> => {
        try {
          const clientId = await (await getPort()).clientId();
          if (!clientId) return noteResult({ outcome: 'not-ready' });
          const state = randomToken();
          const rawNonce = randomToken();
          const nonce = await sha256Hex(rawNonce);
          savePending(env.local, { state, rawNonce, intent, at: env.now() });
          env.note('start', 'redirect');
          env.goTo(buildAuthUrl({ clientId, redirectUri: env.redirectUri, state, nonce }));
          // 画面が移る。返らない（返ると、移れなかった、と見なされる）。ただし、戻るボタンで戻って来たら（bfcache）、やめたことにする
          return await new Promise<LoginResult>((resolve) => {
            env.onRestored?.(() => {
              clearReturn({ session: env.session, local: env.local });
              redirectRunning = null;
              resolve(noteResult({ outcome: 'cancelled' }));
            });
          });
        } catch (error) {
          return noteResult(outcomeOf(error));
        }
      })();
      redirectRunning = running;
      return running;
    },
    finishRedirect(intentNow) {
      // 同時に呼ばれても（開発用の StrictMode など）、証明は 1 回しか使わない
      if (finishing) return finishing;
      if (!hasReturn(env.session)) return Promise.resolve(null);
      const running = finish(intentNow);
      finishing = running;
      void running.then(
        () => {
          if (finishing === running) finishing = null;
        },
        () => {
          if (finishing === running) finishing = null;
        },
      );
      return running;
    },
    async logout() {
      await (await getPort()).signOut();
      env.note('out');
    },
  };
}

const safeStore = (pick: () => Storage): Store | null => {
  try {
    return pick();
  } catch {
    return null;
  }
};

// window から作る。redirectUri は、アプリの URL（origin + base）
export function browserAccountEnv(goTo: (url: string) => void = (url) => window.location.assign(url)): AccountEnv {
  return {
    redirectUri: redirectUriOf(window.location.origin, import.meta.env.BASE_URL),
    goTo,
    session: safeStore(() => window.sessionStorage),
    local: safeStore(() => window.localStorage),
    now: () => Date.now(),
    note: (...parts) => diag.note('login', ...parts),
    onRestored: (listener) =>
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) listener();
      }),
  };
}

// この端末が空か（設計書 7.2）。チケット 0・自分の服 0・見ていない仕事 0・管理者でない。聞けなければ false（空でない扱い）
export async function deviceEmpty(backend: Pick<StudioBackend, 'signIn' | 'listMyItems' | 'openJobs'>): Promise<boolean> {
  try {
    const user = await backend.signIn();
    if (user.admin || user.tickets > 0) return false;
    if ((await backend.listMyItems()).length > 0) return false;
    return (await backend.openJobs()).length === 0;
  } catch {
    return false;
  }
}

// 端末の控えから、その利用者コードの服だけを外し、NEW の印と「見た仕事」の覚えを消す。
// 「前の利用者の服」（owner が違う・無い）は、サーバーに無くても着られるように残しているので、触らない
export async function forgetAccount(library: Library, userCode: string, local: Store | null): Promise<void> {
  for (const item of await library.all()) {
    if (item.owner !== userCode) continue;
    try {
      await library.remove(item.id);
    } catch {
      // 1 点が消せなくても、残りは外す（ログアウトの読み込み直しを止めない）
    }
  }
  for (const key of [NEW_KEY, ACKED_KEY]) {
    try {
      local?.removeItem(key);
    } catch {
      // 消せなくても進む
    }
  }
}

export const NOTICE_KEY = 'dressup_login_notice'; // sessionStorage: 読み込み直しのあとに出す知らせの文

const completing = new WeakMap<StudioBackend, Promise<string | null>>();

// 起動のあと（つなぎ役ができたら）呼ぶ。戻りを受け取り、知らせの文を返す（無ければ null）。
// 'switched' のときは、forgetAccount → 文を NOTICE_KEY に置く → reload()（返り値は null）
export function completeRedirect(deps: { backend: StudioBackend; library: Library; session: Store | null; local: Store | null; reload(): void }): Promise<string | null> {
  const { backend, library, session, local, reload } = deps;
  // 同時に 2 回呼ばれても（StrictMode）、受け取りも読み込み直しも 1 回
  const running = completing.get(backend);
  if (running) return running;
  if (!hasReturn(session)) return Promise.resolve(null);
  const run = (async (): Promise<string | null> => {
    // 入る前の利用者コード（入ったあとは、もう聞けない）。聞けなければ、控えは触らない
    let before: string | null = null;
    try {
      before = (await backend.signIn()).userCode;
    } catch {
      before = null;
    }
    const result = await backend.account.finishRedirect(async (saved) => (saved === 'signin' && !(await deviceEmpty(backend)) ? 'link' : saved));
    if (!result) return null;
    const message = LOGIN_MESSAGES[result.outcome];
    if (result.outcome !== 'switched') return message;
    if (before) await forgetAccount(library, before, local);
    try {
      session?.setItem(NOTICE_KEY, message);
    } catch {
      // 知らせが置けなくても、読み込み直す
    }
    reload();
    return null;
  })();
  completing.set(backend, run);
  const release = () => {
    if (completing.get(backend) === run) completing.delete(backend);
  };
  void run.then(release, release);
  return run;
}

export function takeNotice(session: Store | null): string | null {
  try {
    const text = session?.getItem(NOTICE_KEY) ?? null;
    if (text !== null) session?.removeItem(NOTICE_KEY);
    return text;
  } catch {
    return null;
  }
}
