/**
 * アプリの中のスタジオの、サーバー側の本体
 *
 * 利用者・チケット・生成の進行・保存。置き場（CloudStore・CloudFiles）と AI は外から渡すので、
 * 本物（Firebase の関数）でも、テスト（メモリの中）でも、同じ中身が動く。
 * 絵を作る中身は、PC のスタジオと同じもの（tools/studio/generate.ts と、品目ごとの処理）を使う。
 */
import sharp from 'sharp';
import type { Manifest, ManifestDoll, ManifestItem } from '../../src/content/manifest.ts';
import { isBackHairCategory } from '../../src/pipeline/hairSplit.ts';
import { findStyle } from '../../src/studio/stylePresets.ts';
import { MemoryWriter } from '../content/encode.ts';
import { encodeItemImages } from '../content/manifestEdit.ts';
import type { AiClients } from '../studio/ai.ts';
import type { DollAssets } from '../studio/dollAssets.ts';
import { generateCandidate, planItems, planSet } from '../studio/generate.ts';
import type { Candidate, PlannedItem } from '../studio/generate.ts';
import { isFaceCategory } from '../studio/processFace.ts';
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
  // 仕事を、列に入れる（列が、生成を進める関数を呼ぶ）。delaySeconds: 何秒あとに呼ばれるか（既定 0）
  enqueue: (uid: string, jobId: string, delaySeconds?: number) => Promise<void>;
  maxTries?: number; // 1 つの品目に取りかかれる回数（既定 3。超えたら、打ち切って払い戻す）
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
export const MAX_TRIES = 3;
// ほかの呼び出しが進めている最中に呼ばれたとき、これだけあとに、もう一度呼ばれるようにする
export const BUSY_RETRY_SECONDS = 60;
const GAVE_UP = '作れませんでした（何度か試しましたが、途中で止まりました）。チケットは戻しました';
// 列に入れられなかった、と分かっている仕事を、入れ直す間隔
export const REQUEUE_MS = 30_000;
// 列に入れてあるはずの仕事（列がこみあっていて、まだ呼ばれていないだけかもしれない）を、念のため入れ直すまでの時間。
// 短くすると、こみあっているときに、同じ仕事が列に積み上がって、かえって遅くなる
export const QUEUE_WAIT_MS = 300_000;
// 作ってから、これだけたっても終わらない仕事は、残りを打ち切って払い戻す
export const EXPIRE_MS = 24 * 3_600_000;
const EXPIRED = '時間内に作れませんでした。チケットは戻しました';
// 既定の色（色スライダーの角度）の範囲
export const HUE_MIN = -180;
export const HUE_MAX = 180;
const ORDER_MAX = 500;
const SWEEP_MAX = 200;

