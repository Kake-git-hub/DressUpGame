/**
 * 交換の画面のテスト（にせの裏側を差し込んで、順番・遅れた返事・つながらないときを確かめる）
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '../cloud/backend';
import type { MyItem, StudioBackend, TradeItem, TradeState } from '../cloud/backend';
import type { Library } from '../cloud/library';
import type { CloudSession, SessionState } from '../cloud/session';
import { Trade } from '../trade/Trade';
import { OLD_SERVER_TEXT } from '../trade/tradeFlow';

const item = (id: string): MyItem => ({
  id,
  dollId: 'd',
  item: { id, name: `ふく ${id}`, category: 'top', image: { file: 'image', canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 10, h: 10 } }, thumb: 'thumb' },
  files: { thumb: new Blob(['x'], { type: 'image/png' }) },
  createdAt: 1,
  hue: 0,
  order: 1,
  updatedAt: 1,
  notes: [],
});
const tradeItem = (id: string): TradeItem => ({ id, dollId: 'd', name: `ふく ${id}`, categoryId: 'top', hue: 0, thumb: new Blob(['x']) });
const view = (status: TradeState['status'], extra: Partial<TradeState> = {}): TradeState => ({ id: 't1', status, me: 'b', mine: tradeItem('a'), theirs: tradeItem('z'), myAccepted: false, theirAccepted: false, ...extra });

const sessionState: SessionState = { status: 'ready', user: null, problem: null, problemCode: null, jobs: [], arrivals: [], newItemIds: [], storeFailed: false };
const library: Library = { all: async () => [item('a'), item('b')], put: async () => undefined, remove: async () => undefined };

function setup(backend: Partial<StudioBackend>) {
  const full = { canTrade: async () => true, tradeCancel: async () => undefined, ...backend } as StudioBackend;
  const session = { backend: full, getState: () => sessionState, subscribe: () => () => undefined, markNew: vi.fn(), refresh: async () => undefined } as unknown as CloudSession;
  const onClose = vi.fn();
  render(<Trade session={session} library={library} dolls={[]} categoriesByDoll={{}} onClose={onClose} onLibraryChanged={async () => undefined} />);
  return { session, onClose };
}

beforeEach(() => {
  localStorage.setItem('dressup_studio', 'fake'); // よむ画面に、確認用の入力欄を出す
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('交換の画面', () => {
  it('遅れて届いた「まだ」の返事で、終わった交換が戻らない', async () => {
    let pending: ((state: TradeState) => void) | null = null;
    let calls = 0;
    const backend: Partial<StudioBackend> = {
      tradeClaim: async () => ({ tradeId: 't1' }),
      tradeJoin: async () => undefined,
      trade: () => {
        calls++;
        if (calls === 1) return Promise.resolve(view('claimed'));
        if (calls === 2) return Promise.resolve(view('joined'));
        return new Promise<TradeState>((resolve) => (pending = resolve)); // 遅れる返事
      },
      tradeAccept: async () => view('done', { myAccepted: true, theirAccepted: true, receivedId: 'z' }),
    };
    setup(backend);
    fireEvent.click(await screen.findByTestId('trade-scan'));
    fireEvent.change(await screen.findByTestId('trade-scan-test'), { target: { value: 'ABC' } });
    fireEvent.submit(screen.getByTestId('trade-scan-test').closest('form')!);
    const pick = await screen.findAllByTestId('trade-pick-item');
    fireEvent.click(pick[0]);
    await screen.findByTestId('trade-confirm');
    // 聞いている途中（返事が、まだ）
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(pending).not.toBeNull());
    fireEvent.click(screen.getByTestId('trade-accept'));
    await screen.findByTestId('trade-done');
    await act(async () => {
      pending!(view('joined'));
    });
    expect(screen.getByTestId('trade-done')).toBeTruthy();
    expect(screen.queryByTestId('trade-accept')).toBeNull();
    expect(screen.getByTestId('trade-to-closet')).toBeTruthy();
  });

  it('つながらないときは、古いサーバーとは別の文と、やり直しのボタンを出す', async () => {
    let fail = true;
    setup({
      canTrade: async () => {
        if (fail) throw new BackendError('offline', 'x');
        return true;
      },
    });
    expect((await screen.findByTestId('trade-message')).textContent).toBe('いまは サーバーに つながっていないよ');
    expect(screen.queryByTestId('trade-old-server')).toBeNull();
    fail = false;
    fireEvent.click(screen.getByTestId('trade-retry'));
    await screen.findByTestId('trade-show');
  });

  it('古いサーバーの文は決まった文', async () => {
    setup({ canTrade: async () => false });
    expect((await screen.findByTestId('trade-old-server')).textContent).toBe(OLD_SERVER_TEXT);
  });

  it('動かせないと断られた服は、もう出さない', async () => {
    setup({ tradeOpen: async () => Promise.reject(new BackendError('refused', 'x', { tradeRefusal: 'not-movable' })) });
    fireEvent.click(await screen.findByTestId('trade-show'));
    const pick = await screen.findAllByTestId('trade-pick-item');
    expect(pick).toHaveLength(2);
    fireEvent.click(pick[0]);
    await waitFor(() => expect(screen.getAllByTestId('trade-pick-item')).toHaveLength(1));
    expect(screen.getByTestId('trade-message').textContent).toBe('この ふくは いま こうかんできないよ');
    expect(screen.getByText('つくっている とちゅうの ふくは、できあがってから')).toBeTruthy();
  });

  it('始める途中で閉じたら、できた交換をやめにする', async () => {
    let resolve!: (v: { tradeId: string; code: string }) => void;
    const tradeCancel = vi.fn(async () => undefined);
    setup({ tradeOpen: () => new Promise((r) => (resolve = r)), tradeCancel });
    fireEvent.click(await screen.findByTestId('trade-show'));
    fireEvent.click((await screen.findAllByTestId('trade-pick-item'))[0]);
    cleanup(); // 閉じた
    await act(async () => resolve({ tradeId: 'late', code: 'C' }));
    expect(tradeCancel).toHaveBeenCalledWith('late');
  });
});
