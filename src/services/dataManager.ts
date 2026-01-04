/**
 * ゲームデータ管理サービス
 * ドールとアイテムのインポート/エクスポート/永続化を担当
 */
import type {
  ClothingItemData,
  DollData,
  GameData,
  ImportItemsFile,
  ImportDollsFile,
  ImportItemData,
  ImportDollData,
} from '../types';

// ローカルストレージのキー
const STORAGE_KEY_ITEMS = 'dressup_custom_items';
const STORAGE_KEY_DOLLS = 'dressup_custom_dolls';
const STORAGE_KEY_SELECTED_DOLL = 'dressup_selected_doll';

/**
 * ローカルストレージからカスタムアイテムを読み込む
 */
export function loadCustomItems(): ClothingItemData[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY_ITEMS);
    if (!data) return [];
    return JSON.parse(data) as ClothingItemData[];
  } catch (error) {
    console.error('カスタムアイテムの読み込みエラー:', error);
    return [];
  }
}

/**
 * ローカルストレージにカスタムアイテムを保存
 */
export function saveCustomItems(items: ClothingItemData[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_ITEMS, JSON.stringify(items));
  } catch (error) {
    console.error('カスタムアイテムの保存エラー:', error);
  }
}

/**
 * ローカルストレージからカスタムドールを読み込む
 */
export function loadCustomDolls(): DollData[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY_DOLLS);
    if (!data) return [];
    return JSON.parse(data) as DollData[];
  } catch (error) {
    console.error('カスタムドールの読み込みエラー:', error);
    return [];
  }
}

/**
 * ローカルストレージにカスタムドールを保存
 */
export function saveCustomDolls(dolls: DollData[]): void {
  try {
    localStorage.setItem(STORAGE_KEY_DOLLS, JSON.stringify(dolls));
  } catch (error) {
    console.error('カスタムドールの保存エラー:', error);
  }
}

/**
 * 選択中のドールIDを保存
 */
export function saveSelectedDoll(dollId: string | null): void {
  try {
    if (dollId) {
      localStorage.setItem(STORAGE_KEY_SELECTED_DOLL, dollId);
    } else {
      localStorage.removeItem(STORAGE_KEY_SELECTED_DOLL);
    }
  } catch (error) {
    console.error('選択ドールの保存エラー:', error);
  }
}

/**
 * 選択中のドールIDを読み込む
 */
export function loadSelectedDoll(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY_SELECTED_DOLL);
  } catch (error) {
    console.error('選択ドールの読み込みエラー:', error);
    return null;
  }
}

/**
 * 画像ファイルをBase64 Data URLに変換
 */
export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * インポートデータからアイテムデータを作成
 */
export function convertImportItem(
  importItem: ImportItemData,
  imageDataUrl: string
): ClothingItemData {
  return {
    id: importItem.id,
    name: importItem.name,
    type: importItem.type,
    imageUrl: imageDataUrl,
    position: importItem.position,
    baseZIndex: importItem.baseZIndex,
    tags: importItem.tags,
    author: importItem.author,
    createdAt: importItem.createdAt,
    isCustom: true,
  };
}

/**
 * インポートデータからドールデータを作成
 */
export function convertImportDoll(
  importDoll: ImportDollData,
  bodyImageDataUrl: string,
  faceImageDataUrl?: string
): DollData {
  return {
    id: importDoll.id,
    name: importDoll.name,
    bodyImageUrl: bodyImageDataUrl,
    faceImageUrl: faceImageDataUrl,
    skinTone: importDoll.skinTone,
    defaultUnderwear: importDoll.defaultUnderwear,
    tags: importDoll.tags,
    author: importDoll.author,
    createdAt: importDoll.createdAt,
    isCustom: true,
  };
}

/**
 * JSONファイルを解析してアイテムデータを取得
 */
export async function parseItemsJson(jsonFile: File): Promise<ImportItemsFile> {
  const text = await jsonFile.text();
  const data = JSON.parse(text) as ImportItemsFile;
  
  // バリデーション
  if (!data.version || !Array.isArray(data.items)) {
    throw new Error('無効なアイテムJSONフォーマットです');
  }
  
  return data;
}

/**
 * JSONファイルを解析してドールデータを取得
 */
export async function parseDollsJson(jsonFile: File): Promise<ImportDollsFile> {
  const text = await jsonFile.text();
  const data = JSON.parse(text) as ImportDollsFile;
  
  // バリデーション
  if (!data.version || !Array.isArray(data.dolls)) {
    throw new Error('無効なドールJSONフォーマットです');
  }
  
  return data;
}

/**
 * アイテムを削除
 */
export function deleteCustomItem(itemId: string): ClothingItemData[] {
  const items = loadCustomItems();
  const filtered = items.filter(item => item.id !== itemId);
  saveCustomItems(filtered);
  return filtered;
}

/**
 * ドールを削除
 */
export function deleteCustomDoll(dollId: string): DollData[] {
  const dolls = loadCustomDolls();
  const filtered = dolls.filter(doll => doll.id !== dollId);
  saveCustomDolls(filtered);
  return filtered;
}

/**
 * カスタムアイテムを追加
 */
export function addCustomItem(item: ClothingItemData): ClothingItemData[] {
  const items = loadCustomItems();
  // 同じIDがあれば上書き
  const existingIndex = items.findIndex(i => i.id === item.id);
  if (existingIndex >= 0) {
    items[existingIndex] = item;
  } else {
    items.push(item);
  }
  saveCustomItems(items);
  return items;
}

/**
 * カスタムドールを追加
 */
export function addCustomDoll(doll: DollData): DollData[] {
  const dolls = loadCustomDolls();
  // 同じIDがあれば上書き
  const existingIndex = dolls.findIndex(d => d.id === doll.id);
  if (existingIndex >= 0) {
    dolls[existingIndex] = doll;
  } else {
    dolls.push(doll);
  }
  saveCustomDolls(dolls);
  return dolls;
}

/**
 * 全ゲームデータをエクスポート
 */
export function exportGameData(): GameData {
  return {
    dolls: loadCustomDolls(),
    items: loadCustomItems(),
    selectedDollId: loadSelectedDoll(),
  };
}

/**
 * 全ゲームデータをインポート
 */
export function importGameData(data: GameData): void {
  if (data.dolls) {
    saveCustomDolls(data.dolls);
  }
  if (data.items) {
    saveCustomItems(data.items);
  }
  if (data.selectedDollId !== undefined) {
    saveSelectedDoll(data.selectedDollId);
  }
}

/**
 * 全カスタムデータをクリア
 */
export function clearAllCustomData(): void {
  localStorage.removeItem(STORAGE_KEY_ITEMS);
  localStorage.removeItem(STORAGE_KEY_DOLLS);
  localStorage.removeItem(STORAGE_KEY_SELECTED_DOLL);
}
