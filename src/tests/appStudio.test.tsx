/**
 * 「つくる」の画面のテスト（裏側は偽物）。ドールの切り替えと、押せない理由
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppStudio } from '../appStudio/AppStudio';
import { BackendError } from '../cloud/backend';
import { createFakeBackend } from '../cloud/fakeBackend';
import { createSession } from '../cloud/session';
import type { ManifestCategory } from '../content/manifest';
import type { DollData } from '../types';

const doll = (id: string, name: string): DollData => ({ id, name, bodyImageUrl: `${id}.webp`, canvasW: 1024, canvasH: 1024, box: { x: 300, y: 50, w: 400, h: 900 } }) as DollData;
const category = (id: string, menuOrder: number): ManifestCategory => ({ id, label: id, layer: menuOrder, menuOrder, overlap: false, movable: false });
const dolls = [doll('girl', 'おんなのこ'), doll('boy', 'おとこのこ')];
const categoriesByDoll = { girl: [category('ドレス', 2), category('トップス', 1), category('かお', 3)], boy: [category('ズボン', 1), category('くつ', 2)] };
const library = { all: async () => [], put: async () => undefined, remove: async () => undefined };

function open(options: Parameters<typeof createFakeBackend>[0] = {}, props: Partial<Parameters<typeof AppStudio>[0]> = {}) {
  const session = createSession({ backend: createFakeBackend({ image: async () => new Blob(['x']), planMs: 0, ...options }), library, onLibraryChanged: () => undefined });
  render(<AppStudio session={session} library={library} dolls={dolls} categoriesByDoll={categoriesByDoll} initialDollId="girl" onClose={() => undefined} onOpenCloset={() => undefined} {...props} />);
  return session;
}
const options = (testId: string) => Array.from(screen.getByTestId(testId).querySelectorAll('option')).map((o) => o.textContent);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('つくる', () => {
  it('最初は、最後に遊んだドール。カテゴリは、メニューの順（セットは最後）。写真と色の欄は無い', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets').textContent).toContain('のこり 5 枚'));
    expect((screen.getByTestId('studio-doll') as HTMLSelectElement).value).toBe('girl');
    expect(options('studio-target')).toEqual(['トップス', 'ドレス', 'かお', 'セット']);
    expect(screen.queryByTestId('studio-photo-button')).toBeNull();
    expect(screen.queryByTestId('studio-color-0')).toBeNull();
  });

  it('ドールを替えると、カテゴリが替わり、先頭が選ばれる。セットに入れるものも、そのドールのもの', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    fireEvent.change(screen.getByTestId('studio-target'), { target: { value: 'ドレス' } });
    fireEvent.change(screen.getByTestId('studio-doll'), { target: { value: 'boy' } });
    expect(options('studio-target')).toEqual(['ズボン', 'くつ', 'セット']);
    expect((screen.getByTestId('studio-target') as HTMLSelectElement).value).toBe('ズボン');
    fireEvent.change(screen.getByTestId('studio-target'), { target: { value: '__set' } });
    const checks = Array.from(screen.getByTestId('studio-set-categories').querySelectorAll('label')).map((l) => [l.textContent?.trim(), (l.querySelector('input') as HTMLInputElement).checked]);
    expect(checks).toEqual([['ズボン', true], ['くつ', true]]);
  });

  it('選んであったドールが、いまは無ければ、先頭のドール', async () => {
    open({}, { initialDollId: 'gone' });
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    expect((screen.getByTestId('studio-doll') as HTMLSelectElement).value).toBe('girl');
  });

  it('テーマが空・チケットが足りない間は、作るを押せず、理由が出る', async () => {
    open({ tickets: 1 });
    await waitFor(() => expect(screen.getByTestId('studio-tickets').textContent).toContain('のこり 1 枚'));
    expect((screen.getByTestId('studio-make') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('studio-hint').textContent).toBe('テーマを入れてください。');
    fireEvent.change(screen.getByTestId('studio-theme'), { target: { value: 'うみ' } });
    expect((screen.getByTestId('studio-make') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByTestId('studio-target'), { target: { value: '__set' } });
    expect(screen.getByTestId('studio-hint').textContent).toBe('チケットが足りません（のこり 1 枚、必要 2 枚）。');
    expect(screen.getByTestId('studio-make').textContent).toBe('作る（チケット 2 枚）');
  });

  it('古いサーバーのときは、知らせを出して、作る欄を出さない', async () => {
    open({ oldServer: true });
    await waitFor(() => expect(screen.getByTestId('studio-problem').textContent).toContain('サーバーが古い版です'));
    expect(screen.queryByTestId('studio-make')).toBeNull();
  });

  it('つながっていないときは、そう知らせる（確かめ方も添える）', async () => {
    open({ offline: true });
    await waitFor(() => expect(screen.getByTestId('studio-problem').textContent).toContain('インターネットにつながっていません'));
    expect(screen.getByTestId('studio-problem').textContent).toContain('開き直してください');
  });

  // 「作る」の返事が失敗したとき
  async function orderWith(error: unknown) {
    const backend = createFakeBackend({ image: async () => new Blob(['x']), planMs: 0 });
    backend.startJob = async () => Promise.reject(error);
    const session = createSession({ backend, library, onLibraryChanged: () => undefined });
    let refreshed = 0;
    const realRefresh = session.refresh.bind(session);
    session.refresh = async () => {
      refreshed++;
      return realRefresh();
    };
    render(<AppStudio session={session} library={library} dolls={dolls} categoriesByDoll={categoriesByDoll} initialDollId="girl" onClose={() => undefined} onOpenCloset={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    fireEvent.change(screen.getByTestId('studio-theme'), { target: { value: 'うみ' } });
    fireEvent.click(screen.getByTestId('studio-make'));
    await waitFor(() => expect(screen.getByTestId('order-show').dataset.phase).not.toBe('ordering'), { timeout: 4000 });
    return { phase: screen.getByTestId('order-show').dataset.phase, text: screen.getByTestId('order-show').textContent ?? '', refreshed: () => refreshed };
  }
  it('サーバーが理由つきで断ったら、「チケットは つかっていません」と伝える', async () => {
    const result = await orderWith(new BackendError('no-tickets', 'チケットが足りません（のこり 0 枚、必要 1 枚）'));
    expect(result.phase).toBe('refused');
    expect(result.text).toContain('チケットは つかっていません。');
    expect(result.refreshed()).toBe(0);
  });
  it('返事が届かなかった（サーバーでは、もう注文できているかもしれない）ときは、そう伝えて、仕事とチケットを聞き直す', async () => {
    const result = await orderWith(new BackendError('unknown', 'サーバーから返事がありません', { uncertain: true }));
    expect(result.phase).toBe('unsure');
    expect(result.text).not.toContain('チケットは つかっていません');
    expect(result.text).toContain('たしかめてね');
    expect(result.refreshed()).toBe(1);
  });
  it('思いがけない失敗（BackendError でない）も、結果が分からないものとして扱う', async () => {
    expect((await orderWith(new Error('boom'))).phase).toBe('unsure');
  });
});
