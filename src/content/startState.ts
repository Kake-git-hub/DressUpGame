/**
 * 起動時の状態を決める: どのドール・背景・服装で始めるか
 * 保存されていた内容を、いま配信されている素材と突き合わせる。
 */
import type { ClothingItemData, EquippedItem } from '../types';
import type { LoadedContent } from './loadContent';
import { fromSavedOutfit } from '../services/outfitStorage';
import type { SavedOutfitEntry } from '../services/outfitStorage';
import { syncPairs } from '../engine/pairs';

export interface StartState {
  dollId: string; // ドールが 1 体も無ければ ''
  backgroundId: string | null;
  outfit: EquippedItem[];
}

export function resolveStartState(
  content: LoadedContent,
  savedDollId: string | null,
  savedBackgroundId: string | null,
  savedOutfit: SavedOutfitEntry[],
  // 髪を「前髪」と「うしろがみ」に分ける前の保存なら true: 着ていた髪の、対のうしろがみも着せる
  addBackHair = false,
): StartState {
  // 保存されたドールが無い・消えた場合は先頭のドール
  const doll = content.dolls.find((d) => d.id === savedDollId) ?? content.dolls[0];
  const dollId = doll?.id ?? '';
  const usable = <T extends { dollId?: string }>(x: T) => !x.dollId || x.dollId === dollId;

  // 服はそのドールのものだけ復元する（別のドールの服を着せない）。一覧から消えた服は外れる
  const available = content.clothing.filter(usable);
  const saved = addBackHair ? withBackHair(savedOutfit, available) : savedOutfit;
  // 髪は、前髪と対のうしろがみを一緒に動かす。別々に調整していた保存（v0.19〜v0.20）は、前髪にそろえる
  const outfit = syncPairs(fromSavedOutfit(saved, available));
  // 背景は、そのドールで使えるもの（専用・共通）だけ
  const background = content.backgrounds.find((bg) => bg.id === savedBackgroundId && usable(bg));
  return { dollId, backgroundId: background?.id ?? null, outfit };
}

// 分ける前は、うしろがみが髪と同じ位置・大きさ・色で付いていた。同じ見た目になるように足す（重なりは、うしろがみ自身の既定）
function withBackHair(saved: SavedOutfitEntry[], available: ClothingItemData[]): SavedOutfitEntry[] {
  const backOf = new Map(available.flatMap((item) => (item.backItemId ? [[item.id, item.backItemId] as const] : [])));
  const worn = new Set(saved.map((entry) => entry.id));
  return saved.flatMap((entry) => {
    const backId = backOf.get(entry.id);
    if (!backId || worn.has(backId)) return [entry];
    const back: SavedOutfitEntry = { ...entry, id: backId, equipOrder: entry.equipOrder - 0.5 };
    delete back.layerAdjust;
    return [back, entry];
  });
}
