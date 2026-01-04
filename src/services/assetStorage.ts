/**
 * アセット保存サービス
 * LocalStorageとIndexedDBを使用してユーザー追加の画像を保存
 * iPadでも動作可能
 */

import type { ClothingItemData, DollData, BackgroundData, ClothingType } from '../types';

const STORAGE_KEYS = {
  CUSTOM_DOLLS: 'dressup_custom_dolls',
  CUSTOM_BACKGROUNDS: 'dressup_custom_backgrounds',
  CUSTOM_CLOTHING: 'dressup_custom_clothing',
};

// IndexedDB名
const DB_NAME = 'DressUpAssets';
const DB_VERSION = 1;
const STORE_NAME = 'images';

// IndexedDBを開く
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

// 画像をBase64に変換
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 画像をIndexedDBに保存
export async function saveImageToStorage(id: string, base64Data: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ id, data: base64Data });
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// 画像をIndexedDBから取得
export async function getImageFromStorage(id: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);
    
    request.onsuccess = () => {
      resolve(request.result?.data ?? null);
    };
    request.onerror = () => reject(request.error);
  });
}

// 画像をIndexedDBから削除
export async function deleteImageFromStorage(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// カスタムドールを保存
export function saveCustomDolls(dolls: DollData[]): void {
  const data = dolls.map(d => ({
    ...d,
    isCustom: true,
  }));
  localStorage.setItem(STORAGE_KEYS.CUSTOM_DOLLS, JSON.stringify(data));
}

// カスタムドールを読み込み
export function loadCustomDolls(): DollData[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_DOLLS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// カスタム背景を保存
export function saveCustomBackgrounds(backgrounds: BackgroundData[]): void {
  const data = backgrounds.map(b => ({
    ...b,
    isCustom: true,
  }));
  localStorage.setItem(STORAGE_KEYS.CUSTOM_BACKGROUNDS, JSON.stringify(data));
}

// カスタム背景を読み込み
export function loadCustomBackgrounds(): BackgroundData[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_BACKGROUNDS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// カスタム服を保存
export function saveCustomClothing(items: ClothingItemData[]): void {
  const data = items.map(i => ({
    ...i,
    isCustom: true,
  }));
  localStorage.setItem(STORAGE_KEYS.CUSTOM_CLOTHING, JSON.stringify(data));
}

// カスタム服を読み込み
export function loadCustomClothing(): ClothingItemData[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_CLOTHING);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

// 新しいカスタムドールを追加
export async function addCustomDoll(
  name: string,
  imageFile: File
): Promise<DollData> {
  const id = `custom-doll-${Date.now()}`;
  const base64 = await fileToBase64(imageFile);
  await saveImageToStorage(id, base64);
  
  const doll: DollData = {
    id,
    name,
    bodyImageUrl: base64,
    isCustom: true,
    skinTone: 'fair',
    dimensions: {
      width: 512,
      height: 1024,
      anchorPoints: {
        headTop: { x: 0.5, y: 0.05 },
        neckCenter: { x: 0.5, y: 0.18 },
        torsoCenter: { x: 0.5, y: 0.4 },
        hipCenter: { x: 0.5, y: 0.55 },
        footBottom: { x: 0.5, y: 0.98 },
      },
    },
    joints: {
      head: { id: 'head', name: '頭', position: { x: 0.5, y: 0.08 } },
      neck: { id: 'neck', name: '首', position: { x: 0.5, y: 0.18 }, parentId: 'head' },
      leftShoulder: { id: 'leftShoulder', name: '左肩', position: { x: 0.3, y: 0.22 }, parentId: 'neck' },
      rightShoulder: { id: 'rightShoulder', name: '右肩', position: { x: 0.7, y: 0.22 }, parentId: 'neck' },
      leftElbow: { id: 'leftElbow', name: '左肘', position: { x: 0.2, y: 0.35 }, parentId: 'leftShoulder' },
      rightElbow: { id: 'rightElbow', name: '右肘', position: { x: 0.8, y: 0.35 }, parentId: 'rightShoulder' },
      leftWrist: { id: 'leftWrist', name: '左手首', position: { x: 0.15, y: 0.48 }, parentId: 'leftElbow' },
      rightWrist: { id: 'rightWrist', name: '右手首', position: { x: 0.85, y: 0.48 }, parentId: 'rightElbow' },
      hip: { id: 'hip', name: '腰', position: { x: 0.5, y: 0.55 }, parentId: 'neck' },
      leftKnee: { id: 'leftKnee', name: '左膝', position: { x: 0.4, y: 0.72 }, parentId: 'hip' },
      rightKnee: { id: 'rightKnee', name: '右膝', position: { x: 0.6, y: 0.72 }, parentId: 'hip' },
      leftAnkle: { id: 'leftAnkle', name: '左足首', position: { x: 0.4, y: 0.92 }, parentId: 'leftKnee' },
      rightAnkle: { id: 'rightAnkle', name: '右足首', position: { x: 0.6, y: 0.92 }, parentId: 'rightKnee' },
    },
  };
  
  const existing = loadCustomDolls();
  saveCustomDolls([...existing, doll]);
  
  return doll;
}

// 新しいカスタム背景を追加
export async function addCustomBackground(
  name: string,
  imageFile: File
): Promise<BackgroundData> {
  const id = `custom-bg-${Date.now()}`;
  const base64 = await fileToBase64(imageFile);
  await saveImageToStorage(id, base64);
  
  const bg: BackgroundData = {
    id,
    name,
    imageUrl: base64,
    isCustom: true,
  };
  
  const existing = loadCustomBackgrounds();
  saveCustomBackgrounds([...existing, bg]);
  
  return bg;
}

// 新しいカスタム服を追加
export async function addCustomClothing(
  name: string,
  type: ClothingType,
  imageFile: File
): Promise<ClothingItemData> {
  const id = `custom-clothing-${Date.now()}`;
  const base64 = await fileToBase64(imageFile);
  await saveImageToStorage(id, base64);
  
  // タイプに応じたデフォルト位置とzIndex
  const typeDefaults: Record<ClothingType, { position: { x: number; y: number }; baseZIndex: number; anchorType: string }> = {
    underwear_top: { position: { x: 0, y: -30 }, baseZIndex: 0, anchorType: 'torso' },
    underwear_bottom: { position: { x: 0, y: 30 }, baseZIndex: 1, anchorType: 'hip' },
    top: { position: { x: 0, y: -30 }, baseZIndex: 20, anchorType: 'torso' },
    bottom: { position: { x: 0, y: 30 }, baseZIndex: 10, anchorType: 'hip' },
    dress: { position: { x: 0, y: 0 }, baseZIndex: 15, anchorType: 'torso' },
    shoes: { position: { x: 0, y: 135 }, baseZIndex: 5, anchorType: 'feet' },
    accessory: { position: { x: 0, y: -125 }, baseZIndex: 30, anchorType: 'head' },
  };
  
  const defaults = typeDefaults[type];
  
  const item: ClothingItemData = {
    id,
    name,
    type,
    imageUrl: base64,
    position: defaults.position,
    baseZIndex: defaults.baseZIndex,
    anchorType: defaults.anchorType as 'head' | 'neck' | 'torso' | 'hip' | 'feet',
    isCustom: true,
  };
  
  const existing = loadCustomClothing();
  saveCustomClothing([...existing, item]);
  
  return item;
}

// カスタムアイテムを削除
export async function deleteCustomDoll(id: string): Promise<void> {
  await deleteImageFromStorage(id);
  const dolls = loadCustomDolls().filter(d => d.id !== id);
  saveCustomDolls(dolls);
}

export async function deleteCustomBackground(id: string): Promise<void> {
  await deleteImageFromStorage(id);
  const bgs = loadCustomBackgrounds().filter(b => b.id !== id);
  saveCustomBackgrounds(bgs);
}

export async function deleteCustomClothing(id: string): Promise<void> {
  await deleteImageFromStorage(id);
  const items = loadCustomClothing().filter(i => i.id !== id);
  saveCustomClothing(items);
}

// ========== 一括取り込み機能 ==========

// ZIPファイルから画像を抽出（JSZipなしの簡易実装）
async function extractImagesFromZip(zipFile: File): Promise<{ name: string; blob: Blob }[]> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(zipFile);
  const images: { name: string; blob: Blob }[] = [];
  
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const lowerPath = path.toLowerCase();
    if (imageExtensions.some(ext => lowerPath.endsWith(ext))) {
      const blob = await file.async('blob');
      // ファイル名から拡張子を除いた名前
      const fileName = path.split('/').pop() || path;
      const name = fileName.replace(/\.[^.]+$/, '');
      images.push({ name, blob });
    }
  }
  
  return images;
}

// フォルダから画像ファイルを抽出
function extractImagesFromFiles(files: FileList): { name: string; file: File }[] {
  const images: { name: string; file: File }[] = [];
  const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (imageTypes.includes(file.type)) {
      const name = file.name.replace(/\.[^.]+$/, '');
      images.push({ name, file });
    }
  }
  
  return images;
}