// 利用者コード: まぎらわしい文字（I・O・0・1）を除いた 8 文字
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 8 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);
// 置き場のパスには、記号を使わない
const safe = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');
const jobPrefix = (uid: string, jobId: string, index: number) => `users/${uid}/jobs/${safe(jobId)}/${index}-`;
// 顔を似せる写真（仕事が終わったら消す）
const photoPath = (uid: string, jobId: string) => `users/${uid}/jobs/${safe(jobId)}/photo.png`;
// 写真の大きさの上限（受け取る大きさ・AI に渡す長い辺）
export const PHOTO_MAX_BYTES = 4_000_000;
const PHOTO_SIDE = 768;
// 写真を、向きを直し、小さくし、撮影の情報（位置など）を落とした PNG にする。画像でなければ CloudError
export async function normalizePhoto(data: Buffer): Promise<Buffer> {
  if (data.length === 0 || data.length > PHOTO_MAX_BYTES) throw new CloudError('refused', '写真が大きすぎます。撮り直してください');
  try {
    return await sharp(data, { limitInputPixels: 50_000_000 }).rotate().resize(PHOTO_SIDE, PHOTO_SIDE, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).png().toBuffer();
  } catch {
    throw new CloudError('refused', '写真を読み取れませんでした。撮り直してください');
  }
}
const PHOTO_THEME = '写真の顔';
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
export async function startJob(deps: CoreDeps, uid: string, input: { dollId: string; theme: string; styleId: string; target: Target; photo?: Buffer | null }): Promise<{ jobId: string; cost: number }> {
  const user = await signIn(deps, uid);
  const typed = typeof input.theme === 'string' ? input.theme.trim() : '';
  // 写真から顔を作るときは、テーマは無くてもよい
  const theme = typed || (input.photo ? PHOTO_THEME : '');
  if (!theme || theme.length > THEME_MAX) throw new CloudError('refused', `テーマは 1〜${THEME_MAX} 文字で入力してください`);
  const doll = await dollOf(deps, input.dollId);
  const target = input.target;
  const wanted = target?.kind === 'set' ? target.categoryIds : target?.kind === 'category' ? [target.categoryId] : [];
  const usable = (id: unknown) => doll.categories.some((c) => c.id === id && !isBackHairCategory(c.label));
  if (!Array.isArray(wanted) || wanted.length === 0 || !wanted.every(usable) || new Set(wanted).size !== wanted.length) throw new CloudError('refused', '作るものを選び直してください');
  if (target.kind === 'set' && (wanted.length < SET_MIN || wanted.length > SET_MAX)) throw new CloudError('refused', `セットに入れるものは ${SET_MIN}〜${SET_MAX} 個にしてください`);
  // 写真は、顔のカテゴリ 1 点を作るときだけ
  const faceLabel = target.kind === 'category' ? doll.categories.find((c) => c.id === target.categoryId)?.label : undefined;
  if (input.photo && !(faceLabel && isFaceCategory(faceLabel))) throw new CloudError('refused', '写真は、顔を作るときだけ使えます');
  const photo = input.photo ? await normalizePhoto(input.photo) : null;
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
      items = await planItems(text, doll, { theme: photo && !typed ? 'a face that looks like the person in the photo' : theme, count: 1, categories: wanted, style: style.prompt, ...(photo ? { photo } : {}) });
    }
  } catch (error) {
    throw new CloudError('unknown', `企画を作れませんでした（${(error as Error).message}）`);
  }
  if (items.length === 0) throw new CloudError('unknown', '企画を作れませんでした。テーマを変えて、もう一度ためしてください');

  const jobId = deps.newId();
  const cost = items.length;
  // 写真は、絵を作る呼び出し（runJob）で使うので、置き場に入れておく（仕事が終わったら消す）
  if (photo) await deps.files.put(photoPath(uid, jobId), photo, 'image/png');
  const now = deps.now();
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
    v: 2,
    queuedAt: now,
    ...(user.admin ? { free: true } : {}),
    ...(photo ? { photo: photoPath(uid, jobId) } : {}),
    candidates: items.map((item, index): CandidateDoc => ({ index, name: item.name, categoryId: item.category, description: item.description, colors: item.colors, status: 'waiting', notes: [] })),
  };
  try {
    if (user.admin) {
      // 管理者は引かない（台帳には残す）
      await deps.store.note(uid, -cost, `admin:job:${jobId}`, now);
      await deps.store.createJob(uid, job);
    } else {
      // チケットを引くことと、仕事を作ることは、1 つの取り引き（片方だけ、が起きない）
      await deps.store.chargeAndCreateJob(uid, job, cost, `job:${jobId}`, now);
    }
  } catch (error) {
    if (photo) await deps.files.removeAll(photoPath(uid, jobId)).catch(() => undefined);
    throw error;
  }
  // 列に入れる。入れられなくても、仕事はできている（進み具合を聞かれたとき・見回りが、入れ直す。入れられなかった印を付けて、早めに）
  await deps.enqueue(uid, jobId).catch(() => deps.store.updateJob(uid, jobId, (current) => (current.queueFailed ? null : { ...current, queueFailed: true })).catch(() => undefined));
  return { jobId, cost };
}

