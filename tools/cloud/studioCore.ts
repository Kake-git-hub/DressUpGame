/**
 * アプリの中のスタジオの、サーバー側の本体
 *
 * 利用者・チケット・生成の進行・保存。置き場（CloudStore・CloudFiles）と AI は外から渡すので、
 * 本物（Firebase の関数）でも、テスト（メモリの中）でも、同じ中身が動く。
 * 絵を作る中身は、PC のスタジオと同じもの（tools/studio/generate.ts と、品目ごとの処理）を使う。
 */
import sharp from 'sharp';
import type { Manifest, ManifestDoll, ManifestItem } from '../../src/content/manifest.ts';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import { isBackHairCategory } from '../../src/pipeline/hairSplit.ts';
import { findStyle } from '../../src/studio/stylePresets.ts';
import { MemoryWriter } from '../content/encode.ts';
import { ContentError, encodeItemImages } from '../content/manifestEdit.ts';
import type { AiClients } from '../studio/ai.ts';
import type { DollAssets } from '../studio/dollAssets.ts';
import { generateCandidate, planItems, planSet } from '../studio/generate.ts';
import type { Candidate, PlannedItem } from '../studio/generate.ts';
import { pngToRgba } from '../studio/silhouette.ts';
import { CloudError } from './store.ts';
import type { CandidateDoc, CloudFiles, CloudStore, ItemDoc, JobDoc, LayerKind, SetRef } from './store.ts';

// 公開されている素材（一覧と、ドールの型）
export interface PublicContent {
  manifest(): Promise<Manifest>;
  assets: DollAssets;
}

export interface CoreDeps {
  store: CloudStore;
  files: CloudFiles;
  ai: AiClients;
  content: PublicContent;
  adminCodes: string[]; // 管理者の利用者コード
  limits: { perDay: number; perUserDay?: number; maxAttempts: number }; // 1 日の画像の上限（サーバー全体・利用者ごと）、1 品目あたりの生成回数
  now: () => number;
  newId: () => string;
  heartbeatMs?: number; // 作っている間、この間隔で「動いている」の合図を書く（既定 30 秒）
  runBudgetMs?: number; // 1 回の呼び出しで、新しい品目に取りかかるのは、始めてからこの時間まで（既定 8 分。関数の時間切れの前に、自分でやめる）
}

export interface UserView {
  userCode: string;
  tickets: number;
  admin: boolean;
}
export type Target = { kind: 'category'; categoryId: string } | { kind: 'set'; categoryIds: string[] };

export const THEME_MAX = 60;
export const SET_MIN = 2;
export const SET_MAX = 6;
const NAME_MAX = 20;
// 作成中のまま、これだけ進んでいない仕事は「止まっている」とみなして、呼び直しで続きを進める
export const STALE_MS = 150_000;
const LAYERS: LayerKind[] = ['png', 'hide', 'shape', 'front', 'under'];

// 利用者コード: まぎらわしい文字（I・O・0・1）を除いた 8 文字
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 8 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);
// 置き場のパスには、記号を使わない
const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');
const jobPrefix = (uid: string, jobId: string, index: number) => `users/${uid}/jobs/${safe(jobId)}/${index}-`;
const itemPrefix = (uid: string, itemId: string) => `users/${uid}/items/${safe(itemId)}/`;
const plainName = (value: string, fallback: string) => value.replace(/[\\/]/g, '').trim().slice(0, NAME_MAX).trim() || fallback.slice(0, NAME_MAX);
const undecided = (c: CandidateDoc) => c.status === 'waiting' || c.status === 'working' || c.status === 'done';

export async function signIn(deps: CoreDeps, uid: string): Promise<UserView> {
  const user = await deps.store.createUser(uid, makeCode, deps.now());
  // チケットの数が壊れている（数でない）ときは、0 枚として扱う
  const tickets = typeof user.tickets === 'number' && Number.isFinite(user.tickets) ? user.tickets : 0;
  return { userCode: user.userCode, tickets, admin: deps.adminCodes.includes(user.userCode) };
}

