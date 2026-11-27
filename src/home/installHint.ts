/**
 * まだホーム画面に追加していない人に、ホーム画面への追加（インストール）やブックマークをすすめる。
 *
 * - 案内を出すのは、だれが開いても（アプリとして開いていない端末なら）。ホームを開いたときに。
 * - 「あとで」で閉じたら、20 時間は出さない（自動の更新や、ログイン・支払いの戻りで読み込み直されても、すぐには出ない）。
 * - 「あとで」を合わせて 3 回押すか、追加できたら、もう出さない（`localStorage` の `dressup_install_hint`）。
 * - 端末に覚えられないとき（保存が使えない）は、出さない側に倒す（閉じたことを覚えられず、毎回出てしまうので）。
 */
export const HINT_KEY = 'dressup_install_hint';
const MAX_CLOSED = 3;
// 「あとで」のあと、出さない時間（だいたい「次の日」まで）
export const SNOOZE_MS = 20 * 60 * 60 * 1000;

// 端末に覚える形。closed = 「あとで」を押した回数、at = 最後に押した時刻、done = もう出さない（追加できた）
interface HintState {
  closed: number;
  at?: number;
  done?: boolean;
}

// 保存が使えなければ null。まだ何も覚えていない・こわれているなら、はじめから（closed 0）
function readState(storage: Pick<Storage, 'getItem'> | null): HintState | null {
  let raw: string | null;
  try {
    if (!storage) return null;
    raw = storage.getItem(HINT_KEY);
  } catch {
    return null;
  }
  try {
    const parsed = (raw ? JSON.parse(raw) : null) as Partial<HintState> | null;
    if (!parsed || typeof parsed !== 'object') return { closed: 0 };
    return {
      closed: typeof parsed.closed === 'number' && parsed.closed > 0 ? Math.floor(parsed.closed) : 0,
      ...(typeof parsed.at === 'number' && Number.isFinite(parsed.at) ? { at: parsed.at } : {}),
      ...(parsed.done === true ? { done: true } : {}),
    };
  } catch {
    return { closed: 0 };
  }
}

function writeState(storage: Pick<Storage, 'setItem'> | null, state: HintState): void {
  try {
    storage?.setItem(HINT_KEY, JSON.stringify(state));
  } catch {
    // 覚えられなくても、遊べる
  }
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
export function wantsInstallHint(storage: Pick<Storage, 'getItem'> | null, standalone: boolean, now: number = Date.now()): boolean {
  if (standalone) return false;
  const state = readState(storage);
  if (state === null || state.done || state.closed >= MAX_CLOSED) return false;
  // 「あとで」から 20 時間は出さない。端末の時計が前にもどっていたら（at が未来）、待たせない
  return state.at === undefined || now < state.at || now - state.at >= SNOOZE_MS;
}

// 「あとで」
export function closeInstallHint(storage: Pick<Storage, 'getItem' | 'setItem'> | null, now: number = Date.now()): void {
  const state = readState(storage);
  if (state) writeState(storage, { ...state, closed: state.closed + 1, at: now });
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
  options: { storage: Pick<Storage, 'getItem' | 'setItem'> | null; standalone: () => boolean; now?: () => number },
): InstallPromptStore {
  let event: InstallPromptEvent | null = null;
  let done = false;
  let count = 0;
  const listeners = new Set<() => void>();
  const changed = () => {
    count++;
    listeners.forEach((listener) => listener());
  };
  target.addEventListener('beforeinstallprompt', (e) => {
    if (wantsInstallHint(options.storage, options.standalone(), (options.now ?? Date.now)())) e.preventDefault();
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
    version: () => count,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