// できた絵を、自分の服として保存する（髪の前後の分け方・くつの中の肌・サムネイルは、PC のスタジオと同じ処理）
async function saveItem(
  deps: CoreDeps,
  uid: string,
  job: JobDoc,
  doll: ManifestDoll,
  itemId: string,
  source: { category: string; name: string; png: Buffer; hide?: Buffer | null; shape?: Buffer | null; front?: Buffer | null; under?: Buffer | null },
  notes: string[],
): Promise<ItemDoc> {
  const input = await deps.content.assets.itemInput(doll, {
    category: source.category,
    name: plainName(source.name, source.name),
    png: source.png,
    hide: source.hide ?? null,
    shape: source.shape ?? null,
    front: source.front ?? null,
    under: source.under ?? null,
  });
  const writer = new MemoryWriter();
  const encoded = await encodeItemImages(doll, input, writer);
  const item: ManifestItem = {
    id: itemId,
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
    paths[file] = `${itemPrefix(uid, itemId)}${file.split('/').pop()}`;
    await deps.files.put(paths[file], data, file.endsWith('.webp') ? 'image/webp' : 'image/png');
  }
  const now = deps.now();
  const doc: ItemDoc = { id: itemId, dollId: doll.id, item, paths, ...(job.set ? { set: job.set as SetRef } : {}), createdAt: now, hue: 0, order: now, updatedAt: now, ...(notes.length > 0 ? { notes } : {}) };
  await deps.store.putItem(uid, doc);
  return doc;
}

/**
 * できなかった（failed）のに、まだ戻していない（refunded !== true）品目を、払い戻して印を付ける。
 * 失敗は、必ず「failed・refunded: false と書く → 払い戻す → refunded: true と書く」の順（先に払い戻すと、そのあと止まって作り直しになり、
 * できた服と払い戻しの両方が起きうる）。払い戻しは、品目ごとに 1 回だけ（refundOnce）なので、何度呼んでもよい。
 */
export async function settleRefunds(deps: CoreDeps, uid: string, jobId: string): Promise<void> {
  const job = await deps.store.getJob(uid, jobId);
  if (!job) return;
  const owed = job.candidates.filter((c) => c.status === 'failed' && c.refunded !== true);
  if (owed.length === 0) return;
  for (const c of owed) {
    // 管理者が始めた仕事は、もともと引いていない（台帳に残すだけ）
    if (job.free) await deps.store.note(uid, 1, `admin:refund:${jobId}:${c.index}`, deps.now());
    else await deps.store.refundOnce(uid, `${jobId}:${c.index}`, `refund:${jobId}:${c.index}`, deps.now());
  }
  const settled = new Set(owed.map((c) => c.index));
  await deps.store.updateJob(uid, jobId, (current) => {
    let changed = false;
    current.candidates = current.candidates.map((c) => {
      if (!settled.has(c.index) || c.status !== 'failed' || c.refunded === true) return c;
      changed = true;
      return { ...c, refunded: true };
    });
    return changed ? current : null;
  });
}

// 前の版で「できた」のまま残っている候補（「使う」を待っていた）を、置き場の絵から、自分の服にする
async function adoptLegacy(deps: CoreDeps, uid: string, jobId: string): Promise<void> {
  const job = await deps.store.getJob(uid, jobId);
  const waiting = job?.candidates.filter((c) => c.status === 'done') ?? [];
  if (!job || waiting.length === 0) return;
  const doll = await dollOf(deps, job.dollId).catch(() => null);
  for (const c of waiting) {
    const itemId = `my:${jobId}-${c.index}`; // 前の版の「使う」と同じ ID
    const layer = async (kind: LayerKind) => (c.layers?.[kind] ? await deps.files.get(c.layers[kind]!) : null);
    const png = await layer('png');
    // 絵・ドールが無くなっていれば、できなかった扱い（チケットは、前の版で使った扱いのまま）。ほかの失敗は、やり直せるように投げる
    const ok = !!doll && !!png;
    if (doll && png) await saveItem(deps, uid, job, doll, itemId, { category: c.categoryId, name: c.name, png, hide: await layer('hide'), shape: await layer('shape'), front: await layer('front'), under: await layer('under') }, c.notes);
    await deps.store.updateJob(uid, jobId, (current) => {
      const target = current.candidates.find((x) => x.index === c.index);
      if (!target || target.status !== 'done') return null;
      if (ok) {
        target.status = 'kept';
        target.itemId = itemId;
      } else {
        target.status = 'failed';
        target.refunded = true;
        target.notes = [...target.notes, 'この服の絵が見つかりませんでした'];
      }
      current.v = 2;
      return current;
    });
    await deps.files.removeAll(jobPrefix(uid, jobId, c.index)).catch(() => undefined);
  }
}

