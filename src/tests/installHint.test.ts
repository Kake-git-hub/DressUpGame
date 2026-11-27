import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shareUrl } from '../home/share';
import { captureShareArrival, closeInstallHint, createInstallPromptStore, finishInstallHint, installKind, wantsInstallHint } from '../home/installHint';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const LINE_IOS = `${IPHONE} Line/15.18.0`;
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

function arrive(search: string, hash = '') {
  const replaceState = vi.fn();
  const location = { pathname: '/DressUpGame/', search, hash };
  return { location, history: { state: { a: 1 }, replaceState }, replaceState };
}

beforeEach(() => localStorage.clear());

describe('おしえる の URL', () => {
  it('教えてもらって開いた、と分かる印（?from=share）を付ける', () => {
    expect(shareUrl('https://kake-git-hub.github.io', '/DressUpGame/')).toBe('https://kake-git-hub.github.io/DressUpGame/?from=share');
  });
});

describe('教えてもらって開いたとき', () => {
  it('印を端末に覚えて、URL から消す（ブックマークやホーム画面に、印が残らないように）', () => {
    const { location, history, replaceState } = arrive('?from=share');
    expect(captureShareArrival({ location, history, storage: localStorage })).toBe(true);
    expect(replaceState).toHaveBeenCalledWith({ a: 1 }, '', '/DressUpGame/');
    expect(wantsInstallHint(localStorage, false)).toBe(true);
  });
  it('ほかの印（?content= など）と # は、残す', () => {
    const { location, history, replaceState } = arrive('?content=e2e-content/&from=share&home=0', '#x');
    expect(captureShareArrival({ location, history, storage: localStorage })).toBe(true);
    expect(replaceState).toHaveBeenCalledWith({ a: 1 }, '', '/DressUpGame/?content=e2e-content%2F&home=0#x');
  });
  it('印が無ければ、何もしない。案内も出さない', () => {
    const { location, history, replaceState } = arrive('?content=e2e-content/');
    expect(captureShareArrival({ location, history, storage: localStorage })).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
    expect(wantsInstallHint(localStorage, false)).toBe(false);
  });
  it('from がほかの値なら、触らない', () => {
    const { location, history, replaceState } = arrive('?from=elsewhere');
    expect(captureShareArrival({ location, history, storage: localStorage })).toBe(false);
    expect(replaceState).not.toHaveBeenCalled();
  });
  it('LINE などの、アプリの中の画面では、URL の印を残す（「ブラウザで開く」で開き直した先でも、案内が出るように）', () => {
    const { location, history, replaceState } = arrive('?from=share');
    expect(captureShareArrival({ location, history, storage: localStorage, userAgent: LINE_IOS })).toBe(true);
    expect(replaceState).not.toHaveBeenCalled();
    expect(wantsInstallHint(localStorage, false)).toBe(true);
  });
  it('端末に覚えられないとき（保存が使えない）は、URL だけ直して、案内は出さない', () => {
    const { location, history, replaceState } = arrive('?from=share');
    expect(captureShareArrival({ location, history, storage: null })).toBe(false);
    expect(replaceState).toHaveBeenCalled();
    expect(wantsInstallHint(null, false)).toBe(false);
  });
});

describe('案内を出すか', () => {
  const arrived = () => captureShareArrival({ ...arrive('?from=share'), storage: localStorage });

  it('もうホーム画面から開いている（アプリとして開いている）なら、出さない', () => {
    arrived();
    expect(wantsInstallHint(localStorage, true)).toBe(false);
  });
  it('次に開いたときも出る。「あとで」を 3 回押したら、もう出さない', () => {
    arrived();
    closeInstallHint(localStorage);
    expect(wantsInstallHint(localStorage, false)).toBe(true);
    closeInstallHint(localStorage);
    expect(wantsInstallHint(localStorage, false)).toBe(true);
    closeInstallHint(localStorage);
    expect(wantsInstallHint(localStorage, false)).toBe(false);
  });
  it('追加できたら、もう出さない', () => {
    arrived();
    finishInstallHint(localStorage);
    expect(wantsInstallHint(localStorage, false)).toBe(false);
  });
  it('もう出さなくなったあとで、また教えてもらって開いても、出さない', () => {
    arrived();
    finishInstallHint(localStorage);
    arrived();
    expect(wantsInstallHint(localStorage, false)).toBe(false);
  });
  it('「あとで」を 3 回押したあとで、また教えてもらって開いても、出さない', () => {
    arrived();
    for (let i = 0; i < 3; i++) closeInstallHint(localStorage);
    arrived();
    expect(wantsInstallHint(localStorage, false)).toBe(false);
  });
  it('覚えがこわれていたら、出さない（教えてもらっていない人に、まちがって出さない）', () => {
    localStorage.setItem('dressup_install_hint', '{こわれた');
    expect(wantsInstallHint(localStorage, false)).toBe(false);
    localStorage.setItem('dressup_install_hint', 'null');
    expect(wantsInstallHint(localStorage, false)).toBe(false);
  });
});

