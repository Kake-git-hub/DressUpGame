/**
 * 交換の画面の段階（純粋な関数）: 交換の様子と、自分の側の進み具合から、いま出す画面を決める
 */
import type { TradeState } from '../cloud/backend';
import type { TradeRefusal } from '../cloud/wire';

// 交換が始まる前の自分の段階（menu = どうする？、pick-show = だす服をえらぶ、scan = QR を読む）。active = 交換が始まった
export type LocalStep = 'menu' | 'pick-show' | 'scan' | 'active';
export type TradeStage = 'menu' | 'pick-show' | 'scan' | 'loading' | 'show-qr' | 'partner-choosing' | 'choose' | 'confirm' | 'done' | 'ended';

export function stageOf(state: TradeState | null, local: LocalStep): TradeStage {
  if (local !== 'active') return local;
  if (!state) return 'loading';
  switch (state.status) {
    case 'open':
      return 'show-qr';
    case 'claimed':
      return state.me === 'a' ? 'partner-choosing' : 'choose';
    case 'joined':
      return 'confirm';
    case 'done':
      return 'done';
    case 'cancelled':
      return 'ended';
  }
}

// 交換が終わった（もう、聞かない・やめない）
export const isFinished = (stage: TradeStage): boolean => stage === 'done' || stage === 'ended';

const REFUSALS: Record<TradeRefusal, string> = {
  expired: 'もういちど よんでね',
  busy: 'ほかの ひとが こうかんちゅう',
  self: 'じぶんの QR コードだよ',
  unknown: 'よめない QR コードだよ',
  limit: 'きょうは もう こうかんできないよ',
  'not-movable': 'この ふくは いま こうかんできないよ',
};
export const refusalText = (refusal: TradeRefusal): string => REFUSALS[refusal];

// カメラが開かなかった理由（denied = 許可を断った、none = カメラが無い、error = ほか）
export type CameraProblem = 'denied' | 'none' | 'error';
export function cameraProblemOf(error: unknown): CameraProblem {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String((error as { name: unknown }).name) : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'none';
  return 'error';
}