/**
 * 生成を進める: 順番待ちの品目を 1 点ずつ作り、できたら、その場で自分の服として保存する。時間がかかる（1 点で 30 秒〜1 分）。
 * 同時に 2 回呼ばれても、絵は 1 回しか作らない。途中で止まった仕事は、呼び直すと続きから進む。
 * 返り値: 'done' = 終わった、'busy' = ほかの呼び出しが進めている、'more' = 持ち時間切れで、残りがある
 */
export async function runJob(deps: CoreDeps, uid: string, jobId: string): Promise<'done' | 'busy' | 'more'> {
  const first = await deps.store.getJob(uid, jobId);
  if (!first) throw new CloudError('refused', 'この仕事は見つかりません');
  const runner = deps.newId(); // この呼び出しの印
  const started = Date.now();
  const budget = deps.runBudgetMs ?? 480_000;
  const maxTries = deps.maxTries ?? MAX_TRIES;

  // 前の呼び出しが、払い戻しの前に止まっていたら、ここで戻す。前の版の「できた」は、服にする
  await settleRefunds(deps, uid, jobId);
  await adoptLegacy(deps, uid, jobId);

  // 順番待ちの品目を 1 つ選んで「作成中」にする（job を書き換える）。取りかかった回数が上限の品目は、できなかった扱いにして飛ばす
  const pick = (job: JobDoc): CandidateDoc | null => {
    for (const c of job.candidates) {
      if (c.status !== 'waiting') continue;
      if ((c.tries ?? 0) >= maxTries) {
        c.status = 'failed';
        c.notes = [GAVE_UP];
        c.refunded = false;
        job.tickets = Math.max(0, job.tickets - 1);
        continue;
      }
      c.status = 'working';
      c.tries = (c.tries ?? 0) + 1;
      return { ...c };
    }
    return null;
  };
  type Taken = { kind: 'item'; candidate: CandidateDoc } | { kind: 'busy' } | { kind: 'none' };
  // 次の 1 点を受け持つ（割り込まれない）。
  // updateJob の change は呼び直されることがあるので、外の変数は、毎回はじめに元へ戻す
  const take = async (): Promise<Taken> => {
    let taken: Taken = { kind: 'none' };
    await deps.store.updateJob(uid, jobId, (job) => {
      taken = { kind: 'none' };
      if (job.done) return null;
      const now = deps.now();
      // 取り引きのやり直し（確定の返事が届かなかった）: 前の回で、もう受け持っている
      const already = job.runner === runner ? job.candidates.find((c) => c.status === 'working') : undefined;
      if (already) {
        taken = { kind: 'item', candidate: { ...already } };
        return null;
      }
      // ほかの呼び出しが進めている最中なら、手を出さない
      if (job.candidates.some((c) => c.status === 'working') && now - job.heartbeat <= STALE_MS) {
        taken = { kind: 'busy' };
        return null;
      }
      // 止まっていた分は、順番待ちに戻す
      job.candidates = job.candidates.map((c) => (c.status === 'working' ? { ...c, status: 'waiting' as const } : { ...c }));
      const next = pick(job);
      job.v = 2; // ここからは、できた服が自動で自分の服になる仕事
      if (next) {
        taken = { kind: 'item', candidate: next };
        job.runner = runner;
      } else {
        job.done = true;
        delete job.runner;
      }
      job.heartbeat = now;
      return job;
    });
    return taken;
  };
  // いまも、この呼び出しが、その品目を受け持っているか（止まったとみなされて、ほかの呼び出しに追い越されていないか）
  const mine = (job: JobDoc, index: number) => job.runner === runner && job.candidates.some((c) => c.index === index && c.status === 'working');
  // 受け持った 1 点の結果を書いて、続けるなら次の 1 点を受け持つ。追い越されていたら、何も書かない（applied = false）。
  // left: 時間切れで、順番待ちが残った
  const finish = async (index: number, change: Partial<CandidateDoc>, refund: boolean, more: boolean): Promise<{ applied: boolean; next: CandidateDoc | null; left: boolean }> => {
    let applied = false;
    let next: CandidateDoc | null = null;
    let left = false;
    await deps.store.updateJob(uid, jobId, (job) => {
      applied = false;
      next = null;
      left = false;
      if (!mine(job, index)) {
        // 取り引きのやり直し（確定の返事が届かなかった）: 前の回で、もう書いてあるなら、書けたものとして続ける。
        // 服になった品目は、服の ID（受け持ちごとに別）で、自分の結果かどうかが分かる
        const written = job.candidates.find((c) => c.index === index);
        const same = !!written && written.status === change.status && (change.itemId === undefined ? job.runner === runner || job.runner === undefined : written.itemId === change.itemId);
        if (same) {
          applied = true;
          const working = job.runner === runner ? job.candidates.find((c) => c.status === 'working') : undefined;
          next = working ? { ...working } : null;
          left = !job.done && !next && job.runner === undefined && job.candidates.some((c) => c.status === 'waiting');
        }
        return null;
      }
      job.candidates = job.candidates.map((c) => (c.index === index ? { ...c, ...change } : { ...c }));
      if (refund) job.tickets = Math.max(0, job.tickets - 1);
      applied = true;
      if (more) next = pick(job);
      if (next) {
        // 続けて受け持つ（runner はそのまま）
      } else if (job.candidates.some((c) => c.status === 'waiting')) {
        // 時間切れ: 残りは、列に入れ直して進める
        left = true;
        delete job.runner;
      } else {
        job.done = true;
        delete job.runner;
      }
      job.heartbeat = deps.now();
      return job;
    });
    return { applied, next, left };
  };

  // その品目の、前の回（1〜upTo 回目）が残した服を消す。品目が「できた」になっていれば、その服は残す
  const reap = async (index: number, upTo: number) => {
    if (upTo <= 0) return;
    const now = await deps.store.getJob(uid, jobId);
    const kept = now?.candidates.find((c) => c.index === index)?.itemId;
    for (let t = 1; t <= upTo; t++) {
      const id = `my:${jobId}-${index}-${t}`;
      if (id !== kept) await deleteItem(deps, uid, id, true).catch(() => undefined);
    }
  };

  // 仕事が終わっていたら、写真を消す（顔を作るためだけに預かったもの）
  const dropPhoto = async () => {
    if (!first.photo) return;
    const now = await deps.store.getJob(uid, jobId);
    if (now && !now.done) return;
    await deps.files.removeAll(first.photo).catch(() => undefined);
  };

  const got = await take();
  if (got.kind === 'busy') return 'busy';
  let result: 'done' | 'busy' | 'more' = 'done';
  if (got.kind === 'item') {
    let current: CandidateDoc | null = got.candidate;
    const photo = first.photo ? await deps.files.get(first.photo) : null;
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
        let savedId: string | null = null;
        // 前の回が、服を保存したまま止まっていたら（落ちた・結果を書けなかった）、その服を片付ける
        await reap(c.index, (c.tries ?? 1) - 1);
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
              ...(photo ? { photo } : {}),
            },
            candidate,
          );
          if (!candidate.png || candidate.status === 'failed') throw new Error(candidate.notes.join(' ') || '絵を作れませんでした');
          // 追い越されていたら、服にしない（引き継いだ呼び出しが、同じ品目を作っている・作り終えている）
          const now = await deps.store.getJob(uid, jobId);
          if (!now || !mine(now, c.index)) {
            result = 'busy';
            break;
          }
          // 受け持ちごとに別の名前にする（追い越された呼び出しが、引き継いだ呼び出しの服を消さないように）
          const itemId = `my:${jobId}-${c.index}-${c.tries ?? 1}`;
          savedId = itemId;
          await saveItem(deps, uid, first, doll, itemId, { category: c.categoryId, name: c.name, png: candidate.png, hide: candidate.hide, shape: candidate.shape, front: candidate.front, under: candidate.under }, candidate.notes);
          change = { status: 'kept', notes: candidate.notes, itemId };
          ok = true;
        } catch (error) {
          // 保存の途中で失敗したら、書きかけを消す
          if (savedId) await deleteItem(deps, uid, savedId, true).catch(() => undefined);
          change = { status: 'failed', notes: [`作れませんでした（${(error as Error).message}）。チケットは戻しました`], refunded: false };
        }
        // 保存した服が、仕事に「できた服」として書かれているか（書かれていなければ、残さない）
        const unclaimed = async (): Promise<boolean> => {
          const now = await deps.store.getJob(uid, jobId);
          return !!now && now.candidates.find((x) => x.index === c.index)?.itemId !== savedId;
        };
        let done: { applied: boolean; next: CandidateDoc | null; left: boolean };
        try {
          done = await finish(c.index, change, !ok, Date.now() - started < budget);
        } catch (error) {
          // 結果を書けなかった: 保存した服は残さない（やり直しで、作り直す）。仕事を読めないときは、消さない（書けているかもしれない）
          if (ok && savedId && (await unclaimed().catch(() => false))) await deleteItem(deps, uid, savedId, true).catch(() => undefined);
          throw error;
        }
        if (!done.applied) {
          // 追い越されていた: 自分が保存した服は消す。払い戻しもしない
          if (ok && savedId && (await unclaimed().catch(() => false))) await deleteItem(deps, uid, savedId, true).catch(() => undefined);
          result = 'busy';
          break;
        }
        // できなかった分は、チケットを戻す（failed と書いたあと）
        if (!ok) await settleRefunds(deps, uid, jobId);
        if (done.left) result = 'more';
        current = done.next;
      }
    } finally {
      clearInterval(beat);
    }
  }
  // 取りかかった回数の上限で打ち切った品目の分（前の回が残した服があれば、片付ける）
  const after = await deps.store.getJob(uid, jobId);
  for (const c of after?.candidates ?? []) if (c.status === 'failed' && (c.tries ?? 0) > 0 && c.refunded !== true) await reap(c.index, c.tries ?? 0);
  await settleRefunds(deps, uid, jobId);
  await dropPhoto();
  return result;
}