describe('端末ごとの案内の種類', () => {
  it('ブラウザが「追加」の画面を出せるなら、ボタン', () => {
    expect(installKind({ userAgent: ANDROID, maxTouchPoints: 5, canPrompt: true })).toBe('prompt');
    expect(installKind({ userAgent: WINDOWS, maxTouchPoints: 0, canPrompt: true })).toBe('prompt');
  });
  it('iPhone・iPad は、共有ボタンからの手順（iPad は Mac と名のることがある）', () => {
    expect(installKind({ userAgent: IPHONE, maxTouchPoints: 5, canPrompt: false })).toBe('ios');
    expect(installKind({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5, canPrompt: false })).toBe('ios');
  });
  it('Android で「追加」の画面を出せないときは、メニューからの手順', () => {
    expect(installKind({ userAgent: ANDROID, maxTouchPoints: 5, canPrompt: false })).toBe('android');
  });
  it('LINE などの、アプリの中の画面では、先にブラウザで開いてもらう', () => {
    expect(installKind({ userAgent: LINE_IOS, maxTouchPoints: 5, canPrompt: false })).toBe('inapp');
    expect(installKind({ userAgent: `${ANDROID} Instagram 300.0`, maxTouchPoints: 5, canPrompt: false })).toBe('inapp');
    // 追加の画面を出せると言ってきても、アプリの中の画面では、先にブラウザへ
    expect(installKind({ userAgent: `${ANDROID} Line/15.18.0`, maxTouchPoints: 5, canPrompt: true })).toBe('inapp');
  });
  it('パソコンは、ブックマーク（本物の Mac は、指で触れない）', () => {
    expect(installKind({ userAgent: WINDOWS, maxTouchPoints: 0, canPrompt: false })).toBe('bookmark');
    expect(installKind({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0, canPrompt: false })).toBe('bookmark');
  });
});

describe('ブラウザの「追加」の画面', () => {
  const promptEvent = (outcome: 'accepted' | 'dismissed') => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
    event.prompt = vi.fn().mockResolvedValue(undefined);
    event.userChoice = Promise.resolve({ outcome });
    return event;
  };
  const arrived = () => captureShareArrival({ ...arrive('?from=share'), storage: localStorage });
  const storeFor = (target: EventTarget, standalone = false) => createInstallPromptStore(target, { storage: localStorage, standalone: () => standalone });

  it('ブラウザが出せると知らせてきたら、覚えておく。案内を出す端末でだけ、ブラウザ自身の案内を止める', () => {
    arrived();
    const target = new EventTarget();
    const store = storeFor(target);
    const changed = vi.fn();
    store.subscribe(changed);
    expect(store.canPrompt()).toBe(false);
    const event = promptEvent('accepted');
    target.dispatchEvent(event);
    expect(store.canPrompt()).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it('教えてもらっていない端末・もうアプリとして開いている端末では、ブラウザ自身の案内を止めない', () => {
    const target = new EventTarget();
    const store = storeFor(target);
    const event = promptEvent('accepted');
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(store.canPrompt()).toBe(true);

    arrived();
    const other = new EventTarget();
    storeFor(other, true);
    const inApp = promptEvent('accepted');
    other.dispatchEvent(inApp);
    expect(inApp.defaultPrevented).toBe(false);
  });
  it('「ついかする」: 追加の画面を出す。追加されたら true。1 回使ったら、もう出せない', async () => {
    arrived();
    const target = new EventTarget();
    const store = storeFor(target);
    const event = promptEvent('accepted');
    target.dispatchEvent(event);
    expect(await store.prompt()).toBe(true);
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(store.canPrompt()).toBe(false);
    expect(await store.prompt()).toBe(false);
  });
  it('やめたら false', async () => {
    arrived();
    const target = new EventTarget();
    const store = storeFor(target);
    target.dispatchEvent(promptEvent('dismissed'));
    expect(await store.prompt()).toBe(false);
  });
  it('追加されたという知らせ（appinstalled）で、installed になり、端末にも覚える（ホームを開いていないときに追加されても、もう出さない）', () => {
    arrived();
    const target = new EventTarget();
    const store = storeFor(target);
    target.dispatchEvent(promptEvent('accepted'));
    const changed = vi.fn();
    store.subscribe(changed);
    target.dispatchEvent(new Event('appinstalled'));
    expect(store.installed()).toBe(true);
    expect(store.canPrompt()).toBe(false);
    expect(changed).toHaveBeenCalled();
    expect(wantsInstallHint(localStorage, false)).toBe(false);
  });
  it('「あとで」は、その回（読み込み直すまで）のあいだ、覚えている', () => {
    arrived();
    const store = storeFor(new EventTarget());
    expect(store.snoozed()).toBe(false);
    const before = store.version();
    store.snooze();
    expect(store.snoozed()).toBe(true);
    expect(store.version()).not.toBe(before);
    // 次の回（新しい読み込み）では、また出せる
    expect(storeFor(new EventTarget()).snoozed()).toBe(false);
  });
});
