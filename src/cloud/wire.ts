/**
 * アプリとサーバーの関数のあいだを行き来するデータの形（どちらも、ここを見る）
 *
 * アプリは、関数 `studio` に { op: '…', … } を渡して呼ぶ（中身は tools/cloud/api.ts）。
 * 絵は、base64 の文字列で受け取る（置き場のパスや、AI への指示は、アプリには渡らない）。
 */
import type { Box, ManifestItem } from '../content/manifest';
import type { SetRef, StudioCandidate, StudioUser } from './backend';

export type WireUser = StudioUser;

export interface WireCandidate {
  index: number;
  name: string;
  categoryId: string;
  status: StudioCandidate['status'];
  notes: string[];
  // できた服の絵の位置（絵そのものは、op: 'preview' で取る）
  preview?: { canvasW: number; canvasH: number; box: Box };
}

export interface WireJob {
  id: string;
  dollId: string;
  set?: SetRef;
  done: boolean;
  tickets: number;
  createdAt: number;
  candidates: WireCandidate[];
  stalled: boolean; // 終わっていないのに、しばらく進んでいない（アプリが「進める」を呼び直す）
}

// 自分の服（絵は含まない。絵は、op: 'itemFiles' で取る）
export interface WireItem {
  id: string;
  dollId: string;
  item: ManifestItem;
  set?: SetRef;
  createdAt: number;
}

// 絵の名前（item の中の file・thumb など）→ base64
export type WireFiles = Record<string, string>;
