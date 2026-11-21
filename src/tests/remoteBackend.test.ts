/**
 * 本物の裏側（サーバーの関数を呼ぶ部品）のテスト。通信は、偽の「運び役」に差し替える。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '../cloud/backend';
import type { StudioJob, StudioUser } from '../cloud/backend';
import { createRemoteBackend } from '../cloud/remoteBackend';
import type { StudioTransport } from '../cloud/remoteBackend';
import type { WireFiles, WireItem, WireJob } from '../cloud/wire';

const PNG = btoa('png-bytes');
const WEBP = btoa('webp-bytes');

// 偽のサーバー: 呼び出しを覚え、決めた答えを返す
function fakeServer() {
  const user: StudioUser = { userCode: 'ABCD2345', tickets: 3, admin: false };
  const jobs = new Map<string, WireJob>();
  const items: WireItem[] = [];
  const calls: string[] = [];
  const runs: string[] = [];
  let lastPhoto: unknown;
  const state = { fail: null as BackendError | null, runDone: null as Promise<void> | null, previewFail: null as BackendError | null };
  const item = (id: string): WireItem => ({
    id,
    dollId: 'doll',
    item: { id, name: 'ふく', category: 'トップス', image: { file: 'files/a.webp', canvasW: 1024, canvasH: 1024, box: { x: 1, y: 2, w: 3, h: 4 } }, thumb: 'files/t.png' },
    createdAt: 5,
  });
  const files: WireFiles = { 'files/a.webp': WEBP, 'files/t.png': PNG };
  const transport: StudioTransport = {
    async call<T>(data: Record<string, unknown>): Promise<T> {
      calls.push(String(data.op));
      if (state.fail) throw state.fail;
      const job = jobs.get(String(data.jobId));
      const answer = (): unknown => {
        switch (data.op) {
          case 'signIn':
            return { user: { ...user } };
          case 'startJob': {
            lastPhoto = data.photo;
            user.tickets -= 1;
            jobs.set('j1', { id: 'j1', dollId: String(data.dollId), done: false, tickets: 1, createdAt: 1, stalled: false, candidates: [{ index: 0, name: 'うみのふく', categoryId: 'トップス', status: 'waiting', notes: [] }] });
            return { jobId: 'j1', cost: 1, user: { ...user } };
          }
          case 'job':
            if (!job) throw new BackendError('refused', 'この仕事は見つかりません');
            return { job: structuredClone(job), user: { ...user } };
          case 'jobs':
            return { jobs: [...jobs.values()].map((j) => structuredClone(j)), user: { ...user } };
          case 'preview':
            if (state.previewFail) throw state.previewFail;
            return { data: PNG, contentType: 'image/png' };
          case 'keep':
            job!.candidates[Number(data.index)].status = 'kept';
            items.push({ ...item(`my:${String(data.jobId)}-${String(data.index)}`), item: { ...item('x').item, id: `my:${String(data.jobId)}-${String(data.index)}`, name: String(data.name) } });
            return { item: items[items.length - 1], files, user: { ...user } };
          case 'discard':
            job!.candidates[Number(data.index)].status = 'discarded';
            return { ok: true };
          case 'items':
            return { items };
          case 'itemFiles':
            return { item: items.find((i) => i.id === data.id) ?? item(String(data.id)), files };
          case 'deleteItem':
            items.splice(0, items.length, ...items.filter((i) => i.id !== data.id));
            return { ok: true };
          default:
            throw new BackendError('refused', 'bad op');
        }
      };
      return answer() as T;
    },
    async run(jobId: string) {
      runs.push(jobId);
      if (state.runDone) await state.runDone;
    },
  };
  // サーバーの側で、1 点できたことにする
  const finish = (jobId: string) => {
    const job = jobs.get(jobId)!;
    job.candidates = job.candidates.map((c) => ({ ...c, status: 'done', preview: { canvasW: 1024, canvasH: 1024, box: { x: 10, y: 20, w: 30, h: 40 } } }));
    job.done = true;
  };
  return { transport, user, jobs, items, calls, runs, state, finish, photo: () => lastPhoto };
}

// jsdom の FileReader はタイマーで動くので、本物のタイマーに戻してから読む
const text = async (blob: Blob) =>
  new Promise<string>((resolve) => {
    vi.useRealTimers();
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });
const count = (calls: string[], op: string) => calls.filter((c) => c === op).length;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('本物の裏側', () => {
  it('利用者を確かめる。チケットの残りが変わったら、知らせる', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport);
    const seen: number[] = [];
    backend.onUser((u) => seen.push(u.tickets));
    expect(await backend.signIn()).toEqual({ userCode: 'ABCD2345', tickets: 3, admin: false });
    await backend.startJob({ dollId: 'doll', theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    expect(seen).toEqual([3, 2]);
  });

  it('顔写真は base64 にして送る。無ければ送らない', async () => {
    vi.useRealTimers(); // 写真の読み取り（FileReader）は、本物の時計で進む
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport);
    await backend.startJob({ dollId: 'doll', theme: '', styleId: 'anime', target: { kind: 'category', categoryId: 'かお' }, photo: new Blob([new Uint8Array([1, 2, 3, 250])]) });
    expect(server.photo()).toBe('AQID+g==');
    await backend.startJob({ dollId: 'doll', theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    expect(server.photo()).toBeUndefined();
  });

  it('始めると、サーバーに「進める」を 1 回だけ頼む。進み具合は、できるまで聞きに行き、できたら絵つきで知らせて、聞くのをやめる', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport, { pollMs: 1000 });
    const { jobId, cost } = await backend.startJob({ dollId: 'doll', theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    expect({ jobId, cost }).toEqual({ jobId: 'j1', cost: 1 });
    expect(server.runs).toEqual(['j1']);
    const seen: StudioJob[] = [];
    backend.watchJob(jobId, (job) => seen.push(job));
    await vi.advanceTimersByTimeAsync(3500);
    expect(seen).toHaveLength(1); // 変わっていない間は、知らせない
    expect(seen[0].candidates[0].status).toBe('waiting');
    expect(server.runs).toEqual(['j1']); // 見始めても、頼み直さない
    server.finish('j1');
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ id: 'j1', done: true, tickets: 1 });
    expect(seen[1].candidates[0]).toMatchObject({ status: 'done', preview: { url: `data:image/png;base64,${PNG}`, canvasW: 1024, box: { x: 10, y: 20, w: 30, h: 40 } } });
    expect(seen[1]).not.toHaveProperty('stalled');
    const asked = count(server.calls, 'job');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(count(server.calls, 'job')).toBe(asked);
    expect(count(server.calls, 'preview')).toBe(1);
  });

  it('閉じる前に作りかけだった分: 一覧を絵つきで返し、見始めると「進める」を頼む（止まっていれば、間をあけて頼み直す）', async () => {
    const server = fakeServer();
    server.jobs.set('old', { id: 'old', dollId: 'doll', done: false, tickets: 2, createdAt: 1, stalled: false, candidates: [
      { index: 0, name: 'a', categoryId: 'トップス', status: 'done', notes: [], preview: { canvasW: 8, canvasH: 8, box: { x: 0, y: 0, w: 1, h: 1 } } },
      { index: 1, name: 'b', categoryId: 'くつ', status: 'working', notes: [] },
    ] });
    const backend = createRemoteBackend(server.transport, { pollMs: 1000, kickEveryMs: 5000 });
    const pending = await backend.pendingJobs();
    expect(pending.map((j) => j.id)).toEqual(['old']);
    expect(pending[0].candidates[0].preview!.url).toMatch(/^data:image\/png;base64,/);
    expect(pending[0].candidates[1].preview).toBeUndefined();
    const seen: StudioJob[] = [];
    backend.watchJob('old', (job) => seen.push(job));
    expect(seen).toHaveLength(1); // 分かっている分は、すぐ知らせる
    await vi.advanceTimersByTimeAsync(1000);
    expect(server.runs).toEqual(['old']);
    // 止まっている: 5 秒あけて、頼み直す
    server.jobs.get('old')!.stalled = true;
    await vi.advanceTimersByTimeAsync(3000);
    expect(server.runs).toEqual(['old']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(server.runs).toEqual(['old', 'old']);
    expect(count(server.calls, 'preview')).toBe(1); // 同じ絵を、何度も取らない
  });

  it('「使う」: 絵つきの自分の服（持ち主の印つき）が返り、見ている画面には「使った」と知らせる。「捨てる」も同じ', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport, { pollMs: 1000 });
    await backend.signIn();
    const { jobId } = await backend.startJob({ dollId: 'doll', theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    server.finish(jobId);
    const seen: StudioJob[] = [];
    backend.watchJob(jobId, (job) => seen.push(job));
    await vi.advanceTimersByTimeAsync(1000);
    const item = await backend.keep(jobId, 0, 'なまえ');
    expect(item).toMatchObject({ id: 'my:j1-0', dollId: 'doll', owner: 'ABCD2345', item: { name: 'なまえ', thumb: 'files/t.png' }, createdAt: 5 });
    expect(item.files['files/a.webp'].type).toBe('image/webp');
    expect(item.files['files/t.png'].type).toBe('image/png');
    expect(await text(item.files['files/a.webp'])).toBe('webp-bytes');
    expect(seen[seen.length - 1].candidates[0].status).toBe('kept');
    // 捨てる
    server.jobs.get(jobId)!.candidates[0].status = 'done';
    await backend.discard(jobId, 0);
    expect(seen[seen.length - 1].candidates[0].status).toBe('discarded');
  });

  it('自分の服: 一覧（絵なし）、1 点を絵ごと取る、消す', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport);
    await backend.signIn();
    const { jobId } = await backend.startJob({ dollId: 'doll', theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    server.finish(jobId);
    await backend.keep(jobId, 0, 'なまえ');
    const list = await backend.listMyItems();
    expect(list.map((i) => i.id)).toEqual(['my:j1-0']);
    expect(list[0]).not.toHaveProperty('files');
    const fetched = await backend.fetchMyItem('my:j1-0');
    expect(fetched).toMatchObject({ id: 'my:j1-0', owner: 'ABCD2345', item: { name: 'なまえ' } });
    expect(await text(fetched.files['files/t.png'])).toBe('png-bytes');
    await backend.deleteMyItem('my:j1-0');
    expect(await backend.listMyItems()).toEqual([]);
  });

  it('聞きに行って失敗しても（つながらない）、見るのをやめない。仕事が無くなっていたら、やめる。見るのをやめたら、聞かない', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport, { pollMs: 1000 });
    const { jobId } = await backend.startJob({ dollId: 'doll', theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    const seen: StudioJob[] = [];
    const stop = backend.watchJob(jobId, (job) => seen.push(job));
    await vi.advanceTimersByTimeAsync(1000);
    server.state.fail = new BackendError('offline', 'つながりません');
    await vi.advanceTimersByTimeAsync(3000);
    server.state.fail = null;
    server.finish(jobId);
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen[seen.length - 1].done).toBe(true);
    stop();

    // 仕事が無くなっていた
    const gone: StudioJob[] = [];
    backend.watchJob('nothing', (job) => gone.push(job));
    await vi.advanceTimersByTimeAsync(1000);
    const asked = count(server.calls, 'job');
    await vi.advanceTimersByTimeAsync(5000);
    expect(count(server.calls, 'job')).toBe(asked);
    expect(gone).toEqual([]);

    // 見るのをやめたら、聞かない
    server.jobs.set('j2', { id: 'j2', dollId: 'doll', done: false, tickets: 1, createdAt: 2, stalled: false, candidates: [{ index: 0, name: 'x', categoryId: 'トップス', status: 'working', notes: [] }] });
    const stop2 = backend.watchJob('j2', () => undefined);
    await vi.advanceTimersByTimeAsync(2000);
    stop2();
    const asked2 = count(server.calls, 'job');
    await vi.advanceTimersByTimeAsync(5000);
    expect(count(server.calls, 'job')).toBe(asked2);
  });

  it('できた服の絵を取れなくても、スタジオは開ける（その候補は絵なしで出し、次に聞くときに取り直す）', async () => {
    const server = fakeServer();
    server.jobs.set('old', { id: 'old', dollId: 'doll', done: false, tickets: 2, createdAt: 1, stalled: false, candidates: [
      { index: 0, name: 'a', categoryId: 'トップス', status: 'done', notes: [], preview: { canvasW: 8, canvasH: 8, box: { x: 0, y: 0, w: 1, h: 1 } } },
      { index: 1, name: 'b', categoryId: 'くつ', status: 'working', notes: [] },
    ] });
    const backend = createRemoteBackend(server.transport, { pollMs: 1000 });
    // 絵を取りに行ったら、通信が切れた
    server.state.previewFail = new BackendError('offline', 'つながりません');
    const pending = await backend.pendingJobs();
    expect(pending[0].candidates[0]).toMatchObject({ status: 'done' });
    expect(pending[0].candidates[0].preview).toBeUndefined();
    const seen: StudioJob[] = [];
    backend.watchJob('old', (job) => seen.push(job));
    await vi.advanceTimersByTimeAsync(2000);
    // 絵を取れなくても、見るのをやめない（仕事そのものは、ある）
    const asked = count(server.calls, 'job');
    await vi.advanceTimersByTimeAsync(2000);
    expect(count(server.calls, 'job')).toBeGreaterThan(asked);
    // 取れるようになったら、絵つきで知らせる
    server.state.previewFail = null;
    await vi.advanceTimersByTimeAsync(1000);
    expect(seen[seen.length - 1].candidates[0].preview!.url).toMatch(/^data:image\/png;base64,/);
  });

  it('絵が置き場から無くなっていた（サーバーが「見つかりません」と断る）ら、絵なしで出して、取り直しは繰り返さない。終わった仕事は、聞くのをやめる', async () => {
    const server = fakeServer();
    server.jobs.set('old', { id: 'old', dollId: 'doll', done: true, tickets: 1, createdAt: 1, stalled: false, candidates: [
      { index: 0, name: 'a', categoryId: 'トップス', status: 'done', notes: [], preview: { canvasW: 8, canvasH: 8, box: { x: 0, y: 0, w: 1, h: 1 } } },
    ] });
    server.state.previewFail = new BackendError('refused', 'この絵は見つかりません');
    const backend = createRemoteBackend(server.transport, { pollMs: 1000 });
    const seen: StudioJob[] = [];
    backend.watchJob('old', (job) => seen.push(job));
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen).toHaveLength(1);
    expect(seen[0].candidates[0]).toMatchObject({ status: 'done' });
    expect(seen[0].candidates[0].preview).toBeUndefined();
    expect(count(server.calls, 'preview')).toBe(1);
    expect(count(server.calls, 'job')).toBe(1);
    // 捨てることはできる
    await backend.discard('old', 0);
    expect(seen[seen.length - 1].candidates[0].status).toBe('discarded');
  });

  it('「進める」を頼めなかった（こみあっている・通信が切れた）ら、間をあけて頼み直す', async () => {
    const server = fakeServer();
    let failRuns = 1;
    const run = server.transport.run;
    server.transport.run = async (jobId) => {
      await run(jobId);
      if (failRuns-- > 0) throw new BackendError('limit', 'こみあっています');
    };
    const backend = createRemoteBackend(server.transport, { pollMs: 1000, kickEveryMs: 5000 });
    const { jobId } = await backend.startJob({ dollId: 'doll', theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    server.jobs.get(jobId)!.stalled = true; // だれも作っていない
    backend.watchJob(jobId, () => undefined);
    await vi.advanceTimersByTimeAsync(3000);
    expect(server.runs).toEqual(['j1']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(server.runs).toEqual(['j1', 'j1']);
  });

  it('サーバーの失敗は、そのまま伝える（チケットが足りない、など）', async () => {
    const server = fakeServer();
    const backend = createRemoteBackend(server.transport);
    server.state.fail = new BackendError('no-tickets', 'チケットが足りません');
    await expect(backend.startJob({ dollId: 'doll', theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } })).rejects.toMatchObject({ code: 'no-tickets' });
    expect(server.runs).toEqual([]);
    await expect(backend.signIn()).rejects.toMatchObject({ code: 'no-tickets' });
  });
});
