/**
 * サーバーの置き場の形（利用者・チケット・生成の進み具合・自分の服）
 *
 * 本物は Firestore と Storage（functions/src/）。テストと手元の確認は、メモリの中の偽物（memoryStore.ts）。
 * 「読んで、変えて、書く」が途中で割り込まれてはいけない操作（チケットを引く・進み具合を書き換える）は、
 * この形の 1 つの操作にまとめてある（本物は、取り引きで行う）。
 */
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
}

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
  createdAt: number;
  heartbeat: number; // 最後に進めた時刻（止まっている仕事を見分ける）
  runner?: string; // いま進めている呼び出しの印（追い越された古い呼び出しが、あとから書き込まないように）
  free?: boolean; // 管理者が始めた仕事（チケットを引いていないので、できなくても戻さない）
  photo?: string; // 顔を似せる写真の置き場のパス。仕事が終わったら消す
  v?: 2; // 列で進める版の仕事（できた服は、自動で自分の服になる）
  seen?: boolean; // 利用者が、結果（できた・できなかった）を見た
  queuedAt?: number; // 最後に列に入れた時刻（入れ直しすぎないため）
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
}

export interface CloudStore {
  getUser(uid: string): Promise<UserDoc | null>;
  // 利用者を作る（もういれば、そのまま返す）。利用者コードは、ほかの利用者と重ならないものにする
  createUser(uid: string, makeCode: () => string, now: number): Promise<UserDoc>;
  findUidByCode(userCode: string): Promise<string | null>;
  // チケットを引く。足りなければ CloudError('no-tickets')（引かない）。返り値は残り
  charge(uid: string, cost: number, reason: string, now: number): Promise<number>;
  // チケットを足す（戻す・配る）。返り値は残り
  addTickets(uid: string, count: number, reason: string, now: number): Promise<number>;
  // できなかった品目の分を 1 枚戻す。同じ key では、何度呼ばれても 1 回しか戻さない（戻したら true）
  refundOnce(uid: string, key: string, reason: string, now: number): Promise<boolean>;
  // 台帳に書くだけ（管理者が使った分。残りは変えない）
  note(uid: string, count: number, reason: string, now: number): Promise<void>;
  // 画像を 1 枚作る前に呼ぶ。その日の上限に達していたら CloudError('limit')（数は増えない）
  spendImage(day: string, perDay: number): Promise<void>;
  createJob(uid: string, job: JobDoc): Promise<void>;
  // チケットを引くことと、仕事を作ることを、1 つの取り引きで行う。足りなければ CloudError('no-tickets')（どちらも起きない）。返り値は残り
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
  deleteItem(uid: string, itemId: string): Promise<void>;
}

// 絵の置き場
export interface CloudFiles {
  put(path: string, data: Buffer, contentType: string): Promise<void>;
  get(path: string): Promise<Buffer | null>;
  // prefix で始まるパスを全部消す
  removeAll(prefix: string): Promise<void>;
}
