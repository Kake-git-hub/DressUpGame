/**
 * アプリとサーバーの関数のあいだを行き来するデータの形（どちらも、ここを見る）
 *
 * アプリは、関数 `studio` に { op: '…', … } を渡して呼ぶ（中身は tools/cloud/api.ts）。
 * 絵は、base64 の文字列で受け取る（置き場のパスや、AI への指示は、アプリには渡らない）。
 */
import type { ManifestItem } from '../content/manifest';
import type { SetRef, StudioUser } from './backend';

// サーバーの版（op: 'signIn' の返事の api）。
//   2 = 生成を、サーバーの列で進める（アプリが「進める」を呼ばなくてよい）
//   3 = 引き継ぎ（op: 'offer'・'adopt'。2 台めの端末のチケットと服を、アカウントに合わせる）
//   4 = 交換（op: 'tradeOpen' など。2 台で、服を 1 点ずつ入れ替える）
export const SERVER_API = 4;
// アプリが要る、いちばん古いサーバーの版（これより古いと、「サーバーが古い版です」で、作れない）
export const MIN_API = 2;
// 引き継ぎに要るサーバーの版（これより古いサーバーでは、合わせることだけが、できない）
export const ADOPT_API = 3;
// 交換に要るサーバーの版
export const TRADE_API = 4;

export type WireUser = StudioUser;

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
