/**
 * 起動時の状態を決める: どのドール・背景・服装で始めるか
 * 保存されていた内容を、いま配信されている素材と突き合わせる。
 */
import type { EquippedItem } from '../types';
import type { LoadedContent } from './loadContent';
import { fromSavedOutfit } from '../services/outfitStorage';
import type { SavedOutfitEntry } from '../services/outfitStorage';

export interface StartState {
  dollId: string; // ドールが 1 体も無ければ ''
  backgroundId: string | null;
  outfit: EquippedItem[];
}

export function resolveStartState(
  content: LoadedContent,
  savedDollId: string | null,
  savedBackgroundId: string | null,
  savedOutfit: SavedOutfitEntry[]
): StartState {
  // 保存されたドールが無い・消えた場合は先頭のドール
  const doll = content.dolls.find((d) => d.id === savedDollId) ?? content.dolls[0];
  const dollId = doll?.id ?? '';
  const usable = <T extends { dollId?: string }>(x: T) => !x.dollId || x.dollId === dollId;

  // 服はそのドールのものだけ復元する（別のドールの服を着せない）。一覧から消えた服は外れる
  const outfit = fromSavedOutfit(savedOutfit, content.clothing.filter(usable));
  // 背景は、そのドールで使えるもの（専用・共通）だけ
  const background = content.backgrounds.find((bg) => bg.id === savedBackgroundId && usable(bg));
  return { dollId, backgroundId: background?.id ?? null, outfit };
}
