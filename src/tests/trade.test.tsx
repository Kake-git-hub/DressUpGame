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

const item = (id: string, owner = 'me'): MyItem => ({
  id,
  owner,
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

const sessionState: SessionState = { status: 'ready', user: { userCode: 'me' } as SessionState['user'], problem: null, problemCode: null, jobs: [], arrivals: [], newItemIds: [], storeFailed: false, welcome: null };
const library: Library = { all: async () => [item('a'), item('b')], put: async () => undefined, remove: async () => undefined };

function setup(backend: Partial<StudioBackend>, over: { library?: Library; refresh?: () => Promise<void>; onLibraryChanged?: () => Promise<void> } = {}) {
  const full = { canTrade: async () => true, tradeCancel: async () => undefined, ...backend } as StudioBackend;
  const session = { backend: full, getState: () => sessionState, subscribe: () => () => undefined, markNew: vi.fn(), refresh: over.refresh ?? (async () => undefined) } as unknown as CloudSession;
  const onClose = vi.fn();
  render(<Trade session={session} library={over.library ?? library} dolls={[]} categoriesByDoll={{}} onClose={onClose} onLibraryChanged={over.onLibraryChanged ?? (async () => undefined)} />);
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

  it('前の利用者の服は、出す服の一覧に出さない（なければ、服が無い表示）', async () => {
    setup({}, { library: { ...library, all: async () => [item('a'), item('old', 'someone-else')] } });
    fireEvent.click(await screen.findByTestId('trade-show'));
    expect(await screen.findAllByTestId('trade-pick-item')).toHaveLength(1);
    cleanup();
    setup({}, { library: { ...library, all: async () => [item('old', 'someone-else')] } });
    expect(await screen.findByTestId('trade-no-items')).toBeTruthy();
  });

  it('あいてが えらんでいる間は、自分の服の絵を出す', async () => {
    setup({
      tradeOpen: async () => ({ tradeId: 't1', code: 'C' }),
      trade: async () => view('claimed', { me: 'a', mine: tradeItem('a'), theirs: undefined }),
    });
    fireEvent.click(await screen.findByTestId('trade-show'));
    fireEvent.click((await screen.findAllByTestId('trade-pick-item'))[0]);
    const text = await screen.findByTestId('trade-partner-choosing');
    expect(text.closest('.trade-body')?.querySelector('.trade-card .trade-name')?.textContent).toBe('ふく a');
  });

  it('「はい」を押したあとで、結果を見ないまま閉じたら、一覧を同期し直す', async () => {
    const refresh = vi.fn(async () => undefined);
    const onLibraryChanged = vi.fn(async () => undefined);
    let joinedAlready = false;
    setup(
      {
        tradeClaim: async () => ({ tradeId: 't1' }),
        tradeJoin: async () => {
          joinedAlready = true;
        },
        trade: async () => view(joinedAlready ? 'joined' : 'claimed'),
        tradeAccept: async () => view('joined', { myAccepted: true }),
      },
      { refresh, onLibraryChanged },
    );
    fireEvent.click(await screen.findByTestId('trade-scan'));
    fireEvent.change(await screen.findByTestId('trade-scan-test'), { target: { value: 'ABC' } });
    fireEvent.submit(screen.getByTestId('trade-scan-test').closest('form')!);
    fireEvent.click((await screen.findAllByTestId('trade-pick-item'))[0]);
    await screen.findByTestId('trade-confirm');
    fireEvent.click(screen.getByTestId('trade-accept'));
    await waitFor(() => expect(screen.queryByTestId('trade-accept')).toBeNull());
    cleanup();
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(onLibraryChanged).toHaveBeenCalled());
  });

  it('「はい」を押していなければ、閉じても同期し直さない', async () => {
    const refresh = vi.fn(async () => undefined);
    setup({ tradeOpen: async () => ({ tradeId: 't1', code: 'C' }), trade: async () => view('open', { me: 'a' }) }, { refresh });
    fireEvent.click(await screen.findByTestId('trade-show'));
    fireEvent.click((await screen.findAllByTestId('trade-pick-item'))[0]);
    await screen.findByTestId('trade-cancel');
    cleanup();
    await new Promise((r) => setTimeout(r, 20));
    expect(refresh).not.toHaveBeenCalled();
  });
});
