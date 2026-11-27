/**
 * 「つくる」の中の「アカウント」の欄と、ホームの知らせのテスト（裏側の口は偽物）
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import { Account } from '../appStudio/Account';
import { ADOPT_KEY, ADMIN_NOTE, LOGIN_MESSAGES, NOTICE_KEY } from '../cloud/account';
import type { AccountInfo, LoginResult, StudioAccount } from '../cloud/account';
import { BackendError } from '../cloud/backend';
import type { AdoptAnswer, MyItem, StudioUser } from '../cloud/backend';
import type { Library } from '../cloud/library';
import type { CloudSession } from '../cloud/session';
import { ACKED_KEY, NEW_KEY } from '../cloud/session';
import { LoginNotice } from '../home/LoginNotice';

const EMAIL = 'tameshi@example.com';
const GOOGLE: AccountInfo = { kind: 'google', email: EMAIL, name: 'ためし はなこ' };
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
  redirect?: (intent: 'link' | 'signin', options?: { step?: string }) => Promise<LoginResult>;
  offer?: () => Promise<string>; // offerHandoff（既定は、合い言葉 'word-1'）
  adopt?: (word: string) => Promise<AdoptAnswer>; // 既定は done（チケット 3・服 1）
  stashed?: boolean; // signInWithStashed の答え（既定 true）
  logout?: () => Promise<void>;
  noUser?: boolean; // つなぎ役が、まだ利用者を知らない（つながっていない）
  signInFails?: boolean; // backend.signIn() が投げる（通信が無い）
  logoutSwapsUserTo?: string; // logout() の中で、つなぎ役のいまの利用者が、別の利用者（空の利用者）に替わる（偽物の裏側と同じ）
}

function setup(options: Setup = {}) {
  let user: StudioUser = { userCode: 'AAAA', tickets: options.tickets ?? 0, free: options.tickets ?? 0, lots: [], admin: options.admin ?? false };
  let state = { user: (options.noUser ? undefined : user) as StudioUser | undefined, jobs: [] as unknown[] };
  const listeners = new Set<() => void>();
  let info = options.info ?? GUEST;
  const account = {
    prepare: vi.fn(options.prepare ?? (async () => info)),
    canRedirect: vi.fn(async () => options.canRedirect ?? true),
    loginWithPopup: vi.fn(async () => ({ outcome: 'linked' }) as LoginResult),
    startRedirect: vi.fn(options.redirect ?? (async () => ({ outcome: 'not-ready' }) as LoginResult)),
    signInWithStashed: vi.fn(async () => options.stashed ?? true),
    finishRedirect: vi.fn(async () => null),
    logout: vi.fn(
      options.logout ??
        (async () => {
          if (options.logoutSwapsUserTo) {
            user = { ...user, userCode: options.logoutSwapsUserTo };
            state = { ...state, user };
          }
        }),
    ),
  };
  const backend = {
    account: account as unknown as StudioAccount,
    signIn: vi.fn(async () => {
      if (options.signInFails) throw new Error('offline');
      return user;
    }),
    listMyItems: async () => Array.from({ length: options.items ?? 0 }, (_, i) => ({ id: `s${i}` })),
    openJobs: async () => Array.from({ length: options.jobs ?? 0 }, (_, i) => ({ id: `j${i}` })),
    offerHandoff: vi.fn(options.offer ?? (async () => 'word-1')),
    adopt: vi.fn(options.adopt ?? (async (): Promise<AdoptAnswer> => ({ status: 'done', tickets: 3, items: 1 }))),
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
    user = { ...user, tickets, free: tickets };
    state = { ...state, user };
    act(() => listeners.forEach((listener) => listener()));
  };
  // つなぎ役は知らせない（作者が、よそからチケットを配った）
  const setTicketsQuietly = (tickets: number) => {
    user = { ...user, tickets, free: tickets };
  };
  return { account, backend, setInfo: (next: AccountInfo) => (info = next), setTickets, setTicketsQuietly };
}

const planted = (over: Record<string, unknown> = {}) => localStorage.setItem(ADOPT_KEY, JSON.stringify({ word: 'word-1', from: 'AAAA', stage: 'offered', at: Date.now(), ...over }));
const redirectButton = () => screen.getByTestId('account-login-redirect') as HTMLButtonElement;
const message = () => screen.getByTestId('account-message').textContent;
const ready = async () => {
  await waitFor(() => expect(redirectButton().disabled).toBe(false));
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
  it('つなぎ役が知らせなくても、20 秒おきに端末が空かを聞き直す（よそから配られたチケットを、置き去りにしない）', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const { account, setTicketsQuietly } = setup({ tickets: 0 });
      await ready();
      setTicketsQuietly(3);
      await act(async () => {
        vi.advanceTimersByTime(20_000);
      });
      expect(redirectButton().disabled).toBe(false); // 聞き直している間も、押せる
      await act(async () => undefined);
      fireEvent.click(redirectButton());
      expect(account.startRedirect).toHaveBeenCalledWith('link');
    } finally {
      vi.useRealTimers();
    }
  });

  it('画面に戻ってきたとき（visible・focus）も、聞き直す', async () => {
    const { account, backend, setTicketsQuietly } = setup({ tickets: 0 });
    await ready();
    const calls = (backend.signIn as Mock).mock.calls.length;
    setTicketsQuietly(2);
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect((backend.signIn as Mock).mock.calls.length).toBeGreaterThan(calls));
    fireEvent.click(redirectButton());
    expect(account.startRedirect).toHaveBeenLastCalledWith('link');
    cleanup();
    // 閉じたあとは、聞かない
    const after = (backend.signIn as Mock).mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect((backend.signIn as Mock).mock.calls.length).toBe(after);
  });

  it('見えていない間の visibilitychange は、聞き直さない', async () => {
    const { backend } = setup();
    await ready();
    const calls = (backend.signIn as Mock).mock.calls.length;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
    }
    expect((backend.signIn as Mock).mock.calls.length).toBe(calls);
  });

  it('欄を出したあとで、端末が空でなくなったら（チケットが届いた）、「入る」ではなく「結び付ける」にする（チケットを置き去りにしない）', async () => {
    const { account, setTickets } = setup({ tickets: 0 });
    await ready();
    setTickets(3);
    await ready();
    fireEvent.click(redirectButton());
    expect(account.startRedirect).toHaveBeenCalledWith('link');
  });

  it('ゲストの欄は、「Google で ログイン」のボタン 1 つだけ。説明の文・小さい窓のボタン・たたむ見出しは無い', async () => {
    setup();
    await ready();
    const section = screen.getByTestId('account-section');
    expect(redirectButton().textContent).toBe('Google で ログイン');
    expect(section.textContent).toBe('Google で ログイン');
    expect(section.querySelectorAll('button').length).toBe(1);
    expect(screen.queryByTestId('account-login-popup')).toBeNull();
    expect(screen.queryByTestId('account-summary')).toBeNull();
    expect(section.tagName).not.toBe('DETAILS');
    expect(section.querySelector('details, summary')).toBeNull();
  });

  it('準備が済むまで、ボタンは押せない（「準備しています…」）。済むと押せる', async () => {
    let finish: (info: AccountInfo) => void = () => undefined;
    setup({ prepare: () => new Promise<AccountInfo>((resolve) => (finish = resolve)) });
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
    expect(redirectButton().disabled).toBe(true);
  });

  it('空でない端末: startRedirect(link)。クリックが返った時点で、もう呼ばれている。linked → ログイン中と文', async () => {
    const { account, setInfo } = setup({ tickets: 3 });
    await ready();
    let done: (r: LoginResult) => void = () => undefined;
    account.startRedirect.mockImplementationOnce(() => new Promise<LoginResult>((resolve) => (done = resolve)));
    fireEvent.click(redirectButton());
    expect(account.startRedirect).toHaveBeenCalledTimes(1);
    expect(account.startRedirect).toHaveBeenCalledWith('link');
    // 待っている間
    expect(screen.getByTestId('account-busy').textContent).toBe('ログインしています…');
    expect(redirectButton().disabled).toBe(true);
    setInfo(GOOGLE);
    await act(async () => done({ outcome: 'linked' }));
    await waitFor(() => expect(screen.getByTestId('account-email').textContent).toBe('ためし はなこ でログイン中'));
    expect(message()).toBe(LOGIN_MESSAGES.linked);
    expect(screen.queryByTestId('account-login-redirect')).toBeNull();
    expect(screen.queryByTestId('account-busy')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  it('端末が空かは、チケット・服・仕事・管理者で決まる（どれかがあれば link）', async () => {
    for (const change of [{ items: 1 }, { jobs: 1 }, { admin: true }]) {
      const { account } = setup(change);
      await ready();
      fireEvent.click(redirectButton());
      expect(account.startRedirect).toHaveBeenCalledWith('link');
      cleanup();
    }
  });

  it('空の端末: startRedirect(signin)。switched（覚えが無い）→ settleLogin を通る: 前の利用者の服だけ控えから外し、知らせを置いて、読み込み直す。adopt は呼ばない', async () => {
    localStorage.setItem(NEW_KEY, '["a1"]');
    localStorage.setItem(ACKED_KEY, '["j"]');
    const { account, backend } = setup({ redirect: async () => ({ outcome: 'switched' }) });
    await ready();
    fireEvent.click(redirectButton());
    expect(account.startRedirect).toHaveBeenCalledWith('signin');
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(backend.adopt).not.toHaveBeenCalled();
    expect(await ids()).toEqual(['b1', 'c1']);
    expect(localStorage.getItem(NEW_KEY)).toBeNull();
    expect(localStorage.getItem(ACKED_KEY)).toBeNull();
    expect(sessionStorage.getItem(NOTICE_KEY)).toBe(LOGIN_MESSAGES.switched);
  });

  it.each(['cancelled', 'no-popup', 'failed', 'not-ready'] as const)('%s → その文が欄に出る。読み込み直さない・控えは変わらない', async (outcome) => {
    setup({ tickets: 2, redirect: async () => ({ outcome }) });
    await ready();
    fireEvent.click(redirectButton());
    await waitFor(() => expect(message()).toBe(LOGIN_MESSAGES[outcome]));
    expect(reload).not.toHaveBeenCalled();
    expect(await ids()).toEqual(['a1', 'a2', 'b1', 'c1']);
    // 失敗のあとは、また押せる
    expect(redirectButton().disabled).toBe(false);
    expect(screen.queryByTestId('account-busy')).toBeNull();
  });

  it('taken → 合い言葉をもらい、証明で入れれば、adopt で合わさる: 知らせ merged を置いて、元の利用者の服だけ控えから外し、読み込み直す', async () => {
    localStorage.setItem(NEW_KEY, '["a1"]');
    const { account, backend } = setup({ tickets: 2, redirect: async () => ({ outcome: 'taken', code: 'auth/credential-already-in-use', hint: 'sub-secret' }) });
    await ready();
    fireEvent.click(redirectButton());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(backend.offerHandoff).toHaveBeenCalledTimes(1);
    expect(account.signInWithStashed).toHaveBeenCalledTimes(1);
    expect(backend.adopt).toHaveBeenCalledWith('word-1');
    expect(sessionStorage.getItem(NOTICE_KEY)).toBe(LOGIN_MESSAGES.merged);
    expect(await ids()).toEqual(['b1', 'c1']);
    expect(localStorage.getItem(ADOPT_KEY)).toBeNull();
    expect(account.startRedirect).toHaveBeenCalledTimes(1); // 押したときの 1 回だけ（もう一度、画面を移らない）
  });

  it('taken、証明が返らない → 覚え（offered）を残して、画面なしの行き来（signin・silent）へ進む。控えは、まだ外さない', async () => {
    const { account } = setup({ tickets: 2, stashed: false, redirect: async (_intent, options?: { step?: string }) => (options?.step ? { outcome: 'not-ready' } : { outcome: 'taken', code: 'auth/credential-already-in-use' }) });
    await ready();
    fireEvent.click(redirectButton());
    await waitFor(() => expect(account.startRedirect).toHaveBeenCalledTimes(2));
    expect(account.startRedirect).toHaveBeenLastCalledWith('signin', { step: 'silent' });
    expect(JSON.parse(localStorage.getItem(ADOPT_KEY)!)).toMatchObject({ word: 'word-1', from: 'AAAA', stage: 'offered' });
    expect(reload).not.toHaveBeenCalled();
    expect(await ids()).toEqual(['a1', 'a2', 'b1', 'c1']);
  });

  it('効いている offered の覚えがあれば、空でなくても、signin。10 分を過ぎた覚えは、無いのと同じ（link）', async () => {
    planted();
    const first = setup({ tickets: 3 });
    await ready();
    fireEvent.click(redirectButton());
    expect(first.account.startRedirect).toHaveBeenCalledWith('signin');
    cleanup();
    planted({ at: Date.now() - 11 * 60_000 });
    const second = setup({ tickets: 3 });
    await ready();
    fireEvent.click(redirectButton());
    expect(second.account.startRedirect).toHaveBeenCalledWith('link');
    expect(localStorage.getItem(ADOPT_KEY)).toBeNull();
  });

  it('サーバーが古い（old-server）→ その文。何も変えない・覚えも置かない', async () => {
    setup({ tickets: 2, redirect: async () => ({ outcome: 'taken' }), offer: async () => Promise.reject(new BackendError('old-server', '古い')) });
    await ready();
    fireEvent.click(redirectButton());
    await waitFor(() => expect(message()).toBe(LOGIN_MESSAGES['taken-old-server']));
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(ADOPT_KEY)).toBeNull();
    expect(await ids()).toEqual(['a1', 'a2', 'b1', 'c1']);
  });

  it('合い言葉がもらえない → 書き換えた taken の文（合わせる準備ができませんでした）。何も変えない', async () => {
    setup({ tickets: 2, redirect: async () => ({ outcome: 'taken' }), offer: async () => Promise.reject(new BackendError('offline', 'x')) });
    await ready();
    fireEvent.click(redirectButton());
    await waitFor(() => expect(message()).toBe('この Google のアカウントは、ほかの端末で使われています。合わせる準備ができませんでした。少し待ってから、もう一度ログインしてください'));
    expect(reload).not.toHaveBeenCalled();
    expect(localStorage.getItem(ADOPT_KEY)).toBeNull();
    expect(redirectButton().disabled).toBe(false);
  });

  it('入ったあと adopt が落ちたら → merge-later の文を置いて読み込み直す。覚えは switched で残り、端末の服は外さない', async () => {
    const { backend } = setup({ tickets: 2, redirect: async () => ({ outcome: 'taken' }), adopt: async () => Promise.reject(new BackendError('offline', 'x')) });
    await ready();
    fireEvent.click(redirectButton());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(backend.adopt).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(NOTICE_KEY)).toBe(LOGIN_MESSAGES['merge-later']);
    expect(JSON.parse(localStorage.getItem(ADOPT_KEY)!)).toMatchObject({ word: 'word-1', stage: 'switched' });
    expect(await ids()).toEqual(['a1', 'a2', 'b1', 'c1']);
  });

  it('管理者の端末で合わさったら、知らせに「管理者の印が外れました」が付く', async () => {
    setup({ admin: true, redirect: async () => ({ outcome: 'taken' }) });
    await ready();
    fireEvent.click(redirectButton());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(NOTICE_KEY)).toBe(LOGIN_MESSAGES.merged + ADMIN_NOTE);
  });

  it('ボタンを押すと startRedirect(intent)。移れなければ（not-ready）、その文', async () => {
    const { account } = setup({ tickets: 1 });
    await ready();
    fireEvent.click(redirectButton());
    expect(account.startRedirect).toHaveBeenCalledWith('link');
    expect(account.startRedirect).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('account-busy').textContent).toBe('ログインしています…');
    await waitFor(() => expect(message()).toBe(LOGIN_MESSAGES['not-ready']));
    expect(redirectButton().disabled).toBe(false);
  });

  it('空の端末では signin。移れる間（返らない）は、「ログインしています…」のまま', async () => {
    const { account } = setup({ redirect: () => new Promise<LoginResult>(() => undefined) });
    await ready();
    fireEvent.click(redirectButton());
    expect(account.startRedirect).toHaveBeenCalledWith('signin');
    await act(async () => undefined);
    expect(screen.getByTestId('account-busy')).toBeTruthy();
    expect(redirectButton().disabled).toBe(true);
  });

  it('client_id が分からなくても、ボタンは押せる（押したら not-ready の文）', async () => {
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

  it('ログイン中: 名前（メールアドレスではない）と「ログアウト」。名前が空なら「ログイン中」だけ', async () => {
    setup({ info: { kind: 'google', email: '', name: '' } });
    await waitFor(() => expect(screen.getByTestId('account-email').textContent).toBe('ログイン中'));
    expect(screen.getByTestId('account-logout').textContent).toBe('ログアウト');
    expect(screen.queryByTestId('account-login-redirect')).toBeNull();
  });

  it('ログアウト: 押すと確かめ。「やめる」で何も起きない', async () => {
    const { account } = setup({ info: GOOGLE });
    await waitFor(() => expect(screen.getByTestId('account-email').textContent).toBe('ためし はなこ でログイン中'));
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

  it('ログアウトで、つなぎ役のいまの利用者が空の利用者に替わっても、外すのは、ログアウト前の利用者の服（替わったあとの利用者の服ではない）', async () => {
    setup({ info: GOOGLE, logoutSwapsUserTo: 'ZZZZ' });
    await waitFor(() => expect(screen.getByTestId('account-logout')).toBeTruthy());
    fireEvent.click(screen.getByTestId('account-logout'));
    fireEvent.click(screen.getByTestId('account-logout-yes'));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
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

  const openLogout = async () => {
    await waitFor(() => expect(screen.getByTestId('account-logout')).toBeTruthy());
    fireEvent.click(screen.getByTestId('account-logout'));
    fireEvent.click(screen.getByTestId('account-logout-yes'));
  };
  const CANT_LOGOUT = 'ログアウトできませんでした。インターネットを確かめて、もう一度ためしてください';

  it('つなぎ役が利用者を知らなくても、signIn() で聞いて、その服を外してからログアウトする', async () => {
    const { account } = setup({ info: GOOGLE, noUser: true });
    await openLogout();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(account.logout).toHaveBeenCalledTimes(1);
    expect(await ids()).toEqual(['b1', 'c1']);
  });

  it('利用者が分からない（つなぎ役も signIn() も）ときは、ログアウトしない: 文が出る・何も消さない・読み込み直さない・ためし直せる', async () => {
    const { account } = setup({ info: GOOGLE, noUser: true, signInFails: true });
    await openLogout();
    await waitFor(() => expect(message()).toBe(CANT_LOGOUT));
    expect(account.logout).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(await ids()).toEqual(['a1', 'a2', 'b1', 'c1']);
    expect(screen.queryByTestId('account-logout-confirm')).toBeNull();
    expect((screen.getByTestId('account-logout') as HTMLButtonElement).disabled).toBe(false);
  });

  it('ログアウトのあと、端末の控えが読めなくても（library.all が投げる）、読み込み直す', async () => {
    setup({ info: GOOGLE });
    library.all = async () => Promise.reject(new Error('idb'));
    await openLogout();
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  });

  it('入った（switched）あと、端末の控えが読めなくても、読み込み直す', async () => {
    setup({ redirect: async () => ({ outcome: 'switched' }) });
    await ready();
    library.all = async () => Promise.reject(new Error('idb'));
    fireEvent.click(redirectButton());
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem(NOTICE_KEY)).toBe(LOGIN_MESSAGES.switched);
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
