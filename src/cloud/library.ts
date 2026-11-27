/**
 * 端末の中の「自分の服」
 *
 * アプリのスタジオで作った服（と、作者に届けてもらった服）の控えを、IndexedDB に持つ。
 * ゲームを開くときは、サーバーに聞かずに、この控えを公開の素材に重ねて出す（オフラインでも着られる）。
 * 自分の服は、公開の服より先に並ぶ。
 * データベースの名前は、旧方式の片付け（legacyCleanup.ts）が消す `DressUpAssets` とは別にする。
 */
import { isPlainFit } from '../engine/fit';
import { itemToClothing } from '../content/loadContent';
import type { LoadedContent } from '../content/loadContent';
import type { ManifestImage } from '../content/manifest';
import { isDarkImage, recolor } from '../pipeline/recolor';
import type { BackgroundData, ClothingItemData } from '../types';
import { byClosetOrder, isBackgroundItem } from './backend';
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

// 前の版の控え（色・並び順を持たない服）は、もとの色・作った順として読む
const withDefaults = (item: MyItem): MyItem => ({ ...item, hue: item.hue ?? 0, order: item.order ?? item.createdAt, updatedAt: item.updatedAt ?? item.createdAt, notes: item.notes ?? [] });

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
        return (request.result as MyItem[]).map(withDefaults).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
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

// 既定の色を付けたサムネイルを作る。thumb: サムネイル（data: の URL）、pictures: その服の絵（前髪とうしろがみなど。黒っぽい絵かどうかを見る）
export type TintThumb = (input: { thumb: string; hue: number; pictures: string[] }) => Promise<string>;

function loadPixels(url: string, maxSide = 256): Promise<{ canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; data: ImageData }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const k = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight, 1));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * k));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * k));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return reject(new Error('絵を読めませんでした'));
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({ canvas, ctx, data: ctx.getImageData(0, 0, canvas.width, canvas.height) });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    image.onerror = () => reject(new Error('絵を読めませんでした'));
    image.src = url;
  });
}
// ゲームの色変え（pipeline/recolor.ts）と同じ色にする。黒っぽい絵（黒髪など）は、色相を回す代わりに、黒い所に色を付ける。
// 前髪とうしろがみは、どちらかが黒っぽければ、両方とも黒っぽい絵として扱う（ゲームと同じ）
const tintWithCanvas: TintThumb = async ({ thumb, hue, pictures }) => {
  let dark = false;
  for (const picture of pictures) {
    if ((dark = isDarkImage((await loadPixels(picture)).data.data))) break;
  }
  const { canvas, ctx, data } = await loadPixels(thumb, 512);
  const output = ctx.createImageData(data.width, data.height);
  recolor(data.data, output.data, hue, dark);
  ctx.putImageData(output, 0, 0);
  return canvas.toDataURL('image/png');
};

/**
 * 自分の服を、公開の素材に重ねる。そのドール・カテゴリの服として、**公開の服の前**に、クローゼットの順番で並ぶ。
 * 絵は data: の URL にする（描画の部品が、そのまま読める）。
 * 既定の色（hue）のある服は、着せたときの色（colorHue）と戻す先（defaultHue）を持ち、サムネイルは色を付けた絵にする。
 * 自分のセットは、公開のセットより先に並ぶ（負の order。新しいセットほど先）。
 * 公開の素材に無いドール・カテゴリの服、絵が欠けている服は、足さない（控えからは消さない）。
 * 自分の背景（カテゴリが、背景の印）は、そのドールの背景として、**公開の背景の前**に並ぶ（同じく、クローゼットの順番）。
 */