async function dollOf(deps: CoreDeps, dollId: string): Promise<ManifestDoll> {
  const doll = (await deps.content.manifest()).dolls.find((d) => d.id === dollId);
  if (!doll) throw new CloudError('refused', 'このドールは、いまは使えません');
  return doll;
}

/**
 * 生成を始める: 入力を確かめ、企画を作り、チケットを引いて、順番待ちの仕事を作る。絵は、まだ作らない（runJob）。
 */
export async function startJob(deps: CoreDeps, uid: string, input: { dollId: string; theme: string; styleId: string; target: Target }): Promise<{ jobId: string; cost: number }> {
  const user = await signIn(deps, uid);
  const theme = typeof input.theme === 'string' ? input.theme.trim() : '';
  if (!theme || theme.length > THEME_MAX) throw new CloudError('refused', `テーマは 1〜${THEME_MAX} 文字で入力してください`);
  const doll = await dollOf(deps, input.dollId);
  const target = input.target;
  const wanted = target?.kind === 'set' ? target.categoryIds : target?.kind === 'category' ? [target.categoryId] : [];
  const usable = (id: unknown) => doll.categories.some((c) => c.id === id && !isBackHairCategory(c.label));
  if (!Array.isArray(wanted) || wanted.length === 0 || !wanted.every(usable) || new Set(wanted).size !== wanted.length) throw new CloudError('refused', '作るものを選び直してください');
  if (target.kind === 'set' && (wanted.length < SET_MIN || wanted.length > SET_MAX)) throw new CloudError('refused', `セットに入れるものは ${SET_MIN}〜${SET_MAX} 個にしてください`);
  const { text, image } = deps.ai;
  if (!text || !image) throw new CloudError('unknown', 'サーバーの準備ができていません（AI のキーが設定されていません）');

  // 足りないと分かっているなら、企画（文章の AI）も呼ばない（チケットの無い人に、作者の費用で AI を使わせない）
  if (!user.admin && user.tickets < wanted.length) throw new CloudError('no-tickets', `チケットが足りません（のこり ${user.tickets} 枚、必要 ${wanted.length} 枚）`);

  // 企画（文章の AI）。ここで失敗しても、チケットは引いていない
  const style = findStyle(input.styleId);
  let items: PlannedItem[];
  let setName: string | null = null;
  try {
    if (target.kind === 'set') {
      const planned = await planSet(text, doll, { theme, categories: wanted, style: style.prompt });
      items = planned.items;
      setName = planned.name;
    } else {
      items = await planItems(text, doll, { theme, count: 1, categories: wanted, style: style.prompt });
    }
  } catch (error) {
    throw new CloudError('unknown', `企画を作れませんでした（${(error as Error).message}）`);
  }
  if (items.length === 0) throw new CloudError('unknown', '企画を作れませんでした。テーマを変えて、もう一度ためしてください');

  const jobId = deps.newId();
  const cost = items.length;
  const now = deps.now();
  // 管理者は引かない（台帳には残す）
  if (user.admin) await deps.store.note(uid, -cost, `admin:job:${jobId}`, now);
  else await deps.store.charge(uid, cost, `job:${jobId}`, now);
  const job: JobDoc = {
    id: jobId,
    dollId: doll.id,
    theme,
    styleId: style.id,
    ...(setName !== null ? { set: { id: `my:set-${jobId}`, name: setName } } : {}),
    done: false,
    tickets: cost,
    createdAt: now,
    heartbeat: now,
    ...(user.admin ? { free: true } : {}),
    candidates: items.map((item, index): CandidateDoc => ({ index, name: item.name, categoryId: item.category, description: item.description, colors: item.colors, status: 'waiting', notes: [] })),
  };
  try {
    await deps.store.createJob(uid, job);
  } catch (error) {
    // 仕事を作れなかったら、引いた分を戻す
    if (!user.admin) await deps.store.addTickets(uid, cost, `refund:job:${jobId}`, deps.now());
    throw error;
  }
  return { jobId, cost };
}

