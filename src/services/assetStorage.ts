/**
 * アセット保存サービス
 * LocalStorageとIndexedDBを使用してユーザー追加の画像を保存
 * iPadでも動作可能
 */

import type { ClothingItemData, DollData, BackgroundData, ClothingType, DollPreset, CategoryInfo } from '../types';
import { DEFAULT_CATEGORY_MAP, getCategoryInfo, parseFolderName } from '../types';

const STORAGE_KEYS = {
  CUSTOM_DOLLS: 'dressup_custom_dolls',
  CUSTOM_BACKGROUNDS: 'dressup_custom_backgrounds',
  CUSTOM_CLOTHING: 'dressup_custom_clothing',
  DOLL_PRESETS: 'dressup_doll_presets',
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

function inferImageMimeType(fileName?: string): string | null {
  if (!fileName) return null;
  const ext = fileName.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      return null;
  }
}

function normalizeDataUrlMime(dataUrl: string, desiredMime: string | null): string {
  if (!desiredMime || !desiredMime.startsWith('image/')) return dataUrl;
  const match = dataUrl.match(/^data:([^;]*);base64,/);
  if (!match) return dataUrl;
  const currentMime = match[1] ?? '';
  if (currentMime.startsWith('image/')) return dataUrl;
  // ZIP由来などで application/octet-stream になっているケースを補正
  return dataUrl.replace(/^data:[^;]*;base64,/, `data:${desiredMime};base64,`);
}

// 画像をBase64(Data URL)に変換（ZIP由来などでmimeが欠ける場合は拡張子から補正）
export function fileToBase64(file: Blob, fileName?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result as string;
      const mimeFromBlob = (file as File).type || '';
      const desiredMime = mimeFromBlob.startsWith('image/') ? mimeFromBlob : inferImageMimeType(fileName);
      resolve(normalizeDataUrlMime(raw, desiredMime));
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 画像を処理：右下のウォーターマーク領域をカット（クロマキーはGPUフィルタで処理）
 * @param dataUrl 元画像のData URL
 * @param cropBottomRight 右下カットのサイズ（px）、デフォルト160
 * @returns 処理済みのData URL
 */
export function processImageWithChromaKey(
  dataUrl: string,
  cropBottomRight: number = 160
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl); // フォールバック
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      // 右下のウォーターマーク領域のみクリア（高速処理）
      const cropStartX = canvas.width - cropBottomRight;
      const cropStartY = canvas.height - cropBottomRight;
      ctx.clearRect(cropStartX, cropStartY, cropBottomRight, cropBottomRight);

      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗'));
    img.src = dataUrl;
  });
}

/**
 * グリーンバック透過処理（クロマキー）
 * HSV色空間でグリーン系の色を透明にする
 * @param dataUrl 元画像のData URL
 * @returns 透過処理済みのData URL
 */
export function processChromaKeyTransparent(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(dataUrl);
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // グリーンバック判定（より厳密な判定 + エッジのソフト透過）
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        // 緑が支配的かどうかを判定
        const greenDominance = g - Math.max(r, b);
        const saturation = Math.max(r, g, b) - Math.min(r, g, b);
        
        // 純粋なグリーンバック: 緑が非常に優勢で彩度が高い
        // 閾値を厳しくして白/銀色を保護
        if (greenDominance > 50 && saturation > 60 && g > 80) {
          // 完全に透明
          data[i + 3] = 0;
        } else if (greenDominance > 35 && saturation > 45 && g > 60) {
          // エッジ部分: ソフトな透過（ギザギザ軽減）
          const alpha = Math.max(0, 255 - (greenDominance - 35) * 10);
          data[i + 3] = Math.min(data[i + 3], alpha);
        }
      }

      ctx.putImageData(imageData, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗'));
    img.src = dataUrl;
  });
}

/**
 * 画像ファイルを読み込み、処理（右下カット＋クロマキー）してBase64で返す
 */