// Blobをbase64に変換
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// 一括取り込み結果の型
export interface BulkImportResult {
  success: number;
  failed: number;
  items: (DollData | BackgroundData | ClothingItemData)[];
}

// ZIPから一括取り込み
export async function bulkImportFromZip(
  zipFile: File,
  targetType: 'dolls' | 'backgrounds' | 'clothing',
  clothingType?: ClothingType
): Promise<BulkImportResult> {
  const images = await extractImagesFromZip(zipFile);
  const result: BulkImportResult = { success: 0, failed: 0, items: [] };
  
  for (const { name, blob } of images) {
    try {
      const base64 = await blobToBase64(blob);
      const id = `custom-${targetType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveImageToStorage(id, base64);
      
      if (targetType === 'dolls') {
        const doll = createDollData(id, name, base64);
        result.items.push(doll);
      } else if (targetType === 'backgrounds') {
        const bg: BackgroundData = { id, name, imageUrl: base64, isCustom: true };
        result.items.push(bg);
      } else if (targetType === 'clothing' && clothingType) {
        const item = createClothingData(id, name, clothingType, base64);
        result.items.push(item);
      }
      result.success++;
    } catch (e) {
      console.error('Import failed:', name, e);
      result.failed++;
    }
  }
  
  // 保存
  if (targetType === 'dolls') {
    const existing = loadCustomDolls();
    saveCustomDolls([...existing, ...(result.items as DollData[])]);
  } else if (targetType === 'backgrounds') {
    const existing = loadCustomBackgrounds();
    saveCustomBackgrounds([...existing, ...(result.items as BackgroundData[])]);
  } else if (targetType === 'clothing') {
    const existing = loadCustomClothing();
    saveCustomClothing([...existing, ...(result.items as ClothingItemData[])]);
  }
  
  return result;
}

// フォルダから一括取り込み
export async function bulkImportFromFolder(
  files: FileList,
  targetType: 'dolls' | 'backgrounds' | 'clothing',
  clothingType?: ClothingType
): Promise<BulkImportResult> {
  const images = extractImagesFromFiles(files);
  const result: BulkImportResult = { success: 0, failed: 0, items: [] };
  
  for (const { name, file } of images) {
    try {
      const base64 = await fileToBase64(file);
      const id = `custom-${targetType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveImageToStorage(id, base64);
      
      if (targetType === 'dolls') {
        const doll = createDollData(id, name, base64);
        result.items.push(doll);
      } else if (targetType === 'backgrounds') {
        const bg: BackgroundData = { id, name, imageUrl: base64, isCustom: true };
        result.items.push(bg);
      } else if (targetType === 'clothing' && clothingType) {
        const item = createClothingData(id, name, clothingType, base64);
        result.items.push(item);
      }
      result.success++;
    } catch (e) {
      console.error('Import failed:', name, e);
      result.failed++;
    }
  }
  
  // 保存
  if (targetType === 'dolls') {
    const existing = loadCustomDolls();
    saveCustomDolls([...existing, ...(result.items as DollData[])]);
  } else if (targetType === 'backgrounds') {
    const existing = loadCustomBackgrounds();
    saveCustomBackgrounds([...existing, ...(result.items as BackgroundData[])]);
  } else if (targetType === 'clothing') {
    const existing = loadCustomClothing();
    saveCustomClothing([...existing, ...(result.items as ClothingItemData[])]);
  }
  
  return result;
}

// ドールデータを作成するヘルパー
function createDollData(id: string, name: string, base64: string): DollData {
  return {
    id,
    name,
    bodyImageUrl: base64,
    isCustom: true,
    skinTone: 'fair',
    dimensions: {
      width: 512,
      height: 1024,
      anchorPoints: {
        headTop: { x: 0.5, y: 0.05 },
        neckCenter: { x: 0.5, y: 0.18 },
        torsoCenter: { x: 0.5, y: 0.4 },
        hipCenter: { x: 0.5, y: 0.55 },
        footBottom: { x: 0.5, y: 0.98 },
      },
    },
    joints: {
      head: { id: 'head', name: '頭', position: { x: 0.5, y: 0.08 } },
      neck: { id: 'neck', name: '首', position: { x: 0.5, y: 0.18 }, parentId: 'head' },
      leftShoulder: { id: 'leftShoulder', name: '左肩', position: { x: 0.3, y: 0.22 }, parentId: 'neck' },
      rightShoulder: { id: 'rightShoulder', name: '右肩', position: { x: 0.7, y: 0.22 }, parentId: 'neck' },
      leftElbow: { id: 'leftElbow', name: '左肘', position: { x: 0.2, y: 0.35 }, parentId: 'leftShoulder' },
      rightElbow: { id: 'rightElbow', name: '右肘', position: { x: 0.8, y: 0.35 }, parentId: 'rightShoulder' },
      leftWrist: { id: 'leftWrist', name: '左手首', position: { x: 0.15, y: 0.48 }, parentId: 'leftElbow' },
      rightWrist: { id: 'rightWrist', name: '右手首', position: { x: 0.85, y: 0.48 }, parentId: 'rightElbow' },
      hip: { id: 'hip', name: '腰', position: { x: 0.5, y: 0.55 }, parentId: 'neck' },
      leftKnee: { id: 'leftKnee', name: '左膝', position: { x: 0.4, y: 0.72 }, parentId: 'hip' },
      rightKnee: { id: 'rightKnee', name: '右膝', position: { x: 0.6, y: 0.72 }, parentId: 'hip' },
      leftAnkle: { id: 'leftAnkle', name: '左足首', position: { x: 0.4, y: 0.92 }, parentId: 'leftKnee' },
      rightAnkle: { id: 'rightAnkle', name: '右足首', position: { x: 0.6, y: 0.92 }, parentId: 'rightKnee' },
    },
  };
}

// 服データを作成するヘルパー
function createClothingData(id: string, name: string, type: ClothingType, base64: string): ClothingItemData {
  const typeDefaults: Record<ClothingType, { position: { x: number; y: number }; baseZIndex: number; anchorType: string }> = {
    underwear_top: { position: { x: 0, y: -30 }, baseZIndex: 0, anchorType: 'torso' },
    underwear_bottom: { position: { x: 0, y: 30 }, baseZIndex: 1, anchorType: 'hip' },
    top: { position: { x: 0, y: -30 }, baseZIndex: 20, anchorType: 'torso' },
    bottom: { position: { x: 0, y: 30 }, baseZIndex: 10, anchorType: 'hip' },
    dress: { position: { x: 0, y: 0 }, baseZIndex: 15, anchorType: 'torso' },
    shoes: { position: { x: 0, y: 135 }, baseZIndex: 5, anchorType: 'feet' },
    accessory: { position: { x: 0, y: -125 }, baseZIndex: 30, anchorType: 'head' },
  };
  
  const defaults = typeDefaults[type];
  
  return {
    id,
    name,
    type,
    imageUrl: base64,
    position: defaults.position,
    baseZIndex: defaults.baseZIndex,
    anchorType: defaults.anchorType as 'head' | 'neck' | 'torso' | 'hip' | 'feet',
    isCustom: true,
  };
}
