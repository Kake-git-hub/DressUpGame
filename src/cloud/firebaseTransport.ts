/**
 * サーバーの関数を呼ぶ「運び役」の本物（Firebase）
 *
 * 匿名のログインをしてから、関数 studio を呼ぶ（生成を進めるのは、サーバーの列。アプリは呼ばない）。Firestore と Storage は、アプリからは使わない（決まりで断られる）。
 * Firebase の部品は大きいので、このファイルは「つくる」を開いたときに初めて読み込む（createBackend.ts）。
 */
import { initializeApp } from 'firebase/app';
import type { FirebaseOptions } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import type { Auth } from 'firebase/auth';
import { getFunctions, httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';
import { BackendError } from './backend';
import type { BackendErrorCode } from './backend';
import { firebaseConfig, FUNCTIONS_REGION } from './firebaseConfig';
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
  if (reason && CODES.includes(reason) && typeof e.message === 'string' && e.message) return new BackendError(reason, e.message);
  if (!online) return new BackendError('offline', 'インターネットにつながっていません');
  switch (code) {
    // 届かなかった・返事が来なかった（SDK は、通信の失敗も、関数が無いときの失敗も、internal として返す）
    case 'functions/internal':
    case 'functions/unavailable':
    case 'functions/deadline-exceeded':
    case 'functions/cancelled':
      return new BackendError('unknown', NO_ANSWER);
    case 'auth/network-request-failed':
      return new BackendError('offline', 'インターネットにつながっていません');
    case 'functions/resource-exhausted':
      return new BackendError('limit', 'いま、こみあっています。少し待ってから、もう一度ためしてください');
    case 'functions/not-found':
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
    case 'auth/configuration-not-found':
      return new BackendError('unknown', NOT_READY);
    case 'functions/unauthenticated':
      return new BackendError('unknown', 'ログインできませんでした。アプリを開き直してください');
    default:
      return new BackendError('unknown', 'うまくいきませんでした。少し待ってから、もう一度ためしてください');
  }
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

  return {
    async call<T>(data: Record<string, unknown>): Promise<T> {
      try {
        await ready();
        return (await studio(data)).data as T;
      } catch (error) {
        throw toBackendError(error);
      }
    },
  };
}
