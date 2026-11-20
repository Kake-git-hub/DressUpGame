/**
 * 本物の裏側: サーバーの関数（functions/）を呼んで動く StudioBackend
 *
 * 通信そのものは「運び役」（StudioTransport。本物は firebaseTransport.ts）に任せ、ここは段取りだけを受け持つ:
 *   - 進み具合は、できるまで、数秒おきに聞きに行く（アプリは、サーバーの置き場を直接は読めない）
 *   - 生成を進める関数（時間がかかる）を呼ぶ。閉じる前に作りかけだった分・止まっている分は、呼び直す
 *   - 絵は base64 で届くので、表示用の data: の URL や、保存用の Blob に直す
 */
import type { MyItem, StudioBackend, StudioCandidate, StudioJob, StudioUser } from './backend';
import type { WireFiles, WireItem, WireJob, WireUser } from './wire';

export interface StudioTransport {
  // 軽い呼び出し（関数 studio）。失敗は BackendError
  call<T>(data: Record<string, unknown>): Promise<T>;
  // 生成を進める（関数 studioRun）。終わるまで返らない。失敗は BackendError
  run(jobId: string): Promise<void>;
}

export interface RemoteOptions {
  pollMs?: number; // 進み具合を聞きに行く間隔
  kickEveryMs?: number; // 止まっている仕事の「進める」を、呼び直す間隔
}

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
const typeOf = (name: string) => TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/png';
function toBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

interface Watch {
  listeners: Set<(job: StudioJob) => void>;
  timer: ReturnType<typeof setTimeout> | null;
  asking: boolean;
  over: boolean; // もう聞きに行かない（終わった・無くなった）
}

