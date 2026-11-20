import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '../cloud/backend';
import type { StudioJob } from '../cloud/backend';
import { createFakeBackend } from '../cloud/fakeBackend';

const image = async () => new Blob(['png'], { type: 'image/png' });
const make = (options: Parameters<typeof createFakeBackend>[0] = {}) => createFakeBackend({ image, delayMs: 100, ...options });
const lastJob = (backend: ReturnType<typeof make>, id: string) => {
  let job: StudioJob | null = null;
  const stop = backend.watchJob(id, (j) => (job = j));
  stop();
  return job! as StudioJob;
};

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe('偽物の裏側（開発とテスト用）', () => {
  it('利用者: 利用者コードと、チケットの残りを返す。次に開いても同じ利用者', async () => {
    const a = await make({ tickets: 3 }).signIn();
    expect(a.tickets).toBe(3);
    expect(a.userCode).toMatch(/^[A-Z0-9]{8}$/);
    expect(a.admin).toBe(false);
    const again = await make({ tickets: 99 }).signIn(); // 保存されている利用者が優先
    expect(again).toEqual(a);
  });

  it('1 点作る: チケットが 1 枚減り、順番待ち → 作成中 → できた、と進む。絵と位置が付く', async () => {
    const backend = make({ tickets: 2 });
    const seen: number[] = [];
    backend.onUser((u) => seen.push(u.tickets));
    const { jobId, cost } = await backend.startJob({ dollId: 'd', theme: 'うみ', styleId: 'anime', target: { kind: 'category', categoryId: 'トップス' } });
    expect(cost).toBe(1);
    expect(seen.at(-1)).toBe(1);
    expect(lastJob(backend, jobId).candidates.map((c) => c.status)).toEqual(['working']);
    await vi.advanceTimersByTimeAsync(150);
    const job = lastJob(backend, jobId);
    expect(job.done).toBe(true);
    expect(job.tickets).toBe(1);
    expect(job.candidates[0]).toMatchObject({ index: 0, categoryId: 'トップス', status: 'done' });
    expect(job.candidates[0].name).toBeTruthy();
    expect(job.candidates[0].preview).toMatchObject({ canvasW: 1024, canvasH: 1024 });
    expect(job.candidates[0].preview!.url).toMatch(/^data:image\/png/);
  });

  it('セット: パーツの数だけチケットを使い、同じセットの印が付く。1 点ずつ順に進む', async () => {
    const backend = make({ tickets: 5 });
    const { jobId, cost } = await backend.startJob({ dollId: 'd', theme: 'うみ', styleId: 'anime', target: { kind: 'set', categoryIds: ['トップス', 'ボトムス', 'くつ'] } });
    expect(cost).toBe(3);
    expect((await backend.signIn()).tickets).toBe(2);
    const start = lastJob(backend, jobId);
    expect(start.set?.name).toBeTruthy();
    expect(start.candidates.map((c) => c.status)).toEqual(['working', 'waiting', 'waiting']);
    await vi.advanceTimersByTimeAsync(150);
    expect(lastJob(backend, jobId).candidates.map((c) => c.status)).toEqual(['done', 'working', 'waiting']);
    await vi.advanceTimersByTimeAsync(300);
    expect(lastJob(backend, jobId).done).toBe(true);
  });

  it('チケットが足りないときは、始めずに断る（残りは減らない）', async () => {
    const backend = make({ tickets: 1 });
    const error = await backend.startJob({ dollId: 'd', theme: 'x', styleId: 'anime', target: { kind: 'set', categoryIds: ['a', 'b'] } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackendError);
    expect((error as BackendError).code).toBe('no-tickets');
    expect((await backend.signIn()).tickets).toBe(1);
  });

  it('できなかった品目の分は、チケットが戻る', async () => {
    const backend = make({ tickets: 3, failCategories: ['くつ'] });
    const { jobId } = await backend.startJob({ dollId: 'd', theme: 'x', styleId: 'anime', target: { kind: 'set', categoryIds: ['トップス', 'くつ'] } });
    await vi.advanceTimersByTimeAsync(500);
    const job = lastJob(backend, jobId);
    expect(job.candidates.map((c) => c.status)).toEqual(['done', 'failed']);
    expect(job.candidates[1].notes.join('')).toMatch(/チケット/);
    expect(job.tickets).toBe(1);
    expect((await backend.signIn()).tickets).toBe(2);
  });

  it('「使う」: 自分の服ができる（ID は my: で始まり、絵が付き、セットの印を引き継ぐ）。一覧に入り、消せる', async () => {
    const backend = make({ tickets: 5 });
    const { jobId } = await backend.startJob({ dollId: 'd', theme: 'x', styleId: 'anime', target: { kind: 'set', categoryIds: ['トップス', 'くつ'] } });
    await vi.advanceTimersByTimeAsync(500);
    const kept = await backend.keep(jobId, 0, 'あたらしいなまえ');
    expect(kept.id).toMatch(/^my:/);
    expect(kept.dollId).toBe('d');
    expect(kept.item).toMatchObject({ id: kept.id, name: 'あたらしいなまえ', category: 'トップス' });
    expect(kept.files[kept.item.image.file]).toBeInstanceOf(Blob);
    expect(kept.files[kept.item.thumb]).toBeInstanceOf(Blob);
    expect(kept.set).toEqual(lastJob(backend, jobId).set);
    expect(lastJob(backend, jobId).candidates[0].status).toBe('kept');
    expect((await backend.listMyItems()).map((i) => i.id)).toEqual([kept.id]);
    // 一覧には絵が入らない。1 点を、絵ごと取れる（持ち主の印つき）
    expect((await backend.listMyItems())[0]).not.toHaveProperty('files');
    const fetched = await backend.fetchMyItem(kept.id);
    expect(fetched.files[fetched.item.image.file]).toBeInstanceOf(Blob);
    expect(fetched.owner).toBe((await backend.signIn()).userCode);
    expect(kept.owner).toBe(fetched.owner);
    await expect(backend.fetchMyItem('my:nothing')).rejects.toMatchObject({ code: 'refused' });
    // 同じ候補を 2 回は使えない
    await expect(backend.keep(jobId, 0, 'x')).rejects.toBeInstanceOf(BackendError);
    await backend.deleteMyItem(kept.id);
    expect(await backend.listMyItems()).toEqual([]);
  });

  it('「捨てる」と、決めていない候補の一覧（閉じて開き直しても残る。作りかけは続きから進む）', async () => {
    const backend = make({ tickets: 5 });
    const { jobId } = await backend.startJob({ dollId: 'd', theme: 'x', styleId: 'anime', target: { kind: 'set', categoryIds: ['トップス', 'くつ'] } });
    await vi.advanceTimersByTimeAsync(150); // 1 点目ができて、2 点目が作成中
    // 閉じて開き直す
    const reopened = make({ tickets: 99 });
    expect((await reopened.pendingJobs()).map((j) => j.id)).toEqual([jobId]);
    await vi.advanceTimersByTimeAsync(300);
    expect(lastJob(reopened, jobId).candidates.map((c) => c.status)).toEqual(['done', 'done']);
    await reopened.discard(jobId, 0);
    expect((await reopened.pendingJobs())[0].candidates.map((c) => c.status)).toEqual(['discarded', 'done']);
    await reopened.keep(jobId, 1, 'くつ');
    // 全部決めたら、一覧から消える
    expect(await reopened.pendingJobs()).toEqual([]);
  });

  it('テーマが空・長すぎる、セットのカテゴリの数が範囲の外、は断る', async () => {
    const backend = make({ tickets: 9 });
    const start = (theme: string, categoryIds: string[]) => backend.startJob({ dollId: 'd', theme, styleId: 'anime', target: { kind: 'set', categoryIds } }).catch((e: BackendError) => e.code);
    expect(await start(' ', ['a', 'b'])).toBe('refused');
    expect(await start('あ'.repeat(61), ['a', 'b'])).toBe('refused');
    expect(await start('x', ['a'])).toBe('refused');
    expect(await start('x', ['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('refused');
    expect((await backend.signIn()).tickets).toBe(9);
  });

  it('つながっていないとき（offline）は、どの操作も offline で断る', async () => {
    const backend = make({ tickets: 2, offline: true });
    await expect(backend.signIn()).rejects.toMatchObject({ code: 'offline' });
    await expect(backend.listMyItems()).rejects.toMatchObject({ code: 'offline' });
  });
});
