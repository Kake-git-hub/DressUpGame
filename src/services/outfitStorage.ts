/**
 * 着ている服の保存
 * 画像は保存せず、アイテムID・着た順・調整値だけを localStorage に置く
 */
import type { ClothingItemData, EquippedItem } from '../types';
import { toDollOffsets } from '../engine/units';

export interface SavedOutfitEntry {
  id: string;
  equipOrder: number;
  adjustOffsetX?: number;
  adjustOffsetY?: number;
  adjustScale?: number;
  adjustRotation?: number;
  layerAdjust?: number;
  colorHue?: number;
  setLayer?: number; // セットとして着せたときの重ね順
}

export const OUTFIT_KEY = 'dressup_outfit';
// 髪を「前髪」と「うしろがみ」の 2 点に分けてから保存したことの目印
const HAIR_PARTS_KEY = 'dressup_outfit_hair_parts';
// 位置の調整値を「ドールの絵の px」で保存したことの目印（それより前は、横画面のキャンバスの px）
const UNITS_KEY = 'dressup_outfit_units';
const UNITS_DOLL = 'doll';
// 旧形式（アイテム全体＝画像URL入り）を保存していたキー
export const LEGACY_OUTFIT_KEY = 'dressup_equipped_items';

const ADJUST_KEYS = [
  'adjustOffsetX',
  'adjustOffsetY',
  'adjustScale',
  'adjustRotation',
  'layerAdjust',
  'colorHue',
  'setLayer',
] as const;

// 1件を保存形式に変換（不正なら null）
function toEntry(value: unknown): SavedOutfitEntry | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.equipOrder !== 'number') return null;
  const entry: SavedOutfitEntry = { id: record.id, equipOrder: record.equipOrder };
  for (const key of ADJUST_KEYS) {
    const v = record[key];
    if (typeof v === 'number' && Number.isFinite(v)) entry[key] = v;
  }
  return entry;
}

// 保存文字列を読む。1件でも不正なら全体を捨てる
function parseEntries(raw: string | null): SavedOutfitEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const entries: SavedOutfitEntry[] = [];
    for (const value of parsed) {
      const entry = toEntry(value);
      if (!entry) return [];
      entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
}

export function toSavedOutfit(items: EquippedItem[]): SavedOutfitEntry[] {
  return items.flatMap((item) => toEntry(item) ?? []);
}

// 保存データから装備を組み立てる。今は存在しないIDは外す
export function fromSavedOutfit(saved: SavedOutfitEntry[], available: ClothingItemData[]): EquippedItem[] {
  const byId = new Map(available.map((item) => [item.id, item]));
  return saved.flatMap((entry) => {
    const item = byId.get(entry.id);
    return item ? [{ ...item, ...entry }] : [];
  });
}

export function saveOutfit(items: EquippedItem[]): void {
  try {
    localStorage.setItem(OUTFIT_KEY, JSON.stringify(toSavedOutfit(items)));
    localStorage.setItem(HAIR_PARTS_KEY, '1');
    localStorage.setItem(UNITS_KEY, UNITS_DOLL);
  } catch (error) {
    console.error('装備アイテム保存エラー:', error);
  }
}

// legacyUnit: 目印の無い保存（位置の調整値が、横画面のキャンバスの px）を「ドールの絵の px」に直すための縮尺
// （横にしたときの、ドールの絵の 1px の長さ）。直したら、新しい形で書き戻す
export function loadOutfit(legacyUnit = 1): SavedOutfitEntry[] {
  try {
    const current = localStorage.getItem(OUTFIT_KEY);
    const legacy = localStorage.getItem(LEGACY_OUTFIT_KEY);
    if (legacy !== null) localStorage.removeItem(LEGACY_OUTFIT_KEY);
    const inDollUnits = localStorage.getItem(UNITS_KEY) === UNITS_DOLL;
    let entries: SavedOutfitEntry[] = [];
    let rewrite = false;
    if (current !== null) {
      entries = parseEntries(current);
    } else if (legacy !== null) {
      // 旧形式を変換して新キーに書き直す
      entries = parseEntries(legacy);
      rewrite = true;
    }
    // 縮尺が分からない（0 など）ときは、変換も目印もしない（次に開いたときに変換する）
    if (!inDollUnits && Number.isFinite(legacyUnit) && legacyUnit > 0) {
      entries = entries.map((entry) => toDollOffsets(entry, legacyUnit));
      localStorage.setItem(UNITS_KEY, UNITS_DOLL);
      rewrite = rewrite || current !== null;
    }
    if (rewrite) localStorage.setItem(OUTFIT_KEY, JSON.stringify(entries));
    return entries;
  } catch (error) {
    console.error('装備アイテム読み込みエラー:', error);
    return [];
  }
}

// 髪を 2 点に分ける前の保存か（そのころは、髪 1 点にうしろがみが含まれていた）
export function isOutfitFromBeforeHairParts(): boolean {
  try {
    return localStorage.getItem(HAIR_PARTS_KEY) === null;
  } catch {
    return false;
  }
}