/**
 * 生成を進める: 順番待ちの品目を 1 点ずつ作る。時間がかかる（1 点で 30 秒〜1 分）。
 * 同時に 2 回呼ばれても、絵は 1 回しか作らない。途中で止まった仕事は、呼び直すと続きから進む。
 */
export async function runJob(deps: CoreDeps, uid: string, jobId: string): Promise<void> {
  const first = await deps.store.getJob(uid, jobId);
  if (!first) throw new CloudError('refused', 'この仕事は見つかりません');
  const runner = deps.newId(); // この呼び出しの印
  const started = Date.now();
  const budget = deps.runBudgetMs ?? 480_000;

  // 次の 1 点を「作成中」にして受け持つ（割り込まれない）。受け持てなければ null。
  // updateJob の change は呼び直されることがあるので、外の変数は、毎回はじめに元へ戻す
  const take = async (): Promise<CandidateDoc | null> => {
    let claimed: CandidateDoc | null = null;
    await deps.store.updateJob(uid, jobId, (job) => {
      claimed = null;
      if (job.done) return null;
      const now = deps.now();
      // ほかの呼び出しが進めている最中なら、手を出さない
      if (job.candidates.some((c) => c.status === 'working') && now - job.heartbeat <= STALE_MS) return null;
      // 止まっていた分は、順番待ちに戻す
      job.candidates = job.candidates.map((c) => (c.status === 'working' ? { ...c, status: 'waiting' as const } : c));
      const next = job.candidates.find((c) => c.status === 'waiting');
      if (next) {
        next.status = 'working';
        claimed = { ...next };
        job.runner = runner;
      } else {
        job.done = true;
        delete job.runner;
      }
      job.heartbeat = now;
      return job;
    });
    return claimed;
  };
  // いまも、この呼び出しが、その品目を受け持っているか（止まったとみなされて、ほかの呼び出しに追い越されていないか）
  const mine = (job: JobDoc, index: number) => job.runner === runner && job.candidates.some((c) => c.index === index && c.status === 'working');
  // 受け持った 1 点の結果を書いて、続けるなら次の 1 点を受け持つ。追い越されていたら、何も書かない（applied = false）
  const finish = async (index: number, change: Partial<CandidateDoc>, refund: boolean, more: boolean): Promise<{ applied: boolean; next: CandidateDoc | null }> => {
    let applied = false;
    let next: CandidateDoc | null = null;
    await deps.store.updateJob(uid, jobId, (job) => {
      applied = false;
      next = null;
      if (!mine(job, index)) return null;
      job.candidates = job.candidates.map((c) => (c.index === index ? { ...c, ...change } : c));
      if (refund) job.tickets = Math.max(0, job.tickets - 1);
      applied = true;
      const waiting = job.candidates.find((c) => c.status === 'waiting');
      if (!waiting) {
        job.done = true;
        delete job.runner;
      } else if (more) {
        waiting.status = 'working';
        next = { ...waiting };
      } else {
        // 時間切れ: 残りは、アプリからの呼び直しに任せる
        delete job.runner;
      }
      job.heartbeat = deps.now();
      return job;
    });
    return { applied, next };
  };

  let current = await take();
  if (!current) return;
  // 作っている間は、「動いている」の合図を書き続ける（1 点に長くかかっても、止まったとみなされて二重に作られないように）
  const beat = setInterval(() => {
    void deps.store.updateJob(uid, jobId, (job) => (job.done || job.runner !== runner ? null : { ...job, heartbeat: deps.now() })).catch(() => undefined);
  }, deps.heartbeatMs ?? 30_000);
  try {
    const doll = await dollOf(deps, first.dollId).catch(() => null);
    const { text, image } = deps.ai;
    // 画像を 1 枚作る前: 利用者ごとの上限（1 人が、みんなの分を使い切らないように。管理者にはかけない）と、サーバー全体の上限
    const spend = async () => {
      const day = dayOf(deps.now());
      if (!first.free && deps.limits.perUserDay !== undefined) await deps.store.spendImage(`${day}:${uid}`, deps.limits.perUserDay);
      await deps.store.spendImage(day, deps.limits.perDay);
    };
    while (current) {
      const c: CandidateDoc = current;
      let change: Partial<CandidateDoc>;
      let ok = false;
      try {
        if (!doll) throw new CloudError('refused', 'このドールは、いまは使えません');
        if (!text || !image) throw new CloudError('unknown', 'サーバーの準備ができていません');
        const candidate: Candidate = { item: { category: c.categoryId, name: c.name, description: c.description, colors: c.colors }, status: 'waiting', attempts: 0, warnings: [], notes: [] };
        await generateCandidate(
          {
            text,
            image,
            budget: { spend },
            doll,
            template: await deps.content.assets.workTemplate(doll),
            data: await deps.content.assets.workData(doll),
            style: findStyle(first.styleId).prompt,
            hi: await deps.content.assets.hiTemplate(doll),
            maxAttempts: deps.limits.maxAttempts,
          },
          candidate,
        );
        if (!candidate.png || candidate.status === 'failed') throw new Error(candidate.notes.join(' ') || '絵を作れませんでした');
        // 保存用の絵と、見せる絵（切り抜き）を置き場に入れる
        const prefix = jobPrefix(uid, jobId, c.index);
        const layers: Partial<Record<LayerKind, string>> = {};
        for (const kind of LAYERS) {
          const data = candidate[kind];
          if (!data) continue;
          layers[kind] = `${prefix}${kind}.png`;
          await deps.files.put(layers[kind]!, data, 'image/png');
        }
        const full = await pngToRgba(candidate.png);
        const box = alphaBBox(full.rgba, full.width, full.height);
        if (!box) throw new Error('絵が空でした');
        const preview = { path: `${prefix}preview.png`, canvasW: full.width, canvasH: full.height, box };
        await deps.files.put(preview.path, await sharp(candidate.png).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).png().toBuffer(), 'image/png');
        change = { status: 'done', notes: candidate.notes, preview, layers };
        ok = true;
      } catch (error) {
        change = { status: 'failed', notes: [`作れませんでした（${(error as Error).message}）。チケットは戻しました`] };
      }
      if (!ok) {
        // 追い越されていたら、戻さない・消さない（引き継いだ呼び出しが、同じ品目を作っている・作り終えている）
        const now = await deps.store.getJob(uid, jobId);
        if (!now || !mine(now, c.index)) return;
        // できなかった分は、チケットを戻す。同じ品目では 1 回だけ（このあと止まって作り直しになり、また失敗しても、二重に戻らない）。
        // 管理者が始めた仕事は、もともと引いていない
        if (first.free) await deps.store.note(uid, 1, `admin:refund:${jobId}:${c.index}`, deps.now());
        else await deps.store.refundOnce(uid, `${jobId}:${c.index}`, `refund:${jobId}:${c.index}`, deps.now());
      }
      const result = await finish(c.index, change, !ok, Date.now() - started < budget);
      if (!result.applied) return;
      if (!ok) await deps.files.removeAll(jobPrefix(uid, jobId, c.index)).catch(() => undefined);
      current = result.next;
    }
  } finally {
    clearInterval(beat);
  }
}

