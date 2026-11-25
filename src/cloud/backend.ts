/**
 * アプリの中のスタジオの「裏側」の形
 *
 * アプリは、裏側をこの形としてだけ知る。本物は Firebase（段階 E3）、テストと開発は端末の中だけで動く偽物（fakeBackend.ts）。
 * チケットの残り・生成・保存は、どれも裏側が決める（アプリの側では増減しない）。
 */
import type { ManifestItem } from '../content/manifest';
import type { StudioAccount } from './account';

export interface StudioUser {
  userCode: string; // 作者に伝えると、チケットや服を届けてもらえる短い文字列
  tickets: number;
  admin: boolean;
}

// 何を作るか: カテゴリを 1 つ選んで 1 点、または、カテゴリをいくつか選んでセット
export type StudioTarget = { kind: 'category'; categoryId: string } | { kind: 'set'; categoryIds: string[] };

export interface SetRef {
  id: string;
  name: string;
}

export interface StudioCandidate {
  index: number;
  name: string;
  categoryId: string;
  // waiting = 順番待ち、working = 作成中、kept = 自分の服になった（itemId）、failed = できなかった（チケットは戻る）
  status: 'waiting' | 'working' | 'kept' | 'failed';
  notes: string[]; // 検品で気づいたこと・失敗の理由（日本語）
  itemId?: string; // できた服（自分の服）の ID
}

export interface StudioJob {
  id: string;
  dollId: string;
  set?: SetRef;
  done: boolean; // 全部の候補が、服になった・できなかった、のどちらかになった
  candidates: StudioCandidate[];
  tickets: number; // 使った枚数（戻した分を引いたあと）
  createdAt: number;
}

/**
 * 自分の服 1 点。item は、公開の一覧（manifest）の服と同じ形。
 * item の中の絵の名前（image.file・thumb・back.file など）は、files の名前（そのまま）。
 */
export interface MyItem {
  id: string; // `my:` で始まる（公開の服と重ならない）
  dollId: string;
  item: ManifestItem;
  files: Record<string, Blob>;
  set?: SetRef;
  createdAt: number;
  // どの利用者の服か（利用者コード）。端末の控えをサーバーに合わせるとき、ほかの利用者だったころの服を消さないために持つ
  owner?: string;
  hue: number; // 既定の色（色スライダーの角度。-180〜180。0 = もとの色）
  order: number; // 並び順（大きいほど先。作ったときは createdAt）
  updatedAt: number; // 名前・色・並び順を最後に変えた時刻
  notes: string[]; // 検品で気づいたこと（注意あり）
}
// 一覧に載る中身（絵は含まない）
export type MyItemInfo = Omit<MyItem, 'files' | 'owner'>;

// old-server = サーバーが古い版（生成を、サーバーの列で進めない版）。作者が載せ直すまで、作れない
export type BackendErrorCode = 'offline' | 'no-tickets' | 'limit' | 'refused' | 'unknown' | 'old-server';
export class BackendError extends Error {
  readonly code: BackendErrorCode;
  // 結果が分からない失敗（返事が届かなかった、など。サーバーの側では、もう済んでいるかもしれない）。
  // false なら、サーバーが理由つきで断った = 何も起きていない、と言い切れる
  readonly uncertain: boolean;
  constructor(code: BackendErrorCode, message: string, options: { uncertain?: boolean } = {}) {
    super(message);
    this.code = code;
    this.uncertain = options.uncertain ?? false;
  }
}
export const OLD_SERVER_MESSAGE = 'サーバーが古い版です（作者が載せ直す必要があります）';

// adopt の答え。done = 移した（数は、いま移した分。もう移ったあとなら 0）、wait = 匿名のうちは移さない、used = ほかの人が使った合い言葉、
// unknown = 知らない（もう使い終わった）合い言葉、refused = 移せない利用者
export interface AdoptAnswer {
  status: 'done' | 'wait' | 'used' | 'unknown' | 'refused';
  tickets: number;
  items: number;
}

export interface StudioBackend {
  // Google のアカウントでのログイン・ログアウト（段階 ③-a）
  readonly account: StudioAccount;
  // 利用者を確かめる（初めてなら作る）。サーバーが古い版なら BackendError('old-server')
  signIn(): Promise<StudioUser>;
  // チケットの残りなどが変わったら知らせる。返り値を呼ぶと、知らせを止める
  onUser(listener: (user: StudioUser) => void): () => void;
  // 生成を始める。チケットは、ここで引かれる（できなかった品目の分は、あとで戻る）。
  // 返ってきたあとは、アプリを閉じても、サーバーが最後まで進める。できた服は、自動で自分の服になる
  startJob(input: { dollId: string; theme: string; styleId: string; target: StudioTarget }): Promise<{ jobId: string; cost: number }>;
  // 進み具合を知らせる。返り値を呼ぶと、知らせを止める
  watchJob(jobId: string, listener: (job: StudioJob) => void): () => void;
  // まだ見ていない仕事（作りかけ + 終わって、結果をまだ見ていないもの）。新しい順
  openJobs(): Promise<StudioJob[]>;
  // 結果（できた・できなかった）を見た、の印を付ける（次からは openJobs に出ない）
  ackJob(jobId: string): Promise<void>;
  // 自分の服の一覧（サーバーにあるもの全部。絵は含まない）
  listMyItems(): Promise<MyItemInfo[]>;
  // 自分の服 1 点を、絵ごと取る
  fetchMyItem(id: string): Promise<MyItem>;
  // 名前・既定の色を変える
  updateMyItem(id: string, change: { name?: string; hue?: number }): Promise<MyItemInfo>;
  // 並び順を変える（ids の先頭ほど、先に並ぶ）。返り値は、変えた服
  orderMyItems(ids: string[]): Promise<MyItemInfo[]>;
  deleteMyItem(id: string): Promise<void>;
  // 引き継ぎの合い言葉をもらう（匿名の利用者のうちに）。サーバーが古ければ BackendError('old-server')
  offerHandoff(): Promise<string>;
  // 合い言葉を出して、この利用者へ移してもらう
  adopt(word: string): Promise<AdoptAnswer>;
  // 管理者だけ: 利用者コードの人に、チケットを count 枚配る（無料）。サーバーが古ければ BackendError('old-server')
  giveTickets(userCode: string, count: number): Promise<GiftAnswer>;
}

// 配った結果: 相手の利用者コード（アカウントへ移った人なら、移った先）と、配ったあとの枚数
export interface GiftAnswer {
  userCode: string;
  tickets: number;
}
// 1 回に配れる枚数の上限（サーバーと同じ）
export const GIFT_MAX = 100;
// 利用者コードの書き方をそろえる（大文字に。空白と - は取る）
export const normalizeUserCode = (code: string): string => code.trim().toUpperCase().replace(/[\s-]/g, '');

// 自分の服の並び順: order の大きい順（同じなら、新しい順 → ID）
export function byClosetOrder(a: { order: number; createdAt: number; id: string }, b: { order: number; createdAt: number; id: string }): number {
  return b.order - a.order || b.createdAt - a.createdAt || a.id.localeCompare(b.id);
}

// 何枚のチケットを使うか（1 点 = 1 枚。セットは、パーツの数だけ）
export const ticketCost = (target: StudioTarget): number => (target.kind === 'set' ? target.categoryIds.length : 1);
export const THEME_MAX = 60;
export const SET_MIN = 2;
export const SET_MAX = 6;
export const NAME_MAX = 20;
export const HUE_MIN = -180;
export const HUE_MAX = 180;
