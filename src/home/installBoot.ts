/**
 * 「ホームがめんに ついか」の案内の、起動のときの用意（main.tsx が、いちばん最初に読み込む）。
 * ブラウザの知らせ（追加の画面を出せる）は、開いてすぐに 1 回しか来ないので、ホーム画面を読み込む前から聞いておく。
 */
import { createInstallPromptStore, isStandalone } from './installHint';

export const installStorage: Storage | null = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

export const installPrompts = createInstallPromptStore(window, { storage: installStorage, standalone: () => isStandalone(window) });
