/**
 * 配信された素材（一覧ファイル）を取得して、アプリの型に変換する
 */
import type { BackgroundData, ClothingItemData, DollData } from '../types';
import { itemSetIds, parseManifest } from './manifest';
import type { ManifestBackground, ManifestCategory, ManifestItem } from './manifest';

export const DEFAULT_CONTENT_URL = 'https://kake-git-hub.github.io/DressUpGame-content/';

// 素材の置き場所を決める。
// ?content=<相対パス> があれば、ページと同じオリジン内の相対パスとして使う（テスト・制作中の確認用）。
// 外部のサイトを指す値は無視する。
export function resolveContentUrl(search: string, pageUrl: string): string {
  const value = new URLSearchParams(search).get('content');
  if (!value) return DEFAULT_CONTENT_URL;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || /^[/\\]{2}/.test(value) || /^\/\\/.test(value)) return DEFAULT_CONTENT_URL;
  try {
    const resolved = new URL(value.endsWith('/') ? value : `${value}/`, pageUrl);
    if (resolved.origin !== new URL(pageUrl).origin) return DEFAULT_CONTENT_URL;
    return resolved.href;
  } catch {
    return DEFAULT_CONTENT_URL;
  }
}

// 「後ろに描く分（back）」のある髪は、前髪と、うしろがみの 2 点（2 枚の絵）に分けて読み込む。
// メニューに出るのは髪の 1 点だけ。うしろがみは髪と一緒に付き、位置・大きさ・向き・色は前髪とそろえる。
// 重なりの順番だけは、1 枚ずつ変えられる
export const BACK_HAIR_TYPE = 'うしろがみ';
// ドールのすぐ後ろ
const BACK_HAIR_LAYER = -1;
export const backItemId = (frontId: string): string => `${frontId}#back`;

export interface LoadedContent {
  dolls: DollData[];
  clothing: ClothingItemData[];
  backgrounds: BackgroundData[];
  // ドールごとのカテゴリ（自分の服を、あとから重ねるときに使う）
  categories?: Record<string, ManifestCategory[]>;
}

/**
 * 一覧の服 1 点を、アプリの服に変える。「後ろに描く分（back）」のある髪は、前髪とうしろがみの 2 点になる。
 * url: 一覧の中の絵の名前 → 読める URL。sets: 入っているセット（ID と名前と順番）
 */
export function itemToClothing(
  dollId: string,
  category: ManifestCategory,
  item: ManifestItem,
  url: (file: string) => string,
  sets?: { id: string; name: string; order?: number; layer?: number }[],
): ClothingItemData[] {
  const layer = item.layer ?? category.layer;
  const result: ClothingItemData[] = [
    {
      id: item.id,
      name: item.name,
      type: category.label,
      imageUrl: url(item.image.file),
      thumbnailUrl: url(item.thumb),
      position: { x: 0, y: 0 },
      baseZIndex: layer,
      layerOrder: layer,
      categoryOrder: category.menuOrder,
      allowOverlap: item.overlap ?? category.overlap,
      movable: category.movable,
      dollId,
      canvasW: item.image.canvasW,
      canvasH: item.image.canvasH,
      box: item.image.box,
      ...(item.hide ? { hide: { url: url(item.hide.file), box: item.hide.box } } : {}),
      ...(item.under ? { under: { url: url(item.under.file), canvasW: item.under.canvasW, canvasH: item.under.canvasH, box: item.under.box } } : {}),
      ...(item.back ? { backItemId: backItemId(item.id) } : {}),
      // セットの印（うしろがみの分には付けない。髪と一緒に付くので）
      ...(sets && sets.length > 0 ? { sets } : {}),
    },
  ];
  if (item.back) {
    result.push({
      id: backItemId(item.id),
      name: item.name,
      type: BACK_HAIR_TYPE,
      imageUrl: url(item.back.file),
      // うしろがみのサムネイル（体の裏の塗りつぶしを、うすい体の形で隠した絵）。無ければ絵そのもの
      thumbnailUrl: url(item.backThumb ?? item.back.file),
      position: { x: 0, y: 0 },
      baseZIndex: BACK_HAIR_LAYER,
      layerOrder: BACK_HAIR_LAYER,
      categoryOrder: category.menuOrder + 0.5,
      allowOverlap: false,
      movable: false,
      dollId,
      canvasW: item.back.canvasW,
      canvasH: item.back.canvasH,
      box: item.back.box,
      frontItemId: item.id,
      // 前髪と同じ軸で回り、大きくなる（前髪の中心）
      pivot: {
        x: item.image.box.x + item.image.box.w / 2 - item.image.canvasW / 2,
        y: item.image.box.y + item.image.box.h / 2 - item.image.canvasH / 2,
      },
    });
  }
  return result;
}

