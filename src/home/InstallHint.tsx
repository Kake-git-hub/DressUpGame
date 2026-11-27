/**
 * ホームに出す、小さな窓:「ホームがめんに ついかすると、つぎから すぐ あそべるよ」。
 * まだアプリとして開いていない端末なら、だれにでも、開いたときに 1 回出る（決まりは installHint.ts）。
 * 「あとで」か、窓の外を押すと閉じて、20 時間は出ない（あそんでホームにもどっても、読み込み直しても）。
 */
import { useState, useSyncExternalStore } from 'react';
import { closeInstallHint, finishInstallHint, installKind, wantsInstallHint } from './installHint';
import type { InstallKind, InstallPromptStore } from './installHint';

export interface InstallHintProps {
  store: InstallPromptStore;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  standalone: boolean;
  userAgent: string;
  maxTouchPoints: number;
  now?: () => number;
}

// iPhone・iPad の「共有」の印（四角から上向きの矢印）
const ShareIcon = () => (
  <svg className="install-hint-icon" viewBox="0 0 24 24" aria-label="きょうゆう" role="img">
    <path d="M12 3v12M12 3l-4 4M12 3l4 4M6 11H5v9h14v-9h-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const TITLE: Record<InstallKind, string> = {
  prompt: 'ホームがめんに ついかすると、つぎから すぐ あそべるよ',
  ios: 'ホームがめんに ついかすると、つぎから すぐ あそべるよ',
  android: 'ホームがめんに ついかすると、つぎから すぐ あそべるよ',
  inapp: 'ブラウザで ひらくと、ホームがめんに ついか できるよ',
  bookmark: 'ブックマークすると、つぎから すぐ あそべるよ',
};

function Steps({ kind }: { kind: InstallKind }) {
  switch (kind) {
    case 'ios':
      return (
        <ol className="install-hint-steps">
          <li>
            <ShareIcon /> を おす
          </li>
          <li>「ホーム画面に追加」を えらぶ</li>
        </ol>
      );
    case 'android':
      return (
        <ol className="install-hint-steps">
          <li>ブラウザの メニュー（「︙」や「≡」）を おす</li>
          <li>「ホーム画面に追加」を えらぶ</li>
        </ol>
      );
    case 'inapp':
      return <p className="install-hint-steps">メニュー（「…」や「︙」）から 「ブラウザで開く」を えらんでね</p>;
    case 'bookmark':
      return <p className="install-hint-steps">ブックマーク（おきにいり）に いれてね。 キーボードなら Ctrl + D （Mac は ⌘ + D）</p>;
    default:
      return null;
  }
}

export function InstallHint({ store, storage, standalone, userAgent, maxTouchPoints, now = Date.now }: InstallHintProps) {
  // ブラウザの知らせ（追加の画面を出せる・追加された）で、描き直す
  useSyncExternalStore(store.subscribe, store.version);
  // 出すかどうかは、ホームを開いたときに 1 回だけ決める（出ている途中で、時刻のせいで消えたり出たりしない）
  const [wanted] = useState(() => wantsInstallHint(storage, standalone, now()));
  const [closed, setClosed] = useState(false);

  if (!wanted || closed || store.installed()) return null;
  const kind = installKind({ userAgent, maxTouchPoints, canPrompt: store.canPrompt() });

  const add = () => {
    void store.prompt().then((ok) => {
      if (!ok) return;
      finishInstallHint(storage);
      setClosed(true);
    });
  };
  const later = () => {
    closeInstallHint(storage, now());
    setClosed(true);
  };

  return (
    <div className="home-share-overlay install-hint-overlay" onClick={later} data-testid="install-hint-overlay">
      <div className="home-share-panel install-hint" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="ホームがめんに ついか" data-testid="install-hint" data-kind={kind}>
        <p className="install-hint-title">{TITLE[kind]}</p>
        <Steps kind={kind} />
        <div className="home-share-actions">
          <button onClick={later} data-testid="install-hint-later">
            あとで
          </button>
          {kind === 'prompt' && (
            <button className="primary" onClick={add} data-testid="install-hint-add">
              ついかする
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
