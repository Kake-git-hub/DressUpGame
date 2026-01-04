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
