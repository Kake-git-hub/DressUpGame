/// <reference types="vite/client" />
/**
 * ログインの段取り（Google のアカウントに、結び付ける・入る・ログアウトする）。
 *
 * Firebase は import しない。Firebase に触る所は、小さい口（AuthPort）に閉じ込める（本物は firebaseTransport.ts、偽物は fakeAuth.ts）。
 * この段取りは、本物と偽物の両方で同じものを使う（E2E が、本物と同じ段取りを通るように）。
 * きろく（env.note）・結果には、メールアドレス・証明・state・nonce を出さない。Firebase の失敗は、code（auth/…）の文字だけを取り出す。
 */
import { diag } from '../services/diag';
import { BackendError } from './backend';
import type { StudioBackend, StudioUser } from './backend';
import { buildAuthUrl, clearReturn, hasReturn, randomToken, readReturn, savePending, sha256Hex, subOf } from './googleRedirect';
import type { LoginIntent, LoginStep } from './googleRedirect';
import { redirectUriOf } from './googleRedirect';
import type { Library } from './library';
import { ACKED_KEY, NEW_KEY } from './session';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type AccountInfo = { kind: 'guest' } | { kind: 'google'; email: string };
export type LoginOutcome = 'linked' | 'switched' | 'taken' | 'cancelled' | 'not-ready' | 'no-popup' | 'failed' | 'merged' | 'merge-later' | 'taken-old-server' | 'press-again';
export interface LoginResult {
  outcome: LoginOutcome;
  code?: string; // auth/… の語だけ（きろく用）
  step?: LoginStep; // 画面を移る方法の戻りのとき、どの行き来の戻りか（無ければ、最初の行き来）
  hint?: string; // 結び付けが taken だったときだけ、証明の sub（次の行き来の login_hint 用。きろくには出さない）
}

// 合わせたあとの知らせの、後ろの文（起動のときにもう一度 adopt して合わさったときは、この文だけを出す）
const MERGED_TAIL = 'この端末のチケットと服を、アカウントに合わせました';

export const LOGIN_MESSAGES: Record<LoginOutcome, string> = {
  linked: 'Google のアカウントでログインしました',
  switched: 'Google のアカウントでログインしました',
  merged: `Google のアカウントでログインしました。${MERGED_TAIL}`,
  'merge-later': 'Google のアカウントでログインしました。この端末のチケットと服は、インターネットにつながったときに、合わせます',
  'taken-old-server': 'この Google のアカウントは、ほかの端末で使われています。サーバーが古い版のため、まだ合わせられません（作者が載せ直す必要があります）',
  'press-again': 'もう一度「小さい窓でログイン」を押すと、この端末のチケットと服を合わせて、ログインします',
  taken: 'この Google のアカウントは、ほかの端末で使われています。合わせる準備ができませんでした。少し待ってから、もう一度ログインしてください',
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
  // 「もう使われている」と断られたときに Firebase が返した証明で、そのアカウントに入る。証明が無ければ false。入れなければ、投げる
  signInWithStashed(): Promise<boolean>;
  signOut(): Promise<void>;
  clientId(): Promise<string | null>; // 方法 2 の client_id。分からなければ null
}

