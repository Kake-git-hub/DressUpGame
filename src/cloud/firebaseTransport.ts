/**
 * サーバーの関数を呼ぶ「運び役」の本物（Firebase）
 *
 * 匿名のログインをしてから、関数 studio を呼ぶ（生成を進めるのは、サーバーの列。アプリは呼ばない）。Firestore と Storage は、アプリからは使わない（決まりで断られる）。
 * Firebase の部品は大きいので、このファイルは「つくる」を開いたときに初めて読み込む（createBackend.ts）。
 */
import { initializeApp } from 'firebase/app';
import type { FirebaseOptions } from 'firebase/app';
import { getAuth, GoogleAuthProvider, linkWithCredential, linkWithPopup, OAuthProvider, signInAnonymously, signInWithCredential, signInWithPopup, signOut } from 'firebase/auth';
import type { Auth, AuthError, OAuthCredential } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
import type { AccountInfo, AuthPort } from './account';
import { BackendError } from './backend';
import type { BackendErrorCode } from './backend';
import { firebaseConfig, FUNCTIONS_REGION, GOOGLE_CLIENT_ID } from './firebaseConfig';
import { redirectUriOf } from './googleRedirect';
import type { LoginIntent } from './googleRedirect';
import type { StudioTransport } from './remoteBackend';

const CODES: BackendErrorCode[] = ['offline', 'no-tickets', 'limit', 'refused', 'unknown', 'old-server'];
// 端末はつながっているのに、返事が無い。関数がまだ載っていない・起動に失敗した、でもこうなる（ブラウザからは、通信の失敗と見分けられない）
const NO_ANSWER = 'サーバーから返事がありません。少し待って、開き直してください（続くときは、サーバーの準備ができていないかもしれません。作者に知らせてください）';
const NOT_READY = 'サーバーの準備ができていません（作者の設定が終わっていないか、更新の途中です）';

/**
 * Firebase の失敗を、画面に出せる形（BackendError）に直す。
 * サーバーの関数が理由つきで断ったとき（details.code）は、その理由と文章をそのまま使う。
 */
export function toBackendError(error: unknown, online: boolean = globalThis.navigator?.onLine ?? true): BackendError {
  if (error instanceof BackendError) return error;
  const e = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; message?: unknown; details?: unknown };
  const code = typeof e.code === 'string' ? e.code : '';
  const reason = (typeof e.details === 'object' && e.details !== null ? (e.details as { code?: unknown }).code : undefined) as BackendErrorCode | undefined;
  // Firebase の部品は、文章の後ろに HTTP の番号（「 [400]」など）を付けることがある。画面には出さない
  if (reason && CODES.includes(reason) && typeof e.message === 'string' && e.message) return new BackendError(reason, e.message.replace(/\s*\[\d{3}\]$/, ''));
  // ここから下は、サーバーの理由つきの返事が無い失敗: 呼び出しが届いて、もう済んでいるかもしれない（結果が分からない）
  const unsure = { uncertain: true };
  if (!online) return new BackendError('offline', 'インターネットにつながっていません', unsure);
  switch (code) {
    // 届かなかった・返事が来なかった（SDK は、通信の失敗も、関数が無いときの失敗も、internal として返す）
    case 'functions/internal':
    case 'functions/unavailable':
    case 'functions/deadline-exceeded':
    case 'functions/cancelled':
      return new BackendError('unknown', NO_ANSWER, unsure);
    case 'auth/network-request-failed':
      return new BackendError('offline', 'インターネットにつながっていません', unsure);
    case 'functions/resource-exhausted':
      return new BackendError('limit', 'いま、こみあっています。少し待ってから、もう一度ためしてください', unsure);
    case 'functions/not-found':
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
    case 'auth/configuration-not-found':
      return new BackendError('unknown', NOT_READY, unsure);
    case 'functions/unauthenticated':
      return new BackendError('unknown', 'ログインできませんでした。アプリを開き直してください', unsure);
    default:
      return new BackendError('unknown', 'うまくいきませんでした。少し待ってから、もう一度ためしてください', unsure);
  }
}

// 方法 2 の client_id を、Firebase の公開の受け口（accounts:createAuthUri）に聞く。分からなければ null
export async function lookupClientId(fetchImpl: typeof fetch, apiKey: string, continueUri: string): Promise<string | null> {
  try {
    const response = await fetchImpl(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: 'google.com', continueUri }),
    });
    if (response.status !== 200) return null;
    const body = (await response.json()) as { authUri?: unknown };
    if (typeof body.authUri !== 'string') return null;
    return new URL(body.authUri).searchParams.get('client_id') || null;
  } catch {
    return null;
  }
}

export interface AuthPortDeps {
  auth: Auth;
  resetSignIn: () => void; // ログアウトのあと、次の匿名のログインをやり直せるようにする
  fetchImpl: typeof fetch;
  apiKey: string;
  clientId: string; // 設定にある client_id（空なら調べる）
  continueUri: string;
}

const NO_CURRENT_USER = { code: 'auth/no-current-user' };
const TAKEN_CODE = 'auth/credential-already-in-use';