export async function fileToBase64WithProcessing(
  file: Blob,
  fileName?: string
): Promise<string> {
  const raw = await fileToBase64(file, fileName);
  return processImageWithChromaKey(raw);
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

/**
 * 透過処理済み画像を取得（なければ元画像から生成してキャッシュ）
 * @param id アイテムID
 * @param originalImageUrl 元画像URL（フォールバック用）
 * @returns 透過処理済み画像のData URL
 */
export async function getTransparentImage(id: string, originalImageUrl: string): Promise<string> {
  const transparentId = `${id}_transparent`;
  
  // キャッシュから取得を試みる
  const cached = await getImageFromStorage(transparentId);
  if (cached) {
    return cached;
  }
  
  // キャッシュがない場合は生成して保存
  const transparent = await processChromaKeyTransparent(originalImageUrl);
  await saveImageToStorage(transparentId, transparent);
  return transparent;
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

// カスタムドールを保存（imageUrlはIndexedDBから復元するためIDのみ保存）
export function saveCustomDolls(dolls: DollData[]): void {
  const data = dolls.map(d => ({
    id: d.id,
    name: d.name,
    skinTone: d.skinTone,
    dimensions: d.dimensions,
    joints: d.joints,
    isCustom: true,
    // bodyImageUrlは保存しない（IndexedDBから復元）
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

// カスタム背景を保存（imageUrlはIndexedDBから復元するためIDのみ保存）
export function saveCustomBackgrounds(backgrounds: BackgroundData[]): void {
  const data = backgrounds.map(b => ({
    id: b.id,
    name: b.name,
    thumbnailUrl: b.thumbnailUrl,
    isCustom: true,
    // imageUrlは保存しない（IndexedDBから復元）
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

// カスタム服を保存（imageUrlはIndexedDBから復元するためIDのみ保存）
export function saveCustomClothing(items: ClothingItemData[]): void {
  const data = items.map(i => ({
    id: i.id,
    name: i.name,
    type: i.type,
    baseZIndex: i.baseZIndex,
    layerOrder: i.layerOrder,
    categoryOrder: i.categoryOrder,
    position: i.position,
    anchorType: i.anchorType,
    dollId: i.dollId,
    movable: i.movable,
    allowOverlap: i.allowOverlap,
    hasThumbnail: !!i.thumbnailUrl, // サムネイルがあるかフラグ
    isCustom: true,
    // imageUrl, thumbnailUrlは保存しない（IndexedDBから復元）
  }));
  localStorage.setItem(STORAGE_KEYS.CUSTOM_CLOTHING, JSON.stringify(data));
}

// カスタム服を読み込み
export function loadCustomClothing(): ClothingItemData[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_CLOTHING);
    const parsed = data ? (JSON.parse(data) as any[]) : [];
    // レガシーデータの型揺れ（文字列→数値）や欠落を最低限補正
    return parsed.map((i) => {
      const baseZIndex = typeof i.baseZIndex === 'string' ? Number(i.baseZIndex) : i.baseZIndex;
      const layerOrder =
        typeof i.layerOrder === 'string'
          ? Number(i.layerOrder)
          : typeof i.layerOrder === 'number'
            ? i.layerOrder
            : undefined;

      return {
        ...i,
        baseZIndex: Number.isFinite(baseZIndex) ? baseZIndex : 25,
        layerOrder: Number.isFinite(layerOrder as number) ? (layerOrder as number) : undefined,
      } as ClothingItemData;
    });
  } catch {
    return [];
  }
}

// ========== 画像復元関数（IndexedDBから） ==========

// カスタムドールの画像を復元
export async function restoreDollImages(dolls: DollData[]): Promise<DollData[]> {
  const restored: DollData[] = [];
  for (const doll of dolls) {
    if (doll.isCustom && !doll.bodyImageUrl) {
      const imageData = await getImageFromStorage(doll.id);
      if (imageData) {
        restored.push({ ...doll, bodyImageUrl: imageData });
      } else {
        console.warn(`ドール画像が見つかりません: ${doll.id}`);
      }
    } else {
      restored.push(doll);
    }
  }
  return restored;
}

// カスタム背景の画像を復元
export async function restoreBackgroundImages(backgrounds: BackgroundData[]): Promise<BackgroundData[]> {
  const restored: BackgroundData[] = [];
  for (const bg of backgrounds) {
    if (bg.isCustom && !bg.imageUrl) {
      const imageData = await getImageFromStorage(bg.id);
      if (imageData) {
        restored.push({ ...bg, imageUrl: imageData });
      } else {
        console.warn(`背景画像が見つかりません: ${bg.id}`);
      }
    } else {
      restored.push(bg);
    }
  }
  return restored;
}

// カスタム服の画像を復元
export async function restoreClothingImages(items: ClothingItemData[]): Promise<ClothingItemData[]> {
  const restored: ClothingItemData[] = [];
  for (const item of items) {
    if (item.isCustom && !item.imageUrl) {
      const imageData = await getImageFromStorage(item.id);
      if (imageData) {
        // サムネイルがある場合は復元
        let thumbnailUrl: string | undefined;
        if ((item as any).hasThumbnail) {
          const thumbData = await getImageFromStorage(`${item.id}-thumb`);
          if (thumbData) {
            thumbnailUrl = thumbData;
          }
        }
        restored.push({ ...item, imageUrl: imageData, thumbnailUrl });
      } else {
        console.warn(`服画像が見つかりません: ${item.id}`);
      }
    } else {
      restored.push(item);
    }
  }
  return restored;
}

// 新しいカスタムドールを追加
export async function addCustomDoll(
  name: string,
  imageFile: File
): Promise<DollData> {
  const id = `custom-doll-${Date.now()}`;
  // 右下ウォーターマーク除去＋クロマキー処理
  const base64 = await fileToBase64WithProcessing(imageFile, imageFile.name);
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
  const base64 = await fileToBase64(imageFile, imageFile.name);
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

// 新しいカスタム服を追加（動的カテゴリ対応）
export async function addCustomClothing(
  name: string,
  type: ClothingType,
  imageFile: File
): Promise<ClothingItemData> {
  const id = `custom-clothing-${Date.now()}`;
  // 右下ウォーターマーク除去＋クロマキー処理
  const base64 = await fileToBase64WithProcessing(imageFile, imageFile.name);
  await saveImageToStorage(id, base64);
  
  // 透過処理済み画像も保存（プレビュー用）
  const transparentBase64 = await processChromaKeyTransparent(base64);
  await saveImageToStorage(`${id}_transparent`, transparentBase64);
  
  // DEFAULT_CATEGORY_MAPからデフォルト値を取得
  const mapping = DEFAULT_CATEGORY_MAP[type.toLowerCase()];
  const defaults = mapping || {
    position: { x: 0, y: 0 },
    zIndex: 25,
    anchorType: 'torso',
  };
  
  const item: ClothingItemData = {
    id,
    name,
    type,
    imageUrl: base64,
    position: defaults.position,
    baseZIndex: mapping?.zIndex || 25,
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
  await deleteImageFromStorage(`${id}_transparent`); // 透過画像も削除
  const items = loadCustomClothing().filter(i => i.id !== id);
  saveCustomClothing(items);
}

/**
 * すべてのカスタムデータを削除
 */
export async function clearAllCustomData(): Promise<void> {
  // IndexedDBの全画像を削除
  const dolls = loadCustomDolls();
  const backgrounds = loadCustomBackgrounds();
  const clothing = loadCustomClothing();
  
  for (const doll of dolls) {
    await deleteImageFromStorage(doll.id);
  }
  for (const bg of backgrounds) {
    await deleteImageFromStorage(bg.id);
  }
  for (const item of clothing) {
    await deleteImageFromStorage(item.id);
  }
  
  // LocalStorageをクリア
  localStorage.removeItem(STORAGE_KEYS.CUSTOM_DOLLS);
  localStorage.removeItem(STORAGE_KEYS.CUSTOM_BACKGROUNDS);
  localStorage.removeItem(STORAGE_KEYS.CUSTOM_CLOTHING);
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
function blobToBase64(blob: Blob, fileName?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result as string;
      const mimeFromBlob = (blob as File).type || '';
      const desiredMime = mimeFromBlob.startsWith('image/') ? mimeFromBlob : inferImageMimeType(fileName);
      resolve(normalizeDataUrlMime(raw, desiredMime));
    };
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
      const base64 = await blobToBase64(blob, name);
      const id = `custom-${targetType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveImageToStorage(id, base64);
      
      // 服の場合は透過画像も保存
      if (targetType === 'clothing') {
        const transparentBase64 = await processChromaKeyTransparent(base64);
        await saveImageToStorage(`${id}_transparent`, transparentBase64);
      }
      
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
      // ドール・服は右下カット＋クロマキー処理、背景はそのまま
      const base64 = targetType === 'backgrounds' 
        ? await fileToBase64(file)
        : await fileToBase64WithProcessing(file, file.name);
      const id = `custom-${targetType}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveImageToStorage(id, base64);
      
      // 服の場合は透過画像も保存
      if (targetType === 'clothing') {
        const transparentBase64 = await processChromaKeyTransparent(base64);
        await saveImageToStorage(`${id}_transparent`, transparentBase64);
      }
      
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

// 服データを作成するヘルパー（動的カテゴリ対応）
// categoryRaw: 元のフォルダ名（_movable サフィックス含む可能性あり、番号プレフィックス含む可能性あり）
function createClothingData(id: string, name: string, type: ClothingType, base64: string, categoryRaw?: string): ClothingItemData {
  // フォルダ名から番号とラベルを抽出
  // 新フォーマット: 「レイヤー順_カテゴリ並び順_ラベル」（例: "01_02_ドレス"）
  // 旧フォーマット: 「番号_ラベル」（例: "1_くつした"）
  const parsed = parseFolderName(categoryRaw || type);
  const categoryLabel = parsed.label; // 番号を除いたカテゴリ名
  const layerOrder = parsed.order; // レイヤー順（番号がなければundefined）
  const categoryOrder = parsed.categoryOrder; // カテゴリ並び順（番号がなければundefined）
  
  // DEFAULT_CATEGORY_MAPからデフォルト値を取得、なければ汎用値
  const mapping = DEFAULT_CATEGORY_MAP[categoryLabel.toLowerCase()];
  const defaults = mapping || {
    position: { x: 0, y: 0 },
    zIndex: 25,
    anchorType: 'torso',
  };
  
  // movable判定: categoryRawに_movableがあるか、デフォルトでmovableなカテゴリか
  const rawLower = (categoryRaw || type).toLowerCase();
  const hasMovableSuffix = rawLower.includes('_movable');
  const isDefaultMovable = mapping?.movable ?? false;
  const movable = hasMovableSuffix || isDefaultMovable;
  
  // overlap判定: categoryRawに_overlapがあるか
  const allowOverlap = rawLower.includes('_overlap');
  
  return {
    id,
    name,
    type: categoryLabel.toLowerCase(), // 番号を除いたカテゴリ名を使用
    imageUrl: base64,
    position: defaults.position,
    baseZIndex: mapping?.zIndex || 25,
    anchorType: defaults.anchorType as 'head' | 'neck' | 'torso' | 'hip' | 'feet',
    isCustom: true,
    movable,
    layerOrder,
    categoryOrder,
    allowOverlap,
  };
}

// ========== 階層フォルダ一括取り込み ==========

// フォルダ階層からカテゴリを判定（レガシー互換）
function detectCategoryFromPath(path: string): {
  type: 'dolls' | 'backgrounds' | 'clothing';
  clothingType?: ClothingType;
} | null {
  const lowerPath = path.toLowerCase();
  
  // ドール
  if (lowerPath.includes('/dolls/') || lowerPath.startsWith('dolls/')) {
    return { type: 'dolls' };
  }
  
  // 背景
  if (lowerPath.includes('/backgrounds/') || lowerPath.startsWith('backgrounds/')) {
    return { type: 'backgrounds' };
  }
  
  // 服カテゴリ（動的検出）
  const clothingMatch = lowerPath.match(/[/\\]clothing[/\\]([^/\\]+)[/\\]/);
  if (clothingMatch) {
    return { type: 'clothing', clothingType: clothingMatch[1] };
  }
  
  return null;
}

// 階層構造対応の一括取り込み結果
export interface HierarchicalImportResult {
  dolls: { success: number; failed: number; items: DollData[] };
  backgrounds: { success: number; failed: number; items: BackgroundData[] };
  clothing: { success: number; failed: number; items: ClothingItemData[] };
}

// フォルダ階層から一括取り込み（複数カテゴリ対応）- レガシー互換
export async function bulkImportFromHierarchicalFolder(
  files: FileList
): Promise<HierarchicalImportResult> {
  const result: HierarchicalImportResult = {
    dolls: { success: 0, failed: 0, items: [] },
    backgrounds: { success: 0, failed: 0, items: [] },
    clothing: { success: 0, failed: 0, items: [] },
  };
  
  const imageTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!imageTypes.includes(file.type)) continue;
    
    // webkitRelativePathからカテゴリを判定
    const path = file.webkitRelativePath || file.name;
    const category = detectCategoryFromPath(path);
    
    if (!category) {
      console.warn('カテゴリ不明:', path);
      continue;
    }
    
    try {
      // ドール・服は右下カット＋クロマキー処理、背景はそのまま
      const base64 = category.type === 'backgrounds'
        ? await fileToBase64(file, file.name)
        : await fileToBase64WithProcessing(file, file.name);
      const id = `custom-${category.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const name = file.name.replace(/\.[^.]+$/, '');
      
      await saveImageToStorage(id, base64);
      
      switch (category.type) {
        case 'dolls': {
          const doll = createDollData(id, name, base64);
          result.dolls.items.push(doll);
          result.dolls.success++;
          break;
        }
        case 'backgrounds': {
          const bg: BackgroundData = { id, name, imageUrl: base64, isCustom: true };
          result.backgrounds.items.push(bg);
          result.backgrounds.success++;
          break;
        }
        case 'clothing': {
          if (category.clothingType) {
            const item = createClothingData(id, name, category.clothingType, base64);
            result.clothing.items.push(item);
            result.clothing.success++;
          }
          break;
        }
      }
    } catch (e) {
      console.error('Import failed:', path, e);
      switch (category.type) {
        case 'dolls': result.dolls.failed++; break;
        case 'backgrounds': result.backgrounds.failed++; break;
        case 'clothing': result.clothing.failed++; break;
      }
    }
  }
  
  // 保存
  if (result.dolls.items.length > 0) {
    const existing = loadCustomDolls();
    saveCustomDolls([...existing, ...result.dolls.items]);
  }
  if (result.backgrounds.items.length > 0) {
    const existing = loadCustomBackgrounds();
    saveCustomBackgrounds([...existing, ...result.backgrounds.items]);
  }
  if (result.clothing.items.length > 0) {
    const existing = loadCustomClothing();
    saveCustomClothing([...existing, ...result.clothing.items]);
  }
  
  return result;
}

// ========== 新プリセット形式（ドール専用） ==========

// 進捗コールバック用の型
export interface ImportProgress {
  phase: 'parsing' | 'backgrounds' | 'dolls' | 'clothing' | 'saving' | 'complete';
  current: number;
  total: number;
  message: string;
}

export type ProgressCallback = (progress: ImportProgress) => void;

// UIスレッドを解放するためのユーティリティ
function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    // requestIdleCallbackが使えればそれを使う、なければsetTimeout
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(resolve, { timeout: 50 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

// プリセット取り込み結果
export interface PresetImportResult {
  presets: { success: number; failed: number; items: DollPreset[] };
  backgrounds: { success: number; failed: number; items: BackgroundData[] };
}

// ドールプリセットを保存（メタデータのみ、画像はIndexedDB）
export function saveDollPresets(presets: DollPreset[]): void {
  const metaData = presets.map(p => ({
    id: p.id,
    name: p.name,
    dollId: p.doll.id,
    clothingIds: p.clothingItems.map(c => c.id),
    categories: p.categories,
  }));
  localStorage.setItem(STORAGE_KEYS.DOLL_PRESETS, JSON.stringify(metaData));
}

// ドールプリセットを読み込み
export function loadDollPresets(): DollPreset[] {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.DOLL_PRESETS);
    if (!data) return [];
    
    const metaList = JSON.parse(data);
    const allDolls = loadCustomDolls();
    const allClothing = loadCustomClothing();
    
    return metaList.map((meta: any) => {
      const doll = allDolls.find(d => d.id === meta.dollId) || {
        id: meta.dollId,
        name: meta.dollName,
        bodyImageUrl: meta.dollBodyImageUrl,
        isCustom: true,
      };
      const clothingItems = meta.clothingIds
        .map((id: string) => allClothing.find(c => c.id === id))
        .filter(Boolean);
      
      return {
        id: meta.id,
        name: meta.name,
        doll,
        clothingItems,
        categories: meta.categories || [],
      };
    });
  } catch {
    return [];
  }
}

// プリセットフォルダから取り込み（新形式: doll-{id}/clothing/{category}/）
export async function importPresetFromFolder(
  files: FileList,
  onProgress?: ProgressCallback
): Promise<PresetImportResult> {
  const reportProgress = (progress: ImportProgress) => {
    if (onProgress) onProgress(progress);
  };

  reportProgress({ phase: 'parsing', current: 0, total: 1, message: 'ファイルを解析中...' });

  const result: PresetImportResult = {
    presets: { success: 0, failed: 0, items: [] },
    backgrounds: { success: 0, failed: 0, items: [] },
  };
  
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp'];
  
  // ファイルをプリセット別に分類
  const presetMap = new Map<string, {
    dolls: { name: string; file: File }[];
    clothing: Map<string, { name: string; file: File; thumbFile?: File }[]>;
    clothingThumbs: Map<string, File>; // サムネイル用マップ（ベース名 -> File）
  }>();
  const backgroundFiles: { name: string; file: File }[] = [];
  
  console.log('=== プリセット取り込み開始 ===');
  console.log(`ファイル数: ${files.length}`);
  
  // 全ファイルのパスをログ出力
  for (let i = 0; i < Math.min(files.length, 20); i++) {
    console.log(`[${i}] ${files[i].webkitRelativePath || files[i].name}`);
  }
  if (files.length > 20) {
    console.log(`... 他 ${files.length - 20} ファイル`);
  }
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    // 画像ファイルかチェック（拡張子で判定）
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isImage = imageExtensions.includes(ext);
    if (!isImage) {
      continue; // 非画像はスキップ（ログ出力しない）
    }
    
    // パスを取得（webkitRelativePathを優先）
    const fullPath = file.webkitRelativePath || file.name;
    const path = fullPath.replace(/\\/g, '/');
    const parts = path.split('/').filter(p => p.length > 0);
    const fileNameWithoutExt = file.name.replace(/\.[^.]+$/, '');
    
    // _サムネサフィックスをチェック（_サムネ, _thumb, _thumbnailに対応）
    const isThumb = fileNameWithoutExt.endsWith('_サムネ') ||
                    fileNameWithoutExt.toLowerCase().endsWith('_thumb') || 
                    fileNameWithoutExt.toLowerCase().endsWith('_thumbnail');
    const baseName = isThumb 
      ? fileNameWithoutExt.replace(/(_サムネ|_thumb|_thumbnail)$/i, '') 
      : fileNameWithoutExt;
    
    console.log(`処理中: ${path} (parts: ${parts.join(' > ')}, isThumb: ${isThumb})`);
    
    // 背景フォルダ（パス内にbackgroundsがあれば背景）
    const bgIndex = parts.findIndex(p => p.toLowerCase() === 'backgrounds');
    if (bgIndex !== -1) {
      if (!isThumb) {
        backgroundFiles.push({ name: baseName, file });
        console.log(`  → 背景として追加: ${baseName}`);
      }
      continue;
    }
    
    // doll-{id} フォルダを探す（どの階層でもOK）
    const dollFolderIndex = parts.findIndex(p => p.toLowerCase().startsWith('doll-'));
    if (dollFolderIndex === -1) {
      console.log(`  → スキップ（doll-フォルダなし）`);
      continue;
    }
    
    const dollFolderName = parts[dollFolderIndex];
    const presetId = dollFolderName.toLowerCase();
    
    if (!presetMap.has(presetId)) {
      presetMap.set(presetId, { dolls: [], clothing: new Map(), clothingThumbs: new Map() });
    }
    const preset = presetMap.get(presetId)!;
    
    // dollFolderIndex以降のパーツを解析
    const subParts = parts.slice(dollFolderIndex + 1);
    
    // dolls フォルダ内の画像
    const dollsIndex = subParts.findIndex(p => p.toLowerCase() === 'dolls');
    if (dollsIndex !== -1) {
      if (!isThumb) {
        preset.dolls.push({ name: baseName, file });
        console.log(`  → ドールとして追加: ${presetId} / ${baseName}`);
      }
      continue;
    }
    
    // clothing/{category} フォルダ内の画像
    const clothingIndex = subParts.findIndex(p => p.toLowerCase() === 'clothing');
    if (clothingIndex !== -1 && clothingIndex + 1 < subParts.length) {
      const category = subParts[clothingIndex + 1].toLowerCase();
      // カテゴリがファイル名でないことを確認
      if (category && !category.includes('.')) {
        if (isThumb) {
          // サムネイルの場合はthumbsマップに保存
          const thumbKey = `${category}/${baseName}`;
          preset.clothingThumbs.set(thumbKey, file);
          console.log(`  → サムネイルとして追加: ${presetId} / ${category} / ${baseName}_thumb`);
        } else {
          // 本体画像の場合
          if (!preset.clothing.has(category)) {
            preset.clothing.set(category, []);
          }
          preset.clothing.get(category)!.push({ name: baseName, file });
          console.log(`  → 服として追加: ${presetId} / ${category} / ${baseName}`);
        }
      }
    }
  }
  
  reportProgress({ phase: 'parsing', current: 1, total: 1, message: 'ファイル分類完了' });
  await yieldToMain();
  
  console.log(`背景ファイル: ${backgroundFiles.length}`);
  console.log(`プリセット数: ${presetMap.size}`);
  for (const [id, data] of presetMap) {
    console.log(`  ${id}: ドール${data.dolls.length}体, 服カテゴリ${data.clothing.size}種, サムネイル${data.clothingThumbs.size}枚`);
  }
  
  // 背景を取り込み
  const bgTotal = backgroundFiles.length;
  for (let i = 0; i < backgroundFiles.length; i++) {
    const { name, file } = backgroundFiles[i];
    reportProgress({ 
      phase: 'backgrounds', 
      current: i + 1, 
      total: bgTotal, 
      message: `背景を取り込み中... (${i + 1}/${bgTotal})` 
    });
    
    try {
      const base64 = await fileToBase64(file, file.name);
      const id = `custom-bg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveImageToStorage(id, base64);
      
      const bg: BackgroundData = { id, name, imageUrl: base64, isCustom: true };
      result.backgrounds.items.push(bg);
      result.backgrounds.success++;
    } catch (e) {
      console.error('Background import failed:', name, e);
      result.backgrounds.failed++;
    }
    
    // 5件ごとにUIスレッドを解放
    if ((i + 1) % 5 === 0) {
      await yieldToMain();
    }
  }
  
  // 全服の総数をカウント
  let totalClothingCount = 0;
  for (const [, data] of presetMap) {
    for (const [, items] of data.clothing) {
      totalClothingCount += items.length;
    }
  }
  let clothingProcessed = 0;
  
  // 各プリセットを取り込み
  const presetEntries = Array.from(presetMap.entries());
  for (let pi = 0; pi < presetEntries.length; pi++) {
    const [presetId, data] = presetEntries[pi];
    
    reportProgress({ 
      phase: 'dolls', 
      current: pi + 1, 
      total: presetEntries.length, 
      message: `ドール取り込み中... (${pi + 1}/${presetEntries.length})` 
    });
    
    try {
      // ドールがなければスキップ
      if (data.dolls.length === 0) {
        console.warn(`プリセット ${presetId} にドールがありません`);
        result.presets.failed++;
        continue;
      }
      
      // 最初のドールを使用
      const dollFile = data.dolls[0];
      // 右下ウォーターマーク除去＋クロマキー処理
      const dollBase64 = await fileToBase64WithProcessing(dollFile.file, dollFile.file.name);
      const dollId = `custom-doll-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveImageToStorage(dollId, dollBase64);
      
      const doll = createDollData(dollId, dollFile.name, dollBase64);
      
      // 服を取り込み
      const clothingItems: ClothingItemData[] = [];
      const categories: CategoryInfo[] = [];
      
      for (const [categoryRaw, clothingFiles] of data.clothing) {
        // _movable サフィックスを除去したカテゴリ名を使用
        const categoryClean = categoryRaw.replace(/_movable/gi, '').toLowerCase();
        categories.push(getCategoryInfo(categoryRaw));
        
        for (const { name, file } of clothingFiles) {
          clothingProcessed++;
          reportProgress({ 
            phase: 'clothing', 
            current: clothingProcessed, 
            total: totalClothingCount, 
            message: `服を取り込み中... (${clothingProcessed}/${totalClothingCount})` 
          });
          
          // 右下ウォーターマーク除去＋クロマキー処理
          const base64 = await fileToBase64WithProcessing(file, file.name);
          const id = `custom-clothing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await saveImageToStorage(id, base64);
          
          // サムネイルがあれば読み込み（サムネイルはウォーターマークカット不要）
          const thumbKey = `${categoryRaw}/${name}`;
          const thumbFile = data.clothingThumbs.get(thumbKey);
          let thumbnailUrl: string | undefined;
          if (thumbFile) {
            thumbnailUrl = await fileToBase64(thumbFile, thumbFile.name);
            const thumbId = `${id}-thumb`;
            await saveImageToStorage(thumbId, thumbnailUrl);
            console.log(`  サムネイル読み込み: ${thumbKey}`);
          }
          
          const item = createClothingData(id, name, categoryClean, base64, categoryRaw);
          // サムネイルURLを追加
          if (thumbnailUrl) {
            item.thumbnailUrl = thumbnailUrl;
          }
          // ドールIDを関連付け
          item.dollId = dollId;
          clothingItems.push(item);
          
          // 3件ごとにUIスレッドを解放
          if (clothingProcessed % 3 === 0) {
            await yieldToMain();
          }
        }
      }
      
      const preset: DollPreset = {
        id: presetId,
        name: dollFile.name,
        doll,
        clothingItems,
        categories,
      };
      
      result.presets.items.push(preset);
      result.presets.success++;
      
    } catch (e) {
      console.error(`Preset ${presetId} import failed:`, e);
      result.presets.failed++;
    }
    
    await yieldToMain();
  }
  
  reportProgress({ phase: 'saving', current: 0, total: 1, message: 'データを保存中...' });
  await yieldToMain();
  
  // すべてのドールと服を一括保存（全上書き）
  const allDolls = result.presets.items.map(p => p.doll);
  const allClothing = result.presets.items.flatMap(p => p.clothingItems);
  
  if (allDolls.length > 0) {
    saveCustomDolls(allDolls);
  }
  if (allClothing.length > 0) {
    saveCustomClothing(allClothing);
  }
  
  // 背景を保存（全上書き）
  if (result.backgrounds.items.length > 0) {
    saveCustomBackgrounds(result.backgrounds.items);
  }
  
  // プリセットを保存（全上書き）
  if (result.presets.items.length > 0) {
    saveDollPresets(result.presets.items);
  }
  
  reportProgress({ phase: 'complete', current: 1, total: 1, message: '取り込み完了！' });
  
  return result;
}

// ZIPからプリセット取り込み（進捗コールバック対応）
export async function importPresetFromZip(
  zipFile: File,
  onProgress?: ProgressCallback
): Promise<PresetImportResult> {
  const reportProgress = (progress: ImportProgress) => {
    if (onProgress) onProgress(progress);
  };

  reportProgress({ phase: 'parsing', current: 0, total: 1, message: 'ZIPファイルを解析中...' });

  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(zipFile);
  
  const result: PresetImportResult = {
    presets: { success: 0, failed: 0, items: [] },
    backgrounds: { success: 0, failed: 0, items: [] },
  };
  
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];
  
  // ファイルをプリセット別に分類
  const presetMap = new Map<string, {
    dolls: { name: string; blob: Blob; fileNameWithExt: string }[];
    clothing: Map<string, { name: string; blob: Blob; fileNameWithExt: string }[]>;
    clothingThumbs: Map<string, { blob: Blob; fileNameWithExt: string }>; // サムネイル用マップ
  }>();
  const backgroundFiles: { name: string; blob: Blob; fileNameWithExt: string }[] = [];
  
  console.log('=== ZIP取り込み開始 ===');
  console.log(`ZIP内ファイル数: ${Object.keys(zip.files).length}`);
  
  for (const [path, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    const lowerPath = path.toLowerCase();
    if (!imageExtensions.some(ext => lowerPath.endsWith(ext))) continue;
    
    // パスをパース（最後の要素はファイル名）
    const pathParts = path.replace(/\\/g, '/').split('/').filter(p => p.length > 0);
    const fileNameWithExt = pathParts.pop() || '';
    const fileNameWithoutExt = fileNameWithExt.replace(/\.[^.]+$/, '');
    const parts = pathParts; // ディレクトリ部分のみ
    
    // _サムネサフィックスをチェック（_サムネ, _thumb, _thumbnailに対応）
    const isThumb = fileNameWithoutExt.endsWith('_サムネ') ||
                    fileNameWithoutExt.toLowerCase().endsWith('_thumb') ||
                    fileNameWithoutExt.toLowerCase().endsWith('_thumbnail');
    const baseName = isThumb 
      ? fileNameWithoutExt.replace(/(_サムネ|_thumb|_thumbnail)$/i, '') 
      : fileNameWithoutExt;
    
    console.log(`処理中: ${path} (dirs: ${parts.join(' > ')}, isThumb: ${isThumb})`);
    
    const blob = await file.async('blob');
    
    // 背景フォルダ
    const bgIndex = parts.findIndex(p => p.toLowerCase() === 'backgrounds');
    if (bgIndex !== -1) {
      if (!isThumb) {
        backgroundFiles.push({ name: baseName, blob, fileNameWithExt });
        console.log(`  → 背景として追加: ${baseName}`);
      }
      continue;
    }
    
    // doll-{id} フォルダを探す
    const dollFolderIndex = parts.findIndex(p => p.toLowerCase().startsWith('doll-'));
    if (dollFolderIndex === -1) {
      console.log(`  → スキップ（doll-フォルダなし）`);
      continue;
    }
    
    const presetId = parts[dollFolderIndex].toLowerCase();
    
    if (!presetMap.has(presetId)) {
      presetMap.set(presetId, { dolls: [], clothing: new Map(), clothingThumbs: new Map() });
    }
    const preset = presetMap.get(presetId)!;
    
    // dollFolderIndex以降のパーツを解析
    const subParts = parts.slice(dollFolderIndex + 1);
    
    // dolls フォルダ内
    const dollsIndex = subParts.findIndex(p => p.toLowerCase() === 'dolls');
    if (dollsIndex !== -1) {
      if (!isThumb) {
        preset.dolls.push({ name: baseName, blob, fileNameWithExt });
        console.log(`  → ドールとして追加: ${presetId} / ${baseName}`);
      }
      continue;
    }
    
    // clothing/{category} フォルダ内
    const clothingIndex = subParts.findIndex(p => p.toLowerCase() === 'clothing');
    if (clothingIndex !== -1 && clothingIndex + 1 < subParts.length) {
      const category = subParts[clothingIndex + 1].toLowerCase();
      if (isThumb) {
        // サムネイルの場合はthumbsマップに保存
        const thumbKey = `${category}/${baseName}`;
        preset.clothingThumbs.set(thumbKey, { blob, fileNameWithExt });
        console.log(`  → サムネイルとして追加: ${presetId} / ${category} / ${baseName}_thumb`);
      } else {
        if (!preset.clothing.has(category)) {
          preset.clothing.set(category, []);
        }
        preset.clothing.get(category)!.push({ name: baseName, blob, fileNameWithExt });
        console.log(`  → 服として追加: ${presetId} / ${category} / ${baseName}`);
      }
    }
  }
  
  reportProgress({ phase: 'parsing', current: 1, total: 1, message: 'ファイル分類完了' });
  await yieldToMain();
  
  console.log(`背景ファイル: ${backgroundFiles.length}`);
  console.log(`プリセット数: ${presetMap.size}`);
  for (const [id, data] of presetMap) {
    console.log(`  ${id}: ドール${data.dolls.length}体, 服カテゴリ${data.clothing.size}種, サムネイル${data.clothingThumbs.size}枚`);
  }
  
  // 背景を取り込み
  const bgTotal = backgroundFiles.length;
  for (let i = 0; i < backgroundFiles.length; i++) {
    const { name, blob, fileNameWithExt } = backgroundFiles[i];
    reportProgress({ 
      phase: 'backgrounds', 
      current: i + 1, 
      total: bgTotal, 
      message: `背景を取り込み中... (${i + 1}/${bgTotal})` 
    });
    
    try {
      const base64 = await blobToBase64(blob, fileNameWithExt);
      const id = `custom-bg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveImageToStorage(id, base64);
      
      const bg: BackgroundData = { id, name, imageUrl: base64, isCustom: true };
      result.backgrounds.items.push(bg);
      result.backgrounds.success++;
    } catch (e) {
      console.error('Background import failed:', name, e);
      result.backgrounds.failed++;
    }
    
    // 5件ごとにUIスレッドを解放
    if ((i + 1) % 5 === 0) {
      await yieldToMain();
    }
  }
  
  // 全服の総数をカウント
  let totalClothingCount = 0;
  for (const [, data] of presetMap) {
    for (const [, items] of data.clothing) {
      totalClothingCount += items.length;
    }
  }
  let clothingProcessed = 0;
  
  // 各プリセットを取り込み
  const presetEntries = Array.from(presetMap.entries());
  for (let pi = 0; pi < presetEntries.length; pi++) {
    const [presetId, data] = presetEntries[pi];
    
    reportProgress({ 
      phase: 'dolls', 
      current: pi + 1, 
      total: presetEntries.length, 
      message: `ドール取り込み中... (${pi + 1}/${presetEntries.length})` 
    });
    
    try {
      if (data.dolls.length === 0) {
        console.warn(`プリセット ${presetId} にドールがありません`);
        result.presets.failed++;
        continue;
      }
      
      const dollFile = data.dolls[0];
      const dollBase64 = await blobToBase64(dollFile.blob, dollFile.fileNameWithExt);
      const dollId = `custom-doll-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await saveImageToStorage(dollId, dollBase64);
      
      const doll = createDollData(dollId, dollFile.name, dollBase64);
      
      const clothingItems: ClothingItemData[] = [];
      const categories: CategoryInfo[] = [];
      
      for (const [categoryRaw, clothingFiles] of data.clothing) {
        // _movable サフィックスを除去したカテゴリ名を使用
        const categoryClean = categoryRaw.replace(/_movable/gi, '').toLowerCase();
        categories.push(getCategoryInfo(categoryRaw));
        
        for (const { name, blob, fileNameWithExt: clothingFileExt } of clothingFiles) {
          clothingProcessed++;
          reportProgress({ 
            phase: 'clothing', 
            current: clothingProcessed, 
            total: totalClothingCount, 
            message: `服を取り込み中... (${clothingProcessed}/${totalClothingCount})` 
          });
          
          const base64 = await blobToBase64(blob, clothingFileExt);
          const id = `custom-clothing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          await saveImageToStorage(id, base64);
          
          // サムネイルがあれば読み込み
          const thumbKey = `${categoryRaw}/${name}`;
          const thumbData = data.clothingThumbs.get(thumbKey);
          let thumbnailUrl: string | undefined;
          if (thumbData) {
            thumbnailUrl = await blobToBase64(thumbData.blob, thumbData.fileNameWithExt);
            const thumbId = `${id}-thumb`;
            await saveImageToStorage(thumbId, thumbnailUrl);
            console.log(`  サムネイル読み込み: ${thumbKey}`);
          }
          
          const item = createClothingData(id, name, categoryClean, base64, categoryRaw);
          // サムネイルURLを追加
          if (thumbnailUrl) {
            item.thumbnailUrl = thumbnailUrl;
          }
          // ドールIDを関連付け
          item.dollId = dollId;
          clothingItems.push(item);
          
          // 3件ごとにUIスレッドを解放
          if (clothingProcessed % 3 === 0) {
            await yieldToMain();
          }
        }
      }
      
      const preset: DollPreset = {
        id: presetId,
        name: dollFile.name,
        doll,
        clothingItems,
        categories,
      };
      
      result.presets.items.push(preset);
      result.presets.success++;
      
    } catch (e) {
      console.error(`Preset ${presetId} import failed:`, e);
      result.presets.failed++;
    }
    
    await yieldToMain();
  }
  
  reportProgress({ phase: 'saving', current: 0, total: 1, message: 'データを保存中...' });
  await yieldToMain();
  
  // すべてのドールと服を一括保存（全上書き）
  const allDolls = result.presets.items.map(p => p.doll);
  const allClothing = result.presets.items.flatMap(p => p.clothingItems);
  
  if (allDolls.length > 0) {
    saveCustomDolls(allDolls);
  }
  if (allClothing.length > 0) {
    saveCustomClothing(allClothing);
  }
  
  // 背景を保存（全上書き）
  if (result.backgrounds.items.length > 0) {
    saveCustomBackgrounds(result.backgrounds.items);
  }
  
  // プリセットを保存（全上書き）
  if (result.presets.items.length > 0) {
    saveDollPresets(result.presets.items);
  }
  
  reportProgress({ phase: 'complete', current: 1, total: 1, message: '取り込み完了！' });
  
  return result;
}
