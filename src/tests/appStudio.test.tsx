/**
 * 「つくる」の画面のテスト（裏側は偽物）。ドールの切り替えと、押せない理由
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  render(<AppStudio session={session} library={library} dolls={dolls} categoriesByDoll={categoriesByDoll} initialDollId="girl" onClose={() => undefined} {...props} />);
  return session;
}
const tiles = (testId: string) => Array.from(screen.getByTestId(testId).querySelectorAll(':scope > button')).map((b) => b.getAttribute('aria-label'));
const pressed = (testId: string) => Array.from(screen.getByTestId(testId).querySelectorAll('button[aria-pressed="true"]')).map((b) => b.getAttribute('aria-label'));
const stepOf = () => screen.getByTestId('studio-step').dataset.step;
const tap = (testId: string, label: string) => fireEvent.click(within(screen.getByTestId(testId)).getByRole('button', { name: label }));
const next = () => fireEvent.click(screen.getByTestId('studio-next'));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('つくる', () => {
  it('最初は、ドールを選ぶ段（最後に遊んだドール）。次は、カテゴリを絵で選ぶ（メニューの順。そのあとにセット、はいけい）', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets').textContent).toContain('のこり 5 枚'));
    expect(stepOf()).toBe('doll');
    expect(pressed('studio-doll')).toEqual(['おんなのこ']);
    next();
    expect(stepOf()).toBe('what');
    // 「はいけい」は、サーバーが作れると分かってから出る（v0.49.0。セットのあと）
    await waitFor(() => expect(tiles('studio-target')).toEqual(['トップス', 'ドレス', 'かお', 'セット', 'はいけい']));
    expect(pressed('studio-target')).toEqual(['トップス']);
    expect(screen.queryByTestId('studio-photo-button')).toBeNull();
  });

  it('カテゴリの絵は、そのカテゴリの先頭の服のサムネイル（公開の服を先に。ほかのドールの服は使わない）。無ければ名前の 1 文字め', async () => {
    const clothing = [
      { id: 'my:1', name: '自分', type: 'トップス', imageUrl: 'my.png', thumbnailUrl: 'my-thumb.png', dollId: 'girl' },
      { id: 't1', name: 'シャツ', type: 'トップス', imageUrl: 't1.png', thumbnailUrl: 't1-thumb.png', dollId: 'girl' },
      { id: 't2', name: 'シャツ2', type: 'トップス', imageUrl: 't2.png', thumbnailUrl: 't2-thumb.png', dollId: 'girl' },
      { id: 'd1', name: 'ドレス', type: 'ドレス', imageUrl: 'd1.png', thumbnailUrl: 'd1-thumb.png', dollId: 'boy' },
      { id: 'k1', name: 'かお', type: 'かお', imageUrl: 'k1.png', dollId: 'girl' },
    ] as Parameters<typeof AppStudio>[0]['clothing'];
    open({}, { clothing });
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    next();
    const src = (label: string) => within(screen.getByTestId('studio-target')).getByRole('button', { name: label }).querySelector('img')?.getAttribute('src') ?? null;
    expect(src('トップス')).toBe('t1-thumb.png');
    expect(src('ドレス')).toBeNull();
    expect(within(screen.getByTestId('studio-target')).getByRole('button', { name: 'ドレス' }).textContent).toContain('ド');
    expect(src('かお')).toBe('k1.png');
  });

  it('カテゴリの絵をタップすると選ばれて、テーマの段へ進む。もどると、選んだものに印', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    next();
    tap('studio-target', 'ドレス');
    expect(stepOf()).toBe('theme');
    fireEvent.click(screen.getByTestId('studio-back'));
    expect(pressed('studio-target')).toEqual(['ドレス']);
  });

  it('ドールの絵をタップすると、そのドールのカテゴリに替わり、先頭が選ばれる。セットに入れるものも、そのドールのもの', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    tap('studio-doll', 'おとこのこ');
    expect(stepOf()).toBe('what');
    await waitFor(() => expect(tiles('studio-target')).toEqual(['ズボン', 'くつ', 'セット', 'はいけい']));
    expect(pressed('studio-target')).toEqual(['ズボン']);
    tap('studio-target', 'セット');
    expect(stepOf()).toBe('what'); // セットは、入れるものを選んでから進む
    expect(pressed('studio-set-categories')).toEqual(['ズボン', 'くつ']);
  });

  it('選んであったドールが、いまは無ければ、先頭のドール', async () => {
    open({}, { initialDollId: 'gone' });
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    expect(pressed('studio-doll')).toEqual(['おんなのこ']);
  });

  it('ドールが 1 体なら、ドールの段は無い', async () => {
    open({}, { dolls: [dolls[0]] });
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    expect(stepOf()).toBe('what');
    expect(screen.queryByTestId('studio-back')).toBeNull();
  });

  it('セットに入れるものが 2 個より少ない・テーマが空の間は、つぎへを押せず、理由が出る。テーマの例をタップすると入る', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    next();
    tap('studio-target', 'セット');
    tap('studio-set-categories', 'トップス');
    tap('studio-set-categories', 'ドレス');
    expect((screen.getByTestId('studio-next') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('studio-hint').textContent).toBe('セットに入れるものを 2〜6 個選んでください（いま 0 個）。');
    tap('studio-set-categories', 'かお');
    tap('studio-set-categories', 'ドレス');
    next();
    expect(stepOf()).toBe('theme');
    expect((screen.getByTestId('studio-next') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('studio-hint').textContent).toBe('テーマを入れてください。');
    fireEvent.click(screen.getAllByTestId('studio-theme-idea')[0]);
    expect((screen.getByTestId('studio-theme') as HTMLInputElement).value).toBe('うみ');
    next();
    expect(stepOf()).toBe('style');
    expect(pressed('studio-style')).toEqual(['アニメ']);
    tap('studio-style', 'ポップ');
    expect(stepOf()).toBe('check');
    expect(screen.getByTestId('studio-summary').textContent).toContain('セット（ドレス・かお）');
    expect(screen.getByTestId('studio-summary').textContent).toContain('「うみ」');
    expect(screen.getByTestId('studio-summary').textContent).toContain('ポップ');
    expect(screen.getByTestId('studio-make').textContent).toContain('作る（チケット 2 枚）');
  });

  it('チケットが足りないと、さいごの段で作るを押せず、理由が出る', async () => {
    open({ tickets: 1 });
    await waitFor(() => expect(screen.getByTestId('studio-tickets').textContent).toContain('のこり 1 枚'));
    next();
    tap('studio-target', 'セット');
    next();
    fireEvent.change(screen.getByTestId('studio-theme'), { target: { value: 'うみ' } });
    next();
    next();
    expect((screen.getByTestId('studio-make') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('studio-hint').textContent).toBe('チケットが足りません（のこり 1 枚、必要 2 枚）。');
  });

  it('管理者でなければ、チケットを配る欄は出ない。管理者なら出て、自分のコードに配れる（偽物の世界）', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    expect(screen.queryByTestId('gift-section')).toBeNull();
    cleanup();
    localStorage.clear();
    const session = open({ admin: true, tickets: 0 });
    await waitFor(() => expect(screen.getByTestId('gift-section')).toBeTruthy());
    const code = session.getState().user!.userCode;
    fireEvent.change(screen.getByTestId('gift-code'), { target: { value: code.toLowerCase() } });
    fireEvent.change(screen.getByTestId('gift-count'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('gift-give'));
    await waitFor(() => expect(screen.getByTestId('gift-message').textContent).toContain(`${code} さんに 3 枚 配りました（いま 3 枚）`));
    fireEvent.change(screen.getByTestId('gift-code'), { target: { value: 'ZZZZZZZZ' } });
    fireEvent.click(screen.getByTestId('gift-give'));
    await waitFor(() => expect(screen.getByTestId('gift-message').textContent).toContain('見つかりません'));
    fireEvent.change(screen.getByTestId('gift-count'), { target: { value: '0' } });
    expect((screen.getByTestId('gift-give') as HTMLButtonElement).disabled).toBe(true);
  });

  it('説明の文は置かない（v0.48.0）: 注文の説明・テーマの書き方・セットの選び方の文は無い。「クローゼットを見る」「チケットを買う」のボタンも無い', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    const all = () => screen.getByTestId('app-studio').textContent ?? '';
    expect(all()).not.toContain('絵をえらんで注文すると');
    expect(screen.queryByTestId('studio-open-closet')).toBeNull();
    expect(screen.queryByTestId('studio-buy')).toBeNull();
    expect(all()).not.toContain('クローゼットを見る');
    next();
    tap('studio-target', 'セット');
    // セットに入れるものの絵は出る。選び方の文は無い
    expect(pressed('studio-set-categories')).toEqual(['トップス', 'ドレス']);
    expect(all()).not.toContain('タップで えらんでね');
    expect(screen.getByTestId('studio-set-categories').querySelector(':scope > span')).toBeNull();
    next();
    expect(stepOf()).toBe('theme');
    expect(all()).not.toContain('すきな ことばを 書いてね');
    expect(screen.getAllByTestId('studio-theme-idea').length).toBeGreaterThan(0);
  });

  it('利用者コードは、「コード: XXXXXXXX」だけ（説明の文は無い）', async () => {
    const session = open();
    await waitFor(() => expect(screen.getByTestId('studio-user-code')).toBeTruthy());
    const code = session.getState().user!.userCode;
    expect(screen.getByTestId('studio-user-code').textContent).toBe(code);
    expect(screen.getByTestId('studio-user-code').parentElement?.textContent).toBe(`コード: ${code}`);
  });

  it('作っている服の欄に、説明の文（閉じても続きます）は無い。進み具合は出る', async () => {
    open({ delayMs: 60_000 });
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    next();
    tap('studio-target', 'トップス');
    fireEvent.change(screen.getByTestId('studio-theme'), { target: { value: 'うみ' } });
    next();
    next();
    fireEvent.click(screen.getByTestId('studio-make'));
    await waitFor(() => expect(screen.getByTestId('studio-making')).toBeTruthy(), { timeout: 4000 });
    expect(screen.getByTestId('studio-making').textContent).not.toContain('この画面を閉じても');
    expect(screen.getByTestId('studio-job-notice').textContent).not.toBe('');
  });

  it('確認用の裏側（demo）の注は、残す', async () => {
    open({}, { demo: true });
    await waitFor(() => expect(screen.getByTestId('studio-demo').textContent).toContain('確認用の画面です'));
  });

  it('画面は、遊ぶ画面の上の半透明の幕ではなく、ひとつの画面（studio-screen）', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    expect(screen.getByTestId('app-studio').className).toBe('studio-screen');
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
    render(<AppStudio session={session} library={library} dolls={dolls} categoriesByDoll={categoriesByDoll} initialDollId="girl" onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    fireEvent.click(screen.getByTestId('studio-next')); // ドール
    fireEvent.click(screen.getByTestId('studio-next')); // なにを
    fireEvent.change(screen.getByTestId('studio-theme'), { target: { value: 'うみ' } });
    fireEvent.click(screen.getByTestId('studio-next')); // テーマ
    fireEvent.click(screen.getByTestId('studio-next')); // 絵柄
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