export function createRemoteBackend(transport: StudioTransport, options: RemoteOptions = {}): StudioBackend {
  const pollMs = options.pollMs ?? 2500;
  const kickEveryMs = options.kickEveryMs ?? 30_000;
  let user: StudioUser | null = null;
  const userListeners = new Set<(user: StudioUser) => void>();
  const previews = new Map<string, string>(); // `${jobId}:${index}` → data: の URL
  const known = new Map<string, StudioJob>(); // 最後に分かった進み具合
  const kicked = new Map<string, number>(); // 「進める」を最後に頼んだ時刻
  const watches = new Map<string, Watch>();

  // 返事に利用者が入っていたら、覚えて、変わっていれば知らせる
  const took = <T extends { user?: WireUser }>(answer: T): T => {
    const next = answer.user;
    if (next && (!user || user.userCode !== next.userCode || user.tickets !== next.tickets || user.admin !== next.admin)) {
      user = { userCode: next.userCode, tickets: next.tickets, admin: next.admin };
      const snapshot = user;
      userListeners.forEach((listener) => listener({ ...snapshot }));
    }
    return answer;
  };
  const me = async (): Promise<StudioUser> => user ?? (await backend.signIn());

  // サーバーの進み具合を、画面の形に直す（できた候補の絵を、まだ持っていなければ取る）
  const toJob = async (wire: WireJob): Promise<StudioJob> => {
    const candidates = await Promise.all(
      wire.candidates.map(async (c): Promise<StudioCandidate> => {
        const base: StudioCandidate = { index: c.index, name: c.name, categoryId: c.categoryId, status: c.status, notes: c.notes };
        if (c.status !== 'done' || !c.preview) return base;
        const key = `${wire.id}:${c.index}`;
        let url = previews.get(key);
        if (!url) {
          const image = await transport.call<{ data: string; contentType: string }>({ op: 'preview', jobId: wire.id, index: c.index });
          url = `data:${image.contentType};base64,${image.data}`;
          previews.set(key, url);
        }
        return { ...base, preview: { url, canvasW: c.preview.canvasW, canvasH: c.preview.canvasH, box: c.preview.box } };
      }),
    );
    return { id: wire.id, dollId: wire.dollId, ...(wire.set ? { set: wire.set } : {}), done: wire.done, candidates, tickets: wire.tickets, createdAt: wire.createdAt };
  };
  const publish = (job: StudioJob) => {
    const before = known.get(job.id);
    known.set(job.id, job);
    if (before && JSON.stringify(before) === JSON.stringify(job)) return;
    watches.get(job.id)?.listeners.forEach((listener) => listener(structuredCopy(job)));
  };
  const structuredCopy = (job: StudioJob): StudioJob => JSON.parse(JSON.stringify(job)) as StudioJob;

  // サーバーに「進める」を頼む（返事は待たない。終わったら、すぐ進み具合を聞く）
  const kick = (jobId: string) => {
    kicked.set(jobId, Date.now());
    void transport.run(jobId).then(
      () => void ask(jobId),
      () => undefined,
    );
  };
  const schedule = (jobId: string) => {
    const watch = watches.get(jobId);
    if (!watch || watch.over || watch.listeners.size === 0 || watch.timer) return;
    watch.timer = setTimeout(() => {
      watch.timer = null;
      void ask(jobId);
    }, pollMs);
  };
  // 進み具合を 1 回聞く。終わっていなければ、次を予約する
  const ask = async (jobId: string): Promise<void> => {
    const watch = watches.get(jobId);
    if (!watch || watch.over || watch.asking || watch.listeners.size === 0) return;
    watch.asking = true;
    try {
      const { job } = took(await transport.call<{ job: WireJob; user: WireUser }>({ op: 'job', jobId }));
      publish(await toJob(job));
      if (job.done) {
        watch.over = true;
      } else {
        // まだ頼んでいない（閉じる前に作りかけだった）か、止まっているなら、「進める」を頼む
        const last = kicked.get(jobId);
        if (last === undefined || (job.stalled && Date.now() - last >= kickEveryMs)) kick(jobId);
      }
    } catch (error) {
      // 仕事が無くなっていたら、やめる。つながらないだけなら、また聞く
      if ((error as { code?: unknown }).code === 'refused') watch.over = true;
    } finally {
      watch.asking = false;
    }
    schedule(jobId);
  };
  // 「使う」「捨てる」のあと: 手元の進み具合を書き換えて、見ている画面に知らせる
  const decided = (jobId: string, index: number, status: StudioCandidate['status']) => {
    const job = known.get(jobId);
    if (!job) return;
    publish({ ...job, candidates: job.candidates.map((c) => (c.index === index ? { index: c.index, name: c.name, categoryId: c.categoryId, status, notes: c.notes } : c)) });
  };
  const toMyItem = (item: WireItem, files: WireFiles, owner: string): MyItem => ({
    id: item.id,
    dollId: item.dollId,
    item: item.item,
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, toBlob(data, typeOf(name))])),
    ...(item.set ? { set: item.set } : {}),
    createdAt: item.createdAt,
    owner,
  });

  const backend: StudioBackend = {
    async signIn() {
      took(await transport.call<{ user: WireUser }>({ op: 'signIn' }));
      return { ...user! };
    },
    onUser(listener) {
      userListeners.add(listener);
      return () => userListeners.delete(listener);
    },
    async startJob(input) {
      const started = took(await transport.call<{ jobId: string; cost: number; user: WireUser }>({ op: 'startJob', ...input }));
      kick(started.jobId);
      return { jobId: started.jobId, cost: started.cost };
    },
    watchJob(jobId, listener) {
      const watch = watches.get(jobId) ?? { listeners: new Set(), timer: null, asking: false, over: false };
      watches.set(jobId, watch);
      watch.listeners.add(listener);
      const job = known.get(jobId);
      if (job) listener(structuredCopy(job));
      if (job?.done) watch.over = true;
      // まだ分かっていない仕事は、すぐ聞く。分かっている仕事は、次の間隔から
      if (job) schedule(jobId);
      else void ask(jobId);
      return () => {
        watch.listeners.delete(listener);
        if (watch.listeners.size === 0 && watch.timer) {
          clearTimeout(watch.timer);
          watch.timer = null;
        }
      };
    },
    async pendingJobs() {
      const { jobs } = took(await transport.call<{ jobs: WireJob[]; user: WireUser }>({ op: 'jobs' }));
      const converted = await Promise.all(jobs.map(toJob));
      for (const job of converted) known.set(job.id, job);
      return converted.map(structuredCopy);
    },
    async keep(jobId, index, name) {
      const kept = took(await transport.call<{ item: WireItem; files: WireFiles; user: WireUser }>({ op: 'keep', jobId, index, name }));
      decided(jobId, index, 'kept');
      return toMyItem(kept.item, kept.files, (await me()).userCode);
    },
    async discard(jobId, index) {
      await transport.call({ op: 'discard', jobId, index });
      decided(jobId, index, 'discarded');
    },
    async listMyItems() {
      return (await transport.call<{ items: WireItem[] }>({ op: 'items' })).items;
    },
    async fetchMyItem(id) {
      const { item, files } = await transport.call<{ item: WireItem; files: WireFiles }>({ op: 'itemFiles', id });
      return toMyItem(item, files, (await me()).userCode);
    },
    async deleteMyItem(id) {
      await transport.call({ op: 'deleteItem', id });
    },
  };
  return backend;
}
