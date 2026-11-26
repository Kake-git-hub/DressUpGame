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
import { isPlainFit, normalizeFit, sameFit } from '../../src/engine/fit.ts';
import type { ItemFit } from '../../src/engine/fit.ts';
import { findStyle } from '../../src/studio/stylePresets.ts';
import { MemoryWriter } from '../content/encode.ts';
import { encodeItemImages } from '../content/manifestEdit.ts';
import type { AiClients } from '../studio/ai.ts';
import type { DollAssets } from '../studio/dollAssets.ts';
import { generateCandidate, planItems, planSet } from '../studio/generate.ts';
import type { Candidate, PlannedItem } from '../studio/generate.ts';
import { isFaceCategory } from '../studio/processFace.ts';
import { CloudError } from './store.ts';
import { readWallet, usable as usableCount } from './wallet.ts';
import type { PayDeps } from './payment.ts';
import type { WireTrade, WireTradeItem, TradeRefusal } from '../../src/cloud/wire.ts';
import type { CandidateDoc, CloudFiles, CloudStore, ItemDoc, JobDoc, LayerKind, SetRef, TradeDoc, TradeEndReason } from './store.ts';

// 公開されている素材（一覧と、ドールの型）
export interface PublicContent {
  manifest(): Promise<Manifest>;
  assets: DollAssets;
}

export interface CoreDeps {
  store: CloudStore;
  pay?: PayDeps; // 支払い（無ければ、売らない・ようこそ 0）
  files: CloudFiles;
  ai: AiClients;
  content: PublicContent;
  adminCodes: string[]; // 管理者の利用者コード
  limits: { perDay: number; perUserDay?: number; maxAttempts: number }; // 1 日の画像の上限（サーバー全体・利用者ごと）、1 品目あたりの生成回数
  now: () => number;
  newId: () => string;
  newWord: () => string; // 引き継ぎの合い言葉（使い捨て。本物は 32 バイトの乱数）
  // 仕事を、列に入れる（列が、生成を進める関数を呼ぶ）。delaySeconds: 何秒あとに呼ばれるか（既定 0）
  enqueue: (uid: string, jobId: string, delaySeconds?: number) => Promise<void>;
  maxTries?: number; // 1 つの品目に取りかかれる回数（既定 3。超えたら、打ち切って払い戻す）
  heartbeatMs?: number; // 作っている間、この間隔で「動いている」の合図を書く（既定 30 秒）
  runBudgetMs?: number; // 1 回の呼び出しで、新しい品目に取りかかるのは、始めてからこの時間まで（既定 8 分。関数の時間切れの前に、自分でやめる）
}

