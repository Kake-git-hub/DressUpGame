/**
 * 先読み: 現在のドールの素材をまとめて取りに行き、サービスワーカーのキャッシュに入れる。
 * 一度開けば、オフラインでも（まだ着ていない服も含めて）遊べるようにするため。
 */
import type { BackgroundData, ClothingItemData, DollData } from '../types';

// 先読みする URL の一覧。メニューに出るサムネイルを先に、大きな画像を後にする
export function contentUrlsForDoll(
  baseUrl: string,
  doll: DollData,
  clothing: ClothingItemData[],
  backgrounds: BackgroundData[]
): string[] {
  const items = clothing.filter((item) => !item.dollId || item.dollId === doll.id);
  const bgs = backgrounds.filter((bg) => !bg.dollId || bg.dollId === doll.id);
  const thumbs = [...items.map((i) => i.thumbnailUrl), ...bgs.map((b) => b.thumbnailUrl)];
  return [
    // 一覧ファイルもキャッシュに入れる（初回はサービスワーカーの準備前に読まれているため）
    new URL('manifest.json', baseUrl).href,
    doll.bodyImageUrl,
    ...thumbs.filter((u): u is string => !!u),
    ...items.map((i) => i.imageUrl),
    ...bgs.map((b) => b.imageUrl),
  ];
}

export async function prefetchUrls(
  urls: string[],
  options: { concurrency?: number; fetchImpl?: typeof fetch } = {}
): Promise<{ ok: number; failed: number }> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const queue = [...new Set(urls)];
  let ok = 0;
  let failed = 0;
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        const response = await fetchImpl(url);
        if (response.ok) ok++;
        else failed++;
      } catch {
        failed++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.concurrency ?? 4, queue.length) }, worker));
  return { ok, failed };
}
