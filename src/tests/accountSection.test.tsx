/**
 * 「つくる」の中の「アカウント」の欄と、ホームの知らせのテスト（裏側の口は偽物）
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Account } from '../appStudio/Account';
import { LOGIN_MESSAGES, NOTICE_KEY } from '../cloud/account';
import type { AccountInfo, LoginResult, StudioAccount } from '../cloud/account';
import type { MyItem, StudioUser } from '../cloud/backend';
import type { Library } from '../cloud/library';
import type { CloudSession } from '../cloud/session';
import { ACKED_KEY, NEW_KEY } from '../cloud/session';
import { LoginNotice } from '../home/LoginNotice';

const EMAIL = 'tameshi@example.com';
const GOOGLE: AccountInfo = { kind: 'google', email: EMAIL };
const GUEST: AccountInfo = { kind: 'guest' };

let items: MyItem[];
let library: Library;
let reload: Mock<() => void>;
const mine = (id: string, owner?: string) => ({ id, ...(owner ? { owner } : {}) }) as unknown as MyItem;

interface Setup {
  info?: AccountInfo; // prepare() が返す、いまの状態
  tickets?: number;
  items?: number; // サーバーにある自分の服の数
  jobs?: number;
  admin?: boolean;
  canRedirect?: boolean;
  prepare?: () => Promise<AccountInfo>;
  popup?: (intent: 'link' | 'signin') => Promise<LoginResult>;
  redirect?: (intent: 'link' | 'signin') => Promise<LoginResult>;
  logout?: () => Promise<void>;
}

function setup(options: Setup = {}) {
  let user: StudioUser = { userCode: 'AAAA', tickets: options.tickets ?? 0, admin: options.admin ?? false };
  let state = { user, jobs: [] as unknown[] };
  const listeners = new Set<() => void>();
  let info = options.info ?? GUEST;
  const account = {
    prepare: vi.fn(options.prepare ?? (async () => info)),
    canRedirect: vi.fn(async () => options.canRedirect ?? true),
    loginWithPopup: vi.fn(options.popup ?? (async () => ({ outcome: 'linked' }) as LoginResult)),
    startRedirect: vi.fn(options.redirect ?? (async () => ({ outcome: 'not-ready' }) as LoginResult)),
    finishRedirect: vi.fn(async () => null),
    logout: vi.fn(options.logout ?? (async () => undefined)),
  };
  const backend = {
    account: account as unknown as StudioAccount,
    signIn: async () => user,
    listMyItems: async () => Array.from({ length: options.items ?? 0 }, (_, i) => ({ id: `s${i}` })),
    openJobs: async () => Array.from({ length: options.jobs ?? 0 }, (_, i) => ({ id: `j${i}` })),
  };
  const session = {
    backend,
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  } as unknown as CloudSession;
  render(<Account session={session} library={library} reload={reload} />);
  // つなぎ役が、チケットの数が変わったと知らせる（作者がチケットを配った、など）
  const setTickets = (tickets: number) => {
    user = { ...user, tickets };
    state = { ...state, user };
    act(() => listeners.forEach((listener) => listener()));
  };
  return { account, setInfo: (next: AccountInfo) => (info = next), setTickets };
}

const popupButton = () => screen.getByTestId('account-login-popup') as HTMLButtonElement;
const redirectButton = () => screen.getByTestId('account-login-redirect') as HTMLButtonElement;
const message = () => screen.getByTestId('account-message').textContent;
const ready = async () => {
  await waitFor(() => expect(popupButton().disabled).toBe(false));
};
const ids = async () => (await library.all()).map((i) => i.id);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  items = [mine('a1', 'AAAA'), mine('a2', 'AAAA'), mine('b1', 'BBBB'), mine('c1')];
  library = {
    all: async () => [...items],
    put: async (item) => void items.push(item),
    remove: async (id) => void (items = items.filter((i) => i.id !== id)),
  };
  reload = vi.fn();
});
afterEach(cleanup);

describe('「アカウント」の欄', () => {
  it('欄を出したあとで、端末が空でなくなったら（チケットが届いた）、「入る」ではなく「結び付ける」にする（チケットを置き去りにしない）', async () => {
    const { account, setTickets } = setup({ tickets: 0 });
    await ready();
    setTickets(3);
    await ready();
    fireEvent.click(popupButton());
    expect(account.loginWithPopup).toHaveBeenCalledWith('link');
  });

  it('見出しと説明、ボタンの文、注意書き', async () => {
    setup();
    await ready();
    const section = screen.getByTestId('account-section');
    expect(section.textContent).toContain('アカウント');
    expect(section.textContent).toContain('Google のアカウントでログインすると、ほかの端末でも、同じチケットと服を使えます。');
    expect(popupButton().textContent).toBe('Google でログイン（方法 1: 小さい窓）');
    expect(redirectButton().textContent).toBe('Google でログイン（方法 2: 画面を移る）');
    expect(section.textContent).toContain('ためしの版です。どちらの方法で、うまくいったか・いかなかったかを、きろく（log）から報告してください。');
  });

  it('準備が済むまで、2 つのボタンは押せない（「準備しています…」）。済むと押せる', async () => {
    let finish: (info: AccountInfo) => void = () => undefined;
    setup({ prepare: () => new Promise<AccountInfo>((resolve) => (finish = resolve)) });
    expect(popupButton().disabled).toBe(true);
    expect(redirectButton().disabled).toBe(true);
    expect(screen.getByTestId('account-section').textContent).toContain('準備しています…');
    await act(async () => finish(GUEST));
    await ready();
    expect(redirectButton().disabled).toBe(false);
    expect(screen.getByTestId('account-section').textContent).not.toContain('準備しています…');
  });

  it('準備に失敗したら、そう出して、ボタンは押せないまま', async () => {
    setup({ prepare: async () => Promise.reject(new Error('x')) });
    await waitFor(() => expect(message()).toBe('いまは、ログインの準備ができません（インターネットを確かめてください）'));
    expect(popupButton().disabled).toBe(true);
    expect(redirectButton().disabled).toBe(true);
  });

  it('空でない端末: 方法 1 は loginWithPopup(link)。クリックが返った時点で、もう呼ばれている。linked → ログイン中と文', async () => {
    const { account, setInfo } = setup({ tickets: 3 });
    await ready();
    let done: (r: LoginResult) => void = () => undefined;
    account.loginWithPopup.mockImplementationOnce(() => new Promise<LoginResult>((resolve) => (done = resolve)));
    fireEvent.click(popupButton());
    expect(account.loginWithPopup).toHaveBeenCalledTimes(1);
    expect(account.loginWithPopup).toHaveBeenCalledWith('link');
    // 待っている間
    expect(screen.getByTestId('account-busy').textContent).toBe('ログインしています…');
    expect(popupButton().disabled).toBe(true);
    expect(redirectButton().disabled).toBe(true);
    setInfo(GOOGLE);
    await act(async () => done({ outcome: 'linked' }));
    await waitFor(() => expect(screen.getByTestId('account-email').textContent).toBe(`ログイン中: ${EMAIL}`));
    expect(message()).toBe(LOGIN_MESSAGES.linked);
    expect(screen.queryByTestId('account-login-popup')).toBeNull();
    expect(screen.queryByTestId('account-busy')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('端末が空かは、チケット・服・仕事・管理者で決まる（どれかがあれば link）', async () => {
    for (const change of [{ items: 1 }, { jobs: 1 }, { admin: true }]) {
      const { account } = setup(change);
      await ready();
      fireEvent.click(popupButton());
      expect(account.loginWithPopup).toHaveBeenCalledWith('link');
      cleanup();
    }
  });

  it('空の端末: 方法 1 は loginWithPopup(signin)。switched → 前の利用者の服だけ控えから外し、知らせを置いて、読み込み直す', async () => {
    localStorage.setItem(NEW_KEY, '["a1"]');
    localStorage.setItem(ACKED_KEY, '["j"]');
    const { account } = setup({ popup: async () => ({ outcome: 'switched' }) });
    await ready();
    fireEvent.click(popupButton());
    expect(account.loginWithPopup).toHaveBeenCalledWith('signin');
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(await ids()).toEqual(['b1', 'c1']);
    expect(localStorage.getItem(NEW_KEY)).toBeNull();
    expect(localStorage.getItem(ACKED_KEY)).toBeNull();
    expect(sessionStorage.getItem(NOTICE_KEY)).toBe(LOGIN_MESSAGES.switched);
  });

  it.each(['taken', 'cancelled', 'no-popup', 'failed', 'not-ready'] as const)('%s → その文が欄に出る。読み込み直さない・控えは変わらない', async (outcome) => {
    setup({ tickets: 2, popup: async () => ({ outcome }) });
    await ready();
    fireEvent.click(popupButton());
    await waitFor(() => expect(message()).toBe(LOGIN_MESSAGES[outcome]));
    expect(reload).not.toHaveBeenCalled();
    expect(await ids()).toEqual(['a1', 'a2', 'b1', 'c1']);
    // 失敗のあとは、また押せる
    expect(popupButton().disabled).toBe(false);
    expect(screen.queryByTestId('account-busy')).toBeNull();
  });

  it('方法 2: startRedirect(intent)。移れなければ（not-ready）、その文', async () => {
    const { account } = setup({ tickets: 1 });
    await ready();
    fireEvent.click(redirectButton());
    expect(account.startRedirect).toHaveBeenCalledWith('link');
    expect(screen.getByTestId('account-busy').textContent).toBe('ログインしています…');
    await waitFor(() => expect(message()).toBe(LOGIN_MESSAGES['not-ready']));
    expect(redirectButton().disabled).toBe(false);
  });

  it('方法 2: 空の端末では signin。移れる間（返らない）は、「ログインしています…」のまま', async () => {
    const { account } = setup({ redirect: () => new Promise<LoginResult>(() => undefined) });
    await ready();
    fireEvent.click(redirectButton());
    expect(account.startRedirect).toHaveBeenCalledWith('signin');
    await act(async () => undefined);
    expect(screen.getByTestId('account-busy')).toBeTruthy();
    expect(redirectButton().disabled).toBe(true);
  });

  it('client_id が分からなくても、方法 2 のボタンは押せる（押したら not-ready の文）', async () => {
    setup({ canRedirect: false });
    await ready();
    await waitFor(() => expect(redirectButton().disabled).toBe(false));
  });

  it('ゲストのとき、「ログアウト」のボタンは無い', async () => {
    setup();
    await ready();
    expect(screen.queryByTestId('account-logout')).toBeNull();
    expect(screen.queryByTestId('account-email')).toBeNull();
  });

  it('ログイン中: メールアドレスと「ログアウト」。メールアドレスが空なら「ログイン中」だけ', async () => {
    setup({ info: { kind: 'google', email: '' } });
    await waitFor(() => expect(screen.getByTestId('account-email').textContent).toBe('ログイン中'));
    expect(screen.getByTestId('account-logout').textContent).toBe('ログアウト');
    expect(screen.queryByTestId('account-login-popup')).toBeNull();
  });

  it('ログアウト: 押すと確かめ。「やめる」で何も起きない', async () => {
    const { account } = setup({ info: GOOGLE });
    await waitFor(() => expect(screen.getByTestId('account-email').textContent).toBe(`ログイン中: ${EMAIL}`));
    expect(screen.queryByTestId('account-logout-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('account-logout'));
    expect(screen.getByTestId('account-logout-confirm').textContent).toContain('ログアウトすると、この端末では、チケットと作った服が見えなくなります。アカウントには残っていて、同じ Google でログインすると戻ります。');
    expect(screen.getByTestId('account-logout-yes').textContent).toBe('ログアウトする');
    expect(screen.getByTestId('account-logout-no').textContent).toBe('やめる');
    fireEvent.click(screen.getByTestId('account-logout-no'));
    expect(screen.queryByTestId('account-logout-confirm')).toBeNull();
    expect(account.logout).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(await ids()).toEqual(['a1', 'a2', 'b1', 'c1']);
  });

  it('ログアウトする: logout() のあと、いまの利用者の服だけ控えから外し、読み込み直す', async () => {
    const { account } = setup({ info: GOOGLE });
    await waitFor(() => expect(screen.getByTestId('account-logout')).toBeTruthy());
    fireEvent.click(screen.getByTestId('account-logout'));
    fireEvent.click(screen.getByTestId('account-logout-yes'));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(account.logout).toHaveBeenCalledTimes(1);
    expect(await ids()).toEqual(['b1', 'c1']);
  });

  it('logout() が投げたら、控えはそのまま・読み込み直さない・文が出る', async () => {
    setup({ info: GOOGLE, logout: async () => Promise.reject(new Error('offline')) });
    await waitFor(() => expect(screen.getByTestId('account-logout')).toBeTruthy());
    fireEvent.click(screen.getByTestId('account-logout'));
    fireEvent.click(screen.getByTestId('account-logout-yes'));
    await waitFor(() => expect(message()).toBe('ログアウトできませんでした。少し待ってから、もう一度ためしてください'));
    expect(reload).not.toHaveBeenCalled();
    expect(await ids()).toEqual(['a1', 'a2', 'b1', 'c1']);
    // もう一度ためせる
    expect(screen.getByTestId('account-logout')).toBeTruthy();
  });
});

describe('ホームの知らせ', () => {
  it('文と「OK」。押すと onClose', () => {
    const onClose = vi.fn();
    render(<LoginNotice message="Google のアカウントでログインしました" onClose={onClose} />);
    expect(screen.getByTestId('login-notice').textContent).toContain('Google のアカウントでログインしました');
    expect(screen.getByTestId('login-notice-ok').textContent).toBe('OK');
    fireEvent.click(screen.getByTestId('login-notice-ok'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