export interface UserView {
  userCode: string;
  tickets: number; // 使える枚数（配った分と、期限内の買った分）
  free: number; // 配った分
  lots: { count: number; left: number; expiresAt: number }[]; // 買った分（期限内で、残りがあるものだけ。期限の早い順）
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
// アカウントが signIn したとき、残りを移す元の数（新しい順）
const DRAIN_ADOPTED = 5;

// 利用者コード: まぎらわしい文字（I・O・0・1）を除いた 8 文字
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from({ length: 8 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
export const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);
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
  // 財布は、利用者の文書から読む（チケットの数が壊れていれば 0 枚、期限切れは数えない）
  const now = deps.now();
  const wallet = readWallet(user, now);
  const lots = wallet.lots
    .filter((l) => l.expiresAt > now && l.left > 0)
    .sort((a, b) => a.expiresAt - b.expiresAt)
    .map((l) => ({ count: l.count, left: l.left, expiresAt: l.expiresAt }));
  return { userCode: user.userCode, tickets: usableCount(wallet, now), free: wallet.free, lots, admin: deps.adminCodes.includes(user.userCode) };
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
    else await deps.store.refundOnce(uid, `${jobId}:${c.index}`, c.index, job.draws, `refund:${jobId}:${c.index}`, deps.now());
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
  try {
    const result = await runJob(deps, uid, jobId);
    // ほかの呼び出しが進めている最中: そのまま終わると、落ちた直後のやり直しが空振りになり、だれも続きを進めなくなる
    if (result === 'busy') await deps.enqueue(uid, jobId, BUSY_RETRY_SECONDS);
    else if (result === 'more') await deps.enqueue(uid, jobId, 0);
  } finally {
    // アカウントへ移した（匿名だった）利用者なら、この仕事でできた服・戻ったチケットも移す。
    // 移すのに失敗しても、仕事は失敗にしない（次の仕事の終わり・アカウントの signIn で、また移す）
    await drainMoved(deps, uid).catch(() => undefined);
  }
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

// 自分の服の、名前・既定の色・はじめの位置を変える（fit: null = もとの位置にもどす）
export async function updateItem(deps: CoreDeps, uid: string, itemId: string, change: { name?: string; hue?: number; fit?: ItemFit | null }): Promise<ItemDoc> {
  // 相手が「はい」と決めた服は、変えない（名前・色が変わると、決めた服と別のものになる）
  if (await inLiveTrade(deps, uid, itemId, 'joined')) throw new CloudError('refused', 'この服は、こうかんの はなしが すすんでいるので、かえられません');
  return deps.store.updateItem(uid, itemId, (item) => {
    const next: ItemDoc = { ...item, item: { ...item.item } };
    if (typeof change.name === 'string') next.item.name = plainName(change.name, item.item.name);
    if (typeof change.hue === 'number' && Number.isFinite(change.hue)) next.hue = Math.max(HUE_MIN, Math.min(HUE_MAX, Math.round(change.hue)));
    const fit = change.fit ? normalizeFit(change.fit) : change.fit;
    if (change.fit && !fit) throw new CloudError('refused', '呼び出しの形が正しくありません');
    if (fit === null || (fit && isPlainFit(fit))) delete next.fit;
    else if (fit) next.fit = fit;
    if (next.item.name === item.item.name && (next.hue ?? 0) === (item.hue ?? 0) && sameFit(next.fit, item.fit)) return null;
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
  const item = force ? null : await deps.store.getItem(uid, itemId);
  if (!force && !item) return;
  if (!force && (await inLiveTrade(deps, uid, itemId))) throw new CloudError('refused', 'この服は、こうかんに だしているので、けせません');
  const deleted = await deps.store.deleteItem(uid, itemId);
  // 読んだあとで、交換で別の人へ動いていた服は、絵を消さない（動いた先で使っている）
  if (!force && !deleted) return;
  const own = itemPrefix(uid, itemId);
  await deps.files.removeAll(own);
  // 引き継いだ服は、絵が元の利用者の置き場にある（移すときに、絵は動かさない）。服が持っているパスのフォルダも消す。
  // ほかの服の絵を消さないように、`users/{だれか}/items/{この服の ID}/` の形のものだけ
  const folders = new Set<string>();
  for (const path of Object.values(item?.paths ?? {})) {
    const m = /^users\/[^/]+\/items\/([^/]+)\//.exec(path);
    if (m && m[1] === safe(itemId) && m[0] !== own) folders.add(m[0]);
  }
  for (const folder of folders) await deps.files.removeAll(folder);
}

// ── 引き継ぎ（2 台めの端末の、匿名の利用者のチケットと服を、アカウントへ移す。設計書 8.5）──
// どれも、何度呼ばれても、2 重に足さない（移すのは、置き場の 1 つの取り引きの中で読み直してから）

// 匿名の利用者に、引き継ぎの合い言葉を渡す（まだ使われていなければ、前と同じもの）
export async function offerHandoff(deps: CoreDeps, uid: string): Promise<string> {
  await signIn(deps, uid);
  return deps.store.offerHandoff(uid, deps.newWord, deps.now());
}

export type AdoptStatus = 'done' | 'used' | 'unknown' | 'refused';
/**
 * 合い言葉を出した（匿名でない）利用者 toUid へ、合い言葉の元の利用者のチケットと服を移す。
 * 合い言葉は、移す前に、1 つの取り引きで押さえる（2 つのアカウントが同時に出しても、移せるのは 1 つだけ。服が分かれない）。
 * 印（movedTo・adopted）を先に書いてから移すので、途中で止まっても、あとの drain（仕事の終わり・signIn・もう一度の adopt）が続きを移す。
 * 押さえたあとで断る・何もしない（自分の合い言葉・元が名前のある利用者・元がいない）ときは、合い言葉は押さえたまま。
 * チケットと服は、元に残る（元は、本物のアカウント。ほかの人は、もう、その合い言葉で取れない）
 */
export async function adoptUser(deps: CoreDeps, toUid: string, word: string): Promise<{ status: AdoptStatus; tickets: number; items: number }> {
  const none = { tickets: 0, items: 0 };
  const claim = await deps.store.claimHandoff(word, toUid);
  if (claim.status !== 'ok') return { status: claim.status, ...none };
  const from = claim.uid;
  if (from === toUid) return { status: 'done', ...none };
  const source = await deps.store.getUser(from);
  if (!source) return { status: 'unknown', ...none };
  // 元が、あとから名前のある利用者になった（1 台めとして Google と結び付けた）: そのアカウントを、ほかへ移さない
  if (source.named) return { status: 'refused', ...none };
  await deps.store.markUser(from, { movedTo: toUid });
  await signIn(deps, toUid);
  await deps.store.addAdopted(toUid, from);
  return { status: 'done', ...(await drain(deps, from, toUid)) };
}

// 服の ID（`my:{仕事}-{番号}-{回}`、前の版は `my:{仕事}-{番号}`）から、考えられる（仕事・番号）の組
function jobRefs(itemId: string): { jobId: string; index: number }[] {
  if (!itemId.startsWith('my:')) return [];
  const parts = itemId.slice(3).split('-');
  const refs: { jobId: string; index: number }[] = [];
  for (let k = 1; k < parts.length; k++) {
    const rest = parts.slice(k);
    if (rest.length > 2 || !rest.every((p) => /^\d+$/.test(p))) continue;
    refs.push({ jobId: parts.slice(0, k).join('-'), index: Number(rest[0]) });
  }
  return refs;
}

// その服を、いま移してよいか。
// - 仕事が終わっていない: 移さない（進めている呼び出しが、やり直しで、その服と絵を消すことがある。終わったら、workJob の終わりが移す）
// - 仕事は終わったが、その品目の「できた服」でない（前の回の残り物・できなかった品目の残り物）: 移さない
//   （片付け = reap が、元の置き場の絵を消すので、移すと、絵の無い服になる。チケットも戻っている）
// 「終わった」は、もとに戻らないので、読んだあとで変わっても、移してよいかは変わらない
async function movable(deps: CoreDeps, from: string, item: ItemDoc): Promise<boolean> {
  for (const ref of jobRefs(item.id)) {
    const job = await deps.store.getJob(from, ref.jobId);
    if (!job) continue;
    if (!job.done) return false;
    const c = job.candidates.find((x) => x.index === ref.index);
    if (!c) return true;
    // 前の版の「使う」は、itemId を書いていない
    return c.status === 'kept' && (c.itemId === undefined || c.itemId === item.id);
  }
  return true;
}

// from のチケットと服を、to へ移す。何度呼ばれてもよい（残りがあれば移る。無ければ何も起きない）。絵のファイルは、動かさない
export async function drain(deps: CoreDeps, from: string, to: string): Promise<{ tickets: number; items: number }> {
  const source = await deps.store.getUser(from);
  if (!source || source.named) return { tickets: 0, items: 0 };
  const tickets = await deps.store.moveTickets(from, to, deps.now());
  let items = 0;
  for (const item of await deps.store.listItems(from)) {
    if (!(await movable(deps, from, item))) continue;
    if (await deps.store.moveItem(from, to, item.id)) items++;
  }
  return { tickets, items };
}

// 移した印（movedTo）のある利用者なら、残りを移す
async function drainMoved(deps: CoreDeps, uid: string): Promise<void> {
  const user = await deps.store.getUser(uid);
  if (user?.movedTo) await drain(deps, uid, user.movedTo);
}

// アカウントが、つないだとき（signIn）: もらった元（新しい順に 5 人まで）に残りがあれば移す（払い戻し・作者が配った分）。
// 元が、そのあとほかのアカウントへ移っていたら、取らない
export async function drainAdopted(deps: CoreDeps, uid: string): Promise<void> {
  const user = await deps.store.getUser(uid);
  for (const from of (user?.adopted ?? []).slice(-DRAIN_ADOPTED).reverse()) {
    const source = await deps.store.getUser(from).catch(() => null);
    if (source?.movedTo !== uid) continue;
    await drain(deps, from, uid).catch(() => undefined);
  }
}

// ── 交換（2 台で、服を 1 点ずつ入れ替える。設計書 3・5・6 章）──
// 読み取りの印の命（アプリは、QR を出している間、60 秒おきに新しくする）
export const TRADE_CODE_MS = 90_000;
// 時間切れ: open のまま・読み取ってから（claimed）・服がそろってから（joined）
export const TRADE_OPEN_MS = 600_000;
export const TRADE_CLAIMED_MS = 300_000;
export const TRADE_JOINED_MS = 180_000;
// 1 人 1 日の回数（tradeOpen + tradeClaim）
export const TRADE_PER_DAY = 30;

// 断る。message の先頭の `trade:{理由}` を、アプリが見分ける
const tradeRefuse = (reason: TradeRefusal, message: string) => new CloudError('refused', `trade:${reason} ${message}`);
const TRADE_MESSAGES: Record<TradeRefusal, string> = {
  unknown: 'この こうかんは みつかりません',
  expired: 'じかんが きれました。もういちど やりなおしてね',
  self: 'じぶんの コードは よめません',
  busy: 'この こうかんは、ほかの ひとと すすんでいます',
  'not-movable': 'この ふくは、まだ こうかんに だせません',
  limit: 'きょうは こうかんできる かいすうが いっぱいです。あした また ためしてね',
};
const refuseTrade = (reason: TradeRefusal) => tradeRefuse(reason, TRADE_MESSAGES[reason]);

const isLive = (t: TradeDoc) => t.status === 'open' || t.status === 'claimed' || t.status === 'joined';
function timedOut(t: TradeDoc, now: number): boolean {
  if (t.status === 'open') return now - t.createdAt > TRADE_OPEN_MS;
  if (t.status === 'claimed') return now - (t.claimedAt ?? t.createdAt) > TRADE_CLAIMED_MS;
  if (t.status === 'joined') return now - (t.joinedAt ?? t.claimedAt ?? t.createdAt) > TRADE_JOINED_MS;
  return false;
}
const sideOf = (t: TradeDoc, uid: string): 'a' | 'b' | null => (t.a.uid === uid ? 'a' : t.b?.uid === uid ? 'b' : null);

// 生きている交換を、やめにする（中で読み直す。もう終わっていれば、何もしない）
async function endTrade(deps: CoreDeps, id: string, reason: TradeEndReason): Promise<TradeDoc> {
  const now = deps.now();
  return deps.store.updateTrade(id, (t) => (isLive(t) ? { ...t, status: 'cancelled', reason, endedAt: now } : null));
}
// 時間切れなら、ここで cancelled にする
async function settleTrade(deps: CoreDeps, t: TradeDoc): Promise<TradeDoc> {
  if (!isLive(t) || !timedOut(t, deps.now())) return t;
  const now = deps.now();
  return deps.store.updateTrade(t.id, (cur) => (isLive(cur) && timedOut(cur, now) ? { ...cur, status: 'cancelled', reason: 'expired', endedAt: now } : null));
}
async function loadTrade(deps: CoreDeps, uid: string, tradeId: string): Promise<TradeDoc> {
  const t = await deps.store.getTrade(tradeId);
  if (!t || !sideOf(t, uid)) throw refuseTrade('unknown');
  return settleTrade(deps, t);
}
// その人の、前の交換（生きていれば）をやめにする
async function replacePrevious(deps: CoreDeps, uid: string): Promise<void> {
  const prev = (await deps.store.getUser(uid))?.trade;
  if (!prev) return;
  try {
    await endTrade(deps, prev, 'replaced');
  } catch (e) {
    // 交換が無い（'refused'）ときだけ、見のがす。ほかの失敗は、前の交換が生きたままかもしれないので、そのまま返す
    if (!(e instanceof CloudError && e.code === 'refused')) throw e;
  }
}
// その服が、その人の生きている（時間切れでない）交換に出ているか
async function inLiveTrade(deps: CoreDeps, uid: string, itemId: string, only?: 'joined'): Promise<boolean> {
  const id = (await deps.store.getUser(uid))?.trade;
  const t = id ? await deps.store.getTrade(id) : null;
  if (!t || !isLive(t) || timedOut(t, deps.now()) || (only && t.status !== only)) return false;
  const side = sideOf(t, uid);
  return side !== null && t[side]?.itemId === itemId;
}
// 交換に出せる、自分の服
async function offerable(deps: CoreDeps, uid: string, itemId: string): Promise<ItemDoc> {
  const item = itemId.startsWith('my:') ? await deps.store.getItem(uid, itemId) : null;
  if (!item) throw refuseTrade('unknown');
  if (!(await movable(deps, uid, item))) throw refuseTrade('not-movable');
  return item;
}
async function countTrade(deps: CoreDeps, uid: string): Promise<void> {
  try {
    await deps.store.countTrade(uid, dayOf(deps.now()), TRADE_PER_DAY);
  } catch (e) {
    if (e instanceof CloudError && e.code === 'limit') throw refuseTrade('limit');
    throw e;
  }
}

// 交換を出す: 服を決めて、読み取りの印を作る。前の自分の交換は、やめにする
export async function tradeOpen(deps: CoreDeps, uid: string, itemId: string): Promise<{ tradeId: string; code: string }> {
  await signIn(deps, uid);
  await offerable(deps, uid, itemId);
  await countTrade(deps, uid);
  await replacePrevious(deps, uid);
  const now = deps.now();
  const trade: TradeDoc = { id: deps.newId(), status: 'open', a: { uid, itemId }, code: deps.newWord(), codeAt: now, createdAt: now };
  await deps.store.putTrade(trade);
  await deps.store.setUserTrade(uid, trade.id);
  return { tradeId: trade.id, code: trade.code };
}

// 読み取りの印を、新しくする（前の印は、使えなくなる）。読み取られたあとでも、できる
export async function tradeCode(deps: CoreDeps, uid: string, tradeId: string): Promise<{ code: string }> {
  const t = await loadTrade(deps, uid, tradeId);
  if (t.a.uid !== uid) throw refuseTrade('unknown');
  if (t.status !== 'open' && t.status !== 'claimed') throw refuseTrade('expired');
  const now = deps.now();
  const next = await deps.store.updateTrade(tradeId, (cur) => (cur.status === 'open' || cur.status === 'claimed' ? { ...cur, code: deps.newWord(), codeAt: now } : null));
  if (next.status !== 'open' && next.status !== 'claimed') throw refuseTrade('expired');
  return { code: next.code };
}

// 印を読み取る。相手の交換の B になる
export async function tradeClaim(deps: CoreDeps, uid: string, code: string): Promise<{ tradeId: string }> {
  await signIn(deps, uid);
  const found = await deps.store.findTradeByCode(code);
  if (!found) throw refuseTrade('unknown');
  if (found.a.uid === uid) throw refuseTrade('self');
  // 古い印は、交換の文書から消えている。終わった交換の印は、生きた交換には、つながらない
  const t = await settleTrade(deps, found);
  if (!isLive(t)) throw refuseTrade('expired');
  // 返事が届かず、同じ人がもう一度読み取った: 同じ交換のまま（回数も、前の交換のやめも、しない）
  if (t.status === 'claimed' && t.b?.uid === uid && t.code === code) return { tradeId: t.id };
  if (t.status !== 'open') throw refuseTrade('busy');
  if (deps.now() - t.codeAt > TRADE_CODE_MS) throw refuseTrade('expired');
  await countTrade(deps, uid);
  // 前の交換は、読み取りを書く前にやめにする（やめられなければ、ここで止まり、この交換は読み取られない）
  await replacePrevious(deps, uid);
  const now = deps.now();
  // 読み直して決める（割り込まれたら、やり直し）。change は、2 回以上呼ばれることがある
  let verdict = null as TradeRefusal | null;
  const claimed = await deps.store.updateTrade(t.id, (cur) => {
    verdict = null;
    if (cur.code !== code) verdict = 'unknown';
    else if (!isLive(cur) || timedOut(cur, now)) verdict = 'expired';
    else if (cur.status === 'claimed' && cur.b?.uid === uid) return null; // 同じ人の、2 回め（書かない）
    else if (cur.status !== 'open') verdict = 'busy';
    else if (now - cur.codeAt > TRADE_CODE_MS) verdict = 'expired';
    if (verdict) return null;
    return { ...cur, status: 'claimed', b: { uid }, claimedAt: now };
  });
  if (verdict) throw refuseTrade(verdict);
  await deps.store.setUserTrade(uid, claimed.id);
  return { tradeId: claimed.id };
}

// B が、自分の服を決める
export async function tradeJoin(deps: CoreDeps, uid: string, tradeId: string, itemId: string): Promise<void> {
  const t = await loadTrade(deps, uid, tradeId);
  if (t.b?.uid !== uid) throw refuseTrade('unknown');
  if (!isLive(t)) throw refuseTrade('expired');
  if (t.status !== 'claimed') throw refuseTrade('busy');
  await offerable(deps, uid, itemId);
  const now = deps.now();
  const next = await deps.store.updateTrade(tradeId, (cur) => (cur.status === 'claimed' && cur.b?.uid === uid && !timedOut(cur, now) ? { ...cur, status: 'joined', b: { uid, itemId }, joinedAt: now } : null));
  if (next.status !== 'joined') throw refuseTrade('expired');
}

// 絵（サムネイル）つきの、交換の服。持ち主が変わっていても（入れ替えたあと）見つかるように、両方の持ち主を探す
const THUMB_TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
async function tradeItem(deps: CoreDeps, owners: string[], itemId: string | undefined): Promise<WireTradeItem | undefined> {
  if (!itemId) return undefined;
  for (const owner of owners) {
    const doc = await deps.store.getItem(owner, itemId);
    if (!doc) continue;
    const path = doc.paths[doc.item.thumb];
    const data = path ? await deps.files.get(path) : null;
    return {
      id: doc.id,
      dollId: doc.dollId,
      name: doc.item.name,
      categoryId: doc.item.category,
      hue: doc.hue ?? 0,
      thumb: data ? data.toString('base64') : '',
      thumbType: THUMB_TYPES[doc.item.thumb.split('.').pop()?.toLowerCase() ?? ''] ?? 'image/webp',
    };
  }
  return undefined;
}
async function wireTrade(deps: CoreDeps, uid: string, t: TradeDoc): Promise<WireTrade> {
  const me = sideOf(t, uid);
  if (!me) throw refuseTrade('unknown');
  const other = me === 'a' ? 'b' : 'a';
  const mine = t[me];
  const theirs = t[other];
  const owners = [t.a.uid, ...(t.b ? [t.b.uid] : [])];
  const myItem = await tradeItem(deps, owners, mine?.itemId);
  // 相手の服は、読み取ったあと（claimed 以降）から
  const theirItem = t.status === 'open' ? undefined : await tradeItem(deps, owners, theirs?.itemId);
  return {
    id: t.id,
    status: t.status,
    me,
    ...(myItem ? { mine: myItem } : {}),
    ...(theirItem ? { theirs: theirItem } : {}),
    myAccepted: !!mine?.accepted,
    theirAccepted: !!theirs?.accepted,
    ...(t.reason ? { reason: t.reason } : {}),
    ...(t.status === 'done' && theirs?.itemId ? { receivedId: theirs.itemId } : {}),
  };
}

export async function tradeView(deps: CoreDeps, uid: string, tradeId: string): Promise<WireTrade> {
  return wireTrade(deps, uid, await loadTrade(deps, uid, tradeId));
}

// 「こうかんする」: 自分の分を立て、両方立ったら入れ替える。2 人が同時に押しても、入れ替えは 1 回（swapTrade が決める）
export async function tradeAccept(deps: CoreDeps, uid: string, tradeId: string): Promise<WireTrade> {
  const t = await loadTrade(deps, uid, tradeId);
  if (t.status === 'done' || t.status === 'cancelled') return wireTrade(deps, uid, t);
  if (t.status !== 'joined') throw refuseTrade('unknown');
  const me = sideOf(t, uid)!;
  const marked = await deps.store.updateTrade(tradeId, (cur) => {
    if (cur.status !== 'joined' || cur[me]?.accepted || timedOut(cur, deps.now())) return null;
    return { ...cur, [me]: { ...cur[me]!, accepted: true } };
  });
  // 自分の分を立てたあとの交換を読み直して、両方立っていれば入れ替える（相手が先に立てていても、あとでも）
  let latest = await settleTrade(deps, (await deps.store.getTrade(tradeId)) ?? marked);
  if (latest.status === 'joined' && latest.a.accepted && latest.b?.accepted) latest = await deps.store.swapTrade(tradeId, deps.now());
  return wireTrade(deps, uid, latest);
}

export async function tradeCancel(deps: CoreDeps, uid: string, tradeId: string): Promise<void> {
  const t = await loadTrade(deps, uid, tradeId);
  if (isLive(t)) await endTrade(deps, tradeId, 'cancel');
}

// ── チケットを配る（管理者だけ。テストの利用者などに、無料で）──
export const GIFT_MAX = 100; // 1 回に配れる枚数の上限（打ち間違いで、大きな数を配らないように）
/**
 * 管理者が、利用者コードで指した人に、チケットを count 枚配る。台帳の理由は `gift:{配った人の利用者コード}`。
 * 相手が、ほかのアカウントへ移った（2 台めの端末として合わせた）利用者なら、移った先に配る。
 * 返り値は、相手の利用者コード（移った先）と、配ったあとの枚数
 */
export async function giveTickets(deps: CoreDeps, uid: string, input: { userCode: string; count: number }): Promise<{ userCode: string; tickets: number }> {
  const me = await signIn(deps, uid);
  if (!me.admin) throw new CloudError('refused', 'チケットを配れるのは、管理者だけです');
  const count = input.count;
  if (!Number.isInteger(count) || count < 1 || count > GIFT_MAX) throw new CloudError('refused', `配る枚数は 1〜${GIFT_MAX} 枚にしてください`);
  const code = String(input.userCode ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  const found = code ? await deps.store.findUidByCode(code) : null;
  if (!found) throw new CloudError('refused', `利用者コード「${code}」の人が見つかりません`);
  let to = found;
  let user = await deps.store.getUser(to);
  // 移った先をたどる（念のため、3 回まで）
  for (let i = 0; i < 3 && user?.movedTo; i++) {
    const next = await deps.store.getUser(user.movedTo);
    if (!next) break;
    to = user.movedTo;
    user = next;
  }
  if (!user) throw new CloudError('refused', `利用者コード「${code}」の人が見つかりません`);
  // 財布の、配った分（無料・期限なし）に足す。買った分（期限つき）には入れない
  const tickets = await deps.store.addTickets(to, count, `gift:${me.userCode}`, deps.now());
  return { userCode: user.userCode, tickets };
}
