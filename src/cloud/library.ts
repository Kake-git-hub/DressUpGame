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
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

const UNAVAILABLE = 'この端末では、服を保存できません（端末の保存領域が使えません）';

// IndexedDB が使えない端末（プライベートブラウズなど）では、読むと空（落ちない）。書くと、保存できなかったことを知らせる。
// openTimeoutMs: 開くのに返事が無いとき、これだけ待ったら「使えない」として進む（ゲームの起動を止めない）
export function openLibrary(factory: IDBFactory | null = globalThis.indexedDB ?? null, openTimeoutMs = 1500): Library {
  let opened: Promise<IDBDatabase | null> | null = null;
  const open = (): Promise<IDBDatabase | null> => {
    opened ??= new Promise<IDBDatabase | null>((resolve) => {
      try {
        if (!factory) return resolve(null);
        setTimeout(() => resolve(null), openTimeoutMs);
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
  // 書き込みは、失敗したら Error（黙って失わない。画面が知らせる）
  const write = async (work: (store: IDBObjectStore) => void): Promise<void> => {
    const db = await open();
    if (!db) throw new Error(UNAVAILABLE);
    try {
      const tx = db.transaction(STORE, 'readwrite');
      work(tx.objectStore(STORE));
      await done(tx);
    } catch (error) {
      console.error('自分の服を保存できませんでした:', error);
      throw new Error('この端末に、服を保存できませんでした（空きが足りないかもしれません）');
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
  };
}

function toDataUrl(source: Blob): Promise<string> {
  // 種類の分からない絵は、PNG として読めるようにする（描画の部品は、data: の種類で絵かどうかを見分ける）
  const blob = source.type ? source : source.slice(0, source.size, 'image/png');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('絵を読めませんでした'));
    reader.readAsDataURL(blob);
  });
}

// data: に直した絵の覚え（服の ID・絵の名前・大きさ → URL）。服が増えた・減ったときに重ね直しても、同じ絵を読み直さない
const dataUrls = new Map<string, string>();

/**
 * 自分の服を、公開の素材に重ねる。そのドール・カテゴリの服として、公開の服のあとに並ぶ。
 * 絵は data: の URL にする（描画の部品が、そのまま読める）。
 * 公開の素材に無いドール・カテゴリの服、絵が欠けている服は、足さない（控えからは消さない）。
 */
export async function mergeMyItems(content: LoadedContent, items: MyItem[]): Promise<LoadedContent> {
  if (items.length === 0) {
    dataUrls.clear();
    return content;
  }
  const clothing = [...content.clothing];
  const used = new Set<string>();
  for (const mine of items) {
    // 控えが 1 件壊れていても（中身が欠けているなど）、ほかの服は出す
    try {
      const category = content.categories?.[mine.dollId]?.find((c) => c.id === mine.item.category);
      if (!category || !content.dolls.some((d) => d.id === mine.dollId)) continue;
      // 使う絵を、全部 data: の URL にする
      const images: (ManifestImage | undefined)[] = [mine.item.image, mine.item.hide, mine.item.back, mine.item.under];
      const names = [...images.flatMap((i) => (i ? [i.file] : [])), mine.item.thumb, ...(mine.item.backThumb ? [mine.item.backThumb] : [])];
      if (names.some((name) => !(mine.files[name] instanceof Blob))) continue;
      const urls = new Map<string, string>();
      for (const name of new Set(names)) {
        const file = mine.files[name];
        const key = `${mine.id}\n${name}\n${file.size}`;
        const url = dataUrls.get(key) ?? (await toDataUrl(file));
        dataUrls.set(key, url);
        used.add(key);
        urls.set(name, url);
      }
      const converted = itemToClothing(mine.dollId, category, mine.item, (file) => urls.get(file) ?? '', mine.set);
      clothing.push(...converted.map((c) => ({ ...c, mine: true })));
    } catch (error) {
      console.error('自分の服を読めませんでした:', error);
    }
  }
  // 消えた服の分は、忘れる
  for (const key of [...dataUrls.keys()]) if (!used.has(key)) dataUrls.delete(key);
  return { ...content, clothing };
}
