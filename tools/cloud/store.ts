/**
 * サーバーの置き場の形（利用者・チケット・生成の進み具合・自分の服）
 *
 * 本物は Firestore と Storage（functions/src/）。テストと手元の確認は、メモリの中の偽物（memoryStore.ts）。
 * 「読んで、変えて、書く」が途中で割り込まれてはいけない操作（チケットを引く・進み具合を書き換える）は、
 * この形の 1 つの操作にまとめてある（本物は、取り引きで行う）。
 */
import type { ItemFit } from '../../src/engine/fit.ts';
import type { Box, ManifestItem } from '../../src/content/manifest.ts';

export type CloudErrorCode = 'no-tickets' | 'limit' | 'refused' | 'unknown';
// 利用者に伝える失敗（message は、そのまま画面に出す日本語）
export class CloudError extends Error {
  readonly code: CloudErrorCode;
  constructor(code: CloudErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface UserDoc {
  userCode: string;
  tickets: number;
  createdAt: number;
  movedTo?: string; // この利用者（匿名だった）のチケットと服は、この uid へ移す
  adopted?: string[]; // この利用者が、もらった元の uid（古い順。20 件まで）
  named?: boolean; // 匿名でない利用者として、1 回でも呼んだ（移す元には、できない）
  handoff?: string; // この利用者の、いまの合い言葉
  trade?: string; // この利用者の、いまの交換（ひとつだけ）の ID
  free?: number; // 配った分のチケット
  lots?: Lot[]; // 買った分のチケット（期限つき）
  ticketsWritten?: number; // 最後に書いた tickets（手で書き換えた差を見分ける）
  welcomed?: true; // 最初に配る分を、もう配った
}
// 支払い（purchases/{Checkout Session の ID}）。expiresAt = 買ったチケットの期限
export interface PurchaseDoc {
  id: string;
  uid: string;
  pack: string;
  tickets: number;
  price: number;
  status: 'open' | 'paid' | 'expired';
  createdAt: number;
  expiresAt: number;
  adultAt: number; // 保護者の確認を通した時刻
  agreedAt: number; // 最終確認で同意した時刻
  paidAt?: number;
  reclaimed?: number; // 返金・取り消しで、もう取り戻した枚数（目標の数。引けなかった分も含む）
  announced?: true; // アプリに「ふえました」を伝え終えた
}
// 買ったチケットのまとまり（id = 支払いの番号）
export interface Lot {
  id: string;
  count: number;
  left: number;
  boughtAt: number;
  expiresAt: number;
}
// 仕事が引いた所（lot 無し = 配った分）
export interface Draw {
  lot?: string;
  n: number;
}
// 引き継ぎの合い言葉（handoffs/{合い言葉}）。uid = 移す元（合い言葉をもらった匿名の利用者）、usedBy = 使った人（移す先）
export interface HandoffDoc {
  uid: string;
  createdAt: number;
  usedBy?: string;
}
export type HandoffClaim = { status: 'ok'; uid: string } | { status: 'unknown' } | { status: 'used' };
// adopted に覚えておく、元の uid の数
export const ADOPTED_MAX = 20;

// waiting = 順番待ち、working = 作成中、kept = 自分の服になった（itemId）、failed = できなかった（チケットは戻す）。
// done（できたが、まだ服にしていない）・discarded（捨てた）は、前の版の名残
export type CandidateStatus = 'waiting' | 'working' | 'done' | 'failed' | 'kept' | 'discarded';
export type LayerKind = 'png' | 'hide' | 'shape' | 'front' | 'under';
export interface CandidateDoc {
  index: number;
  name: string;
  categoryId: string;
  description: string; // 画像の AI への指示（英語）
  colors: string[];
  status: CandidateStatus;
  notes: string[]; // 検品で気づいたこと・失敗の理由（日本語）
  // できた服の絵（切り抜き済み。置き場のパス）と、ドールのキャンバスの上での位置
  preview?: { path: string; canvasW: number; canvasH: number; box: Box };
  // 保存するときに使う絵（置き場のパス）。前の版の「できた」候補だけが持つ
  layers?: Partial<Record<LayerKind, string>>;
  tries?: number; // 取りかかった回数（上限を超えたら、打ち切って払い戻す）
  itemId?: string; // できた服（自分の服）の ID
  refunded?: boolean; // できなかった分のチケットを、戻し終えた
}
export interface SetRef {
  id: string;
  name: string;
}
export interface JobDoc {
  id: string;
  dollId: string;
  theme: string;
  styleId: string;
  set?: SetRef;
  done: boolean;
  tickets: number; // 使った枚数（戻した分を引いたあと）
  draws?: Draw[]; // どこから何枚引いたか
  createdAt: number;
  heartbeat: number; // 最後に進めた時刻（止まっている仕事を見分ける）
  runner?: string; // いま進めている呼び出しの印（追い越された古い呼び出しが、あとから書き込まないように）
  free?: boolean; // 管理者が始めた仕事（チケットを引いていないので、できなくても戻さない）
  photo?: string; // 顔を似せる写真の置き場のパス。仕事が終わったら消す
  v?: 2; // 列で進める版の仕事（できた服は、自動で自分の服になる）
  seen?: boolean; // 利用者が、結果（できた・できなかった）を見た
  queuedAt?: number; // 最後に列に入れた（入れようとした）時刻（入れ直しすぎないため）
  queueFailed?: boolean; // 列に入れられなかった、と分かっている（早めに入れ直す）
  // テーマの細かさと、引いたくじ（日本語の名前）。none = 測れなかった（いままでどおりに企画した）。写真から作る仕事には無い。調べもの用で、利用者には見せない
  width?: { level: 'tight' | 'normal' | 'wide' | 'none'; hints: string[] };
  candidates: CandidateDoc[];
}
// 自分の服。item の中の絵の名前（files/…）は、paths で置き場のパスに引ける
export interface ItemDoc {
  id: string; // `my:` で始まる
  dollId: string;
  item: ManifestItem;
  paths: Record<string, string>;
  set?: SetRef;
  createdAt: number;
  hue?: number; // 既定の色（色スライダーの角度。-180〜180。無ければ 0）
  order?: number; // 並び順（大きいほど先。無ければ createdAt）
  updatedAt?: number; // 名前・色・並び順を最後に変えた時刻（無ければ createdAt）
  notes?: string[]; // 検品で気づいたこと（注意あり）
  fit?: ItemFit; // はじめの位置（クローゼットで決める。無ければ、もとの位置）
}

// 交換（trades/{id}）。a = 出した人、b = 読み取った人。code = 読み取りの印、codeAt = 印を出した時刻
export type TradeStatus = 'open' | 'claimed' | 'joined' | 'done' | 'cancelled';
export type TradeEndReason = 'cancel' | 'expired' | 'gone' | 'conflict' | 'replaced';
export interface TradeSide {
  uid: string;
  itemId?: string;
  accepted?: boolean;
}
export interface TradeDoc {
  id: string;
  status: TradeStatus;
  a: TradeSide;
  b?: TradeSide;
  code: string;
  codeAt: number;
  createdAt: number;
  claimedAt?: number;
  joinedAt?: number;
  endedAt?: number;
  reason?: TradeEndReason;
}

export interface CloudStore {
  getUser(uid: string): Promise<UserDoc | null>;
  // 利用者を作る（もういれば、そのまま返す）。利用者コードは、ほかの利用者と重ならないものにする
  createUser(uid: string, makeCode: () => string, now: number): Promise<UserDoc>;
  findUidByCode(userCode: string): Promise<string | null>;
  // チケットを引く（期限の近い買った分から、足りなければ配った分から）。足りなければ CloudError('no-tickets')（引かない）。返り値は残り（使える枚数）
  charge(uid: string, cost: number, reason: string, now: number): Promise<number>;
  // チケットを配る（配った分に足す）。返り値は残り
  addTickets(uid: string, count: number, reason: string, now: number): Promise<number>;
  // 財布を読むだけ（期限切れを除いた lots）
  getWallet(uid: string, now: number): Promise<{ free: number; lots: Lot[] }>;
  // できなかった品目（index）の分を 1 枚戻す。draws は、その仕事が引いた所（無ければ配った分へ）。
  // 同じ key では、何度呼ばれても 1 回しか戻さない（戻したら true）。台帳の行に、戻した所（to = lot の id か 'free'）を書く
  refundOnce(uid: string, key: string, index: number, draws: Draw[] | undefined, reason: string, now: number): Promise<boolean>;
  // 台帳に書くだけ（管理者が使った分。残りは変えない）
  note(uid: string, count: number, reason: string, now: number): Promise<void>;
  // 画像を 1 枚作る前に呼ぶ。その日の上限に達していたら CloudError('limit')（数は増えない）
  spendImage(day: string, perDay: number): Promise<void>;
  createJob(uid: string, job: JobDoc): Promise<void>;
  // チケットを引くことと、仕事を作ることを、1 つの取り引きで行う。足りなければ CloudError('no-tickets')（どちらも起きない）。返り値は残り。
  // 同じ仕事が、もうあれば（確定の返事が届かなかったときのやり直し）、何もせずに、いまの残りを返す
  chargeAndCreateJob(uid: string, job: JobDoc, cost: number, reason: string, now: number): Promise<number>;
  getJob(uid: string, jobId: string): Promise<JobDoc | null>;
  // 進み具合を、読んで書き換える（割り込まれない）。change が null を返したら、何も書かない。返り値は、書いたあとの内容。
  // **change は、2 回以上呼ばれることがある**（ほかの書き込みと重なると、読み直して呼び直す）。
  // change の中で外の変数に結果を入れるときは、毎回、最初に元へ戻すこと
  updateJob(uid: string, jobId: string, change: (job: JobDoc) => JobDoc | null): Promise<JobDoc>;
  listJobs(uid: string): Promise<JobDoc[]>; // 新しい順
  // 終わっていない仕事（全部の利用者。古い順、limit 件まで）
  listOpenJobs(limit: number): Promise<{ uid: string; job: JobDoc }[]>;
  putItem(uid: string, item: ItemDoc): Promise<void>;
  getItem(uid: string, itemId: string): Promise<ItemDoc | null>;
  // 服を、読んで書き換える（割り込まれない）。無ければ CloudError('refused')。change が null を返したら、書かない。
  // updateJob と同じく、change は 2 回以上呼ばれることがある
  updateItem(uid: string, itemId: string, change: (item: ItemDoc) => ItemDoc | null): Promise<ItemDoc>;
  listItems(uid: string): Promise<ItemDoc[]>; // 作った順
  // 消せたら true（もう無ければ false。交換で別の人へ動いた服の絵を、うっかり消さないため）
  deleteItem(uid: string, itemId: string): Promise<boolean>;

  // ── 引き継ぎ（2 台めの端末の、匿名の利用者のチケットと服を、アカウントへ移す）──
  // どれも、確定の返事が届かずに、もう一度呼ばれてよい（2 回めは、何も変えない）
  // 利用者の印を書く。もう同じ値なら、書かない。利用者がいなければ CloudError('refused')
  markUser(uid: string, change: { movedTo?: string; named?: true }): Promise<void>;
  // adopted に足す（重ならない。もうあれば、新しい側へ動かす。20 件を超えたら、古いものから落とす）
  addAdopted(uid: string, from: string): Promise<void>;
  // その利用者の、まだ使っていない合い言葉があれば返す。無ければ、makeWord() で作って、handoffs と利用者に書く（1 つの取り引き）。
  // makeWord は、取り引きのやり直しで、2 回以上呼ばれることがある（確定したものだけが残る）
  offerHandoff(uid: string, makeWord: () => string, now: number): Promise<string>;
  getHandoff(word: string): Promise<HandoffDoc | null>;
  // 合い言葉を、移す前に押さえる（1 つの取り引き）。無ければ unknown。ほかの人が押さえていれば used。
  // そうでなければ usedBy = by を書いて（もう by なら、書かない）、移す元の uid を返す。同じ人なら、何度呼んでも ok
  claimHandoff(word: string, by: string): Promise<HandoffClaim>;
  // from の使えるチケットを全部（買った分は期限のまま）、to へ移す（1 つの取り引き。中で from を読み直す）。台帳に、from へ -n・to へ +n
  // （理由 `adopt:out:{to}`・`adopt:in:{from}`）。返り値は、移した枚数。0 なら、何も書かない。
  // from が名前のある利用者（named）なら、移さない（0）。to がいなければ CloudError('refused')
  moveTickets(from: string, to: string, now: number): Promise<number>;
  // 服 1 点を、from から to へ移す（1 つの取り引き。中で読み直す）。from に無ければ false。to に同じ ID があれば、書かずに from から消す（true）
  moveItem(from: string, to: string, itemId: string): Promise<boolean>;

  // ── 交換（2 台で、服を 1 点ずつ入れ替える）──
  putTrade(trade: TradeDoc): Promise<void>;
  getTrade(id: string): Promise<TradeDoc | null>;
  // 読み取りの印から探す（無ければ null）
  findTradeByCode(code: string): Promise<TradeDoc | null>;
  // 交換を、読んで書き換える（割り込まれない）。無ければ CloudError('refused')。change が null を返したら、書かない。
  // updateJob と同じく、change は 2 回以上呼ばれることがある
  updateTrade(id: string, change: (trade: TradeDoc) => TradeDoc | null): Promise<TradeDoc>;
  // a.itemId を b.uid へ、b.itemId を a.uid へ（1 つの取り引き。中で、交換と 2 点の服と、受け取る側の同じ ID を読み直す）。
  // まだ status=joined・両方 accepted・両方の服がそれぞれの持ち主にある・受け取る側に同じ ID が無い、ときだけ動かして done にする。
  // 服が無ければ cancelled（reason 'gone'）、受け取る側に同じ ID があれば cancelled（'conflict'）で、何も動かさない。
  // もう done（や cancelled）、まだ joined でない・両方 accepted でないときは、何も変えずに、そのまま返す。
  // 動かした服は、set を外し、order と updatedAt を now にする（名前・色・絵・ID はそのまま）
  swapTrade(id: string, now: number): Promise<TradeDoc>;
  // 交換を 1 回始めた（出した・読み取った）と数える。その日（day）の上限（perDay）に達していたら CloudError('limit')（数は増えない）
  countTrade(uid: string, day: string, perDay: number): Promise<void>;
  // 利用者のいまの交換の ID を書く（null で消す）。利用者がいなければ CloudError('refused')
  setUserTrade(uid: string, tradeId: string | null): Promise<void>;

  // ── 支払い（買ったチケットを、財布に足す・取り戻す）──
  // Checkout を作ったあとに書く
  putPurchase(p: PurchaseDoc): Promise<void>;
  getPurchase(id: string): Promise<PurchaseDoc | null>;
  // 支払い済みにして、買った分を財布に足す（1 つの取り引き）。open なら lot {id, tickets, left: tickets, boughtAt: paidAt, expiresAt}・paid・台帳 buy:{id}。
  // もう paid なら added 0。expired でも、支払い済みと言われたら足す（30 分を過ぎて払えたとき）。無ければ null
  fulfillPurchase(id: string, paidAt: number, now: number): Promise<{ added: number; purchase: PurchaseDoc } | null>;
  // open のときだけ expired にする
  expirePurchase(id: string): Promise<void>;
  // 買った分から、target - reclaimed 枚を取り戻す（1 つの取り引き。大きくなるときだけ。lot の left より多くは取らない）。台帳 refund-paid:{id}。取った枚数を返す
  reclaimPurchase(id: string, target: number, now: number): Promise<number>;
  // paid で、まだアプリに伝えていない支払い
  listUnannounced(uid: string): Promise<PurchaseDoc[]>;
  markAnnounced(id: string): Promise<void>;
  // 支払いページを 1 回作ったと数える。その日（day）の上限（perDay）に達していたら CloudError('limit')（数は増えない）
  countCheckout(uid: string, day: string, perDay: number): Promise<void>;
  // 最初に配る分（ようこそ）を配る（1 つの取り引き）。welcomed が無ければ free に n 枚・welcomed・台帳 welcome。足した枚数（もう配っていれば 0）
  markWelcome(uid: string, n: number, now: number): Promise<number>;
}

// 絵の置き場
export interface CloudFiles {
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<Buffer | null>;
  // prefix で始まるパスを全部消す
  removeAll(prefix: string): Promise<void>;
}
