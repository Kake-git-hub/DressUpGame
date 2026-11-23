/**
 * つなぎ役: サーバー（裏側）と、端末の控え・画面のあいだをつなぐ。アプリに 1 つだけ作る。
 *
 *   - つなぐ（利用者を確かめる）。つながらなくても、ゲームは止めない（理由を state.problem に入れるだけ）
 *   - 作りかけの仕事がある間は、ときどきサーバーに聞く（画面が見えている間だけ）
 *   - 仕事が終わったら、できた服を端末の控えに取り込み、メニューに重ね直してもらい、「届いた」と知らせる
 *   - 結果を見た印は、サーバーに付ける。付けられなくても、この端末では、もう出さない
 *
 * このファイルは軽い（Firebase の部品を読まない）。裏側の本物は、初めて呼ぶときに読み込まれる（createBackend.ts）。
 */
import { BackendError } from './backend';
import type { BackendErrorCode, StudioBackend, StudioJob, StudioUser } from './backend';
import type { Library } from './library';
import { syncLibrary } from './sync';

export interface SessionState {
  status: 'idle' | 'connecting' | 'ready' | 'problem'; // idle = まだつないでいない
  user: StudioUser | null;
  problem: string | null; // つなげなかった理由（「つくる」「クローゼット」の中に出す。ゲームには出さない）
  problemCode: BackendErrorCode | null;
  jobs: StudioJob[]; // まだ見ていない仕事（作りかけ + 終わって、結果を見ていないもの）。新しい順
  arrivals: StudioJob[]; // jobs のうち、終わっていて、できた服を端末に取り込んだあとのもの。古い順（演出を出す順）
  newItemIds: string[]; // NEW の印の服（できてから、まだ 1 回も開いていない）
  storeFailed: boolean; // 端末に保存できなかった服がある
}

export interface CloudSession {
  getState(): SessionState;
  subscribe(listener: () => void): () => void;
  connect(): Promise<void>; // つなぐ（2 回呼んでも 1 回）。失敗しても投げない（state.problem）
  refresh(): Promise<void>; // いますぐ、服を合わせ、仕事を聞く（つながっていなければ、つなぎ直す）
  setFast(on: boolean): void; // つくる・クローゼットを開いている間は true（聞く間隔 3 秒。ふだんは 30 秒）
  track(jobId: string): void; // 「作る」で始めた仕事を、すぐ見はじめる
  ack(jobId: string): Promise<void>; // 演出・知らせを見た
  markSeen(itemId: string): void; // NEW の印を消す
  readonly backend: StudioBackend;
}

export const USED_KEY = 'dressup_cloud_used'; // 1 回でもつないだ端末の印（次からは、起動のあと、裏でつなぐ）
export const NEW_KEY = 'dressup_new_items'; // NEW の印の服の ID（JSON の並び）
export const ACKED_KEY = 'dressup_acked_jobs'; // この端末で結果を見た仕事（サーバーに印を付けられなかったときの控え）
const SLOW_MS = 30_000;
const FAST_MS = 3_000;
const KEEP_MAX = 200;

