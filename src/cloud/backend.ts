/**
 * アプリの中のスタジオの「裏側」の形
 *
 * アプリは、裏側をこの形としてだけ知る。本物は Firebase（段階 E3）、テストと開発は端末の中だけで動く偽物（fakeBackend.ts）。
 * チケットの残り・生成・保存は、どれも裏側が決める（アプリの側では増減しない）。
 */
import type { Box, ManifestItem } from '../content/manifest';

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

// できた服の絵（切り抜き済み）と、ドールのキャンバスの上での位置
export interface StudioPreview {
  url: string;
  canvasW: number;
  canvasH: number;
  box: Box;
}

export interface StudioCandidate {
  index: number;
  name: string;
  categoryId: string;
  // waiting = 順番待ち、working = 作成中、done = できた、failed = できなかった（チケットは戻る）、
  // kept = 「使う」で自分の服にした、discarded = 「捨てる」で消した
  status: 'waiting' | 'working' | 'done' | 'failed' | 'kept' | 'discarded';
  notes: string[]; // 検品で気づいたこと・失敗の理由（日本語）
  preview?: StudioPreview;
}

export interface StudioJob {
  id: string;
  dollId: string;
  set?: SetRef;
  done: boolean; // 全部の候補が、できた・できなかった、のどちらかになった
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
}

export type BackendErrorCode = 'offline' | 'no-tickets' | 'limit' | 'refused' | 'unknown';
export class BackendError extends Error {
  readonly code: BackendErrorCode;
  constructor(code: BackendErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface StudioBackend {
  // 利用者を確かめる（初めてなら作る）
  signIn(): Promise<StudioUser>;
  // チケットの残りなどが変わったら知らせる。返り値を呼ぶと、知らせを止める
  onUser(listener: (user: StudioUser) => void): () => void;
  // 生成を始める。チケットは、ここで引かれる（できなかった品目の分は、あとで戻る）
  startJob(input: { dollId: string; theme: string; styleId: string; target: StudioTarget }): Promise<{ jobId: string; cost: number }>;
  // 進み具合を知らせる。返り値を呼ぶと、知らせを止める
  watchJob(jobId: string, listener: (job: StudioJob) => void): () => void;
  // まだ「使う」「捨てる」を決めていない候補のある仕事（閉じる前に作っていた分も含む）。新しい順
  pendingJobs(): Promise<StudioJob[]>;
  // 「使う」: 自分の服にする
  keep(jobId: string, index: number, name: string): Promise<MyItem>;
  // 「捨てる」
  discard(jobId: string, index: number): Promise<void>;
  // 自分の服の一覧（サーバーにあるもの全部）
  listMyItems(): Promise<MyItem[]>;
  deleteMyItem(id: string): Promise<void>;
}

// 何枚のチケットを使うか（1 点 = 1 枚。セットは、パーツの数だけ）
export const ticketCost = (target: StudioTarget): number => (target.kind === 'set' ? target.categoryIds.length : 1);
export const THEME_MAX = 60;
export const SET_MIN = 2;
export const SET_MAX = 6;