// 列の関数の中身: 生成を進め、終わっていなければ、列に入れ直す
export async function workJob(deps: CoreDeps, uid: string, jobId: string): Promise<void> {
  const result = await runJob(deps, uid, jobId);
  // ほかの呼び出しが進めている最中: そのまま終わると、落ちた直後のやり直しが空振りになり、だれも続きを進めなくなる
  if (result === 'busy') await deps.enqueue(uid, jobId, BUSY_RETRY_SECONDS);
  else if (result === 'more') await deps.enqueue(uid, jobId, 0);
}

// 終わっていないのに、だれも作っていない（まだ呼ばれていない・時間切れでやめた・落ちた）か、作成中のまま合図がとぎれている
const stalled = (job: JobDoc, now: number) => !job.done && (!job.candidates.some((c) => c.status === 'working') || now - job.heartbeat > STALE_MS);

/**
 * 仕事 1 つの手当て: 打ち切り（24 時間）→ 払い戻しの残り → 止まっていれば列に入れ直す。返り値は、手当てのあとの仕事。
 * アプリが進み具合を聞いたときと、見回りが呼ぶ（列のやり直しが尽きても・列に入れるのに失敗しても、ここで続きが進む）。
 */
export async function tendJob(deps: CoreDeps, uid: string, job: JobDoc): Promise<JobDoc> {
  const now = deps.now();
  let current = job;
  if (!current.done && now - current.createdAt > EXPIRE_MS) {
    // 残りの品目を、できなかった扱いにして終わる。進めていた呼び出しがあっても、受け持ちの印を消すので、あとから服は残らない
    current = await deps.store.updateJob(uid, job.id, (j) => {
      if (j.done) return null;
      let dropped = 0;
      j.candidates = j.candidates.map((c) => {
        if (c.status !== 'waiting' && c.status !== 'working') return c;
        dropped++;
        return { ...c, status: 'failed' as const, notes: [EXPIRED], refunded: false };
      });
      j.tickets = Math.max(0, j.tickets - dropped);
      j.done = true;
      delete j.runner;
      j.heartbeat = deps.now();
      return j;
    });
  }
  if (current.candidates.some((c) => c.status === 'failed' && c.refunded !== true)) {
    await settleRefunds(deps, uid, job.id);
    current = (await deps.store.getJob(uid, job.id)) ?? current;
  }
  // 前の版の「できた」が残っている仕事も、列に入れる（runJob が、服にする）
  const needsWork = stalled(current, now) || current.candidates.some((c) => c.status === 'done');
  // 列に入れられなかったと分かっていれば、早めに。入れてあるはずなら、長めに待ってから（こみあっているだけかもしれない）
  const wait = current.queueFailed ? REQUEUE_MS : QUEUE_WAIT_MS;
  if (needsWork && now - (current.queuedAt ?? 0) >= wait) {
    let queue = false;
    current = await deps.store.updateJob(uid, job.id, (j) => {
      queue = false;
      // 取り引きのやり直し: 前の回で、もう書いてある
      if (j.queuedAt === now) {
        queue = true;
        return null;
      }
      if (now - (j.queuedAt ?? 0) < (j.queueFailed ? REQUEUE_MS : QUEUE_WAIT_MS)) return null;
      queue = true;
      return { ...j, queuedAt: now };
    });
    if (queue) {
      const failed = await deps.enqueue(uid, job.id).then(
        () => false,
        () => true,
      );
      if (failed !== (current.queueFailed ?? false)) {
        current = await deps.store.updateJob(uid, job.id, (j) => {
          const next = { ...j };
          if (failed) next.queueFailed = true;
          else delete next.queueFailed;
          return next;
        });
      }
    }
  }
  return current;
}