// 応答を待つ上限。つながらない回線で「よみこみちゅう」のまま止まらないようにする
const FETCH_TIMEOUT_MS = 15_000;

// 取得・検証に失敗したら Error
export async function loadContent(baseUrl: string, fetchImpl: typeof fetch = fetch): Promise<LoadedContent> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let body: unknown;
  try {
    const response = await fetchImpl(new URL('manifest.json', baseUrl).href, { signal: controller.signal });
    if (!response.ok) throw new Error(`一覧ファイルを取得できませんでした（HTTP ${response.status}）`);
    body = await response.json();
  } finally {
    clearTimeout(timer);
  }
  const manifest = parseManifest(body);
  // ドールが無いと何も表示できないので、読み込み失敗として扱う
  if (manifest.dolls.length === 0) throw new Error('一覧ファイルにドールがありません');
  const url = (file: string) => new URL(file, baseUrl).href;

  const toBackground = (bg: ManifestBackground, dollId?: string): BackgroundData => ({
    id: bg.id,
    name: bg.name,
    imageUrl: url(bg.file),
    thumbnailUrl: url(bg.thumb),
    ...(dollId ? { dollId } : {}),
  });

  const dolls: DollData[] = [];
  const clothing: ClothingItemData[] = [];
  const backgrounds: BackgroundData[] = [];
  const categoriesByDoll: Record<string, ManifestCategory[]> = {};
  // 服が 1 点も無いドール（スタジオで作りかけ）と、非表示にしたドールは、遊ぶ側には出さない。
  // 出せるドールが 1 体も無くなるときは、服のあるドールを（それも無ければ全部を）そのまま出す
  const playable = (d: { items: unknown[]; hidden?: true }) => d.items.length > 0 && !d.hidden;
  const shown = manifest.dolls.some(playable)
    ? manifest.dolls.filter(playable)
    : manifest.dolls.some((d) => d.items.length > 0)
      ? manifest.dolls.filter((d) => d.items.length > 0)
      : manifest.dolls;
  for (const doll of shown) {
    dolls.push({
      id: doll.id,
      name: doll.name,
      bodyImageUrl: url(doll.image.file),
      canvasW: doll.image.canvasW,
      canvasH: doll.image.canvasH,
      box: doll.image.box,
      ...(doll.setsOrder !== undefined ? { setsOrder: doll.setsOrder } : {}),
    });
    const categories = new Map(doll.categories.map((c) => [c.id, c]));
    const setNames = new Map((doll.sets ?? []).map((x, order) => [x.id, { name: x.name, order, layers: x.layers }]));
    categoriesByDoll[doll.id] = doll.categories;
    for (const item of doll.items) {
      const category = categories.get(item.category);
      if (!category) continue; // parseManifest が保証しているので通らない
      const sets = itemSetIds(item).flatMap((id) => {
        const set = setNames.get(id);
        if (!set) return [];
        const layer = set.layers?.[item.id];
        return [{ id, name: set.name, order: set.order, ...(layer !== undefined ? { layer } : {}) }];
      });
      clothing.push(...itemToClothing(doll.id, category, item, url, sets));
    }
    for (const bg of doll.backgrounds) backgrounds.push(toBackground(bg, doll.id));
  }
  for (const bg of manifest.backgrounds) backgrounds.push(toBackground(bg));
  return { dolls, clothing, backgrounds, categories: categoriesByDoll };
}
