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
import { checkout, purchase, shop, shopAck, welcome } from './payment.ts';
import { ackJob, adoptUser, deleteItem, drainAdopted, listItems, offerHandoff, openJobs, orderItems, PHOTO_MAX_BYTES, signIn, startJob, tendJob, tradeAccept, tradeCancel, tradeClaim, tradeCode, tradeJoin, tradeOpen, tradeView, updateItem, giveTickets } from './studioCore.ts';
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
const num = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw refused();
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

// 呼んだ人について、関数が Firebase の証明から分かること
export interface Caller {
  anonymous: boolean; // 匿名のログイン（まだ Google と結び付けていない）
}

/**
 * Firebase の証明（関数が確かめたあとの中身）から、呼んだ人が匿名かを決める。
 * 匿名 = sign_in_provider が anonymous（無ければ anonymous とみなす）で、しかも、結び付けた提供元が無い
 * （identities の中に、空でない一覧が 1 つも無い）。
 * 匿名のまま Google と結び付けた利用者（1 台めの端末が、アカウントになる道）は、証明の sign_in_provider が
 * anonymous のままのことがある。そのときも、identities に google.com が入るので、匿名でない（named になり、offer できない）
 */
export function callerOfToken(token: unknown): Caller {
  const firebase = (typeof token === 'object' && token !== null ? (token as { firebase?: unknown }).firebase : undefined) as { sign_in_provider?: unknown; identities?: unknown } | null | undefined;
  const provider = typeof firebase === 'object' && firebase !== null ? firebase.sign_in_provider : undefined;
  if (typeof provider === 'string' && provider !== 'anonymous') return { anonymous: false };
  const identities = typeof firebase === 'object' && firebase !== null ? firebase.identities : undefined;
  const linked = typeof identities === 'object' && identities !== null && Object.values(identities).some((list) => Array.isArray(list) && list.length > 0);
  return { anonymous: !linked };
}

/**
 * アプリからの呼び出し（利用者・始める・進み具合・見た印・自分の服・引き継ぎ）。data.op で振り分ける。
 * 時間のかかる「進める」（runJob）は、列が呼ぶ別の関数（アプリからは呼べない）。
 * caller は、分からなければ匿名として扱う（引き継ぎの「もらう」側にならない = 安全な側）
 */
export async function handleCall(deps: CoreDeps, uid: string, data: unknown, caller: Caller = { anonymous: true }): Promise<unknown> {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const user = (): Promise<UserView> => signIn(deps, uid);
  switch (d.op) {
    case 'signIn': {
      const view = await user();
      if (caller.anonymous) return { user: view, api: SERVER_API };
      // 名前のある利用者の印（古い合い言葉で、ほかへ移されないように）と、もらった元に残っている分を移す。
      // 失敗しても、signIn は通す（つなげないと、アプリが何もできなくなる）
      try {
        await deps.store.markUser(uid, { named: true });
        await drainAdopted(deps, uid);
      } catch {
        return { user: view, api: SERVER_API };
      }
      // 最初のログインなら、ようこそのチケット（失敗しても通す）
      let given = 0;
      try {
        given = await welcome(deps, uid);
      } catch {
        given = 0;
      }
      return { user: await user(), api: SERVER_API, ...(given > 0 ? { welcome: given } : {}) };
    }
    case 'offer':
      // 合い言葉は、匿名の利用者（2 台めの端末）だけ。アカウントのチケットと服を、合い言葉で持ち出させない
      if (!caller.anonymous) throw refused('この利用者は、引き継ぎの合い言葉をもらえません');
      return { word: await offerHandoff(deps, uid) };
    case 'adopt': {
      const word = str(d.word, 100);
      // 匿名のうちは、移さない（アカウントに入ってから、もう一度）
      if (caller.anonymous) return { status: 'wait', tickets: 0, items: 0 };
      return { ...(await adoptUser(deps, uid, word)), user: await user() };
    }
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
    // 交換（2 台で、服を 1 点ずつ入れ替える）
    case 'tradeOpen':
      return await tradeOpen(deps, uid, str(d.itemId, 100));
    case 'tradeCode':
      return await tradeCode(deps, uid, str(d.tradeId, 100));
    case 'tradeClaim':
      return await tradeClaim(deps, uid, str(d.code, 200));
    case 'tradeJoin':
      await tradeJoin(deps, uid, str(d.tradeId, 100), str(d.itemId, 100));
      return { ok: true };
    case 'trade':
      return { trade: await tradeView(deps, uid, str(d.tradeId, 100)) };
    case 'tradeAccept':
      return { trade: await tradeAccept(deps, uid, str(d.tradeId, 100)) };
    case 'tradeCancel':
      await tradeCancel(deps, uid, str(d.tradeId, 100));
      return { ok: true };
    // 支払い（チケットを買う）
    case 'shop':
      return { ...(await shop(deps, uid)), user: await user() };
    case 'checkout':
      return { ...(await checkout(deps, uid, caller, { pack: str(d.pack, 100), adultAt: num(d.adultAt), agreedAt: num(d.agreedAt) })), user: await user() };
    case 'purchase':
      return { ...(await purchase(deps, uid, str(d.session, 200))), user: await user() };
    case 'shopAck':
      await shopAck(deps, uid, str(d.session, 200));
      return { ok: true, user: await user() };
    case 'giveTickets': {
      // 管理者だけ（giveTickets の中で確かめる）
      if (typeof d.count !== 'number') throw refused();
      return { gift: await giveTickets(deps, uid, { userCode: str(d.userCode, 40), count: d.count }), user: await user() };
    }
    default:
      throw refused();
  }
}
