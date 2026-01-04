/**
 * Firebase設定
 * 画像などのアセットをFirebase Storageでホスト
 */
import { initializeApp } from 'firebase/app';
import { getStorage, ref, getDownloadURL, listAll } from 'firebase/storage';

// Firebase設定
const firebaseConfig = {
  apiKey: "AIzaSyC3FAMp6_omagcoAzopF94rr6-ZFa6DWK8",
  authDomain: "bboardgames-a5488.firebaseapp.com",
  databaseURL: "https://bboardgames-a5488-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "bboardgames-a5488",
  storageBucket: "bboardgames-a5488.firebasestorage.app",
  messagingSenderId: "56436701144",
  appId: "1:56436701144:web:a75c171872253d1bb5a4ad"
};

// Firebase初期化
const app = initializeApp(firebaseConfig);
const storage = getStorage(app);

/**
 * Firebase StorageからファイルのダウンロードURLを取得
 * @param path Storage内のパス (例: 'dolls/doll-base.png')
 */
export async function getStorageUrl(path: string): Promise<string> {
  try {
    const storageRef = ref(storage, path);
    const url = await getDownloadURL(storageRef);
    return url;
  } catch (error) {
    console.error(`Firebase Storage URLの取得に失敗: ${path}`, error);
    throw error;
  }
}

/**
 * 指定フォルダ内のファイル一覧を取得
 * @param folderPath Storage内のフォルダパス (例: 'backgrounds')
 */
export async function listStorageFiles(folderPath: string): Promise<string[]> {
  try {
    const folderRef = ref(storage, folderPath);
    const result = await listAll(folderRef);
    const urls = await Promise.all(
      result.items.map(item => getDownloadURL(item))
    );
    return urls;
  } catch (error) {
    console.error(`フォルダ一覧の取得に失敗: ${folderPath}`, error);
    return [];
  }
}

/**
 * ドール画像のURLを取得
 * @param dollId ドールID (例: 'doll-base', 'doll-base-2')
 */
export async function getDollImageUrl(dollId: string): Promise<string> {
  return getStorageUrl(`dolls/${dollId}.png`);
}

/**
 * 服アイテム画像のURLを取得
 * @param itemId アイテムID (例: 'top-1', 'bottom-1')
 */
export async function getClothingImageUrl(itemId: string): Promise<string> {
  return getStorageUrl(`clothing/${itemId}.png`);
}

/**
 * 背景画像のURLを取得
 * @param backgroundId 背景ID (例: 'bg-room', 'bg-park')
 */
export async function getBackgroundImageUrl(backgroundId: string): Promise<string> {
  return getStorageUrl(`backgrounds/${backgroundId}.png`);
}

/**
 * 利用可能な背景一覧を取得
 */
export async function getAvailableBackgrounds(): Promise<string[]> {
  return listStorageFiles('backgrounds');
}

export { storage };
