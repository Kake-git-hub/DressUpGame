/**
 * 配信する素材の一覧ファイル（manifest.json）の型と検証
 * アプリ（読む側）と移行スクリプト（書く側）の両方が使う
 */
import type { Box } from '../pipeline/alpha';

export type { Box };

// file は一覧ファイルからの相対パス
export interface ManifestImage {
  file: string;
  canvasW: number; // 切り抜く前の元キャンバスの大きさ
  canvasH: number;
  box: Box; // 元キャンバス内での位置と大きさ
}

export interface ManifestCategory {
  id: string;
  label: string;
  layer: number; // 重ね順（小さいほど下）
  menuOrder: number; // メニューの並び順
  overlap: boolean; // 同カテゴリの重ね着を許すか
  movable: boolean; // 自由配置
}

export interface ManifestItem {
  id: string;
  name: string;
  category: string; // ManifestCategory.id
  image: ManifestImage;
  thumb: string;
}

export interface ManifestBackground {
  id: string;
  name: string;
  file: string;
  thumb: string;
}

export interface ManifestDoll {
  id: string;
  name: string;
  image: ManifestImage;
  categories: ManifestCategory[];
  items: ManifestItem[];
  backgrounds: ManifestBackground[]; // このドール専用の背景
}

export interface Manifest {
  version: 1;
  dolls: ManifestDoll[];
  backgrounds: ManifestBackground[]; // 全ドール共通の背景
}

type Rec = Record<string, unknown>;

function fail(path: string, expected: string): never {
  throw new Error(`manifest: ${path} は ${expected} である必要があります`);
}
function rec(v: unknown, path: string): Rec {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'オブジェクト');
  return v as Rec;
}
function arr(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v)) fail(path, '配列');
  return v;
}
function str(v: unknown, path: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(path, '空でない文字列');
  return v;
}
function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, '数値');
  return v;
}
function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, '真偽値');
  return v;
}
function unique(ids: string[], path: string): void {
  if (new Set(ids).size !== ids.length) fail(path, '重複のない id');
}

function image(v: unknown, path: string): ManifestImage {
  const o = rec(v, path);
  const b = rec(o.box, `${path}.box`);
  const canvasW = num(o.canvasW, `${path}.canvasW`);
  const canvasH = num(o.canvasH, `${path}.canvasH`);
  const box = {
    x: num(b.x, `${path}.box.x`),
    y: num(b.y, `${path}.box.y`),
    w: num(b.w, `${path}.box.w`),
    h: num(b.h, `${path}.box.h`),
  };
  if (canvasW <= 0 || canvasH <= 0) fail(path, '正の大きさのキャンバス');
  if (box.x < 0 || box.y < 0 || box.w <= 0 || box.h <= 0 || box.x + box.w > canvasW || box.y + box.h > canvasH) {
    fail(`${path}.box`, 'キャンバスに収まる矩形');
  }
  return { file: str(o.file, `${path}.file`), canvasW, canvasH, box };
}

function background(v: unknown, path: string): ManifestBackground {
  const o = rec(v, path);
  return {
    id: str(o.id, `${path}.id`),
    name: str(o.name, `${path}.name`),
    file: str(o.file, `${path}.file`),
    thumb: str(o.thumb, `${path}.thumb`),
  };
}

function doll(v: unknown, path: string): ManifestDoll {
  const o = rec(v, path);
  const categories = arr(o.categories, `${path}.categories`).map((c, i): ManifestCategory => {
    const p = `${path}.categories[${i}]`;
    const r = rec(c, p);
    return {
      id: str(r.id, `${p}.id`),
      label: str(r.label, `${p}.label`),
      layer: num(r.layer, `${p}.layer`),
      menuOrder: num(r.menuOrder, `${p}.menuOrder`),
      overlap: bool(r.overlap, `${p}.overlap`),
      movable: bool(r.movable, `${p}.movable`),
    };
  });
  unique(categories.map((c) => c.id), `${path}.categories`);
  const categoryIds = new Set(categories.map((c) => c.id));
  const items = arr(o.items, `${path}.items`).map((it, i): ManifestItem => {
    const p = `${path}.items[${i}]`;
    const r = rec(it, p);
    const category = str(r.category, `${p}.category`);
    if (!categoryIds.has(category)) fail(`${p}.category`, 'categories にある id');
    return {
      id: str(r.id, `${p}.id`),
      name: str(r.name, `${p}.name`),
      category,
      image: image(r.image, `${p}.image`),
      thumb: str(r.thumb, `${p}.thumb`),
    };
  });
  unique(items.map((i) => i.id), `${path}.items`);
  const backgrounds = arr(o.backgrounds, `${path}.backgrounds`).map((b, i) => background(b, `${path}.backgrounds[${i}]`));
  unique(backgrounds.map((b) => b.id), `${path}.backgrounds`);
  return {
    id: str(o.id, `${path}.id`),
    name: str(o.name, `${path}.name`),
    image: image(o.image, `${path}.image`),
    categories,
    items,
    backgrounds,
  };
}

// 形が違えば Error を投げる。余分なキーは捨てる
export function parseManifest(value: unknown): Manifest {
  const o = rec(value, 'manifest');
  if (o.version !== 1) fail('version', '1');
  const dolls = arr(o.dolls, 'dolls').map((d, i) => doll(d, `dolls[${i}]`));
  unique(dolls.map((d) => d.id), 'dolls');
  const backgrounds = arr(o.backgrounds, 'backgrounds').map((b, i) => background(b, `backgrounds[${i}]`));
  unique(backgrounds.map((b) => b.id), 'backgrounds');
  return { version: 1, dolls, backgrounds };
}
