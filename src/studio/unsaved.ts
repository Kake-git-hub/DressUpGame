/**
 * まだ保存していない服の候補の数（画面のあちこちから知らせて、ドールを変える前・ページを閉じる前に確かめる）
 */
import { useEffect } from 'react';

const counts = new Map<string, number>();

export const unsavedCount = (): number => [...counts.values()].reduce((a, b) => a + b, 0);

// key ごとに、いまの未保存の数を知らせる。画面から消えたら 0 に戻る
export function useUnsaved(key: string, count: number): void {
  useEffect(() => {
    counts.set(key, count);
    return () => {
      counts.delete(key);
    };
  }, [key, count]);
}

// 未保存の候補があれば、消えてよいかをたずねる。進めてよければ true
export function confirmDiscard(what: string, ask: (text: string) => boolean = (text) => window.confirm(text)): boolean {
  const n = unsavedCount();
  return n === 0 || ask(`保存していない服の候補が ${n} 点あります。${what}と、消えてしまいます（作り直すと、また画像を作ります）。\n\n続けますか？`);
}
