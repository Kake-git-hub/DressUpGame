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
  // 服が 1 点も無いドール（スタジオで作りかけ）は、遊ぶ側には出さない。どのドールにも服が無いときは、そのまま出す
  const anyItems = manifest.dolls.some((d) => d.items.length > 0);
  for (const doll of manifest.dolls) {
    if (anyItems && doll.items.length === 0) continue;
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
        ...(item.under ? { under: { url: url(item.under.file), canvasW: item.under.canvasW, canvasH: item.under.canvasH, box: item.under.box } } : {}),
        ...(item.back ? { backItemId: backItemId(item.id) } : {}),
      });
      if (item.back) {
        clothing.push({
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
          dollId: doll.id,
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
    }
    for (const bg of doll.backgrounds) backgrounds.push(toBackground(bg, doll.id));
  }
  for (const bg of manifest.backgrounds) backgrounds.push(toBackground(bg));
  return { dolls, clothing, backgrounds };
}