// 見回り: 終わっていない仕事（どの利用者の分も）を手当てする。返り値は、見た数
export async function sweep(deps: CoreDeps): Promise<number> {
  const open = await deps.store.listOpenJobs(SWEEP_MAX);
  for (const { uid, job } of open) await tendJob(deps, uid, job).catch(() => undefined);
  return open.length;
}

// まだ見ていない仕事（作りかけ + 終わって、結果をまだ見ていないもの）。新しい順。それぞれ、手当て済み。
// 前の版の仕事（v なし）は、決まっていない候補が残っているものだけ
export async function openJobs(deps: CoreDeps, uid: string): Promise<JobDoc[]> {
  const jobs = (await deps.store.listJobs(uid)).filter((job) => (job.v === 2 ? !job.seen : job.candidates.some(undecided)));
  const tended: JobDoc[] = [];
  for (const job of jobs) tended.push(await tendJob(deps, uid, job));
  return tended;
}

// 結果（できた・できなかった）を見た、の印を付ける。終わっていない仕事には付けない
export async function ackJob(deps: CoreDeps, uid: string, jobId: string): Promise<void> {
  await deps.store.updateJob(uid, jobId, (job) => (!job.done || job.seen ? null : { ...job, seen: true }));
}

// 自分の服の、名前・既定の色を変える
export async function updateItem(deps: CoreDeps, uid: string, itemId: string, change: { name?: string; hue?: number }): Promise<ItemDoc> {
  return deps.store.updateItem(uid, itemId, (item) => {
    const next: ItemDoc = { ...item, item: { ...item.item } };
    if (typeof change.name === 'string') next.item.name = plainName(change.name, item.item.name);
    if (typeof change.hue === 'number' && Number.isFinite(change.hue)) next.hue = Math.max(HUE_MIN, Math.min(HUE_MAX, Math.round(change.hue)));
    if (next.item.name === item.item.name && (next.hue ?? 0) === (item.hue ?? 0)) return null;
    next.updatedAt = deps.now();
    return next;
  });
}