// まだ「使う」「捨てる」を決めていない候補のある仕事（新しい順）
export async function listJobs(deps: CoreDeps, uid: string): Promise<JobDoc[]> {
  return (await deps.store.listJobs(uid)).filter((job) => job.candidates.some(undecided));
}

// 候補を「できた」から別の状態へ移す（割り込まれない）。できていない・もう決めた候補なら CloudError
async function decide(deps: CoreDeps, uid: string, jobId: string, index: number, from: CandidateDoc['status'], to: CandidateDoc['status']): Promise<{ job: JobDoc; candidate: CandidateDoc }> {
  let found: CandidateDoc | null = null;
  const job = await deps.store.updateJob(uid, jobId, (current) => {
    found = null; // 呼び直されることがあるので、毎回はじめに戻す
    const candidate = current.candidates.find((c) => c.index === index);
    if (!candidate || candidate.status !== from) return null;
    found = { ...candidate };
    candidate.status = to;
    return current;
  });
  if (!found) throw new CloudError('refused', 'この候補は、もう決まっています');
  return { job, candidate: found };
}

/**
 * 「使う」: 候補を、自分の服として保存する（髪の前後の分け方・くつの中の肌・サムネイルは、PC のスタジオと同じ処理）。
 */
export async function keep(deps: CoreDeps, uid: string, jobId: string, index: number, name: string): Promise<ItemDoc> {
  // 先に「使った」にする（同じ候補を、2 回は使えない）。保存に失敗したら、「できた」に戻す
  const { job, candidate } = await decide(deps, uid, jobId, index, 'done', 'kept');
  try {
    const doll = await dollOf(deps, job.dollId);
    const layer = async (kind: LayerKind) => (candidate.layers?.[kind] ? await deps.files.get(candidate.layers[kind]!) : null);
    const png = await layer('png');
    if (!png) throw new CloudError('refused', 'この候補の絵が見つかりません');
    const id = `my:${jobId}-${index}`;
    const input = await deps.content.assets.itemInput(doll, {
      category: candidate.categoryId,
      name: plainName(typeof name === 'string' ? name : '', candidate.name),
      png,
      hide: await layer('hide'),
      shape: await layer('shape'),
      front: await layer('front'),
      under: await layer('under'),
    });
    const writer = new MemoryWriter();
    const encoded = await encodeItemImages(doll, input, writer);
    const item: ManifestItem = {
      id,
      name: input.name,
      category: input.category,
      image: encoded.image,
      thumb: encoded.thumb,
      ...(encoded.hide ? { hide: encoded.hide } : {}),
      ...(encoded.back ? { back: encoded.back } : {}),
      ...(encoded.backThumb ? { backThumb: encoded.backThumb } : {}),
      ...(encoded.under ? { under: encoded.under } : {}),
    };
    const paths: Record<string, string> = {};
    for (const [file, data] of writer.files) {
      paths[file] = `${itemPrefix(uid, id)}${file.split('/').pop()}`;
      await deps.files.put(paths[file], data, file.endsWith('.webp') ? 'image/webp' : 'image/png');
    }
    const doc: ItemDoc = { id, dollId: doll.id, item, paths, ...(job.set ? { set: job.set as SetRef } : {}), createdAt: deps.now() };
    await deps.store.putItem(uid, doc);
    await deps.files.removeAll(jobPrefix(uid, jobId, index)).catch(() => undefined);
    return doc;
  } catch (error) {
    await decide(deps, uid, jobId, index, 'kept', 'done').catch(() => undefined);
    if (error instanceof CloudError) throw error;
    if (error instanceof ContentError) throw new CloudError('refused', error.message);
    throw error;
  }
}

// 「捨てる」
export async function discard(deps: CoreDeps, uid: string, jobId: string, index: number): Promise<void> {
  await decide(deps, uid, jobId, index, 'done', 'discarded');
  await deps.files.removeAll(jobPrefix(uid, jobId, index)).catch(() => undefined);
}

export function listItems(deps: CoreDeps, uid: string): Promise<ItemDoc[]> {
  return deps.store.listItems(uid);
}

export async function deleteItem(deps: CoreDeps, uid: string, itemId: string): Promise<void> {
  if (!(await deps.store.getItem(uid, itemId))) return;
  await deps.store.deleteItem(uid, itemId);
  await deps.files.removeAll(itemPrefix(uid, itemId));
}