export interface StudioAccount {
  prepare(): Promise<AccountInfo>; // 口を用意する（Firebase の読み込み・いまの利用者）。失敗は BackendError のまま投げる
  canRedirect(): Promise<boolean>; // 方法 2 の client_id が分かった
  loginWithPopup(intent: LoginIntent): Promise<LoginResult>; // prepare が済んでいなければ { outcome: 'not-ready' }
  // うまくいけば、画面が移る（返らない）。options: 合わせるときの 2・3 回めの行き来（silent = 画面なし + hint で login_hint、chooser = 選ぶ画面つき）
  startRedirect(intent: LoginIntent, options?: { step?: LoginStep; hint?: string }): Promise<LoginResult>;
  // 断りと一緒に返った証明で入る（prepare の前でも、口を用意して呼ぶ）。証明が無ければ false
  signInWithStashed(): Promise<boolean>;
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
  signInWithStashed: async () => false,
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
    const step = check.step ? { step: check.step } : {};
    try {
      if (!check.ok) {
        env.note('back', check.reason === 'error' ? `error=${check.error ?? ''}` : check.reason);
        return { ...noteResult({ outcome: check.reason === 'error' && check.error === 'access_denied' ? 'cancelled' : 'failed' }), ...step };
      }
      env.note('back', 'ok');
      const auth = await getPort();
      try {
        intent = await intentNow(check.intent);
      } catch {
        // 聞けなければ、覚えていたとおりにする
      }
      await auth.withToken(intent, check.idToken, check.rawNonce);
      return { ...noteResult(succeeded(intent)), ...step };
    } catch (error) {
      const result = failedOrLinked(intent, error);
      // 「もう使われている」ときだけ、1 回めに選んだアカウントの番号（sub）を返す（きろくには出さない）
      const hint = check.ok && result.outcome === 'taken' ? subOf(check.idToken) : null;
      return { ...result, ...step, ...(hint ? { hint } : {}) };
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
    startRedirect(intent, options = {}) {
      if (redirectRunning) return redirectRunning;
      const running = (async (): Promise<LoginResult> => {
        try {
          const clientId = await (await getPort()).clientId();
          if (!clientId) return noteResult({ outcome: 'not-ready' });
          const state = randomToken();
          const rawNonce = randomToken();
          const nonce = await sha256Hex(rawNonce);
          const { step, hint } = options;
          savePending(env.local, { state, rawNonce, intent, at: env.now(), ...(step ? { step } : {}) });
          env.note('start', step ? `redirect ${step}` : 'redirect');
          // silent: 1 回めに選んだアカウントを指定して、画面なしで戻してもらう。chooser: アカウントを選ぶ画面つき
          env.goTo(buildAuthUrl({ clientId, redirectUri: env.redirectUri, state, nonce, ...(step === 'silent' ? { prompt: 'none' as const, ...(hint ? { loginHint: hint } : {}) } : {}) }));
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
    async signInWithStashed() {
      return (await getPort()).signInWithStashed();
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

// ---- 合わせる（2 台めの端末のチケットと服を、アカウントに移してもらう。設計書 8.4） ----

export const ADOPT_KEY = 'dressup_adopt_pending'; // localStorage: 合い言葉の覚え（読み込み直し・アプリを閉じても残す）
export const OFFER_TTL_MS = 600_000; // offered の覚えが効く時間（10 分）
export const ADMIN_NOTE = '（この端末は管理者でしたが、合わせたので、管理者の印が外れました。Firebase の画面で、管理者の利用者コードを、いまの利用者コードに書き換えてください。手順書 2-11）';

// stage: offered = 合い言葉をもらった（まだ、アカウントに入っていない）、switched = アカウントに入った（adopt の最後の返事を待っている）
export interface AdoptPending {
  word: string;
  from: string; // 元の（匿名だった）利用者コード
  stage: 'offered' | 'switched';
  at: number;
  hint?: string; // 1 回めに選んだアカウントの番号（sub）。きろくには出さない
  admin?: boolean; // 元が管理者だった
}

// 期限を見ずに、覚えをそのまま読む（壊れた・形が違う覚えは null）。起動のときの resumeAdopt だけが使う
function readRawAdopt(local: Store | null): AdoptPending | null {
  try {
    const value = JSON.parse(local?.getItem(ADOPT_KEY) ?? 'null') as Partial<AdoptPending> | null;
    if (!value || typeof value.word !== 'string' || !value.word || typeof value.from !== 'string' || typeof value.at !== 'number') return null;
    if (value.stage !== 'offered' && value.stage !== 'switched') return null;
    return {
      word: value.word,
      from: value.from,
      stage: value.stage,
      at: value.at,
      ...(typeof value.hint === 'string' && value.hint ? { hint: value.hint } : {}),
      ...(value.admin === true ? { admin: true } : {}),
    };
  } catch {
    return null; // 壊れた覚えは、無いものとして扱う
  }
}

// 10 分を過ぎた offered は、捨てて null（サーバーの合い言葉は、使われないまま残る。害は無い）。switched は、adopt が最後の返事をするまで残す
export function readAdopt(local: Store | null, now: number): AdoptPending | null {
  const value = readRawAdopt(local);
  if (value?.stage === 'offered' && now - value.at > OFFER_TTL_MS) {
    clearAdopt(local);
    return null;
  }
  return value;
}
function writeAdopt(local: Store | null, pending: AdoptPending): boolean {
  try {
    local?.setItem(ADOPT_KEY, JSON.stringify(pending));
    return local !== null;
  } catch {
    return false;
  }
}
function clearAdopt(local: Store | null): void {
  try {
    local?.removeItem(ADOPT_KEY);
  } catch {
    // 消せなくても進む（次の起動で、サーバーが「もう使った」と答えて、捨てられる）
  }
}

// ---- 積み残し（上書きされそうな switched の覚えの合い言葉。adopt が通るまで、取っておく） ----

export const BACKLOG_KEY = 'dressup_adopt_backlog'; // localStorage: [{ word, from }]（最大 5 件、古いものから捨てる）
export const BACKLOG_MAX = 5;
export interface BacklogEntry {
  word: string;
  from: string;
}

function readBacklog(local: Store | null): BacklogEntry[] {
  try {
    const value = JSON.parse(local?.getItem(BACKLOG_KEY) ?? 'null') as unknown;
    if (!Array.isArray(value)) return [];
    const list: BacklogEntry[] = [];
    for (const entry of value as Array<Partial<BacklogEntry> | null>) {
      if (entry && typeof entry.word === 'string' && entry.word && typeof entry.from === 'string') list.push({ word: entry.word, from: entry.from });
    }
    return list.slice(-BACKLOG_MAX);
  } catch {
    return [];
  }
}
function writeBacklog(local: Store | null, list: BacklogEntry[]): boolean {
  try {
    if (list.length === 0) local?.removeItem(BACKLOG_KEY);
    else local?.setItem(BACKLOG_KEY, JSON.stringify(list.slice(-BACKLOG_MAX)));
    return local !== null || list.length === 0;
  } catch {
    return false;
  }
}
// switched の覚えを、上書きされる前に積み残しへ移す。置けなければ false
function pushBacklog(local: Store | null, record: AdoptPending): boolean {
  const rest = readBacklog(local).filter((entry) => entry.word !== record.word);
  return writeBacklog(local, [...rest, { word: record.word, from: record.from }]);
}

// 積み残しの合い言葉を、全部 adopt してみる（Google のアカウントに入っているときに呼ぶ）。1 つでも合わさったら true
async function tryBacklog(deps: SettleDeps): Promise<boolean> {
  const { backend, local, note } = deps;
  const entries = readBacklog(local);
  if (entries.length === 0) return false;
  const kept: BacklogEntry[] = [];
  let merged = false;
  for (const entry of entries) {
    let answer: Awaited<ReturnType<StudioBackend['adopt']>> | null = null;
    try {
      answer = await backend.adopt(entry.word);
    } catch {
      answer = null; // 通信が切れた、など。理由は、きろくに書かない
    }
    if (answer?.status === 'done') {
      merged = true;
      await forgetQuietly(deps, entry.from);
      note('adopt', 'ok', `tickets=${answer.tickets}`, `items=${answer.items}`);
    } else if (answer && (answer.status === 'used' || answer.status === 'unknown' || answer.status === 'refused')) {
      note('adopt', answer.status);
    } else {
      note('adopt', 'later');
      kept.push(entry);
    }
  }
  writeBacklog(local, kept);
  return merged;
}

// 結び付けるか、入るか: 空なら入る。空でなくても、効いている offered の覚えがあれば入る
// （合わせる途中。結び付けると、2 回めも「もう使われている」になって、行き来が終わらない）
export function intentFor(empty: boolean, local: Store | null, now: number): LoginIntent {
  if (empty) return 'signin';
  return readAdopt(local, now)?.stage === 'offered' ? 'signin' : 'link';
}

export interface SettleDeps {
  backend: StudioBackend;
  library: Library;
  session: Store | null;
  local: Store | null;
  now(): number;
  reload(): void;
  note(...parts: string[]): void;
}

// window から作る（Account の欄と、起動の仕上げが使う）
export function browserSettleDeps(backend: StudioBackend, library: Library, reload: () => void = () => window.location.reload()): SettleDeps {
  return { backend, library, session: safeStore(() => window.sessionStorage), local: safeStore(() => window.localStorage), now: () => Date.now(), reload, note: (...parts) => diag.note('login', ...parts) };
}

const putNotice = (session: Store | null, message: string): void => {
  try {
    session?.setItem(NOTICE_KEY, message);
  } catch {
    // 知らせが置けなくても、読み込み直す
  }
};
const forgetQuietly = async (deps: SettleDeps, userCode: string): Promise<void> => {
  try {
    await forgetAccount(deps.library, userCode, deps.local);
  } catch {
    // 控えが外せなくても進む
  }
};

// 入れた（switched）あとの仕上げ。覚えが無ければ、いままでどおり。あれば、adopt で合わせる。どの道も、最後に読み込み直す
async function settleSwitched(deps: SettleDeps, before: StudioUser | null): Promise<null> {
  const { backend, session, local, now, reload, note } = deps;
  const record = readAdopt(local, now());
  try {
    if (!record) {
      // 合わせるものが無い（空の端末・ふつうの入り直し）。入る前の利用者の服だけ、控えから外す
      if (before) await forgetQuietly(deps, before.userCode);
      putNotice(session, LOGIN_MESSAGES.switched);
      return null;
    }
    // 段階を switched に書き直してから adopt する（adopt の途中で落ちても、次の起動で、もう一度できる）
    writeAdopt(local, { ...record, stage: 'switched', at: now() });
    let answer: Awaited<ReturnType<StudioBackend['adopt']>> | null = null;
    try {
      answer = await backend.adopt(record.word);
    } catch {
      answer = null; // 通信が切れた、など。理由は、きろくに書かない
    }
    const adminNote = record.admin ? ADMIN_NOTE : '';
    await tryBacklog(deps); // 前に積み残した合い言葉も（通った分だけ、控えから外す）
    if (answer?.status === 'done') {
      // 合わさった。サーバーでは、アカウントのものになったので、端末の控えから、元の利用者の服を外す（読み込み直しのあと、アカウントの服として取り直す）
      clearAdopt(local);
      await forgetQuietly(deps, record.from);
      note('adopt', 'ok', `tickets=${answer.tickets}`, `items=${answer.items}`);
      note('result', 'merged');
      putNotice(session, LOGIN_MESSAGES.merged + adminNote);
    } else if (answer && (answer.status === 'used' || answer.status === 'unknown' || answer.status === 'refused')) {
      // ほかの人が使った・もう使い終わった・移せない利用者。覚えを持ち続けても、何も起きない
      clearAdopt(local);
      note('adopt', answer.status);
      putNotice(session, LOGIN_MESSAGES.switched);
    } else {
      // 落ちた・まだ匿名（wait）。覚えを残す。端末の控えは外さない（元の服は、端末で着られるまま）
      note('adopt', 'later');
      note('result', 'merge-later');
      putNotice(session, LOGIN_MESSAGES['merge-later'] + adminNote);
    }
    return null;
  } finally {
    reload();
  }
}

// ログインの結果の仕上げ（方法 1・2 で共通）。before: ログインの前の利用者（聞けなかったら null）。
// 返り値: 画面に出す結果。読み込み直した・画面が移る（返らない）ときは null
export async function settleLogin(deps: SettleDeps, result: LoginResult, method: 'popup' | 'redirect', before: StudioUser | null): Promise<LoginResult | null> {
  const { backend, local, now, note } = deps;
  const noted = (outcome: LoginOutcome): LoginResult => {
    note('result', outcome);
    return { outcome };
  };

  if (result.outcome === 'linked') {
    if (readAdopt(local, now())?.stage === 'offered') clearAdopt(local); // 合わせる途中で、結び付けが通った
    return result;
  }

  if (result.outcome === 'taken') {
    // 行き来の戻り（step）での taken は、これ以上続けない（行き来は、最初・画面なし・選ぶ画面の 3 回まで）
    if (result.step) return result;
    if (!before) {
      note('offer', 'failed'); // 元の利用者が分からないと、合わせられない
      return result;
    }
    let word: string;
    try {
      word = await backend.offerHandoff();
    } catch (error) {
      if (error instanceof BackendError && error.code === 'old-server') {
        note('offer', 'old-server');
        return noted('taken-old-server');
      }
      note('offer', 'failed');
      return result;
    }
    // 入ったのに adopt が終わっていない覚え（switched）は、上書きする前に、積み残しへ移す（合い言葉を失わない）
    const unfinished = readAdopt(local, now());
    if (unfinished?.stage === 'switched' && !pushBacklog(local, unfinished)) {
      note('offer', 'failed');
      return result;
    }
    const pending: AdoptPending = { word, from: before.userCode, stage: 'offered', at: now(), ...(result.hint ? { hint: result.hint } : {}), ...(before.admin ? { admin: true } : {}) };
    // 覚えが置けなければ、入ってはいけない（入ったあと、合い言葉を失う）
    if (!writeAdopt(local, pending)) {
      note('offer', 'failed');
      return result;
    }
    note('offer', 'ok');
    let stashed = false;
    try {
      stashed = await backend.account.signInWithStashed();
    } catch {
      stashed = false; // 理由は、きろくに書かない（Firebase のエラーには、メールアドレスが入りうる）
    }
    if (stashed) {
      note('switch', 'stashed');
      return settleSwitched(deps, before);
    }
    if (method === 'redirect') {
      note('switch', 'silent');
      // 画面が移れば、これは返らない。返ってきたら、移れなかった
      return backend.account.startRedirect('signin', { step: 'silent', ...(pending.hint ? { hint: pending.hint } : {}) });
    }
    return noted('press-again'); // 小さい窓は、押してもらわないと開けない。覚え（offered）を残す
  }

  // 画面なしの行き来が、入れなかった（Google が断った・証明が通らなかった）→ アカウントを選ぶ画面つきで、もう 1 回だけ
  if (result.step === 'silent' && result.outcome !== 'switched') {
    note('switch', 'chooser');
    return backend.account.startRedirect('signin', { step: 'chooser' });
  }

  if (result.outcome === 'switched') return settleSwitched(deps, before);

  return result; // cancelled・not-ready・no-popup・failed、選ぶ画面の戻りの失敗: 何もしない
}

const resuming = new WeakMap<StudioBackend, Promise<string | null>>();

// Google に入っているかを、アカウントに聞く（入った直後にページが落ちて、覚えが offered のままのとき）。聞けなければ null
async function signedInToGoogle(backend: StudioBackend): Promise<boolean | null> {
  try {
    return (await backend.account.prepare()).kind === 'google';
  } catch {
    return null;
  }
}

// 起動のとき（つなぎ役を出す前）: 段階 switched の覚え・積み残しがあれば、もう一度 adopt。合わさったら、知らせの文を返す。
// offered のまま残っていても、もう Google に入っていれば switched として扱う（期限の前に、先に見る）
export function resumeAdopt(deps: SettleDeps): Promise<string | null> {
  const { backend, local, now, note } = deps;
  if (!readRawAdopt(local) && readBacklog(local).length === 0) return Promise.resolve(null);
  // 同時に 2 回呼ばれても（StrictMode）、adopt は 1 回
  const running = resuming.get(backend);
  if (running) return running;
  const run = (async (): Promise<string | null> => {
    let record = readRawAdopt(local);
    if (record?.stage === 'offered') {
      const google = await signedInToGoogle(backend);
      if (google) {
        record = { ...record, stage: 'switched', at: now() };
        writeAdopt(local, record);
      } else if (google === false) {
        record = readAdopt(local, now()); // 入っていない: 10 分の期限のとおり
      } else {
        record = null; // 聞けなかった: 今回は何もしない（覚えも、期限で捨てずに残す）
      }
    }
    let notice: string | null = null;
    if (record?.stage === 'switched') {
      let answer: Awaited<ReturnType<StudioBackend['adopt']>> | null = null;
      try {
        answer = await backend.adopt(record.word);
      } catch {
        answer = null; // つながらない。覚えも、端末の服も、そのまま
      }
      if (answer?.status === 'done') {
        clearAdopt(local);
        await forgetQuietly(deps, record.from);
        note('adopt', 'ok', `tickets=${answer.tickets}`, `items=${answer.items}`);
        notice = MERGED_TAIL;
      } else if (answer && (answer.status === 'used' || answer.status === 'unknown' || answer.status === 'refused')) {
        clearAdopt(local);
        note('adopt', answer.status);
      } // 落ちた・wait（まだ匿名）: 何もしない
    }
    if (await tryBacklog(deps)) notice = MERGED_TAIL;
    return notice;
  })();
  resuming.set(backend, run);
  const release = () => {
    if (resuming.get(backend) === run) resuming.delete(backend);
  };
  void run.then(release, release);
  return run;
}

const completing = new WeakMap<StudioBackend, Promise<string | null>>();

// 起動のあと（つなぎ役ができたら）呼ぶ。戻りを受け取り、結果を settleLogin に通して、知らせの文を返す（無ければ null）。
// 入れたときは、settleLogin が、控えを外す・文を NOTICE_KEY に置く・reload() する（返り値は null）
export function completeRedirect(deps: { backend: StudioBackend; library: Library; session: Store | null; local: Store | null; reload(): void; now?: () => number; note?: (...parts: string[]) => void }): Promise<string | null> {
  const { backend, library, session, local, reload } = deps;
  // 同時に 2 回呼ばれても（StrictMode）、受け取りも読み込み直しも 1 回
  const running = completing.get(backend);
  if (running) return running;
  if (!hasReturn(session)) return Promise.resolve(null);
  const settleDeps: SettleDeps = { backend, library, session, local, reload, now: deps.now ?? (() => Date.now()), note: deps.note ?? ((...parts) => diag.note('login', ...parts)) };
  const run = (async (): Promise<string | null> => {
    // 入る前の利用者（入ったあとは、もう聞けない）。聞けなければ、控えは触らない
    let before: StudioUser | null = null;
    try {
      before = await backend.signIn();
    } catch {
      before = null;
    }
    // 効いている offered の覚えがあれば、いつも signin（空でなくなっていても、結び付けに直さない。直すと、行き来が終わらない）
    const result = await backend.account.finishRedirect(async (saved) => {
      if (readAdopt(local, settleDeps.now())?.stage === 'offered') return 'signin';
      return saved === 'signin' && !(await deviceEmpty(backend)) ? 'link' : saved;
    });
    if (!result) return null;
    const settled = await settleLogin(settleDeps, result, 'redirect', before);
    return settled ? LOGIN_MESSAGES[settled.outcome] : null;
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
