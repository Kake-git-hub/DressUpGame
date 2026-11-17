/**
 * 配信された素材（一覧ファイル）を取得して、アプリの型に変換する
 */
import type { BackgroundData, ClothingItemData, DollData } from '../types';
import { parseManifest } from './manifest';
import type { ManifestBackground } from './manifest';

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

export interface LoadedContent {
  dolls: DollData[];
  clothing: ClothingItemData[];
  backgrounds: BackgroundData[];
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
  for (const doll of manifest.dolls) {
    dolls.push({
      id: doll.id,
      name: doll.name,
      bodyImageUrl: url(doll.image.file),
      canvasW: doll.image.canvasW,
      canvasH: doll.image.canvasH,
      box: doll.image.box,
    });
    const categories = new Map(doll.categories.map((c) => [c.id, c]));
    for (const item of doll.items) {
      const category = categories.get(item.category);
      if (!category) continue; // parseManifest が保証しているので通らない
      const layer = item.layer ?? category.layer;
      clothing.push({
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
        dollId: doll.id,
        canvasW: item.image.canvasW,
        canvasH: item.image.canvasH,
        box: item.image.box,
        ...(item.hide ? { hide: { url: url(item.hide.file), box: item.hide.box } } : {}),
      });
    }
    for (const bg of doll.backgrounds) backgrounds.push(toBackground(bg, doll.id));
  }
  for (const bg of manifest.backgrounds) backgrounds.push(toBackground(bg));
  return { dolls, clothing, backgrounds };
}
