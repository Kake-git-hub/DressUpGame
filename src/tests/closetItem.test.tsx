/**
 * クローゼットの、服 1 点の画面のテスト（サーバーを先に変え、通ったら端末の控えを変える）
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClosetItem } from '../closet/ClosetItem';
import { BackendError } from '../cloud/backend';
import type { MyItem, MyItemInfo, StudioBackend } from '../cloud/backend';
import type { Library } from '../cloud/library';

const item = (id: string, order: number): MyItem => ({
  id,
  dollId: 'd',
  item: { id, name: `ふく ${id}`, category: 'top', image: { file: 'image', canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 10, h: 10 } }, thumb: 'thumb' },
  files: {},
  createdAt: order,
  hue: 0,
  order,
  updatedAt: order,
  notes: [],
});
const infoOf = (source: MyItem, change: Partial<MyItemInfo> = {}): MyItemInfo => {
  const { files: _files, owner: _owner, ...info } = source;
  void _files;
  void _owner;
  return { ...info, ...change };
};

let puts: MyItem[];
let removed: string[];
let library: Library;
beforeEach(() => {
  puts = [];
  removed = [];
  library = { all: async () => [], put: async (i) => void puts.push(i), remove: async (id) => void removed.push(id) };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open(backend: Partial<StudioBackend>, options: { online?: boolean; group?: MyItem[] } = {}) {
  const a = item('a', 2);
  const group = options.group ?? [a, item('b', 1)];
  const handlers = { onChanged: vi.fn(async () => undefined), onGone: vi.fn(), onClose: vi.fn() };
  render(<ClosetItem item={a} doll={null} group={group} online={options.online ?? true} backend={backend as StudioBackend} library={library} {...handlers} />);
  return { a, handlers };
}

describe('クローゼットの、服 1 点の画面', () => {
  it('名前: サーバーが通したら、端末の控えも変える（サーバーが整えた名前で）', async () => {
    const updateMyItem = vi.fn(async (_id: string, change: { name?: string }) => infoOf(item('a', 2), { item: { ...item('a', 2).item, name: `${change.name}!` }, updatedAt: 9 }));
    const { handlers } = open({ updateMyItem });
    fireEvent.change(screen.getByTestId('closet-name'), { target: { value: '  あたらしい  ' } });
    fireEvent.blur(screen.getByTestId('closet-name'));
    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1));
    expect(updateMyItem).toHaveBeenCalledWith('a', { name: 'あたらしい' });
    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ id: 'a', updatedAt: 9, item: { name: 'あたらしい!' } });
    expect((screen.getByTestId('closet-name') as HTMLInputElement).value).toBe('あたらしい!');
  });

  it('名前が空・同じなら、サーバーを呼ばずに、もとの名前に戻す', async () => {
    const updateMyItem = vi.fn();
    open({ updateMyItem });
    fireEvent.change(screen.getByTestId('closet-name'), { target: { value: '   ' } });
    fireEvent.blur(screen.getByTestId('closet-name'));
    expect((screen.getByTestId('closet-name') as HTMLInputElement).value).toBe('ふく a');
    expect(updateMyItem).not.toHaveBeenCalled();
  });

  it('サーバーが通さなかったら（つながらない、など）、端末の控えは変えずに、理由を出す', async () => {
    const { handlers } = open({ updateMyItem: async () => Promise.reject(new BackendError('offline', 'インターネットにつながっていません')) });
    fireEvent.change(screen.getByTestId('closet-name'), { target: { value: 'べつのなまえ' } });
    fireEvent.blur(screen.getByTestId('closet-name'));
    await waitFor(() => expect(screen.getByTestId('closet-error').textContent).toBe('インターネットにつながっていません'));
    expect(puts).toEqual([]);
    expect(handlers.onChanged).not.toHaveBeenCalled();
    expect(handlers.onGone).not.toHaveBeenCalled();
  });

  it('服が、もう無かった（ほかの端末で消された）ら、知らせて、閉じる（控えは変えない）', async () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const { handlers } = open({ updateMyItem: async () => Promise.reject(new BackendError('refused', 'この服は見つかりません')) });
    fireEvent.change(screen.getByTestId('closet-name'), { target: { value: 'べつのなまえ' } });
    fireEvent.blur(screen.getByTestId('closet-name'));
    await waitFor(() => expect(handlers.onGone).toHaveBeenCalledTimes(1));
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('もう ありません'));
    expect(puts).toEqual([]);
  });

  it('ならび: うしろへ、で、となりと入れ替えた並びをサーバーに送り、返ってきた順番を控えに書く', async () => {
    const orderMyItems = vi.fn(async (ids: string[]) => ids.map((id, i) => infoOf(item(id, 0), { order: 100 - i, updatedAt: 50 })));
    const { handlers } = open({ orderMyItems });
    expect((screen.getByTestId('closet-move-front') as HTMLButtonElement).disabled).toBe(true); // 先頭
    fireEvent.click(screen.getByTestId('closet-move-back'));
    await waitFor(() => expect(handlers.onChanged).toHaveBeenCalledTimes(1));
    expect(orderMyItems).toHaveBeenCalledWith(['b', 'a']);
    expect(puts.map((p) => [p.id, p.order])).toEqual([['b', 100], ['a', 99]]);
  });

  it('けす: やめる、では何もしない。けす、でサーバーと控えから消して、閉じる', async () => {
    const deleteMyItem = vi.fn(async () => undefined);
    const { handlers } = open({ deleteMyItem });
    fireEvent.click(screen.getByTestId('closet-delete'));
    fireEvent.click(screen.getByTestId('closet-delete-no'));
    expect(deleteMyItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('closet-delete'));
    fireEvent.click(screen.getByTestId('closet-delete-yes'));
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalledTimes(1));
    expect(deleteMyItem).toHaveBeenCalledWith('a');
    expect(removed).toEqual(['a']);
  });

  it('つながっていないときは、直す・消すを押せない', () => {
    open({}, { online: false });
    expect(screen.getByTestId('closet-offline-note').textContent).toContain('いまは なおせません');
    for (const id of ['closet-name', 'closet-hue', 'closet-move-back', 'closet-delete']) expect((screen.getByTestId(id) as HTMLButtonElement).disabled, id).toBe(true);
  });
});