export async function mergeMyItems(content: LoadedContent, items: MyItem[], tint: TintThumb = tintWithCanvas): Promise<LoadedContent> {
  if (items.length === 0) {
    dataUrls.clear();
    return content;
  }
  // セットの順番: そのセットの服のうち、いちばん古い服の時刻（新しいセットほど、小さい値 = 先）
  const setStart = new Map<string, number>();
  for (const mine of items) {
    if (!mine?.set || typeof mine.createdAt !== 'number') continue;
    setStart.set(mine.set.id, Math.min(setStart.get(mine.set.id) ?? Infinity, mine.createdAt));
  }
  const ordered = [...items].sort((a, b) => {
    try {
      return byClosetOrder({ order: a.order ?? a.createdAt, createdAt: a.createdAt, id: a.id }, { order: b.order ?? b.createdAt, createdAt: b.createdAt, id: b.id });
    } catch {
      return 0;
    }
  });
  const clothing: ClothingItemData[] = [];
  const backgrounds: BackgroundData[] = [];
  const used = new Set<string>();
  for (const mine of ordered) {
    // 控えが 1 件壊れていても（中身が欠けているなど）、ほかの服は出す
    try {
      if (isBackgroundItem(mine)) {
        // 自分の背景: そのドールがゲームに出ていて、絵がそろっているときだけ
        const names = [mine.item.image.file, mine.item.thumb];
        if (!content.dolls.some((d) => d.id === mine.dollId) || names.some((name) => !(mine.files[name] instanceof Blob))) continue;
        const [imageUrl, thumbnailUrl] = await Promise.all(
          names.map(async (name) => {
            const key = `${mine.id}\n${name}\n${mine.files[name].size}`;
            const url = dataUrls.get(key) ?? (await toDataUrl(mine.files[name]));
            dataUrls.set(key, url);
            used.add(key);
            return url;
          }),
        );
        backgrounds.push({ id: mine.id, name: mine.item.name, imageUrl, thumbnailUrl, dollId: mine.dollId, isCustom: true });
        continue;
      }
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
      const sets = mine.set ? [{ ...mine.set, order: -(setStart.get(mine.set.id) ?? mine.createdAt) }] : undefined;
      const converted = itemToClothing(mine.dollId, category, mine.item, (file) => urls.get(file) ?? '', sets);
      const hue = typeof mine.hue === 'number' && Number.isFinite(mine.hue) ? mine.hue : 0;
      let tinted: string | null = null;
      if (hue !== 0) {
        // 色を付けたサムネイル（作れなければ、もとの絵のまま出す）
        const key = `${mine.id}\n${mine.item.thumb}\n${mine.files[mine.item.thumb].size}\nhue:${hue}`;
        tinted = dataUrls.get(key) ?? null;
        if (tinted === null) {
          try {
            const pictures = [mine.item.image.file, ...(mine.item.back ? [mine.item.back.file] : [])].map((file) => urls.get(file) ?? '');
            tinted = await tint({ thumb: urls.get(mine.item.thumb) ?? '', hue, pictures });
          } catch (error) {
            console.error('色を付けたサムネイルを作れませんでした:', error);
          }
        }
        if (tinted !== null) {
          dataUrls.set(key, tinted);
          used.add(key);
        }
      }
      clothing.push(
        ...converted.map((c) => ({
          ...c,
          mine: true,
          ...(hue !== 0 ? { colorHue: hue, defaultHue: hue } : {}),
          // はじめの位置（前髪・うしろがみの両方。位置・大きさ・向きは、対でそろえる）
          ...(mine.fit && !isPlainFit(mine.fit) ? { defaultFit: mine.fit } : {}),
          // 色を付けるのは、メニューに出る絵（前髪・服）だけ。うしろがみは、メニューに出ない
          ...(tinted !== null && c.id === mine.item.id ? { thumbnailUrl: tinted } : {}),
        })),
      );
    } catch (error) {
      console.error('自分の服を読めませんでした:', error);
    }
  }
  // 消えた服の分は、忘れる
  for (const key of [...dataUrls.keys()]) if (!used.has(key)) dataUrls.delete(key);
  return { ...content, clothing: [...clothing, ...content.clothing], backgrounds: [...backgrounds, ...content.backgrounds] };
}
