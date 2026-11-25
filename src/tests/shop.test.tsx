/**
 * チケットを買う画面（パック → 最終確認）と、「つくる」の中の支払いまわり（偽物の裏側）
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStudio } from '../appStudio/AppStudio';
import { pendingSession } from '../appStudio/payReturn';
import { Shop } from '../appStudio/Shop';
import { BackendError } from '../cloud/backend';
import { createFakeBackend } from '../cloud/fakeBackend';
import { addMonthsJst, formatJstDate } from '../cloud/expiry';
import { createSession } from '../cloud/session';
import type { DollData } from '../types';

const packs = [
  { id: '10-300', tickets: 10, price: 300 },
  { id: '30-800', tickets: 30, price: 800 },
];
const doll = { id: 'girl', name: 'おんなのこ', bodyImageUrl: 'g.webp', canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 1, h: 1 } } as DollData;
const library = { all: async () => [], put: async () => undefined, remove: async () => undefined };

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Shop（パック → 最終確認）', () => {
  const fake = () => createFakeBackend({ planMs: 0 });

  it('パックを並べ、選ぶと最終確認が出る。同意の印が無いと「支払いへ進む」は押せない', () => {
    render(<Shop backend={fake()} packs={packs} adultAt={1} onClose={() => undefined} go={() => undefined} />);
    expect(screen.getByTestId('shop-pack-10-300').textContent).toContain('300 円');
    fireEvent.click(screen.getByTestId('shop-pack-10-300'));
    const confirm = screen.getByTestId('shop-confirm').textContent ?? '';
    expect(confirm).toContain('税込 300 円');
    expect(confirm).toContain('チケット 10 枚');
    expect(confirm).toContain('返品・返金はできません');
    expect(screen.getByTestId('shop-until').textContent).toContain(`${formatJstDate(addMonthsJst(Date.now(), 6))}まで`);
    expect(['tokushoho', 'terms', 'privacy'].map((id) => screen.getByTestId(`shop-link-${id}`).getAttribute('href'))).toEqual(['/legal/tokushoho.html', '/legal/terms.html', '/legal/privacy.html']);
    for (const id of ['tokushoho', 'terms', 'privacy']) expect(screen.getByTestId(`shop-link-${id}`).getAttribute('target')).toBe('_blank');
    expect((screen.getByTestId('shop-pay') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('shop-agree'));
    expect((screen.getByTestId('shop-pay') as HTMLButtonElement).disabled).toBe(false);
  });

  it('支払いへ進むと、番号を覚えて、支払いのページへ移る', async () => {
    const go = vi.fn();
    render(<Shop backend={fake()} packs={packs} adultAt={1} onClose={() => undefined} go={go} />);
    fireEvent.click(screen.getByTestId('shop-pack-30-800'));
    fireEvent.click(screen.getByTestId('shop-agree'));
    fireEvent.click(screen.getByTestId('shop-pay'));
    await waitFor(() => expect(go).toHaveBeenCalledTimes(1));
    expect(go.mock.calls[0][0]).toContain('pay=fake');
    expect(pendingSession()).toMatch(/^fake-pay-/);
  });

  it('ログインが要るときは、案内を出して、ログインの欄へ案内する', async () => {
    const onLogin = vi.fn();
    const go = vi.fn();
    render(<Shop backend={createFakeBackend({ planMs: 0, anonymous: true })} packs={packs} adultAt={1} onClose={() => undefined} onLogin={onLogin} go={go} />);
    fireEvent.click(screen.getByTestId('shop-pack-10-300'));
    fireEvent.click(screen.getByTestId('shop-agree'));
    fireEvent.click(screen.getByTestId('shop-pay'));
    await waitFor(() => expect(screen.getByTestId('shop-message').textContent).toContain('Google で ログインすると かえます'));
    expect(go).not.toHaveBeenCalled();
    expect(pendingSession()).toBeNull();
    fireEvent.click(screen.getByTestId('shop-login'));
    expect(onLogin).toHaveBeenCalled();
  });

  it('つながらなかったときは、押し直せる', async () => {
    const backend = fake();
    backend.checkout = async () => {
      throw new BackendError('offline', 'x');
    };
    render(<Shop backend={backend} packs={packs} adultAt={1} onClose={() => undefined} go={() => undefined} />);
    fireEvent.click(screen.getByTestId('shop-pack-10-300'));
    fireEvent.click(screen.getByTestId('shop-agree'));
    fireEvent.click(screen.getByTestId('shop-pay'));
    await waitFor(() => expect(screen.getByTestId('shop-message')).toBeTruthy());
    expect((screen.getByTestId('shop-pay') as HTMLButtonElement).disabled).toBe(false);
  });
});

async function open(options: Parameters<typeof createFakeBackend>[0] = {}, payReturn: Parameters<typeof AppStudio>[0]['payReturn'] = null) {
  const backend = createFakeBackend({ planMs: 0, ...options });
  const session = createSession({ backend, library, onLibraryChanged: () => undefined });
  // 起動のときのログインは、「つくる」を開くより前に済んでいる
  await act(async () => {
    await session.connect();
    render(<AppStudio session={session} library={library} dolls={[doll]} categoriesByDoll={{ girl: [] }} initialDollId="girl" onClose={() => undefined} onOpenCloset={() => undefined} payReturn={payReturn} />);
  });
  return { backend, session };
}

describe('「つくる」の支払いまわり', () => {
  it('ログインしていなければ、押してすぐ案内が出る（保護者の確認の前）。ログインしていれば、確認が出る', async () => {
    await open();
    await waitFor(() => expect(screen.getByTestId('studio-buy')).toBeTruthy());
    fireEvent.click(screen.getByTestId('studio-buy'));
    await waitFor(() => expect(screen.getByTestId('shop-login-message').textContent).toContain('Google で ログインすると かえます'));
    expect(screen.queryByTestId('adult-gate')).toBeNull();
    cleanup();
    localStorage.setItem('dressup_fake_account', JSON.stringify({ google: true }));
    await open();
    await waitFor(() => expect(screen.getByTestId('studio-buy')).toBeTruthy());
    fireEvent.click(screen.getByTestId('studio-buy'));
    await waitFor(() => expect(screen.getByTestId('adult-gate')).toBeTruthy());
  });

  it('売っていないときは、買うボタンが出ない。管理者には出る', async () => {
    await open({ shop: { open: false } });
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    await act(async () => undefined);
    expect(screen.queryByTestId('studio-buy')).toBeNull();
    cleanup();
    localStorage.clear();
    await open({ shop: { open: false }, admin: true });
    await waitFor(() => expect(screen.getByTestId('studio-buy')).toBeTruthy());
  });

  it('買った分の期限が、残りの下に出る（2 つ以上なら、ほか）', async () => {
    await open({ tickets: 2, fakeLots: [{ count: 10, daysLeft: 100 }, { count: 30, daysLeft: 150 }] });
    await waitFor(() => expect(screen.getByTestId('studio-lot').textContent).toContain('うち 10 枚は'));
    expect(screen.getByTestId('studio-tickets').textContent).toContain('のこり 42 枚');
    expect(screen.queryByTestId('studio-lots-list')).toBeNull();
    fireEvent.click(screen.getByTestId('studio-lots-more'));
    expect(screen.getByTestId('studio-lots-list').textContent).toContain('うち 30 枚は');
  });

  it('14 日いないに切れる分は、1 回だけ知らせる（その端末で）', async () => {
    await open({ fakeLots: [{ count: 10, daysLeft: 5 }] });
    await waitFor(() => expect(screen.getByTestId('pay-notice').textContent).toContain('10 枚の チケットが'));
    expect(screen.getByTestId('pay-notice').textContent).toContain('で つかえなくなります');
    cleanup();
    await open({ fakeLots: [{ count: 10, daysLeft: 5 }] });
    await waitFor(() => expect(screen.getByTestId('studio-lot')).toBeTruthy());
    await act(async () => undefined);
    expect(screen.queryByTestId('pay-notice')).toBeNull();
  });

  it('ようこそは、「つくる」を開く前のログインで届いていても、1 回だけ出る', async () => {
    await open({ welcome: 3 });
    await waitFor(() => expect(screen.getByTestId('pay-notice').textContent).toContain('ようこそ！ チケットを 3 枚 プレゼント'));
    expect(screen.getAllByTestId('pay-notice')).toHaveLength(1);
  });

  it('戻り done: 払い済みなら「ふえました」', async () => {
    const backend = createFakeBackend({ planMs: 0 });
    const made = await backend.checkout('10-300', 1, 1);
    backend.fakePay(made.session, 'paid');
    const session = createSession({ backend, library, onLibraryChanged: () => undefined });
    render(<AppStudio session={session} library={library} dolls={[doll]} categoriesByDoll={{ girl: [] }} initialDollId="girl" onClose={() => undefined} onOpenCloset={() => undefined} payReturn={{ kind: 'done', session: made.session }} />);
    await waitFor(() => expect(screen.getByTestId('pay-return').getAttribute('data-status')).toBe('paid'));
    expect(screen.getByTestId('pay-return').textContent).toContain('チケットが 10 枚 ふえました');
    await waitFor(() => expect(screen.getByTestId('studio-tickets').textContent).toContain('のこり 15 枚'));
  });

  it('戻り done: 足されないまま 30 秒たつと「じかんが かかっています」。cancel は「やめました」', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const backend = createFakeBackend({ planMs: 0, payResult: 'slow' });
    const made = await backend.checkout('10-300', 1, 1);
    backend.fakePay(made.session, 'paid');
    const session = createSession({ backend, library, onLibraryChanged: () => undefined });
    render(<AppStudio session={session} library={library} dolls={[doll]} categoriesByDoll={{ girl: [] }} initialDollId="girl" onClose={() => undefined} onOpenCloset={() => undefined} payReturn={{ kind: 'done', session: made.session }} />);
    await waitFor(() => expect(screen.getByTestId('pay-return').getAttribute('data-status')).toBe('checking'));
    expect(screen.getByTestId('pay-return').textContent).toContain('お支払いを たしかめています');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(34_000);
    });
    expect(screen.getByTestId('pay-return').getAttribute('data-status')).toBe('slow');
    expect(screen.getByTestId('pay-return').textContent).toContain('じかんが かかっています');
    cleanup();
    await open({}, { kind: 'cancel' });
    await waitFor(() => expect(screen.getByTestId('pay-return').textContent).toContain('お支払いを やめました'));
  });

  it('戻り done: ほかの人の支払い（pay:other）は、ホーム画面のアプリを開く案内', async () => {
    await open({}, { kind: 'done', session: 'not-mine' });
    await waitFor(() => expect(screen.getByTestId('pay-return').getAttribute('data-status')).toBe('other'));
    expect(screen.getByTestId('pay-return').textContent).toContain('ホーム画面の アプリを ひらくと');
  });

  it('まだ伝えていない足された支払いは、開いたときに 1 回だけ知らせる', async () => {
    const backend = createFakeBackend({ planMs: 0 });
    const made = await backend.checkout('30-800', 1, 1);
    backend.fakePay(made.session, 'paid');
    const session = createSession({ backend, library, onLibraryChanged: () => undefined });
    render(<AppStudio session={session} library={library} dolls={[doll]} categoriesByDoll={{ girl: [] }} initialDollId="girl" onClose={() => undefined} onOpenCloset={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('pay-notice').textContent).toContain('チケットが 30 枚 ふえました'));
    cleanup();
    render(<AppStudio session={createSession({ backend, library, onLibraryChanged: () => undefined })} library={library} dolls={[doll]} categoriesByDoll={{ girl: [] }} initialDollId="girl" onClose={() => undefined} onOpenCloset={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('studio-buy')).toBeTruthy());
    expect(screen.queryByTestId('pay-notice')).toBeNull();
  });
});
