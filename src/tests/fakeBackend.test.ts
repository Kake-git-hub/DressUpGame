import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendError } from '../cloud/backend';
import type { StudioJob } from '../cloud/backend';
import { createFakeBackend } from '../cloud/fakeBackend';

const image = async () => new Blob(['png'], { type: 'image/png' });
const make = (options: Parameters<typeof createFakeBackend>[0] = {}) => createFakeBackend({ image, delayMs: 100, planMs: 0, ...options });
const lastJob = (backend: ReturnType<typeof make>, id: string) => {
  let job: StudioJob | null = null;
  const stop = backend.watchJob(id, (j) => (job = j));
  stop();
  return job! as StudioJob;
};
const top = { dollId: 'd', theme: 'うみ', styleId: 'anime', target: { kind: 'category' as const, categoryId: 'トップス' } };
const set = { dollId: 'd', theme: 'うみ', styleId: 'anime', target: { kind: 'set' as const, categoryIds: ['トップス', 'くつ'] } };
const codeOf = (e: unknown) => (e instanceof BackendError ? e.code : `not a BackendError: ${String(e)}`);

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

  it('1 点作る: チケットが 1 枚減り、作成中 → 自分の服になる（「使う」は要らない）', async () => {
    const backend = make({ tickets: 2 });
    const seen: number[] = [];
    backend.onUser((u) => seen.push(u.tickets));
    const { jobId, cost } = await backend.startJob(top);
    expect(cost).toBe(1);
    expect(seen.at(-1)).toBe(1);
    expect(lastJob(backend, jobId).candidates.map((c) => c.status)).toEqual(['working']);
    expect(await backend.listMyItems()).toEqual([]);
    await vi.advanceTimersByTimeAsync(150);
    const job = lastJob(backend, jobId);
    expect(job.done).toBe(true);
    expect(job.candidates[0]).toMatchObject({ status: 'kept', itemId: `my:${jobId}-0-1` });
    const items = await backend.listMyItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: `my:${jobId}-0-1`, dollId: 'd', hue: 0, notes: [] });
    expect(items[0].item).toMatchObject({ name: 'うみのトップス', category: 'トップス' });
    expect(items[0].order).toBe(items[0].createdAt);
    const full = await backend.fetchMyItem(items[0].id);
    expect(full.files[full.item.image.file]).toBeInstanceOf(Blob);
    expect(full.owner).toBe((await backend.signIn()).userCode);
  });

  it('セット: パーツの数だけチケットを使い、1 点ずつ順に服になる。同じセットの印が付く', async () => {
    const backend = make({ tickets: 5 });
    const { jobId, cost } = await backend.startJob(set);
    expect(cost).toBe(2);
    expect((await backend.signIn()).tickets).toBe(3);
    await vi.advanceTimersByTimeAsync(110);
    expect(lastJob(backend, jobId).candidates.map((c) => c.status)).toEqual(['kept', 'working']);
    await vi.advanceTimersByTimeAsync(110);
    const job = lastJob(backend, jobId);
    expect(job.done).toBe(true);
    const items = await backend.listMyItems();
    expect(items.map((i) => i.set)).toEqual([job.set, job.set]);
    expect(job.set!.id).toBe(`my:set-${jobId}`);
  });

  it('チケットが足りないときは、始めずに断る（残りは減らない）', async () => {
    const backend = make({ tickets: 1 });
    expect(codeOf(await backend.startJob(set).catch((e) => e))).toBe('no-tickets');
    expect((await backend.signIn()).tickets).toBe(1);
    expect(await backend.openJobs()).toEqual([]);
  });

  it('できなかった品目の分は、チケットが戻る。服はできない', async () => {
    const backend = make({ tickets: 2, failCategories: ['くつ'] });
    const { jobId } = await backend.startJob(set);
    await vi.advanceTimersByTimeAsync(250);
    const job = lastJob(backend, jobId);
    expect(job.candidates.map((c) => c.status)).toEqual(['kept', 'failed']);
    expect(job.candidates[1].notes.join('')).toMatch(/チケットは戻しました/);
    expect((await backend.signIn()).tickets).toBe(1);
    expect(await backend.listMyItems()).toHaveLength(1);
  });

  it('読み込み直すと、閉じていた間に過ぎていた分は、できあがっている（サーバーが進めていた、のまね）', async () => {
    const first = make({ tickets: 5 });
    const { jobId } = await first.startJob(set);
    // 時計だけ進める（閉じていたので、前の裏側のタイマーは動かない）
    vi.setSystemTime(Date.now() + 250);
    const reopened = make();
    const job = lastJob(reopened, jobId);
    expect(job.done).toBe(true);
    expect(job.candidates.map((c) => c.status)).toEqual(['kept', 'kept']);
    expect(await reopened.listMyItems()).toHaveLength(2);
  });

  it('読み込み直したとき、まだ途中の分は、続きから進む', async () => {
    const first = make({ tickets: 5 });
    const { jobId } = await first.startJob(set);
    vi.setSystemTime(Date.now() + 120);
    const reopened = make();
    expect(lastJob(reopened, jobId).candidates.map((c) => c.status)).toEqual(['kept', 'working']);
    await vi.advanceTimersByTimeAsync(100);
    expect(lastJob(reopened, jobId).done).toBe(true);
  });

  it('見ていない仕事: 作りかけと、終わって見ていないもの。見た印を付けると出ない（終わっていない仕事には付かない）', async () => {
    const backend = make({ tickets: 5 });
    const a = await backend.startJob(top);
    await vi.advanceTimersByTimeAsync(150);
    const b = await backend.startJob(top);
    expect((await backend.openJobs()).map((j) => j.id)).toEqual([b.jobId, a.jobId]);
    await backend.ackJob(b.jobId); // まだ終わっていない
    await backend.ackJob(a.jobId);
    expect((await backend.openJobs()).map((j) => j.id)).toEqual([b.jobId]);
    // 開き直しても、見た印は残る
    expect((await make().openJobs()).map((j) => j.id)).toEqual([b.jobId]);
  });

  it('服の名前（20 文字まで。空なら変えない）と、既定の色（-180〜180 の整数）を変える', async () => {
    const backend = make({ tickets: 5 });
    await backend.startJob(top);
    await vi.advanceTimersByTimeAsync(150);
    const [item] = await backend.listMyItems();
    vi.setSystemTime(Date.now() + 1000);
    const renamed = await backend.updateMyItem(item.id, { name: `  ${'あ'.repeat(30)} ` });
    expect(renamed.item.name).toBe('あ'.repeat(20));
    expect(renamed.updatedAt).toBeGreaterThan(item.updatedAt);
    expect((await backend.updateMyItem(item.id, { name: '  ' })).item.name).toBe('あ'.repeat(20));
    expect((await backend.updateMyItem(item.id, { hue: 45.6 })).hue).toBe(46);
    expect((await backend.updateMyItem(item.id, { hue: 999 })).hue).toBe(180);
    expect((await backend.fetchMyItem(item.id)).hue).toBe(180);
    expect(codeOf(await backend.updateMyItem('my:none', { hue: 1 }).catch((e) => e))).toBe('refused');
    // 開き直しても残る
    expect((await make().listMyItems())[0]).toMatchObject({ hue: 180, item: { name: 'あ'.repeat(20) } });
  });

  it('並び順: 先頭ほど order が大きい。知らない ID・同じ ID の重なりは断る', async () => {
    const backend = make({ tickets: 5 });
    await backend.startJob(set);
    await vi.advanceTimersByTimeAsync(250);
    const [a, b] = await backend.listMyItems();
    const ordered = await backend.orderMyItems([b.id, a.id]);
    expect(ordered.map((i) => i.id)).toEqual([b.id, a.id]);
    expect(ordered[0].order).toBeGreaterThan(ordered[1].order);
    expect(codeOf(await backend.orderMyItems([a.id, 'my:none']).catch((e) => e))).toBe('refused');
    expect(codeOf(await backend.orderMyItems([a.id, a.id]).catch((e) => e))).toBe('refused');
  });

  it('自分の服を消す', async () => {
    const backend = make({ tickets: 5 });
    await backend.startJob(top);
    await vi.advanceTimersByTimeAsync(150);
    const [item] = await backend.listMyItems();
    await backend.deleteMyItem(item.id);
    expect(await backend.listMyItems()).toEqual([]);
    expect(codeOf(await backend.fetchMyItem(item.id).catch((e) => e))).toBe('refused');
  });

  it('古いサーバー（oldServer）では、利用者を確かめるときに old-server で断る', async () => {
    expect(codeOf(await make({ oldServer: true }).signIn().catch((e) => e))).toBe('old-server');
  });

  it('planMs の間は、「作る」の返事が返らない（注文の演出を確かめるため）', async () => {
    const backend = make({ tickets: 2, planMs: 500 });
    let started = false;
    const pending = backend.startJob(top).then(() => (started = true));
    await vi.advanceTimersByTimeAsync(400);
    expect(started).toBe(false);
    expect((await backend.signIn()).tickets).toBe(2); // まだ引いていない
    await vi.advanceTimersByTimeAsync(150);
    await pending;
    expect(started).toBe(true);
    expect((await backend.signIn()).tickets).toBe(1);
  });

  it('テーマが空・長すぎる、セットのカテゴリの数が範囲の外、は断る', async () => {
    const backend = make({ tickets: 9 });
    const start = (change: object) => backend.startJob({ ...top, ...change } as never).catch(codeOf);
    expect(await start({ theme: ' ' })).toBe('refused');
    expect(await start({ theme: 'あ'.repeat(61) })).toBe('refused');
    expect(await start({ target: { kind: 'set', categoryIds: ['a'] } })).toBe('refused');
    expect(await start({ target: { kind: 'set', categoryIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } })).toBe('refused');
    expect((await backend.signIn()).tickets).toBe(9);
  });

  it('つながっていないとき（offline）は、どの操作も offline で断る', async () => {
    const backend = make({ offline: true });
    for (const work of [() => backend.signIn(), () => backend.startJob(top), () => backend.openJobs(), () => backend.ackJob('x'), () => backend.listMyItems(), () => backend.fetchMyItem('x'), () => backend.updateMyItem('x', { hue: 1 }), () => backend.orderMyItems(['x']), () => backend.deleteMyItem('x')]) {
      expect(codeOf(await work().catch((e) => e))).toBe('offline');
    }
  });

  describe('ログイン（利用者の入れ替え）', () => {
    const readyBackend = async (options: Parameters<typeof make>[0] = {}) => {
      const backend = make(options);
      await backend.account.prepare();
      return backend;
    };
    // 服を 1 点持っている利用者にする
    const withItem = async (backend: ReturnType<typeof make>) => {
      await backend.startJob(top);
      await vi.advanceTimersByTimeAsync(150);
    };

    it('結び付ける: Google になり、チケットも服も利用者コードも、そのまま', async () => {
      const backend = await readyBackend({ tickets: 5 });
      await withItem(backend);
      const before = await backend.signIn();
      expect(await backend.account.prepare()).toEqual({ kind: 'guest' });
      expect(await backend.account.loginWithPopup('link')).toEqual({ outcome: 'linked' });
      expect(await backend.account.prepare()).toEqual({ kind: 'google', email: 'tameshi@example.com' });
      expect(await backend.signIn()).toEqual(before);
      expect(await backend.listMyItems()).toHaveLength(1);
    });

    it('ログアウト → 空の別の利用者。入り直す → 元の利用者コード・チケット・服が戻る（すぐ、メモリにも）', async () => {
      const backend = await readyBackend({ tickets: 5 });
      await withItem(backend);
      const before = await backend.signIn();
      await backend.account.loginWithPopup('link');
      await backend.account.logout();
      const empty = await backend.signIn();
      expect(empty.tickets).toBe(0);
      expect(empty.admin).toBe(false);
      expect(empty.userCode).not.toBe(before.userCode);
      expect(await backend.listMyItems()).toEqual([]);
      expect(await backend.openJobs()).toEqual([]);
      expect(await backend.account.prepare()).toEqual({ kind: 'guest' });
      expect(await backend.account.loginWithPopup('signin')).toEqual({ outcome: 'switched' });
      expect(await backend.signIn()).toEqual(before);
      expect(await backend.listMyItems()).toHaveLength(1);
      expect(await backend.account.prepare()).toEqual({ kind: 'google', email: 'tameshi@example.com' });
      // 次に開いても（読み込み直しても）同じ
      const reopened = await make().signIn();
      expect(reopened).toEqual(before);
    });

    it('置いてある Google の世界があるとき、結び付ける → もう使われている。いまの世界は、そのまま', async () => {
      const backend = await readyBackend({ tickets: 5 });
      await backend.account.loginWithPopup('link');
      await backend.account.logout();
      const empty = await backend.signIn();
      expect(await backend.account.loginWithPopup('link')).toMatchObject({ outcome: 'taken', code: 'auth/credential-already-in-use' });
      expect(await backend.signIn()).toEqual(empty);
      expect(await backend.account.prepare()).toEqual({ kind: 'guest' });
    });

    it('置いてある世界が無いとき、入る → いまの世界のまま Google になる', async () => {
      const backend = await readyBackend({ tickets: 4 });
      const before = await backend.signIn();
      expect(await backend.account.loginWithPopup('signin')).toEqual({ outcome: 'switched' });
      expect(await backend.signIn()).toEqual(before);
      expect(await backend.account.prepare()).toMatchObject({ kind: 'google' });
    });

    it('入れ替えは、利用者の変化を知らせる', async () => {
      const backend = await readyBackend({ tickets: 5 });
      const seen: number[] = [];
      backend.onUser((u) => seen.push(u.tickets));
      await backend.account.loginWithPopup('link');
      await backend.account.logout();
      expect(seen.at(-1)).toBe(0);
    });

    it('googleTaken・loginFail', async () => {
      const taken = await readyBackend({ googleTaken: true });
      expect(await taken.account.loginWithPopup('link')).toMatchObject({ outcome: 'taken' });
      expect(await taken.account.prepare()).toEqual({ kind: 'guest' });
      localStorage.clear();
      const failing = await readyBackend({ loginFail: 'auth/popup-closed-by-user' });
      expect(await failing.account.loginWithPopup('link')).toMatchObject({ outcome: 'cancelled' });
    });

    it('ログアウトで置いた世界の、作りかけの仕事は、入り直したとき、続きから進む', async () => {
      const backend = await readyBackend({ tickets: 5 });
      await backend.account.loginWithPopup('link');
      const { jobId } = await backend.startJob(top);
      await backend.account.logout();
      await vi.advanceTimersByTimeAsync(500);
      await backend.account.loginWithPopup('signin');
      expect((await backend.openJobs()).find((j) => j.id === jobId)?.done).toBe(true);
      expect(await backend.listMyItems()).toHaveLength(1);
    });
  });
});
