/**
 * アプリとサーバーの関数のあいだを行き来するデータの形（どちらも、ここを見る）
 *
 * アプリは、関数 `studio` に { op: '…', … } を渡して呼ぶ（中身は tools/cloud/api.ts）。
 * 絵は、base64 の文字列で受け取る（置き場のパスや、AI への指示は、アプリには渡らない）。
 */
import type { ItemFit } from '../engine/fit';
import type { ManifestItem } from '../content/manifest';
import type { SetRef, StudioUser } from './backend';

// サーバーの版（op: 'signIn' の返事の api）。
//   2 = 生成を、サーバーの列で進める（アプリが「進める」を呼ばなくてよい）
//   3 = 引き継ぎ（op: 'offer'・'adopt'。2 台めの端末のチケットと服を、アカウントに合わせる）
//   4 = 交換（op: 'tradeOpen' など。2 台で、服を 1 点ずつ入れ替える）
//   5 = チケットを配る（op: 'giveTickets'。管理者だけ）
//   6 = 支払い（op: 'shop'・'checkout'・'purchase'・'shopAck'。チケットを買う）と、ようこそのチケット
//   7 = 自分の服の「はじめの位置」（op: 'updateItem' の fit、服の fit）
//   8 = テーマの細かさで、生成の幅を変える（サーバーの中だけの変更。アプリは、8 を要らない。載っている版を見分けるための数）
//   9 = 背景を作る（op: 'startJob' の target { kind: 'background' }。できた背景は、カテゴリが BACKGROUND_CATEGORY の「自分の服」として届く）
export const SERVER_API = 9;
// アプリが要る、いちばん古いサーバーの版（これより古いと、「サーバーが古い版です」で、作れない）
export const MIN_API = 2;
// 引き継ぎに要るサーバーの版（これより古いサーバーでは、合わせることだけが、できない）
export const ADOPT_API = 3;
// 交換に要るサーバーの版
export const TRADE_API = 4;
// チケットを配るのに要るサーバーの版
export const GIFT_API = 5;
// 支払い（チケットを買う）に要るサーバーの版
export const PAY_API = 6;
// はじめの位置（クローゼットで決める）に要るサーバーの版
export const FIT_API = 7;
// 背景を作るのに要るサーバーの版（これより古いサーバーでは、「はいけい」のタイルを出さない）
export const BG_API = 9;
// 背景の印: 仕事の品目（categoryId）と、できた背景（item.category）は、このカテゴリ ID を持つ。ドールのカテゴリには無い ID
export const BACKGROUND_CATEGORY = '__background';

// 古いサーバーの返事には、free・lots が無い（remoteBackend が、全部を配った分として補う）
export type WireUser = Omit<StudioUser, 'free' | 'lots'> & Partial<Pick<StudioUser, 'free' | 'lots'>>;

export interface WireCandidate {
  index: number;
  name: string;
  categoryId: string;
  // waiting = 順番待ち、working = 作成中、kept = 自分の服になった（itemId）、failed = できなかった（チケットは戻る）
  status: 'waiting' | 'working' | 'kept' | 'failed';
  notes: string[];
  itemId?: string;
}

export interface WireJob {
  id: string;
  dollId: string;
  set?: SetRef;
  done: boolean;
  tickets: number;
  createdAt: number;
  candidates: WireCandidate[];
}

// 自分の服（絵は含まない。絵は、op: 'itemFiles' で取る）
export interface WireItem {
  id: string;
  dollId: string;
  item: ManifestItem;
  set?: SetRef;
  createdAt: number;
  hue: number; // 既定の色（色スライダーの角度。-180〜180）
  order: number; // 並び順（大きいほど先）
  updatedAt: number; // 名前・色・並び順を最後に変えた時刻
  notes: string[]; // 検品で気づいたこと
  fit?: ItemFit; // はじめの位置（無ければ、もとの位置。版 7 から）
}

// 絵の名前（item の中の file・thumb など）→ base64
export type WireFiles = Record<string, string>;

// 交換を断るときの理由。CloudError('refused') の message の先頭に `trade:{理由}` を付けて渡す
export type TradeRefusal = 'unknown' | 'expired' | 'self' | 'busy' | 'not-movable' | 'limit';

// 交換に出している服（絵は、サムネイルだけ）
export interface WireTradeItem {
  id: string;
  dollId: string;
  name: string;
  categoryId: string;
  hue: number;
  thumb: string; // base64
  thumbType: string; // 例: image/webp
}

export interface WireTrade {
  id: string;
  status: 'open' | 'claimed' | 'joined' | 'done' | 'cancelled';
  me: 'a' | 'b';
  mine?: WireTradeItem;
  theirs?: WireTradeItem; // 相手の服は、読み取ったあと（claimed 以降）から
  myAccepted: boolean;
  theirAccepted: boolean;
  reason?: 'cancel' | 'expired' | 'gone' | 'conflict' | 'replaced';
  receivedId?: string; // done のとき、もらった服の ID
}

// 支払いを断るときの理由。CloudError('refused') の message の先頭に `pay:{理由}` を付けて渡す
export type PayRefusal = 'login' | 'closed' | 'pack' | 'limit' | 'other';

export interface WireShop {
  open: boolean; // 売る設定 on か管理者（で、パックがあり、支払いの口がある）
  packs: { id: string; tickets: number; price: number }[];
  announce: { session: string; tickets: number }[]; // まだアプリに伝えていない、足された支払い
}
export interface WirePurchase {
  status: 'open' | 'paid' | 'expired';
  added: number; // この呼び出しで足した枚数
  tickets: number; // 買った枚数
}
