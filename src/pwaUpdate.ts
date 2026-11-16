/**
 * PWAの自動更新
 * アプリを開いたとき・画面に戻ったときに新しいバージョンを確認する。
 * 新しいバージョンが見つかると Service Worker が入れ替わり、ページが自動で読み込み直される
 * （vite-plugin-pwa の registerType: 'autoUpdate' の動作）。
 */
export interface RegisterSWOptions {
  immediate?: boolean;
  onRegisteredSW?: (swScriptUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
}
export type RegisterSW = (options: RegisterSWOptions) => unknown;

// 戻り値は後始末（イベントの解除）
export function setupAutoUpdate(registerSW: RegisterSW): () => void {
  let registration: ServiceWorkerRegistration | undefined;

  const check = () => {
    // オフラインなどで失敗しても、次に開いたときにまた確認するので無視してよい
    registration?.update().catch(() => {});
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') check();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      registration = reg;
      check();
    },
  });

  return () => document.removeEventListener('visibilitychange', onVisibilityChange);
}
