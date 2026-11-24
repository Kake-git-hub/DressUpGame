/**
 * アプリからの呼び出しの受け口（サーバーの関数の中身）
 *
 * アプリは、Firestore や Storage を直接は読まない（決まりで全部断る）。どの読み書きも、ここを通る。
 * 絵は、base64 にして返す（アプリが、置き場の CORS の設定なしで受け取れるように）。
 */
import type { WireCandidate, WireItem, WireJob } from '../../src/cloud/wire.ts';
import { CloudError } from './store.ts';
import type { ItemDoc, JobDoc } from './store.ts';
import { SERVER_API } from '../../src/cloud/wire.ts';
import { ackJob, deleteItem, listItems, openJobs, orderItems, PHOTO_MAX_BYTES, signIn, startJob, tendJob, updateItem } from './studioCore.ts';
import type { CoreDeps, Target, UserView } from './studioCore.ts';


export type CandidateView = WireCandidate;
export type JobView = WireJob;
export type ItemView = WireItem;

const jobView = (job: JobDoc): JobView => {
  // 前の版の「できた」（まだ服にしていない）は、作成中として見せる。「捨てた」は、見せない
  const pending = job.candidates.some((c) => c.status === 'done');
  return {
    id: job.id,
    dollId: job.dollId,
    ...(job.set ? { set: job.set } : {}),
    done: job.done && !pending,
    tickets: job.tickets,
    createdAt: job.createdAt,
    candidates: job.candidates
      .filter((c) => c.status !== 'discarded')
      .map((c) => ({
        index: c.index,
        name: c.name,
        categoryId: c.categoryId,
        status: c.status === 'done' ? ('working' as const) : (c.status as CandidateView['status']),
        notes: c.notes,
        ...(c.itemId ? { itemId: c.itemId } : {}),
      })),
  };
};
const itemView = (item: ItemDoc): ItemView => ({
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

const refused = (message = '呼び出しの形が正しくありません') => new CloudError('refused', message);
const str = (value: unknown, max = 200): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw refused();
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
 * アプリからの呼び出し（利用者・始める・進み具合・見た印・自分の服）。data.op で振り分ける。
 * 時間のかかる「進める」（runJob）は、列が呼ぶ別の関数（アプリからは呼べない）。
 */
export async function handleCall(deps: CoreDeps, uid: string, data: unknown): Promise<unknown> {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const user = (): Promise<UserView> => signIn(deps, uid);
  switch (d.op) {
    case 'signIn':
      return { user: await user(), api: SERVER_API };
    case 'startJob': {
      // 写真（顔を似せる。base64）。無ければ null
      const photo = d.photo === undefined || d.photo === null ? null : Buffer.from(str(d.photo, Math.ceil((PHOTO_MAX_BYTES * 4) / 3) + 4), 'base64');
      const started = await startJob(deps, uid, { dollId: str(d.dollId), theme: typeof d.theme === 'string' ? d.theme : '', styleId: typeof d.styleId === 'string' ? d.styleId : '', target: target(d.target), photo });
      return { ...started, user: await user() };
    }
    case 'job': {
      const job = await deps.store.getJob(uid, str(d.jobId, 100));
      if (!job) throw refused('この仕事は見つかりません');
      // 止まっていれば、列に入れ直す（列のやり直しが尽きた・列に入れるのに失敗した仕事を、ここで拾う）
      return { job: jobView(await tendJob(deps, uid, job)), user: await user() };
    }
    case 'jobs':
      return { jobs: (await openJobs(deps, uid)).map(jobView), user: await user() };
    case 'ack':
      await ackJob(deps, uid, str(d.jobId, 100));
      return { ok: true };
    case 'items':
      return { items: (await listItems(deps, uid)).map(itemView) };
    case 'itemFiles': {
      const item = await deps.store.getItem(uid, str(d.id, 100));
      if (!item) throw refused('この服は見つかりません');
      return { item: itemView(item), files: await filesOf(deps, item) };
    }
    case 'updateItem': {
      if (d.name !== undefined && typeof d.name !== 'string') throw refused();
      if (d.hue !== undefined && (typeof d.hue !== 'number' || !Number.isFinite(d.hue))) throw refused();
      if (d.name === undefined && d.hue === undefined) throw refused();
      const change = { ...(typeof d.name === 'string' ? { name: d.name.slice(0, 200) } : {}), ...(typeof d.hue === 'number' ? { hue: d.hue } : {}) };
      return { item: itemView(await updateItem(deps, uid, str(d.id, 100), change)) };
    }
    case 'orderItems': {
      if (!Array.isArray(d.ids) || d.ids.length > 500) throw refused();
      return { items: (await orderItems(deps, uid, d.ids.map((id) => str(id, 100)))).map(itemView) };
    }
    case 'deleteItem':
      await deleteItem(deps, uid, str(d.id, 100));
      return { ok: true };
    default:
      throw refused();
  }
}
