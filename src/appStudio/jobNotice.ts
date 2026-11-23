/**
 * 作りかけの仕事に、何と出すか
 *
 * waiting = 順番を待っています、working = 作っています、crowded = こみあっています（待ったまま 60 秒たった）
 */
import type { StudioJob } from '../cloud/backend';

// 順番待ちのまま、これだけたったら「こみあっています」と出す（止まったと思われないように）
export const CROWDED_MS = 60_000;

export function jobNotice(job: StudioJob, now: number): 'waiting' | 'working' | 'crowded' {
  if (job.candidates.some((c) => c.status !== 'waiting')) return 'working';
  return now - job.createdAt > CROWDED_MS ? 'crowded' : 'waiting';
}
