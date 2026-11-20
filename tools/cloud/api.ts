/**
 * アプリからの呼び出しの受け口（サーバーの関数の中身）
 *
 * アプリは、Firestore や Storage を直接は読まない（決まりで全部断る）。どの読み書きも、ここを通る。
 * 絵は、base64 にして返す（アプリが、置き場の CORS の設定なしで受け取れるように）。
 */
import type { WireCandidate, WireItem, WireJob } from '../../src/cloud/wire.ts';
import { CloudError } from './store.ts';
import type { ItemDoc, JobDoc } from './store.ts';
import { deleteItem, discard, keep, listItems, listJobs, signIn, startJob } from './studioCore.ts';
import type { CoreDeps, Target, UserView } from './studioCore.ts';

// 止まっている仕事（作成中のまま進んでいない）かどうかを、アプリに知らせるための目安
const STALE_MS = 150_000;

export type CandidateView = WireCandidate;
export type JobView = WireJob;
export type ItemView = WireItem;

const jobView = (job: JobDoc, now: number): JobView => ({
  id: job.id,
  dollId: job.dollId,
  ...(job.set ? { set: job.set } : {}),
  done: job.done,
  tickets: job.tickets,
  createdAt: job.createdAt,
  candidates: job.candidates.map((c) => ({
    index: c.index,
    name: c.name,
    categoryId: c.categoryId,
    status: c.status,
    notes: c.notes,
    ...(c.preview ? { preview: { canvasW: c.preview.canvasW, canvasH: c.preview.canvasH, box: c.preview.box } } : {}),
  })),
  stalled: !job.done && now - job.heartbeat > STALE_MS,
});
const itemView = (item: ItemDoc): ItemView => ({ id: item.id, dollId: item.dollId, item: item.item, ...(item.set ? { set: item.set } : {}), createdAt: item.createdAt });

const refused = (message = '呼び出しの形が正しくありません') => new CloudError('refused', message);
const str = (value: unknown, max = 200): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw refused();
  return value;
};
const index = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) throw refused();
  return value;
};
function target(value: unknown): Target {
  const v = value as { kind?: unknown; categoryId?: unknown; categoryIds?: unknown } | null;
  if (typeof v !== 'object' || v === null) throw refused();
  if (v.kind === 'category') return { kind: 'category', categoryId: str(v.categoryId) };
  if (v.kind === 'set' && Array.isArray(v.categoryIds) && v.categoryIds.length <= 20) return { kind: 'set', categoryIds: v.categoryIds.map((id) => str(id)) };
  throw refused();
}

async function filesOf(deps: CoreDeps, item: ItemDoc): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const [name, path] of Object.entries(item.paths)) {
    const data = await deps.files.get(path);
    if (!data) throw new CloudError('unknown', 'この服の絵が見つかりません');
    files[name] = data.toString('base64');
  }
  return files;
}

/**
 * 軽い呼び出し（利用者・始める・進み具合・使う・捨てる・自分の服）。data.op で振り分ける。
 * 時間のかかる「進める」（runJob）は、別の関数にする。
 */
export async function handleCall(deps: CoreDeps, uid: string, data: unknown): Promise<unknown> {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const user = (): Promise<UserView> => signIn(deps, uid);
  switch (d.op) {
    case 'signIn':
      return { user: await user() };
    case 'startJob': {
      const started = await startJob(deps, uid, { dollId: str(d.dollId), theme: typeof d.theme === 'string' ? d.theme : '', styleId: typeof d.styleId === 'string' ? d.styleId : '', target: target(d.target) });
      return { ...started, user: await user() };
    }
    case 'job': {
      const job = await deps.store.getJob(uid, str(d.jobId, 100));
      if (!job) throw refused('この仕事は見つかりません');
      return { job: jobView(job, deps.now()), user: await user() };
    }
    case 'jobs':
      return { jobs: (await listJobs(deps, uid)).map((job) => jobView(job, deps.now())), user: await user() };
    case 'preview': {
      const job = await deps.store.getJob(uid, str(d.jobId, 100));
      const path = job?.candidates.find((c) => c.index === index(d.index))?.preview?.path;
      const bytes = path ? await deps.files.get(path) : null;
      if (!bytes) throw refused('この絵は見つかりません');
      return { data: bytes.toString('base64'), contentType: 'image/png' };
    }
    case 'keep': {
      const item = await keep(deps, uid, str(d.jobId, 100), index(d.index), typeof d.name === 'string' ? d.name : '');
      return { item: itemView(item), files: await filesOf(deps, item), user: await user() };
    }
    case 'discard':
      await discard(deps, uid, str(d.jobId, 100), index(d.index));
      return { ok: true };
    case 'items':
      return { items: (await listItems(deps, uid)).map(itemView) };
    case 'itemFiles': {
      const item = await deps.store.getItem(uid, str(d.id, 100));
      if (!item) throw refused('この服は見つかりません');
      return { item: itemView(item), files: await filesOf(deps, item) };
    }
    case 'deleteItem':
      await deleteItem(deps, uid, str(d.id, 100));
      return { ok: true };
    default:
      throw refused();
  }
}
