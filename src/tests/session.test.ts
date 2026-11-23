/**
 * つなぎ役（起動時の合わせ・進み具合・届いた知らせ）のテスト。裏側は偽物、端末の控えはメモリの中。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '../cloud/backend';
import type { MyItem, StudioBackend } from '../cloud/backend';
import { createFakeBackend } from '../cloud/fakeBackend';
import type { Library } from '../cloud/library';
import { ACKED_KEY, createSession, NEW_KEY, USED_KEY } from '../cloud/session';

const image = async () => new Blob(['png'], { type: 'image/png' });
const top = { dollId: 'd', theme: 'うみ', styleId: 'anime', target: { kind: 'category' as const, categoryId: 'トップス' } };

function memoryLibrary(): Library & { items: Map<string, MyItem>; failPut: boolean } {
  const items = new Map<string, MyItem>();
  const library = {
    items,
    failPut: false,
    all: async () => [...items.values()],
    put: async (item: MyItem) => {
      if (library.failPut) throw new Error('この端末に、服を保存できませんでした');
      items.set(item.id, item);
    },
    remove: async (id: string) => void items.delete(id),
  };
  return library;
}
// 呼ばれた回数を数え、つながらない状態にできる裏側
function wrap(backend: StudioBackend) {
  const state = { offline: false, ackFails: false, calls: { openJobs: 0, listMyItems: 0, ackJob: 0, signIn: 0 } };
  const guard = () => {
    if (state.offline) throw new BackendError('offline', 'インターネットにつながっていません');
  };
  const wrapped: StudioBackend = {
    ...backend,
    async signIn() {
      state.calls.signIn++;
      guard();
      return backend.signIn();
    },
    async openJobs() {
      state.calls.openJobs++;
      guard();
      return backend.openJobs();
    },
    async listMyItems() {
      state.calls.listMyItems++;
      guard();
      return backend.listMyItems();
    },
    async ackJob(jobId) {
      state.calls.ackJob++;
      guard();
      if (state.ackFails) throw new BackendError('unknown', 'だめでした');
      return backend.ackJob(jobId);
    },
  };
  return { backend: wrapped, state };
}
function setup(options: { visible?: () => boolean } = {}) {
  const { backend, state } = wrap(createFakeBackend({ image, delayMs: 100, planMs: 0, tickets: 9 }));
  const library = memoryLibrary();
  let changed = 0;
  const make = () => createSession({ backend, library, onLibraryChanged: () => void changed++, ...(options.visible ? { visible: options.visible } : {}) });
  return { backend, state, library, make, changed: () => changed };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('つなぎ役', () => {
  it('つなぐ前は idle。つなぐと、利用者が分かり、この端末で使った印が残る', async () => {
    const { make } = setup();
    const session = make();
    expect(session.getState()).toMatchObject({ status: 'idle', user: null, jobs: [], arrivals: [], newItemIds: [], storeFailed: false });
    expect(localStorage.getItem(USED_KEY)).toBeNull();
    let notified = 0;
    session.subscribe(() => notified++);
    await session.connect();
    expect(session.getState()).toMatchObject({ status: 'ready', problem: null, user: { tickets: 9 } });
    expect(localStorage.getItem(USED_KEY)).toBe('1');
    expect(notified).toBeGreaterThan(0);
  });

  it('つながらなくても投げず、problem に理由が入る。あとの refresh でつながれば ready（2 回つないでも 1 回）', async () => {
    const { make, state } = setup();
    state.offline = true;
    const session = make();
    await expect(Promise.all([session.connect(), session.connect()])).resolves.toBeDefined();
    expect(state.calls.signIn).toBe(1);
    expect(session.getState()).toMatchObject({ status: 'problem', problemCode: 'offline', user: null });
    expect(session.getState().problem).toMatch(/つながっていません/);
    expect(localStorage.getItem(USED_KEY)).toBeNull();
    state.offline = false;
    await session.refresh();
    expect(session.getState()).toMatchObject({ status: 'ready', problem: null, problemCode: null });
  });

  it('仕事が終わると、服を端末に取り込み、NEW に入り、arrivals に出る', async () => {
    const { make, library, changed } = setup();
    const session = make();
    await session.connect();
    const { jobId } = await session.backend.startJob(top);
    session.track(jobId);
    await vi.advanceTimersByTimeAsync(10);
    expect(session.getState().jobs.map((j) => j.id)).toEqual([jobId]);
    expect(session.getState().arrivals).toEqual([]);
    await vi.advanceTimersByTimeAsync(30_200);
    const state = session.getState();
    expect(state.arrivals.map((j) => j.id)).toEqual([jobId]);
    const itemId = state.arrivals[0].candidates[0].itemId!;
    expect([...library.items.keys()]).toEqual([itemId]);
    expect(state.newItemIds).toEqual([itemId]);
    expect(JSON.parse(localStorage.getItem(NEW_KEY)!)).toEqual([itemId]);
    expect(state.storeFailed).toBe(false);
    expect(changed()).toBe(1);
    // チケットの残りも、変わっている
    expect(state.user!.tickets).toBe(8);
    session.markSeen(itemId);
    expect(session.getState().newItemIds).toEqual([]);
    expect(JSON.parse(localStorage.getItem(NEW_KEY)!)).toEqual([]);
  });

  it('一度開いた服は、つなぎ直しても NEW に戻らない（その仕事の結果を、まだ見ていなくても）', async () => {
    const { make } = setup();
    const session = make();
    await session.connect();
    const { jobId } = await session.backend.startJob(top);
    await vi.advanceTimersByTimeAsync(200);
    await session.refresh();
    const itemId = session.getState().arrivals[0].candidates[0].itemId!;
    expect(session.getState().newItemIds).toEqual([itemId]);
    session.markSeen(itemId);
    // アプリを開き直した（仕事 jobId は、まだ「見た」にしていない）
    const again = make();
    await again.connect();
    expect(again.getState().arrivals.map((j) => j.id)).toEqual([jobId]);
    expect(again.getState().newItemIds).toEqual([]);
  });

  it('届いた順（古い順）に並ぶ', async () => {
    const { make } = setup();
    const session = make();
    await session.connect();
    const a = await session.backend.startJob(top);
    await vi.advanceTimersByTimeAsync(10);
    const b = await session.backend.startJob(top);
    await vi.advanceTimersByTimeAsync(500);
    await session.refresh();
    expect(session.getState().arrivals.map((j) => j.id)).toEqual([a.jobId, b.jobId]);
  });

  it('見た（ack）仕事は arrivals から消え、作り直したつなぎ役でも出ない', async () => {
    const { make, state } = setup();
    const session = make();
    await session.connect();
    const { jobId } = await session.backend.startJob(top);
    await vi.advanceTimersByTimeAsync(200);
    await session.refresh();
    expect(session.getState().arrivals).toHaveLength(1);
    await session.ack(jobId);
    expect(session.getState().arrivals).toEqual([]);
    expect(session.getState().jobs).toEqual([]);
    expect(state.calls.ackJob).toBe(1);
    const again = make();
    await again.connect();
    expect(again.getState().arrivals).toEqual([]);
  });

  it('見た印をサーバーに付けられなくても、この端末では、もう出さない（次につないだとき、付け直す）', async () => {
    const { make, state, backend } = setup();
    const session = make();
    await session.connect();
    const { jobId } = await session.backend.startJob(top);
    await vi.advanceTimersByTimeAsync(200);
    await session.refresh();
    state.ackFails = true;
    await session.ack(jobId);
    expect(session.getState().arrivals).toEqual([]);
    expect(JSON.parse(localStorage.getItem(ACKED_KEY)!)).toEqual([jobId]);
    expect((await backend.openJobs()).map((j) => j.id)).toEqual([jobId]); // サーバーでは、まだ「見ていない」
    state.ackFails = false;
    const again = make();
    await again.connect();
    expect(again.getState().arrivals).toEqual([]);
    expect(await backend.openJobs()).toEqual([]); // 付け直した
  });

  it('端末に保存できないときも、arrivals には出て、storeFailed が true', async () => {
    const { make, library } = setup();
    const session = make();
    await session.connect();
    const { jobId } = await session.backend.startJob(top);
    library.failPut = true;
    await vi.advanceTimersByTimeAsync(200);
    await session.refresh();
    expect(session.getState().arrivals.map((j) => j.id)).toEqual([jobId]);
    expect(session.getState().storeFailed).toBe(true);
    expect(session.getState().newItemIds).toEqual([]);
  });

  it('終わっていない仕事が無ければ、聞き直さない', async () => {
    const { make, state } = setup();
    const session = make();
    await session.connect();
    const asked = state.calls.openJobs;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(state.calls.openJobs).toBe(asked);
  });

  it('ふだんは 30 秒おき、setFast(true) の間は 3 秒おきに聞く', async () => {
    const backendSlow = wrap(createFakeBackend({ image, delayMs: 10_000_000, planMs: 0, tickets: 9 }));
    const session = createSession({ backend: backendSlow.backend, library: memoryLibrary(), onLibraryChanged: () => undefined });
    await session.connect();
    const { jobId } = await session.backend.startJob(top);
    session.track(jobId);
    await vi.advanceTimersByTimeAsync(10);
    const first = backendSlow.state.calls.openJobs;
    await vi.advanceTimersByTimeAsync(29_000);
    expect(backendSlow.state.calls.openJobs).toBe(first);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(backendSlow.state.calls.openJobs).toBe(first + 1);
    session.setFast(true);
    const base = backendSlow.state.calls.openJobs;
    await vi.advanceTimersByTimeAsync(9_100);
    expect(backendSlow.state.calls.openJobs).toBe(base + 3);
    session.setFast(false);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(backendSlow.state.calls.openJobs).toBe(base + 3);
    await vi.advanceTimersByTimeAsync(10_100);
    expect(backendSlow.state.calls.openJobs).toBe(base + 4);
  });

  it('見えていない間は聞かず、見えたらすぐ聞く', async () => {
    let visible = true;
    const backendSlow = wrap(createFakeBackend({ image, delayMs: 10_000_000, planMs: 0, tickets: 9 }));
    const session = createSession({ backend: backendSlow.backend, library: memoryLibrary(), onLibraryChanged: () => undefined, visible: () => visible });
    await session.connect();
    const { jobId } = await session.backend.startJob(top);
    session.track(jobId);
    await vi.advanceTimersByTimeAsync(10);
    visible = false;
    const base = backendSlow.state.calls.openJobs;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(backendSlow.state.calls.openJobs).toBe(base);
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(10);
    expect(backendSlow.state.calls.openJobs).toBe(base + 1);
  });

  it('聞いている途中でつながらなくなっても、落ちずに、また聞く', async () => {
    const backendSlow = wrap(createFakeBackend({ image, delayMs: 60_000, planMs: 0, tickets: 9 }));
    const session = createSession({ backend: backendSlow.backend, library: memoryLibrary(), onLibraryChanged: () => undefined });
    await session.connect();
    const { jobId } = await session.backend.startJob(top);
    session.track(jobId);
    await vi.advanceTimersByTimeAsync(10);
    backendSlow.state.offline = true;
    await vi.advanceTimersByTimeAsync(31_000);
    expect(session.getState().jobs.map((j) => j.id)).toEqual([jobId]); // 分かっている仕事は、消さない
    backendSlow.state.offline = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(session.getState().arrivals.map((j) => j.id)).toEqual([jobId]);
  });
});
