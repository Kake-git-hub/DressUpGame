/**
 * 「ともだちにおしえる」で教えてもらって開いた人に、ホーム画面への追加（インストール）やブックマークをすすめる。
 *
 * - おしえる の URL には ?from=share の印が付く（share.ts）。開いたら、端末に覚えて、URL からは消す。
 * - 案内を出すのは、教えてもらって開いた端末で、まだアプリとして開いていないとき。「あとで」を 3 回押すか、追加できたら、もう出さない。
 * - 端末に覚えられないとき（保存が使えない）は、出さない側に倒す。
 */
export const SHARE_PARAM = 'from';
export const SHARE_MARK = 'share';
export const HINT_KEY = 'dressup_install_hint';
const MAX_CLOSED = 3;

// 端末に覚える形。closed = 「あとで」を押した回数、done = もう出さない（追加できた）
interface HintState {
  closed: number;
  done?: boolean;
}

function readState(storage: Pick<Storage, 'getItem'> | null): HintState | null {
  try {
    const raw = storage?.getItem(HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HintState>;
    return { closed: typeof parsed.closed === 'number' && parsed.closed > 0 ? Math.floor(parsed.closed) : 0, ...(parsed.done === true ? { done: true } : {}) };
  } catch {
    return null;
  }
}

function writeState(storage: Pick<Storage, 'setItem'> | null, state: HintState): boolean {
  try {
    if (!storage) return false;
    storage.setItem(HINT_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * URL に おしえる の印があれば、端末に覚えて、URL から消す（ブックマークやホーム画面に、印が残らないように）。
 * 覚えられたら true。
 */
export function captureShareArrival(env: {
  location: Pick<Location, 'pathname' | 'search' | 'hash'>;
  history: Pick<History, 'state' | 'replaceState'>;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  userAgent?: string;
}): boolean {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(env.location.search);
  } catch {
    return false;
  }
  if (params.get(SHARE_PARAM) !== SHARE_MARK) return false;
  // LINE などの、アプリの中の画面では、印を残す:「ブラウザで開く」で開き直した先（別の保存場所）でも、案内が出るように
  if (!isInAppBrowser(env.userAgent ?? '')) {
    params.delete(SHARE_PARAM);
    const rest = params.toString();
    try {
      env.history.replaceState(env.history.state, '', `${env.location.pathname}${rest ? `?${rest}` : ''}${env.location.hash}`);
    } catch {
      // URL を直せなくても、案内は出せる
    }
  }
  // 前に覚えたこと（あとでの回数・もう出さない）は、消さない
  return writeState(env.storage, readState(env.storage) ?? { closed: 0 });
}

// もうアプリとして（ホーム画面から）開いているか
export function isStandalone(win: Pick<Window, 'matchMedia' | 'navigator'>): boolean {
  try {
    return win.matchMedia('(display-mode: standalone)').matches || (win.navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

// 案内を出すか。standalone = もうアプリとして（ホーム画面から）開いている
export function wantsInstallHint(storage: Pick<Storage, 'getItem'> | null, standalone: boolean): boolean {
  if (standalone) return false;
  const state = readState(storage);
  return !!state && !state.done && state.closed < MAX_CLOSED;
}

// 「あとで」
export function closeInstallHint(storage: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  const state = readState(storage);
  if (state) writeState(storage, { ...state, closed: state.closed + 1 });
}

// 追加できた: もう出さない
export function finishInstallHint(storage: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  writeState(storage, { ...(readState(storage) ?? { closed: 0 }), done: true });
}

/**
 * 端末ごとの案内の種類
 *  prompt   = ブラウザの「追加」の画面を出せる（ボタン 1 つ）
 *  ios      = iPhone・iPad（共有ボタン → ホーム画面に追加）
 *  android  = Android で、追加の画面を出せない（メニュー → ホーム画面に追加）
 *  inapp    = LINE などの、アプリの中の画面（先に、ブラウザで開いてもらう）
 *  bookmark = パソコンなど（ブックマーク）
 */
export type InstallKind = 'prompt' | 'ios' | 'android' | 'inapp' | 'bookmark';

const IN_APP = /\bLine\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|TikTok|Twitter|\bKAKAOTALK/i;
// LINE・Instagram などの、アプリの中の画面か（ホーム画面への追加ができない）
export function isInAppBrowser(userAgent: string): boolean {
  return IN_APP.test(userAgent);
}

export function installKind(env: { userAgent: string; maxTouchPoints: number; canPrompt: boolean }): InstallKind {
  if (isInAppBrowser(env.userAgent)) return 'inapp';
  if (env.canPrompt) return 'prompt';
  // iPad は、Mac と名のることがある（指で触れる Mac は無いので、触れるなら iPad）
  if (/iPhone|iPad|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(env.userAgent)) return 'android';
  return 'bookmark';
}

// ブラウザの「追加」の画面を出すための知らせ（Chrome・Edge など。Safari・Firefox には無い）
interface InstallPromptEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: string }>;
}

export interface InstallPromptStore {
  canPrompt(): boolean;
  installed(): boolean;
  prompt(): Promise<boolean>; // 追加の画面を出す。追加されたら true
  snoozed(): boolean; // この回（読み込み直すまで）は、「あとで」で閉じた
  snooze(): void;
  version(): number; // 何かが変わるたびに増える（画面の描き直し用）
  subscribe(listener: () => void): () => void;
}

/**
 * ブラウザが「追加の画面を出せる」と知らせてきたら、覚えておく（知らせは、開いてすぐに 1 回だけ来る）。
 * 案内を出す端末でだけ、ブラウザ自身の案内を止める。ほかの端末では、ブラウザに任せる。
 * 追加されたという知らせ（appinstalled）は、ホームを開いていないときに来ても、端末に覚える。
 */
export function createInstallPromptStore(
  target: Pick<EventTarget, 'addEventListener'>,
  options: { storage: Pick<Storage, 'getItem' | 'setItem'> | null; standalone: () => boolean },
): InstallPromptStore {
  let event: InstallPromptEvent | null = null;
  let done = false;
  let closed = false;
  let count = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    count++;
    listeners.forEach((listener) => listener());
  };
  target.addEventListener('beforeinstallprompt', (e) => {
    if (wantsInstallHint(options.storage, options.standalone())) e.preventDefault();
    event = e as InstallPromptEvent;
    changed();
  });
  target.addEventListener('appinstalled', () => {
    event = null;
    done = true;
    finishInstallHint(options.storage);
    changed();
  });
  return {
    canPrompt: () => event !== null,
    installed: () => done,
    async prompt() {
      const current = event;
      if (!current) return false;
      // 知らせは、1 回しか使えない
      event = null;
      changed();
      try {
        await current.prompt();
        return (await current.userChoice).outcome === 'accepted';
      } catch {
        return false;
      }
    },
    snoozed: () => closed,
    snooze() {
      closed = true;
      changed();
    },
    version: () => count,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
