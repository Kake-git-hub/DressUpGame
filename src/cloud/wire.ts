/**
 * アプリとサーバーの関数のあいだを行き来するデータの形（どちらも、ここを見る）
 *
 * アプリは、関数 `studio` に { op: '…', … } を渡して呼ぶ（中身は tools/cloud/api.ts）。
 * 絵は、base64 の文字列で受け取る（置き場のパスや、AI への指示は、アプリには渡らない）。
 */
import type { ManifestItem } from '../content/manifest';
import type { SetRef, StudioUser } from './backend';

// サーバーの版。2 = 生成を、サーバーの列で進める（アプリが「進める」を呼ばなくてよい）。op: 'signIn' の返事の api
export const API_VERSION = 2;

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
