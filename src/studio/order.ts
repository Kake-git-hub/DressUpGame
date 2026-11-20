/**
 * 一覧での服の並べ替えの計算
 */

// 並びの中で、from にあるものを to の位置へ動かした並び
export function moveInList<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, x);
  return next;
}

// from 番目の服を、target 番目の服の前（after なら後ろ）に落としたときの、動かした先の番号
export const dropIndex = (from: number, target: number, after: boolean): number => (from === target ? from : target + (after ? 1 : 0) - (from < target ? 1 : 0));