// 自分の服の並び順を変える: ids の順に、order を now, now-1, now-2 … にする（大きいほど先。あとから作った服は、その前に来る）
export async function orderItems(deps: CoreDeps, uid: string, ids: string[]): Promise<ItemDoc[]> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > ORDER_MAX || new Set(ids).size !== ids.length) throw new CloudError('refused', '並び順を読み取れませんでした');
  // 先に、全部が自分の服かを確かめる（途中まで変えて止まらないように）
  for (const id of ids) if (!(await deps.store.getItem(uid, id))) throw new CloudError('refused', 'この服は見つかりません');
  const now = deps.now();
  const result: ItemDoc[] = [];
  for (const [i, id] of ids.entries()) result.push(await deps.store.updateItem(uid, id, (item) => ({ ...item, order: now - i, updatedAt: now })));
  return result;
}

export function listItems(deps: CoreDeps, uid: string): Promise<ItemDoc[]> {
  return deps.store.listItems(uid);
}

// force: 一覧に無くても、置き場の絵を消す（保存の途中で止まった書きかけの片付け）
export async function deleteItem(deps: CoreDeps, uid: string, itemId: string, force = false): Promise<void> {
  if (!force && !(await deps.store.getItem(uid, itemId))) return;
  await deps.store.deleteItem(uid, itemId);
  await deps.files.removeAll(itemPrefix(uid, itemId));
}
