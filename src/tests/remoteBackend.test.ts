/**
 * 本物の裏側（サーバーの関数を呼ぶ部品）のテスト。通信は、偽の「運び役」に差し替える。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '../cloud/backend';
import type { StudioJob, StudioUser } from '../cloud/backend';
import { noAccount } from '../cloud/account';
import { createRemoteBackend } from '../cloud/remoteBackend';
import type { StudioTransport } from '../cloud/remoteBackend';
import type { WireFiles, WireItem, WireJob } from '../cloud/wire';

const PNG = btoa('png-bytes');
const WEBP = btoa('webp-bytes');
const top = { dollId: 'doll', theme: 'うみ', styleId: 'anime', target: { kind: 'category' as const, categoryId: 'トップス' } };

// 偽のサーバー: 呼び出しを覚え、決めた答えを返す
// api: サーバーの版（null なら、返事に入れない = 前の版のサーバー）
function fakeServer(api: number | null = 2) {
  const user: StudioUser = { userCode: 'ABCD2345', tickets: 3, admin: false };
  const jobs = new Map<string, WireJob>();
  const calls: Record<string, unknown>[] = [];
  const state = { fail: null as BackendError | null };
  const adopt = { status: 'done' as 'done' | 'wait' | 'used' | 'unknown' | 'refused', tickets: 2, fail: null as BackendError | null };
  const item = (id: string): WireItem => ({
    id,
    dollId: 'doll',
    item: { id, name: 'ふく', category: 'トップス', image: { file: 'files/a.webp', canvasW: 1024, canvasH: 1024, box: { x: 1, y: 2, w: 3, h: 4 } }, thumb: 'files/t.png' },
    createdAt: 5,
    hue: 30,
    order: 7,
    updatedAt: 9,
    notes: ['そでが みじかい'],
  });
  const items: WireItem[] = [];
  const files: WireFiles = { 'files/a.webp': WEBP, 'files/t.png': PNG };
  const transport: StudioTransport = {
    auth: async () => {
      throw new Error('auth は、このテストでは使わない');
    },
    async call<T>(data: Record<string, unknown>): Promise<T> {
      calls.push(data);
      if (state.fail) throw state.fail;
      const job = jobs.get(String(data.jobId));
      const answer = (): unknown => {
        switch (data.op) {
          case 'signIn':
            return { user: { ...user }, ...(api !== null ? { api } : {}) };
          case 'startJob':
            user.tickets -= 1;
            jobs.set('j1', { id: 'j1', dollId: String(data.dollId), done: false, tickets: 1, createdAt: 1, candidates: [{ index: 0, name: 'うみのふく', categoryId: 'トップス', status: 'waiting', notes: [] }] });
            return { jobId: 'j1', cost: 1, user: { ...user } };
          case 'job':
            if (!job) throw new BackendError('refused', 'この仕事は見つかりません');
            return { job: structuredClone(job), user: { ...user } };
          case 'jobs':
            return { jobs: [...jobs.values()].map((j) => structuredClone(j)), user: { ...user } };
          case 'ack':
            jobs.delete(String(data.jobId));
            return { ok: true };
          case 'items':
            return { items };
          case 'itemFiles':
            return { item: items.find((i) => i.id === data.id) ?? item(String(data.id)), files };
          case 'updateItem':
            return { item: { ...item(String(data.id)), hue: Number(data.hue ?? 30) } };
          case 'orderItems':
            return { items: (data.ids as string[]).map((id, i) => ({ ...item(id), order: 100 - i })) };
          case 'offer':
            return { word: 'word-secret-1' };
          case 'adopt':
            if (adopt.fail) throw adopt.fail;
            if (adopt.status === 'done') user.tickets += adopt.tickets;
            return { status: adopt.status, tickets: adopt.tickets, items: 1, ...(adopt.status === 'done' ? { user: { ...user } } : {}) };
          case 'deleteItem':
            items.splice(0, items.length, ...items.filter((i) => i.id !== data.id));
            return { ok: true };
          default:
            throw new BackendError('refused', 'bad op');
        }
      };
      return answer() as T;
    },
  };
  // サーバーの側で、1 点できた（自分の服になった）ことにする
  const finish = (jobId: string) => {
    const job = jobs.get(jobId)!;
    job.candidates = job.candidates.map((c) => ({ ...c, status: 'kept', itemId: `my:${jobId}-${c.index}-1` }));
    job.done = true;
    items.push(item(`my:${jobId}-0-1`));
  };
  const count = (op: string) => calls.filter((c) => c.op === op).length;
  return { transport, user, jobs, items, calls, state, adopt, finish, count, item };
}

// jsdom の FileReader はタイマーで動くので、本物のタイマーに戻してから読む
const text = async (blob: Blob) =>
  new Promise<string>((resolve) => {
    vi.useRealTimers();
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('本物の裏側', () => {
  it('ログインの段取りは、渡されたものを使う（無ければ運び役の口で作る）', () => {
    const server = fakeServer();
    expect(createRemoteBackend(server.transport, { account: noAccount }).account).toBe(noAccount);
    expect(createRemoteBackend(server.transport).account).not.toBe(noAccount);
  });

  it('ログインの段取り（window を使う）は、裏側を作るときには用意しない。初めて account を見たときに作る（ブラウザでない所 = エミュレーターのテストでも、裏側を作れるように）', () => {
    const server = fakeServer();
    const saved = globalThis.window;
    // ブラウザでない所のまね: window が無い
    Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true });
    try {
      const backend = createRemoteBackend(server.transport);
      expect(typeof backend.signIn).toBe('function'); // 作るだけなら、落ちない
    } finally {
      Object.defineProperty(globalThis, 'window', { value: saved, configurable: true });
    }
    const backend = createRemoteBackend(server.transport);
    expect(backend.account).toBe(backend.account); // 2 回見ても、同じもの
  });
  it('利用者を確かめる。チケットの残りが変わったら、知らせる', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport);
    const seen: number[] = [];
    backend.onUser((u) => seen.push(u.tickets));
    expect(await backend.signIn()).toEqual({ userCode: 'ABCD2345', tickets: 3, admin: false });
    await backend.startJob(top);
    expect(seen).toEqual([3, 2]);
  });

  it('古いサーバー（api が 2 より小さい・無い）では、old-server で断る', async () => {
    for (const api of [1, null]) {
      const error = await createRemoteBackend(fakeServer(api).transport).signIn().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BackendError);
      expect((error as BackendError).code).toBe('old-server');
      expect((error as BackendError).message).toMatch(/サーバーが古い版です/);
    }
  });

  it('始めたあと、アプリは「進める」を呼ばない。進み具合は、終わるまで聞きに行き、終わったら聞くのをやめる', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport, { pollMs: 1000 });
    const { jobId, cost } = await backend.startJob(top);
    expect([jobId, cost]).toEqual(['j1', 1]);
    const seen: StudioJob[] = [];
    backend.watchJob(jobId, (job) => seen.push(job));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen.at(-1)!.candidates[0].status).toBe('waiting');
    await vi.advanceTimersByTimeAsync(2100);
    expect(server.count('job')).toBe(3);
    expect(seen).toHaveLength(1); // 変わっていなければ、知らせない
    server.finish('j1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen.at(-1)).toMatchObject({ done: true, candidates: [{ status: 'kept', itemId: 'my:j1-0-1' }] });
    const asked = server.count('job');
    await vi.advanceTimersByTimeAsync(5000);
    expect(server.count('job')).toBe(asked);
    // 呼んだのは、signIn の無い startJob と job だけ
    expect([...new Set(server.calls.map((c) => c.op))]).toEqual(['startJob', 'job']);
  });

  it('見ていない仕事の一覧と、見た印', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport);
    await backend.startJob(top);
    server.finish('j1');
    const jobs = await backend.openJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: 'j1', done: true, candidates: [{ status: 'kept', itemId: 'my:j1-0-1' }] });
    await backend.ackJob('j1');
    expect(server.calls.at(-1)).toEqual({ op: 'ack', jobId: 'j1' });
    expect(await backend.openJobs()).toEqual([]);
  });

  it('自分の服: 一覧（絵なし。色・順番つき）、1 点を絵ごと取る（持ち主の印つき）、消す', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport);
    server.items.push(server.item('my:a'));
    const list = await backend.listMyItems();
    expect(list).toEqual([server.item('my:a')]);
    const full = await backend.fetchMyItem('my:a');
    expect(full).toMatchObject({ id: 'my:a', owner: 'ABCD2345', hue: 30, order: 7, updatedAt: 9, notes: ['そでが みじかい'] });
    expect(full.files['files/a.webp'].type).toBe('image/webp');
    expect(full.files['files/t.png'].type).toBe('image/png');
    await backend.deleteMyItem('my:a');
    expect(await backend.listMyItems()).toEqual([]);
    expect(await text(full.files['files/a.webp'])).toBe('webp-bytes');
  });

  it('服の名前・色・並び順を変える', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport);
    expect((await backend.updateMyItem('my:a', { hue: 90 })).hue).toBe(90);
    expect(server.calls.at(-1)).toEqual({ op: 'updateItem', id: 'my:a', hue: 90 });
    await backend.updateMyItem('my:a', { name: 'ふく' });
    expect(server.calls.at(-1)).toEqual({ op: 'updateItem', id: 'my:a', name: 'ふく' });
    const ordered = await backend.orderMyItems(['my:b', 'my:a']);
    expect(server.calls.at(-1)).toEqual({ op: 'orderItems', ids: ['my:b', 'my:a'] });
    expect(ordered.map((i) => [i.id, i.order])).toEqual([['my:b', 100], ['my:a', 99]]);
  });

  it('聞きに行って失敗しても（つながらない）、見るのをやめない。仕事が無くなっていたら、やめる。見るのをやめたら、聞かない', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport, { pollMs: 1000 });
    const { jobId } = await backend.startJob(top);
    const seen: StudioJob[] = [];
    const stop = backend.watchJob(jobId, (job) => seen.push(job));
    await vi.advanceTimersByTimeAsync(0);
    server.state.fail = new BackendError('offline', 'つながりません');
    await vi.advanceTimersByTimeAsync(3000);
    server.state.fail = null;
    server.finish('j1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen.at(-1)!.done).toBe(true);
    stop();

    // 見るのをやめたら、聞かない
    const other = fakeServer();
    const second = createRemoteBackend(other.transport, { pollMs: 1000 });
    await second.startJob(top);
    const unwatch = second.watchJob('j1', () => undefined);
    await vi.advanceTimersByTimeAsync(0);
    unwatch();
    const asked = other.count('job');
    await vi.advanceTimersByTimeAsync(5000);
    expect(other.count('job')).toBe(asked);

    // 仕事が無くなっていたら、やめる
    const gone = fakeServer();
    const third = createRemoteBackend(gone.transport, { pollMs: 1000 });
    third.watchJob('nothing', () => undefined);
    await vi.advanceTimersByTimeAsync(5000);
    expect(gone.count('job')).toBe(1);
  });

  it('サーバーの失敗は、そのまま伝える（チケットが足りない、など）', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport);
    server.state.fail = new BackendError('no-tickets', 'チケットが足りません（のこり 0 枚、必要 1 枚）');
    const error = await backend.startJob(top).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendError);
    expect((error as BackendError).code).toBe('no-tickets');
    expect((error as BackendError).message).toMatch(/のこり 0 枚/);
  });

  describe('チケットを配る', () => {
    it('api が 4 なら、op: giveTickets を、書き方をそろえたコードで呼ぶ。返事の gift を返す', async () => {
      const server = fakeServer(4);
      const call = server.transport.call.bind(server.transport);
      const gifts: Record<string, unknown>[] = [];
      server.transport.call = (async (data: Record<string, unknown>) => {
        if (data.op !== 'giveTickets') return call(data);
        gifts.push(data);
        return { gift: { userCode: 'WXYZ2345', tickets: 8 }, user: { userCode: 'ABCD2345', tickets: 3, admin: true } } as never;
      }) as typeof server.transport.call;
      const backend = createRemoteBackend(server.transport);
      expect(await backend.giveTickets(' wxyz-2345 ', 5)).toEqual({ userCode: 'WXYZ2345', tickets: 8 });
      expect(gifts).toEqual([{ op: 'giveTickets', userCode: 'WXYZ2345', count: 5 }]);
    });
    it('api が 3 のサーバーでは、呼ばずに old-server', async () => {
      const server = fakeServer(3);
      const error = await createRemoteBackend(server.transport).giveTickets('WXYZ2345', 1).catch((e: unknown) => e);
      expect((error as BackendError).code).toBe('old-server');
      expect(server.count('giveTickets')).toBe(0);
    });
  });

  describe('引き継ぎ（合い言葉）', () => {
    it('offerHandoff: api が 3 なら、op: offer を呼んで、合い言葉を返す。まだ signIn していなければ、先に signIn する', async () => {
      const server = fakeServer(3);
      const backend = createRemoteBackend(server.transport);
      expect(await backend.offerHandoff()).toBe('word-secret-1');
      expect(server.calls.map((c) => c.op)).toEqual(['signIn', 'offer']);
      expect(server.calls[1]).toEqual({ op: 'offer' });
      // 2 回めは、signIn を繰り返さない（api を覚えている）
      await backend.offerHandoff();
      expect(server.count('signIn')).toBe(1);
      expect(server.count('offer')).toBe(2);
    });
    it('offerHandoff: signIn のあとなら、覚えた api を使う（signIn を重ねない）', async () => {
      const server = fakeServer(3);
      const backend = createRemoteBackend(server.transport);
      await backend.signIn();
      await backend.offerHandoff();
      expect(server.count('signIn')).toBe(1);
    });
    it('offerHandoff: api が 2 のサーバーでは、offer を呼ばずに old-server', async () => {
      const server = fakeServer(2);
      const backend = createRemoteBackend(server.transport);
      const error = await backend.offerHandoff().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BackendError);
      expect((error as BackendError).code).toBe('old-server');
      expect((error as BackendError).message).toMatch(/サーバーが古い版です/);
      expect(server.count('offer')).toBe(0);
    });
    it('offerHandoff: 返事に合い言葉が無ければ、unknown で失敗する', async () => {
      const server = fakeServer(3);
      const call = server.transport.call.bind(server.transport);
      server.transport.call = (async (data: Record<string, unknown>) => (data.op === 'offer' ? ({} as never) : call(data))) as typeof server.transport.call;
      const error = await createRemoteBackend(server.transport).offerHandoff().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BackendError);
      expect((error as BackendError).code).toBe('unknown');
    });
    it('adopt: op: adopt と合い言葉を渡し、返事の状態と数を返す。返事の user は、いつもの took（知らせる）', async () => {
      const server = fakeServer(3);
      const backend = createRemoteBackend(server.transport);
      const seen: number[] = [];
      backend.onUser((u) => seen.push(u.tickets));
      expect(await backend.adopt('w1')).toEqual({ status: 'done', tickets: 2, items: 1 });
      expect(server.calls.at(-1)).toEqual({ op: 'adopt', word: 'w1' });
      expect(seen).toEqual([5]);
      expect(await backend.signIn()).toMatchObject({ tickets: 5 });
    });
    it('adopt: user の無い返事（wait・unknown など）でも、状態を返す。利用者は変えない', async () => {
      const server = fakeServer(3);
      const backend = createRemoteBackend(server.transport);
      await backend.signIn();
      const seen: number[] = [];
      backend.onUser((u) => seen.push(u.tickets));
      for (const status of ['wait', 'used', 'unknown', 'refused'] as const) {
        server.adopt.status = status;
        expect(await backend.adopt('w1')).toEqual({ status, tickets: 2, items: 1 });
      }
      expect(seen).toEqual([]);
    });
    it('adopt: サーバーの失敗は、そのまま伝える', async () => {
      const server = fakeServer(3);
      server.adopt.fail = new BackendError('offline', 'つながりません');
      const error = await createRemoteBackend(server.transport).adopt('w1').catch((e: unknown) => e);
      expect((error as BackendError).code).toBe('offline');
    });
  });
});