type Store = Pick<Storage, 'getItem' | 'setItem'>;
function readList(storage: Store | null, key: string): string[] {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
function writeList(storage: Store | null, key: string, list: string[]): void {
  try {
    storage?.setItem(key, JSON.stringify(list.slice(-KEEP_MAX)));
  } catch {
    // 保存できなくても動く
  }
}

export function createSession(deps: {
  backend: StudioBackend;
  library: Library;
  onLibraryChanged: () => void | Promise<void>;
  storage?: Store;
  visible?: () => boolean;
}): CloudSession {
  const { backend, library } = deps;
  const storage: Store | null = deps.storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
  const visible = deps.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  const listeners = new Set<() => void>();
  let state: SessionState = { status: 'idle', user: null, problem: null, problemCode: null, jobs: [], arrivals: [], newItemIds: readList(storage, NEW_KEY), storeFailed: false };
  const set = (change: Partial<SessionState>) => {
    state = { ...state, ...change };
    listeners.forEach((listener) => listener());
  };

  let acked = readList(storage, ACKED_KEY); // この端末で、もう見た仕事
  const arrived = new Set<string>(); // 服の取り込みまで済ませた仕事
  let fast = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let connecting: Promise<void> | null = null;
  let polling: Promise<void> | null = null;

  const fail = (error: unknown) => {
    const code: BackendErrorCode = error instanceof BackendError ? error.code : 'unknown';
    const message = error instanceof Error ? error.message : String(error);
    set({ status: 'problem', problem: message, problemCode: code });
  };

  // 端末の控えを、サーバーの一覧に合わせる。変わったら、メニューに重ね直してもらう。返り値は、保存できなかった数
  const sync = async (userCode: string): Promise<number> => {
    const result = await syncLibrary(backend, library, userCode);
    if (result.added > 0 || result.removed > 0 || result.updated > 0) await deps.onLibraryChanged();
    return result.failed;
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (state.status !== 'ready' || !state.jobs.some((job) => !job.done)) return;
    timer = setTimeout(() => {
      timer = null;
      // 見えていない間は、聞かない（見えたら、すぐ聞く）
      if (visible()) void poll();
    }, fast ? FAST_MS : SLOW_MS);
  };

  // 仕事を聞く。終わった仕事があれば、できた服を取り込んでから「届いた」にする
  const poll = (full = false): Promise<void> => {
    polling ??= (async () => {
      try {
        const user = state.user;
        if (!user) return;
        // 合わせる前から端末にあった服（NEW の印は、いま初めて届いた服にだけ付ける）
        const before = new Set((await library.all()).map((item) => item.id));
        if (full) {
          const failed = await sync(user.userCode);
          if (failed > 0) set({ storeFailed: true });
        }
        const open = await backend.openJobs();
        // サーバーに印を付けられなかった分は、付け直す（この端末では、もう出さない）
        const jobs = open.filter((job) => !acked.includes(job.id));
        for (const job of open) if (job.done && acked.includes(job.id)) void backend.ackJob(job.id).catch(() => undefined);
        const fresh = jobs.filter((job) => job.done && !arrived.has(job.id));
        let storeFailed = state.storeFailed;
        let newItemIds = state.newItemIds;
        if (fresh.length > 0) {
          // できた服を、端末に取り込む（full のときは、もう合わせてある）
          if (!full && (await sync(user.userCode)) > 0) storeFailed = true;
          const have = new Set((await library.all()).map((item) => item.id));
          const made = fresh.flatMap((job) => job.candidates.flatMap((c) => (c.status === 'kept' && c.itemId ? [c.itemId] : [])));
          if (made.some((id) => !have.has(id))) storeFailed = true;
          const added = made.filter((id) => have.has(id) && !before.has(id) && !newItemIds.includes(id));
          if (added.length > 0) {
            newItemIds = [...newItemIds, ...added];
            writeList(storage, NEW_KEY, newItemIds);
          }
          for (const job of fresh) arrived.add(job.id);
        }
        // 無くなった服（ほかの端末で消した、など）の NEW の印は、消す（ホームの ● が残らないように）
        if (newItemIds.length > 0 && (full || fresh.length > 0)) {
          const have = new Set((await library.all()).map((item) => item.id));
          if (have.size > 0 || full) {
            const kept = newItemIds.filter((id) => have.has(id));
            if (kept.length !== newItemIds.length) {
              newItemIds = kept;
              writeList(storage, NEW_KEY, newItemIds);
            }
          }
        }
        const arrivals = jobs.filter((job) => job.done && arrived.has(job.id)).sort((a, b) => a.createdAt - b.createdAt);
        set({ status: 'ready', problem: null, problemCode: null, jobs, arrivals, newItemIds, storeFailed });
      } catch (error) {
        // つながらないだけなら、分かっている仕事はそのままにして、また聞く
        if (state.status !== 'ready') fail(error);
      } finally {
        polling = null;
        schedule();
      }
    })();
    return polling;
  };

  const connect = (): Promise<void> => {
    if (state.status === 'ready') return Promise.resolve();
    connecting ??= (async () => {
      set({ status: 'connecting', problem: null, problemCode: null });
      try {
        const user = await backend.signIn();
        try {
          storage?.setItem(USED_KEY, '1');
        } catch {
          // 保存できなくても動く
        }
        set({ user });
        await poll(true);
        // 合わせる途中で失敗しても、利用者は分かっている: つくる・クローゼットは開ける
        if (state.status !== 'ready') set({ status: 'ready', problem: null, problemCode: null });
      } catch (error) {
        fail(error);
      } finally {
        connecting = null;
      }
    })();
    return connecting;
  };

  backend.onUser((user) => {
    if (state.user && (state.user.tickets !== user.tickets || state.user.admin !== user.admin || state.user.userCode !== user.userCode)) set({ user });
  });
  // つなごうとして、つながらなかった（起動のときにオフラインだった、など）ら、つながったとき・画面にもどってきたときに、つなぎ直す
  const reconnect = () => {
    if (state.status === 'problem') void connect();
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!visible()) return;
      if (state.status === 'ready' && state.jobs.some((job) => !job.done)) void poll();
      else reconnect();
    });
  }
  if (typeof window !== 'undefined') window.addEventListener('online', reconnect);

  return {
    backend,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    connect,
    async refresh() {
      if (state.status !== 'ready') return connect();
      await polling;
      return poll(true);
    },
    setFast(on) {
      if (fast === on) return;
      fast = on;
      schedule();
    },
    track() {
      void poll();
    },
    async ack(jobId) {
      if (!acked.includes(jobId)) {
        acked = [...acked, jobId];
        writeList(storage, ACKED_KEY, acked);
      }
      set({ jobs: state.jobs.filter((job) => job.id !== jobId), arrivals: state.arrivals.filter((job) => job.id !== jobId) });
      await backend.ackJob(jobId).catch(() => undefined);
    },
    markSeen(itemId) {
      if (!state.newItemIds.includes(itemId)) return;
      const newItemIds = state.newItemIds.filter((id) => id !== itemId);
      writeList(storage, NEW_KEY, newItemIds);
      set({ newItemIds });
    },
  };
}
