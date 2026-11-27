import { beforeEach, describe, expect, it, vi } from 'vitest';
import { shareUrl } from '../home/share';
import { closeInstallHint, createInstallPromptStore, finishInstallHint, installKind, wantsInstallHint } from '../home/installHint';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const LINE_IOS = `${IPHONE} Line/15.18.0`;
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 27, 9);

beforeEach(() => localStorage.clear());

describe('おしえる の URL', () => {
  it('アプリの入口そのまま（印は付けない。案内は、だれが開いても出るので、印は要らない）', () => {
    expect(shareUrl('https://kake-git-hub.github.io', '/DressUpGame/')).toBe('https://kake-git-hub.github.io/DressUpGame/');
  });
});

describe('案内を出すか', () => {
  it('だれが開いても出す（まだアプリとして開いていない端末なら、はじめて開いたときから）', () => {
    expect(wantsInstallHint(localStorage, false)).toBe(true);
  });
  it('もうホーム画面から開いている（アプリとして開いている）なら、出さない', () => {
    expect(wantsInstallHint(localStorage, true)).toBe(false);
  });
  it('「あとで」のあと、20 時間は出さない（自動の更新や、ログインの戻りで読み込み直されても、すぐには出ない）。そのあと、また出る', () => {
    closeInstallHint(localStorage, T0);
    expect(wantsInstallHint(localStorage, false, T0 + 1000)).toBe(false);
    expect(wantsInstallHint(localStorage, false, T0 + 19 * HOUR)).toBe(false);
    expect(wantsInstallHint(localStorage, false, T0 + 21 * HOUR)).toBe(true);
  });
  it('「あとで」を合わせて 3 回押したら、何日たっても、もう出さない', () => {
    closeInstallHint(localStorage, T0);
    closeInstallHint(localStorage, T0 + 24 * HOUR);
    expect(wantsInstallHint(localStorage, false, T0 + 48 * HOUR)).toBe(true);
    closeInstallHint(localStorage, T0 + 48 * HOUR);
    expect(wantsInstallHint(localStorage, false, T0 + 1000 * HOUR)).toBe(false);
  });
  it('端末の時計が前にもどっていても、出なくなったままにはしない', () => {
    closeInstallHint(localStorage, T0);
    expect(wantsInstallHint(localStorage, false, T0 - 48 * HOUR)).toBe(true);
  });
  it('追加できたら、もう出さない', () => {
    finishInstallHint(localStorage);
    expect(wantsInstallHint(localStorage, false)).toBe(false);
  });
  it('端末に覚えられないとき（保存が使えない）は、出さない（閉じたことを覚えられず、毎回出てしまうので）', () => {
    expect(wantsInstallHint(null, false)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('no storage');
      },
    };
    expect(wantsInstallHint(broken, false)).toBe(false);
  });
  it('覚えがこわれていたら、はじめからに数え直す（出す。「あとで」は、また 3 回）', () => {
    localStorage.setItem('dressup_install_hint', '{こわれた');
    expect(wantsInstallHint(localStorage, false)).toBe(true);
    for (let i = 0; i < 3; i++) closeInstallHint(localStorage, T0);
    expect(wantsInstallHint(localStorage, false, T0 + 1000 * HOUR)).toBe(false);
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
  const storeFor = (target: EventTarget, standalone = false) => createInstallPromptStore(target, { storage: localStorage, standalone: () => standalone });

  it('ブラウザが出せると知らせてきたら、覚えておく。案内を出す端末でだけ、ブラウザ自身の案内を止める', () => {
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
  it('案内を出さない端末（もう出さないと覚えた・もうアプリとして開いている）では、ブラウザ自身の案内を止めない', () => {
    const other = new EventTarget();
    storeFor(other, true);
    const inApp = promptEvent('accepted');
    other.dispatchEvent(inApp);
    expect(inApp.defaultPrevented).toBe(false);

    for (let i = 0; i < 3; i++) closeInstallHint(localStorage, T0);
    const target = new EventTarget();
    const store = storeFor(target);
    const event = promptEvent('accepted');
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(store.canPrompt()).toBe(true);
  });
  it('「ついかする」: 追加の画面を出す。追加されたら true。1 回使ったら、もう出せない', async () => {
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
    const target = new EventTarget();
    const store = storeFor(target);
    target.dispatchEvent(promptEvent('dismissed'));
    expect(await store.prompt()).toBe(false);
  });
  it('追加されたという知らせ（appinstalled）で、installed になり、端末にも覚える（ホームを開いていないときに追加されても、もう出さない）', () => {
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
});
