/**
 * 背景を作る（v0.49.0）の、アプリの側のテスト:
 * 偽物の裏側・本物の裏側（古いサーバーの見分け）・「つくる」の画面・クローゼット・届いた演出・ゲームに重ねる所
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppStudio } from '../appStudio/AppStudio';
import { ClosetItem } from '../closet/ClosetItem';
import { closetGroups, OTHER_LABEL } from '../closet/closetView';
import { BACKGROUND_CATEGORY, BACKGROUND_LABEL, BackendError, isBackgroundItem, ticketCost } from '../cloud/backend';
import type { MyItem, StudioBackend, StudioCandidate, StudioJob } from '../cloud/backend';
import { createBackend } from '../cloud/createBackend';
import { createFakeBackend } from '../cloud/fakeBackend';
import { mergeMyItems } from '../cloud/library';
import type { Library } from '../cloud/library';
import { createRemoteBackend } from '../cloud/remoteBackend';
import type { StudioTransport } from '../cloud/remoteBackend';
import { createSession } from '../cloud/session';
import { BG_API, SERVER_API } from '../cloud/wire';
import type { LoadedContent } from '../content/loadContent';
import type { ManifestCategory } from '../content/manifest';
import { contentUrlsForDoll } from '../content/prefetch';
import { Reveal } from '../reveal/Reveal';
import { revealView } from '../reveal/revealView';
import type { BackgroundData, DollData } from '../types';

const doll = (id: string, name: string): DollData => ({ id, name, bodyImageUrl: `${id}.webp`, canvasW: 1024, canvasH: 1024, box: { x: 300, y: 50, w: 400, h: 900 } }) as DollData;
const category = (id: string, menuOrder: number): ManifestCategory => ({ id, label: id, layer: menuOrder, menuOrder, overlap: false, movable: false });
const dolls = [doll('girl', 'おんなのこ'), doll('boy', 'おとこのこ')];
const categoriesByDoll = { girl: [category('ドレス', 2), category('トップス', 1)], boy: [category('ズボン', 1), category('くつ', 2)] };
const blob = (text: string) => new Blob([text], { type: 'image/png' });
const myItem = (id: string, dollId: string, categoryId: string, order = 1): MyItem => ({
  id,
  dollId,
  item: { id, name: `なまえ ${id}`, category: categoryId, image: { file: 'image', canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 1024, h: 1024 } }, thumb: 'thumb' },
  files: { image: blob(`image-${id}`), thumb: blob(`thumb-${id}`) },
  createdAt: order,
  hue: 0,
  order,
  updatedAt: order,
  notes: [],
});
const bgTarget = { dollId: 'girl', theme: 'うみ', styleId: 'anime', target: { kind: 'background' as const } };
const codeOf = (e: unknown) => (e instanceof BackendError ? e.code : `not a BackendError: ${String(e)}`);

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('偽物の裏側: 背景', () => {
  const make = (options: Parameters<typeof createFakeBackend>[0] = {}) => createFakeBackend({ image: async (color) => blob(color), delayMs: 100, planMs: 0, ...options });
  const lastJob = (backend: ReturnType<typeof make>, id: string) => {
    let job: StudioJob | null = null;
    backend.watchJob(id, (j) => (job = j))();
    return job! as StudioJob;
  };

  it('背景を 1 枚作る: チケットは 1 枚。できたら、そのドールの自分の背景になる（絵つきで取れる）', async () => {
    vi.useFakeTimers();
    const backend = make({ tickets: 2 });
    expect(ticketCost({ kind: 'background' })).toBe(1);
    expect(await backend.canMakeBackground()).toBe(true);
    const { jobId, cost } = await backend.startJob(bgTarget);
    expect(cost).toBe(1);
    expect((await backend.signIn()).tickets).toBe(1);
    expect(lastJob(backend, jobId).candidates).toEqual([expect.objectContaining({ categoryId: BACKGROUND_CATEGORY, status: 'working', name: 'うみのはいけい' })]);
    await vi.advanceTimersByTimeAsync(150);
    const job = lastJob(backend, jobId);
    expect(job.done).toBe(true);
    const items = await backend.listMyItems();
    expect(items).toEqual([expect.objectContaining({ id: job.candidates[0].itemId, dollId: 'girl' })]);
    expect(isBackgroundItem(items[0])).toBe(true);
    expect(items[0].item.image.box).toEqual({ x: 0, y: 0, w: 1024, h: 1024 });
    const full = await backend.fetchMyItem(items[0].id);
    expect(full.files[full.item.image.file]).toBeInstanceOf(Blob);
    expect(full.files[full.item.thumb]).toBeInstanceOf(Blob);
  });

  it('できなかった（failCategories に背景）ら、チケットが戻る', async () => {
    vi.useFakeTimers();
    const backend = make({ tickets: 2, failCategories: [BACKGROUND_CATEGORY] });
    const { jobId } = await backend.startJob(bgTarget);
    expect((await backend.signIn()).tickets).toBe(1);
    await vi.advanceTimersByTimeAsync(150);
    expect(lastJob(backend, jobId).candidates[0].status).toBe('failed');
    expect((await backend.signIn()).tickets).toBe(2);
    expect(await backend.listMyItems()).toEqual([]);
  });

  it('チケットが足りなければ、作れない', async () => {
    const backend = make({ tickets: 0 });
    await expect(backend.startJob(bgTarget)).rejects.toSatisfy((e) => codeOf(e) === 'no-tickets');
  });

  it('古い版のサーバーのふり（noBackground）: 作れないと答え、作ろうとすると old-server（チケットは減らない）。服は、作れる', async () => {
    const backend = make({ tickets: 2, noBackground: true });
    expect(await backend.canMakeBackground()).toBe(false);
    await expect(backend.startJob(bgTarget)).rejects.toSatisfy((e) => codeOf(e) === 'old-server');
    expect((await backend.signIn()).tickets).toBe(2);
    await expect(backend.startJob({ ...bgTarget, target: { kind: 'category', categoryId: 'トップス' } })).resolves.toMatchObject({ cost: 1 });
  });

  it('背景の名前は変えられる。色・はじめの位置は、頼んでも付かない', async () => {
    vi.useFakeTimers();
    const backend = make({ tickets: 2 });
    await backend.startJob(bgTarget);
    await vi.advanceTimersByTimeAsync(150);
    const [made] = await backend.listMyItems();
    const next = await backend.updateMyItem(made.id, { name: 'ゆうやけ', hue: 90, fit: { x: 10, y: 0, scale: 1.2, rotation: 0 } });
    expect(next).toMatchObject({ hue: 0, item: { name: 'ゆうやけ', category: BACKGROUND_CATEGORY } });
    expect(next.fit).toBeUndefined();
  });

  it('交換: 背景を出すと、にせの あいても背景を出す（もらった背景は、同じドールの背景）', async () => {
    vi.useFakeTimers();
    const backend = make({ tickets: 2, partner: { claimAfterMs: 10, acceptAfterMs: 10 } });
    await backend.startJob(bgTarget);
    await vi.advanceTimersByTimeAsync(150);
    const [made] = await backend.listMyItems();
    const { tradeId } = await backend.tradeOpen(made.id);
    await vi.advanceTimersByTimeAsync(50);
    const done = await backend.tradeAccept(tradeId);
    expect(done.status).toBe('done');
    const after = await backend.listMyItems();
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(done.receivedId);
    expect(after[0].dollId).toBe('girl');
    expect(isBackgroundItem(after[0])).toBe(true);
  });

  it('偽物の設定（dressup_fake_options）の noBackground を読む', async () => {
    localStorage.setItem('dressup_fake_options', JSON.stringify({ noBackground: true, planMs: 0 }));
    expect(await createBackend('fake').canMakeBackground()).toBe(false);
  });
});

describe('本物の裏側: 背景を作れるサーバーか', () => {
  function server(api: number) {
    const calls: Record<string, unknown>[] = [];
    const transport: StudioTransport = {
      auth: async () => {
        throw new Error('使わない');
      },
      async call<T>(data: Record<string, unknown>): Promise<T> {
        calls.push(data);
        const user = { userCode: 'ABCD2345', tickets: 3, free: 3, lots: [], admin: false };
        if (data.op === 'signIn') return { user, api } as T;
        if (data.op === 'startJob') return { jobId: 'j1', cost: 1, user: { ...user, tickets: 2 } } as T;
        throw new BackendError('refused', 'bad op');
      },
    };
    return { transport, calls };
  }
  it('版 9 から作れる（いまのサーバーの版は 9）', async () => {
    expect(BG_API).toBe(9);
    expect(SERVER_API).toBeGreaterThanOrEqual(BG_API);
    expect(await createRemoteBackend(server(9).transport).canMakeBackground()).toBe(true);
  });
  it('版 8 のサーバーでは作れない。作ろうとしても、サーバーを呼ばずに old-server', async () => {
    const old = server(8);
    const backend = createRemoteBackend(old.transport);
    expect(await backend.canMakeBackground()).toBe(false);
    await expect(backend.startJob(bgTarget)).rejects.toSatisfy((e) => codeOf(e) === 'old-server');
    expect(old.calls.filter((c) => c.op === 'startJob')).toEqual([]);
    // 服は、古いサーバーでも作れる
    await expect(backend.startJob({ ...bgTarget, target: { kind: 'category', categoryId: 'トップス' } })).resolves.toEqual({ jobId: 'j1', cost: 1 });
  });
  it('作るときは、target { kind: background } を、そのまま送る', async () => {
    const now = server(9);
    await createRemoteBackend(now.transport).startJob(bgTarget);
    expect(now.calls.find((c) => c.op === 'startJob')).toMatchObject({ dollId: 'girl', theme: 'うみ', styleId: 'anime', target: { kind: 'background' } });
  });
});

describe('つくる: 「はいけい」のタイル', () => {
  const library: Library = { all: async () => [], put: async () => undefined, remove: async () => undefined };
  function open(options: Parameters<typeof createFakeBackend>[0] = {}, props: Partial<Parameters<typeof AppStudio>[0]> = {}) {
    const backend = createFakeBackend({ image: async () => new Blob(['x']), planMs: 0, ...options });
    const session = createSession({ backend, library, onLibraryChanged: () => undefined });
    render(<AppStudio session={session} library={library} dolls={dolls} categoriesByDoll={categoriesByDoll} initialDollId="girl" onClose={() => undefined} {...props} />);
    return { session, backend };
  }
  const tiles = () => Array.from(screen.getByTestId('studio-target').querySelectorAll(':scope > button')).map((b) => b.getAttribute('aria-label'));
  const stepOf = () => screen.getByTestId('studio-step').dataset.step;
  const next = () => fireEvent.click(screen.getByTestId('studio-next'));

  it('画面の題は「✨ つくる」', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('✨ つくる');
  });

  it('「なにを 作る？」の段の最後（セットのあと）に「はいけい」。説明の文は足さない', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    next();
    await waitFor(() => expect(tiles()).toEqual(['トップス', 'ドレス', 'セット', 'はいけい']));
    // タイルの中は、絵と名前だけ
    expect(screen.getByTestId('studio-target-bg').textContent).toBe('🖼️はいけい');
    expect(screen.getByTestId('studio-step').querySelectorAll('p')).toHaveLength(0);
  });

  it('タイルの絵は、そのドールで使える先頭の背景のサムネイル（公開の背景を先に。ほかのドールの背景は使わない）。無ければ絵文字', async () => {
    const backgrounds: BackgroundData[] = [
      { id: 'my:1', name: '自分の', imageUrl: 'data:mine', thumbnailUrl: 'data:mine-thumb', dollId: 'girl', isCustom: true },
      { id: 'b-boy', name: 'おとこのこ用', imageUrl: 'boy.jpg', thumbnailUrl: 'boy-thumb.jpg', dollId: 'boy' },
      { id: 'b-all', name: 'みんなの', imageUrl: 'all.jpg', thumbnailUrl: 'all-thumb.jpg' },
    ];
    open({}, { backgrounds });
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    next();
    await waitFor(() => expect(screen.getByTestId('studio-target-bg')).toBeTruthy());
    expect(screen.getByTestId('studio-target-bg').querySelector('img')?.getAttribute('src')).toBe('all-thumb.jpg');
  });

  it('選ぶと、1 点と同じ段取り（テーマ → 絵柄 → 確かめ）。チケット 1 枚。確かめの段に「はいけい」。作ると、背景の仕事になる', async () => {
    const { backend } = open({ tickets: 3 });
    const startJob = vi.spyOn(backend, 'startJob');
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    next();
    await waitFor(() => expect(screen.getByTestId('studio-target-bg')).toBeTruthy());
    fireEvent.click(screen.getByTestId('studio-target-bg'));
    expect(stepOf()).toBe('theme');
    fireEvent.change(screen.getByTestId('studio-theme'), { target: { value: 'うみ' } });
    next();
    expect(stepOf()).toBe('style');
    fireEvent.click(within(screen.getByTestId('studio-style')).getAllByRole('button')[0]);
    expect(stepOf()).toBe('check');
    expect(screen.getByTestId('studio-summary').textContent).toContain('はいけい');
    expect(screen.getByTestId('studio-make').textContent).toContain('チケット 1 枚');
    expect((screen.getByTestId('studio-make') as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId('studio-make'));
    await waitFor(() => expect(startJob).toHaveBeenCalledWith({ dollId: 'girl', theme: 'うみ', styleId: expect.any(String), target: { kind: 'background' } }));
    // 作っている一覧には、「はいけい」として出る
    await waitFor(() => expect(screen.getByTestId('studio-making').textContent).toContain('はいけい「うみのはいけい」'));
  });

  it('もどると、「はいけい」に印が付いている', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    next();
    await waitFor(() => expect(screen.getByTestId('studio-target-bg')).toBeTruthy());
    fireEvent.click(screen.getByTestId('studio-target-bg'));
    fireEvent.click(screen.getByTestId('studio-back'));
    expect(screen.getByTestId('studio-target-bg').getAttribute('aria-pressed')).toBe('true');
  });

  it('古い版のサーバー（背景を作れない）では、タイルを出さない（知らせも出さない）。ほかは、いままでどおり', async () => {
    const { backend } = open({ noBackground: true });
    const asked = vi.spyOn(backend, 'canMakeBackground');
    await waitFor(() => expect(screen.getByTestId('studio-tickets')).toBeTruthy());
    next();
    await waitFor(() => expect(asked).toHaveBeenCalled());
    await asked.mock.results[0].value;
    expect(tiles()).toEqual(['トップス', 'ドレス', 'セット']);
    expect(screen.queryByTestId('studio-target-bg')).toBeNull();
    expect(screen.queryByTestId('studio-problem')).toBeNull();
    expect(screen.getByTestId('app-studio').textContent).not.toContain('古い');
  });
});

describe('クローゼット: 背景', () => {
  const categories = [category('トップス', 1)];
  it('そのドールの背景は、服の組のあとに「はいけい」の組（「そのほか」には入らない）。ほかのドールの背景は出ない', () => {
    const items = [myItem('my:bg1', 'girl', BACKGROUND_CATEGORY, 3), myItem('my:top', 'girl', 'トップス', 2), myItem('my:odd', 'girl', 'なくなった', 1), myItem('my:bg-boy', 'boy', BACKGROUND_CATEGORY, 1), myItem('my:bg2', 'girl', BACKGROUND_CATEGORY, 5)];
    const groups = closetGroups(items, 'girl', categories);
    expect(groups.map((g) => [g.categoryId, g.label, g.items.map((i) => i.id)])).toEqual([
      ['トップス', 'トップス', ['my:top']],
      [BACKGROUND_CATEGORY, 'はいけい', ['my:bg2', 'my:bg1']],
      ['', OTHER_LABEL, ['my:odd']],
    ]);
    expect(BACKGROUND_LABEL).toBe('はいけい');
    expect(closetGroups(items, 'boy', categoriesByDoll.boy).map((g) => g.items.map((i) => i.id))).toEqual([['my:bg-boy']]);
  });

  const library: Library = { all: async () => [], put: async () => undefined, remove: async () => undefined };
  const openItem = (item: MyItem, backend: Partial<StudioBackend> = {}) => {
    const handlers = { onChanged: vi.fn(async () => undefined), onGone: vi.fn(), onClose: vi.fn() };
    render(<ClosetItem item={item} doll={dolls[0]} group={[item]} online backend={backend as StudioBackend} library={library} fitReady onEditFit={() => undefined} {...handlers} />);
    return handlers;
  };
  it('背景を開くと、名前と「けす」だけ（色・ならび・いちを きめる、は無い）。ドールは重ねない', () => {
    openItem(myItem('my:bg1', 'girl', BACKGROUND_CATEGORY));
    expect(screen.getByTestId('closet-name')).toBeTruthy();
    expect(screen.getByTestId('closet-delete')).toBeTruthy();
    expect(screen.queryByTestId('closet-hue')).toBeNull();
    expect(screen.queryByTestId('closet-move-front')).toBeNull();
    expect(screen.queryByTestId('closet-fit')).toBeNull();
    expect(screen.getByTestId('closet-stage').querySelector('img[src="girl.webp"]')).toBeNull();
  });
  it('服を開くと、いままでどおり（色・ならび・いちを きめる、がある）', () => {
    openItem(myItem('my:top', 'girl', 'トップス'));
    expect(screen.getByTestId('closet-hue')).toBeTruthy();
    expect(screen.getByTestId('closet-move-front')).toBeTruthy();
    expect(screen.getByTestId('closet-fit')).toBeTruthy();
    expect(screen.getByTestId('closet-stage').querySelector('img[src="girl.webp"]')).not.toBeNull();
  });
  it('背景を消す: サーバーで消してから、端末の控えからも消す', async () => {
    const deleteMyItem = vi.fn(async () => undefined);
    const remove = vi.spyOn(library, 'remove');
    const handlers = openItem(myItem('my:bg1', 'girl', BACKGROUND_CATEGORY), { deleteMyItem });
    fireEvent.click(screen.getByTestId('closet-delete'));
    fireEvent.click(screen.getByTestId('closet-delete-yes'));
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalled());
    expect(deleteMyItem).toHaveBeenCalledWith('my:bg1');
    expect(remove).toHaveBeenCalledWith('my:bg1');
  });
});

describe('届いた演出: 背景', () => {
  const candidate = (categoryId: string, status: StudioCandidate['status'], itemId?: string): StudioCandidate => ({ index: 0, name: 'きかく', categoryId, status, notes: status === 'failed' ? ['作れませんでした'] : [], ...(itemId ? { itemId } : {}) });
  const job = (c: StudioCandidate): StudioJob => ({ id: 'j1', dollId: 'girl', done: true, tickets: 1, createdAt: 1, candidates: [c] });
  it('背景が届いた: background の印が付き、名前は背景の名前', () => {
    const view = revealView(job(candidate(BACKGROUND_CATEGORY, 'kept', 'my:bg1')), [myItem('my:bg1', 'girl', BACKGROUND_CATEGORY)], dolls, categoriesByDoll);
    expect(view).toMatchObject({ kind: 'arrived', background: true, title: 'なまえ my:bg1', missing: 0 });
    expect(view.items.map((i) => i.id)).toEqual(['my:bg1']);
  });
  it('服が届いたときは、background は false', () => {
    expect(revealView(job(candidate('トップス', 'kept', 'my:top')), [myItem('my:top', 'girl', 'トップス')], dolls, categoriesByDoll).background).toBe(false);
  });
  it('背景ができなかった: 「はいけい」として知らせる', () => {
    const view = revealView(job(candidate(BACKGROUND_CATEGORY, 'failed')), [], dolls, categoriesByDoll);
    expect(view).toMatchObject({ kind: 'failed-only', background: false, failed: [{ label: 'はいけい', note: '作れませんでした' }] });
  });
  it('背景の演出: 「あたらしい はいけいが とどいたよ！」。ドールは重ねない。使えるなら「つかってみる」', () => {
    const view = revealView(job(candidate(BACKGROUND_CATEGORY, 'kept', 'my:bg1')), [myItem('my:bg1', 'girl', BACKGROUND_CATEGORY)], dolls, categoriesByDoll);
    const onTryOn = vi.fn();
    render(<Reveal view={view} canTryOn onTryOn={onTryOn} onOpenCloset={() => undefined} onClose={() => undefined} />);
    expect(screen.getByTestId('reveal').textContent).toContain('あたらしい はいけいが とどいたよ！');
    expect(screen.getByTestId('reveal-stage').querySelector('img[src="girl.webp"]')).toBeNull();
    expect(screen.getByTestId('reveal-try').textContent).toBe('つかってみる');
    fireEvent.click(screen.getByTestId('reveal-try'));
    expect(onTryOn).toHaveBeenCalled();
  });
});

describe('ゲームに重ねる: 自分の背景', () => {
  const content: LoadedContent = {
    dolls: [doll('girl', 'おんなのこ'), doll('boy', 'おとこのこ')],
    clothing: [],
    backgrounds: [{ id: 'bg/public', name: 'みんなの', imageUrl: 'https://x/bg.jpg', thumbnailUrl: 'https://x/bg-thumb.jpg' }],
    categories: categoriesByDoll,
  };
  it('そのドールの背景として、公開の背景の前に足す（絵は data: の URL。服には足さない）。クローゼットの順番', async () => {
    const merged = await mergeMyItems(content, [myItem('my:bg1', 'girl', BACKGROUND_CATEGORY, 1), myItem('my:bg2', 'girl', BACKGROUND_CATEGORY, 2), myItem('my:top', 'girl', 'トップス')]);
    expect(merged.backgrounds.map((b) => [b.id, b.dollId])).toEqual([['my:bg2', 'girl'], ['my:bg1', 'girl'], ['bg/public', undefined]]);
    expect(merged.backgrounds[1]).toMatchObject({ name: 'なまえ my:bg1', isCustom: true });
    expect(merged.backgrounds[1].imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(atob(merged.backgrounds[1].imageUrl.split(',')[1])).toBe('image-my:bg1');
    expect(atob(merged.backgrounds[1].thumbnailUrl!.split(',')[1])).toBe('thumb-my:bg1');
    expect(merged.clothing.map((c) => c.id)).toEqual(['my:top']);
    // もとの content は書き換えない
    expect(content.backgrounds).toHaveLength(1);
  });
  it('ゲームに出ていないドールの背景・絵の欠けた背景は、足さない。背景を消したあとは、公開の背景だけに戻る', async () => {
    const broken = { ...myItem('my:bg-broken', 'girl', BACKGROUND_CATEGORY), files: { thumb: blob('t') } };
    const merged = await mergeMyItems(content, [myItem('my:bg-gone', 'いない', BACKGROUND_CATEGORY), broken]);
    expect(merged.backgrounds.map((b) => b.id)).toEqual(['bg/public']);
    expect((await mergeMyItems(content, [])).backgrounds).toEqual(content.backgrounds);
  });
  it('自分の背景は、端末の中に絵があるので、先読みで取りに行かない', async () => {
    const merged = await mergeMyItems(content, [myItem('my:bg1', 'girl', BACKGROUND_CATEGORY)]);
    const urls = contentUrlsForDoll('https://x/', content.dolls[0], [], merged.backgrounds);
    expect(urls.some((u) => u.startsWith('data:'))).toBe(false);
    expect(urls).toContain('https://x/bg.jpg');
  });
});
