/**
 * 端末の中の「自分の服」
 *
 * アプリのスタジオで作った服（と、作者に届けてもらった服）の控えを、IndexedDB に持つ。
 * ゲームを開くときは、サーバーに聞かずに、この控えを公開の素材に重ねて出す（オフラインでも着られる）。
 * データベースの名前は、旧方式の片付け（legacyCleanup.ts）が消す `DressUpAssets` とは別にする。
 */
import { itemToClothing } from '../content/loadContent';
import type { LoadedContent } from '../content/loadContent';
import type { ManifestImage } from '../content/manifest';
import type { MyItem } from './backend';

const DATABASE = 'dressup-library';
const STORE = 'items';

export interface Library {
  all(): Promise<MyItem[]>; // 作った順
  put(item: MyItem): Promise<void>;
  remove(id: string): Promise<void>;
  replaceAll(items: MyItem[]): Promise<void>; // サーバーと合わせるとき: 中身を丸ごと入れ替える
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

// IndexedDB が使えない端末（プライベートブラウズなど）では、空として動く（落ちない）
export function openLibrary(factory: IDBFactory | null = globalThis.indexedDB ?? null): Library {
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => {
    opened ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (!factory) return resolve(null);
        const request = factory.open(DATABASE, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return opened;
  };
  const write = async (work: (store: IDBObjectStore) => void): Promise<void> => {
    const db = await open();
    if (!db) return;
    try {
      const tx = db.transaction(STORE, 'readwrite');
      work(tx.objectStore(STORE));
      await done(tx);
    } catch (error) {
      console.error('自分の服を保存できませんでした:', error);
    }
  };
  return {
    async all() {
      const db = await open();
      if (!db) return [];
      try {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).getAll();
        await done(tx);
        return (request.result as MyItem[]).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      } catch (error) {
        console.error('自分の服を読めませんでした:', error);
        return [];
      }
    },
    put: (item) => write((store) => void store.put(item)),
    remove: (id) => write((store) => void store.delete(id)),
    replaceAll: (items) =>
      write((store) => {
        store.clear();
        for (const item of items) store.put(item);
      }),
  };
}

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('絵を読めませんでした'));
    reader.readAsDataURL(blob);
  });
}

/**
 * 自分の服を、公開の素材に重ねる。そのドール・カテゴリの服として、公開の服のあとに並ぶ。
 * 絵は data: の URL にする（描画の部品が、そのまま読める）。
 * 公開の素材に無いドール・カテゴリの服、絵が欠けている服は、足さない（控えからは消さない）。
 */
export async function mergeMyItems(content: LoadedContent, items: MyItem[]): Promise<LoadedContent> {
  if (items.length === 0) return content;
  const clothing = [...content.clothing];
  for (const mine of items) {
    const category = content.categories?.[mine.dollId]?.find((c) => c.id === mine.item.category);
    if (!category || !content.dolls.some((d) => d.id === mine.dollId)) continue;
    // 使う絵を、全部 data: の URL にする
    const images: (ManifestImage | undefined)[] = [mine.item.image, mine.item.hide, mine.item.back, mine.item.under];
    const names = [...images.flatMap((i) => (i ? [i.file] : [])), mine.item.thumb, ...(mine.item.backThumb ? [mine.item.backThumb] : [])];
    if (names.some((name) => !(mine.files[name] instanceof Blob))) continue;
    try {
      const urls = new Map<string, string>();
      for (const name of new Set(names)) urls.set(name, await toDataUrl(mine.files[name]));
      const converted = itemToClothing(mine.dollId, category, mine.item, (file) => urls.get(file) ?? '', mine.set);
      clothing.push(...converted.map((c) => ({ ...c, mine: true })));
    } catch (error) {
      console.error('自分の服を読めませんでした:', error);
    }
  }
  return { ...content, clothing };
}
