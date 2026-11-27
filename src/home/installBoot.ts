/**
 * 「ホームがめんに ついか」の案内の、起動のときの受け取り（main.tsx が、いちばん最初に呼ぶ）。
 * ブラウザの知らせ（追加の画面を出せる）は、開いてすぐに 1 回しか来ないので、ホーム画面を読み込む前から聞いておく。
 */
import { captureShareArrival, createInstallPromptStore, isStandalone } from './installHint';

export const installStorage: Storage | null = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

// おしえる の URL（?from=share）から開いたなら、端末に覚えて、URL から印を消す
export const arrivedByShare = captureShareArrival({ location: window.location, history: window.history, storage: installStorage, userAgent: window.navigator.userAgent });

export const installPrompts = createInstallPromptStore(window, { storage: installStorage, standalone: () => isStandalone(window) });
