/**
 * 自分の服（端末の控え）を、Stage に重ねる絵の並びにする
 */
import { useEffect, useMemo, useState } from 'react';
import type { MyItem } from './backend';
import type { StageLayer } from './Stage';

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('絵を読めませんでした'));
    reader.readAsDataURL(blob.type ? blob : blob.slice(0, blob.size, 'image/png'));
  });
}

/**
 * 自分の服を、重ねる絵の並びにする（うしろがみ → くつの中の肌 → 服）。hues: 服の ID → 色（無ければ、その服の既定の色）。
 * items の順に重ねる（あとの服ほど手前）。絵が欠けている服は、飛ばす。
 */
export function useItemLayers(items: MyItem[], hues: Record<string, number> = {}): StageLayer[] {
  const [urls, setUrls] = useState<Record<string, string>>({});
  // 絵そのものが替わったときだけ、読み直す
  const wanted = useMemo(() => items.flatMap((item) => [item.item.image, item.item.back, item.item.under].flatMap((image) => (image && item.files[image.file] instanceof Blob ? [{ key: `${item.id}\n${image.file}`, blob: item.files[image.file] }] : []))), [items]);
  const signature = wanted.map((w) => `${w.key}\n${w.blob.size}`).join('\n\n');
  useEffect(() => {
    let alive = true;
    void Promise.all(wanted.map(async (w) => [w.key, await readDataUrl(w.blob).catch(() => '')] as const)).then((pairs) => {
      if (alive) setUrls(Object.fromEntries(pairs.filter(([, url]) => url)));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- wanted は signature が同じなら同じ中身
  }, [signature]);
  return useMemo(() => {
    const layers: StageLayer[] = [];
    for (const item of items) {
      const hue = hues[item.id] ?? item.hue ?? 0;
      const add = (image: MyItem['item']['image'] | undefined, part: string, extra: Partial<StageLayer>) => {
        const url = image ? urls[`${item.id}\n${image.file}`] : undefined;
        if (image && url) layers.push({ key: `${item.id}:${part}`, url, canvasW: image.canvasW, canvasH: image.canvasH, box: image.box, ...extra });
      };
      add(item.item.back, 'back', { behind: true, hue });
      add(item.item.under, 'under', {}); // くつの中の肌は、色を変えない
      add(item.item.image, 'image', { hue });
    }
    return layers;
  }, [items, hues, urls]);
}