// AuthPort の本物。呼ぶ前に、匿名のログインは済んでいる（transport.auth() が待つ）
export function createAuthPort(deps: AuthPortDeps): AuthPort {
  const { auth } = deps;
  let lookedUp: Promise<string | null> | null = null;
  // 結び付けが「もう使われている」と断られたとき、そのアカウントに入るのに使う証明の候補（先に試す順。使ったら捨てる）。
  // 乱数つきの証明は、断りと一緒に返る証明に乱数が無いことがあるので、redirect の道では、自分で作った証明も候補に入れる
  let stashed: OAuthCredential[] = [];
  const stash = (error: unknown, built?: OAuthCredential): void => {
    if (typeof error !== 'object' || error === null || (error as { code?: unknown }).code !== TAKEN_CODE) return;
    const candidates: OAuthCredential[] = [];
    try {
      const fromError = OAuthProvider.credentialFromError(error as AuthError);
      if (fromError) candidates.push(fromError);
    } catch {
      // 証明が取れなくても、断られたことは、そのまま伝える
    }
    if (built) candidates.push(built);
    stashed = candidates;
  };
  return {
    current(): AccountInfo {
      const google = auth.currentUser?.providerData.find((p) => p.providerId === 'google.com');
      return google ? { kind: 'google', email: google.email ?? '' } : { kind: 'guest' };
    },
    // async にしない: ボタンの押下の中で、その場で窓を開く（何かを待ってからだと、ブラウザが窓を止める）
    popup(intent: LoginIntent): Promise<void> {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const user = auth.currentUser;
      // 結び付けたいのに、いまの利用者が無いとき、入るに化けさせない（別の利用者に替わってしまう）
      if (intent === 'link' && !user) return Promise.reject(NO_CURRENT_USER);
      stashed = []; // 前の断りの証明は、使わない
      const opened = intent === 'link' && user ? linkWithPopup(user, provider) : signInWithPopup(auth, provider);
      return opened.then(
        () => undefined,
        (error: unknown) => {
          if (intent === 'link') stash(error);
          throw error;
        },
      );
    },
    async withToken(intent: LoginIntent, idToken: string, rawNonce: string): Promise<void> {
      const credential = new OAuthProvider('google.com').credential({ idToken, rawNonce });
      const user = auth.currentUser;
      stashed = []; // 前の断りの証明は、使わない
      if (intent === 'link') {
        if (!user) throw NO_CURRENT_USER;
        try {
          await linkWithCredential(user, credential);
        } catch (error) {
          stash(error, credential);
          throw error;
        }
      } else await signInWithCredential(auth, credential);
    },
    async signInWithStashed(): Promise<boolean> {
      const candidates = stashed;
      stashed = []; // 使ったら捨てる（入れなかったときも）
      let last: unknown;
      for (const candidate of candidates) {
        try {
          await signInWithCredential(auth, candidate);
          return true;
        } catch (error) {
          last = error;
        }
      }
      if (candidates.length > 0) throw last;
      return false;
    },
    async signOut(): Promise<void> {
      await signOut(auth);
      deps.resetSignIn();
    },
    clientId(): Promise<string | null> {
      if (deps.clientId) return Promise.resolve(deps.clientId);
      lookedUp ??= lookupClientId(deps.fetchImpl, deps.apiKey, deps.continueUri);
      return lookedUp;
    },
  };
}

export interface FirebaseTransportOptions {
  config?: FirebaseOptions;
  // エミュレーターにつなぐとき（テスト）
  connect?: (auth: Auth, functions: Functions) => void;
  appName?: string;
}

export function createFirebaseTransport(options: FirebaseTransportOptions = {}): StudioTransport {
  const app = initializeApp(options.config ?? firebaseConfig, options.appName ?? 'dressup-studio');
  const auth = getAuth(app);
  const functions = getFunctions(app, FUNCTIONS_REGION);
  options.connect?.(auth, functions);
  const studio = httpsCallable(functions, 'studio', { timeout: 180_000 });

  // 匿名のログイン（前に開いたときの利用者が残っていれば、そのまま使う）
  let signing: Promise<void> | null = null;
  const ready = (): Promise<void> => {
    signing ??= (async () => {
      await auth.authStateReady();
      if (!auth.currentUser) await signInAnonymously(auth);
    })().catch((error: unknown) => {
      signing = null;
      throw error;
    });
    return signing;
  };

  let port: AuthPort | null = null;
  return {
    async call<T>(data: Record<string, unknown>): Promise<T> {
      try {
        await ready();
        return (await studio(data)).data as T;
      } catch (error) {
        throw toBackendError(error);
      }
    },
    // ログインの口。匿名のログインが済んでから渡す（currentUser があるように）
    async auth(): Promise<AuthPort> {
      try {
        await ready();
      } catch (error) {
        throw toBackendError(error);
      }
      port ??= createAuthPort({
        auth,
        resetSignIn: () => {
          signing = null;
        },
        fetchImpl: (...args) => fetch(...args),
        apiKey: (options.config ?? firebaseConfig).apiKey ?? '',
        clientId: GOOGLE_CLIENT_ID,
        continueUri: redirectUriOf(window.location.origin, import.meta.env.BASE_URL),
      });
      return port;
    },
  };
}
