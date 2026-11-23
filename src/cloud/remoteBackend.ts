/**
 * 本物の裏側: サーバーの関数（functions/）を呼んで動く StudioBackend
 *
 * 通信そのものは「運び役」（StudioTransport。本物は firebaseTransport.ts）に任せ、ここは段取りだけを受け持つ:
 *   - 進み具合は、終わるまで、数秒おきに聞きに行く（アプリは、サーバーの置き場を直接は読めない）
 *   - 生成を進めるのは、サーバーの列。アプリは「進める」を呼ばない（閉じていても、最後まで進む）
 *   - 絵は base64 で届くので、保存用の Blob に直す
 */
import { noAccount } from './account';
import { BackendError, OLD_SERVER_MESSAGE } from './backend';
import type { MyItem, MyItemInfo, StudioBackend, StudioJob, StudioUser } from './backend';
import { API_VERSION } from './wire';
import type { WireFiles, WireItem, WireJob, WireUser } from './wire';

export interface StudioTransport {
  // サーバーの関数 studio を呼ぶ。失敗は BackendError
  call<T>(data: Record<string, unknown>): Promise<T>;
}

export interface RemoteOptions {
  pollMs?: number; // 進み具合を聞きに行く間隔
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
  let user: StudioUser | null = null;
  const userListeners = new Set<(user: StudioUser) => void>();
  const known = new Map<string, StudioJob>(); // 最後に分かった進み具合
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

  const toJob = (wire: WireJob): StudioJob => ({
    id: wire.id,
    dollId: wire.dollId,
    ...(wire.set ? { set: wire.set } : {}),
    done: wire.done,
    candidates: wire.candidates.map((c) => ({ index: c.index, name: c.name, categoryId: c.categoryId, status: c.status, notes: c.notes, ...(c.itemId ? { itemId: c.itemId } : {}) })),
    tickets: wire.tickets,
    createdAt: wire.createdAt,
  });
  const copy = (job: StudioJob): StudioJob => JSON.parse(JSON.stringify(job)) as StudioJob;
  const publish = (job: StudioJob) => {
    const before = known.get(job.id);
    known.set(job.id, job);
    if (before && JSON.stringify(before) === JSON.stringify(job)) return;
    watches.get(job.id)?.listeners.forEach((listener) => listener(copy(job)));
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
  // （聞かれたサーバーは、止まっている仕事を、自分で列に入れ直す）
  const ask = async (jobId: string): Promise<void> => {
    const watch = watches.get(jobId);
    if (!watch || watch.over || watch.asking || watch.listeners.size === 0) return;
    watch.asking = true;
    try {
      const { job } = took(await transport.call<{ job: WireJob; user: WireUser }>({ op: 'job', jobId }));
      publish(toJob(job));
      if (job.done) watch.over = true;
    } catch (error) {
      // 仕事が無くなっていたら、やめる。つながらないだけなら、また聞く
      if ((error as { code?: unknown }).code === 'refused') watch.over = true;
    } finally {
      watch.asking = false;
    }
    schedule(jobId);
  };
  const toInfo = (item: WireItem): MyItemInfo => ({
    id: item.id,
    dollId: item.dollId,
    item: item.item,
    ...(item.set ? { set: item.set } : {}),
    createdAt: item.createdAt,
    hue: item.hue ?? 0,
    order: item.order ?? item.createdAt,
    updatedAt: item.updatedAt ?? item.createdAt,
    notes: item.notes ?? [],
  });
  const toMyItem = (item: WireItem, files: WireFiles, owner: string): MyItem => ({
    ...toInfo(item),
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, toBlob(data, typeOf(name))])),
    owner,
  });

  const backend: StudioBackend = {
    account: noAccount, // 本物の口は、次のタスクでつなぐ
    async signIn() {
      const answer = took(await transport.call<{ user: WireUser; api?: number }>({ op: 'signIn' }));
      // 古いサーバーは、生成を列で進めない（アプリが呼ばないと、だれも進めない）ので、作らせない
      if (typeof answer.api !== 'number' || answer.api < API_VERSION) throw new BackendError('old-server', OLD_SERVER_MESSAGE);
      return { ...user! };
    },
    onUser(listener) {
      userListeners.add(listener);
      return () => userListeners.delete(listener);
    },
    async startJob(input) {
      const started = took(await transport.call<{ jobId: string; cost: number; user: WireUser }>({ op: 'startJob', dollId: input.dollId, theme: input.theme, styleId: input.styleId, target: input.target }));
      return { jobId: started.jobId, cost: started.cost };
    },
    watchJob(jobId, listener) {
      const watch = watches.get(jobId) ?? { listeners: new Set(), timer: null, asking: false, over: false };
      watches.set(jobId, watch);
      watch.listeners.add(listener);
      const job = known.get(jobId);
      if (job) listener(copy(job));
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
    async openJobs() {
      const { jobs } = took(await transport.call<{ jobs: WireJob[]; user: WireUser }>({ op: 'jobs' }));
      const converted = jobs.map(toJob);
      for (const job of converted) known.set(job.id, job);
      return converted.map(copy);
    },
    async ackJob(jobId) {
      await transport.call({ op: 'ack', jobId });
    },
    async listMyItems() {
      return (await transport.call<{ items: WireItem[] }>({ op: 'items' })).items.map(toInfo);
    },
    async fetchMyItem(id) {
      const { item, files } = await transport.call<{ item: WireItem; files: WireFiles }>({ op: 'itemFiles', id });
      return toMyItem(item, files, (await me()).userCode);
    },
    async updateMyItem(id, change) {
      const { item } = await transport.call<{ item: WireItem }>({ op: 'updateItem', id, ...(change.name !== undefined ? { name: change.name } : {}), ...(change.hue !== undefined ? { hue: change.hue } : {}) });
      return toInfo(item);
    },
    async orderMyItems(ids) {
      return (await transport.call<{ items: WireItem[] }>({ op: 'orderItems', ids })).items.map(toInfo);
    },
    async deleteMyItem(id) {
      await transport.call({ op: 'deleteItem', id });
    },
  };
  return backend;
}
