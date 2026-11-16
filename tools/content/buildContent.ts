/**
 * プリセットのフォルダ → 配信用の一覧ファイルと画像
 *
 * 入力:  <presetDir>/doll-<名前>/{dolls,clothing,backgrounds}/...  と  <presetDir>/backgrounds/...
 * 出力:  <outDir>/manifest.json  と  <outDir>/files/<ハッシュ>.<拡張子>
 *
 * フォルダ名・ファイル名の規則は、これまでのアプリ内取り込みと同じ。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { alphaBBox, isFullyOpaque } from '../../src/pipeline/alpha.ts';
import type { Box } from '../../src/pipeline/alpha.ts';
import { removeBorderBackground } from '../../src/pipeline/removeBackground.ts';
import { removeCornerSpeck } from '../../src/pipeline/removeCornerSpeck.ts';
import { parseManifest } from '../../src/content/manifest.ts';
import type {
  Manifest,
  ManifestBackground,
  ManifestCategory,
  ManifestDoll,
  ManifestImage,
  ManifestItem,
} from '../../src/content/manifest.ts';
import {
  DEFAULT_CATEGORY_MAP,
  isMovableCategory,
  isOverlapCategory,
  parseClothingFileName,
  parseFolderName,
} from '../../src/types/index.ts';

export interface BuildReport {
  dolls: number;
  items: number;
  backgrounds: number;
  warnings: string[];
}

const MAX_SIZE = 1024; // 長辺がこれを超える画像だけ縮小する（表示の基準）
const THUMB_SIZE = 192;
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const THUMB_SUFFIX = /(_サムネ|_thumb|_thumbnail)$/i;
// 規則に合わない名前の服の行き先（これまでの取り込みと同じ値）
const FALLBACK = { category: 'アクセサリー', layer: 20, menuOrder: 99 };

const stem = (file: string) => file.replace(/\.[^.]+$/, '');
const isImage = (file: string) => IMAGE_EXT.test(file) && !THUMB_SUFFIX.test(stem(file));

async function list(dir: string): Promise<{ dirs: string[]; files: string[] }> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return {
      dirs: entries.filter((e) => e.isDirectory()).map((e) => e.name).sort(),
      files: entries.filter((e) => e.isFile()).map((e) => e.name).sort(),
    };
  } catch {
    return { dirs: [], files: [] };
  }
}

class Writer {
  private readonly filesDir: string;
  constructor(outDir: string) {
    this.filesDir = path.join(outDir, 'files');
  }
  // 内容のハッシュを名前にして書く。戻り値は manifest からの相対パス
  async write(data: Buffer, ext: string): Promise<string> {
    const name = `${createHash('sha1').update(data).digest('hex').slice(0, 16)}.${ext}`;
    await fs.writeFile(path.join(this.filesDir, name), data);
    return `files/${name}`;
  }
}

interface Cutout {
  image: ManifestImage;
  thumb: string;
  notes: string[];
}

// 服・ドール: 縮小 → 背景の自動透過 → 右下の小片除去 → 切り抜き → WebP（劣化なし）
async function cutout(file: string, writer: Writer): Promise<Cutout | null> {
  const { data, info } = await sharp(file)
    .resize({ width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const notes: string[] = [];
  if (isFullyOpaque(data) && removeBorderBackground(data, width, height)) notes.push('背景を自動で透明にしました');
  if (removeCornerSpeck(data, width, height)) notes.push('右下の小さな塊を消しました');
  const box: Box | null = alphaBBox(data, width, height);
  if (!box) return null;

  const cropped = sharp(data, { raw: { width, height, channels: 4 } }).extract({
    left: box.x,
    top: box.y,
    width: box.w,
    height: box.h,
  });
  const main = await cropped.clone().webp({ lossless: true, effort: 6 }).toBuffer();
  const thumb = await cropped
    .clone()
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85, alphaQuality: 100 })
    .toBuffer();
  return {
    image: { file: await writer.write(main, 'webp'), canvasW: width, canvasH: height, box },
    thumb: await writer.write(thumb, 'webp'),
    notes,
  };
}

async function background(file: string, id: string, writer: Writer): Promise<ManifestBackground> {
  const base = sharp(file).flatten({ background: '#ffffff' });
  const main = await base
    .clone()
    .resize({ width: MAX_SIZE, height: MAX_SIZE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  const thumb = await base
    .clone()
    .resize({ width: THUMB_SIZE, height: THUMB_SIZE, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toBuffer();
  return { id, name: stem(path.basename(file)), file: await writer.write(main, 'jpg'), thumb: await writer.write(thumb, 'jpg') };
}

async function backgrounds(dir: string, idPrefix: string, writer: Writer, warnings: string[]): Promise<ManifestBackground[]> {
  const result: ManifestBackground[] = [];
  const used = new Set<string>();
  for (const file of (await list(dir)).files.filter(isImage)) {
    try {
      result.push(await background(path.join(dir, file), uniqueId(`${idPrefix}/${stem(file)}`, used), writer));
    } catch (error) {
      warnings.push(`${path.join(dir, file)}: 読めなかったので飛ばしました（${(error as Error).message}）`);
    }
  }
  return result;
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

// 服 1 点ぶんの、名前から読み取った情報
interface ClothingSource {
  file: string;
  name: string;
  idName: string; // ID に使う名前（ファイル名に ID が付いていれば、それを含む）
  categoryId: string;
  label: string;
  layer: number;
  menuOrder: number;
  overlap: boolean;
  movable: boolean;
  unparsed: boolean;
}

async function clothingSources(clothingDir: string): Promise<ClothingSource[]> {
  const sources: ClothingSource[] = [];
  const top = await list(clothingDir);

  // フォルダ方式: clothing/<重ね順>_<並び順>_<カテゴリ名>[_movable][_overlap]/<名前>.png
  for (const folder of top.dirs) {
    const parsed = parseFolderName(folder);
    const mapping = DEFAULT_CATEGORY_MAP[parsed.label.toLowerCase()];
    for (const file of (await list(path.join(clothingDir, folder))).files.filter(isImage)) {
      sources.push({
        file: path.join(clothingDir, folder, file),
        name: stem(file),
        idName: stem(file),
        categoryId: parsed.label.toLowerCase(),
        label: parsed.label,
        layer: parsed.order ?? mapping?.zIndex ?? 25,
        menuOrder: parsed.categoryOrder ?? 999,
        overlap: isOverlapCategory(folder),
        movable: isMovableCategory(folder),
        unparsed: false,
      });
    }
  }

  // ファイル名方式: clothing/<重ね順>_<並び順>_<カテゴリ名>_[overlap]<名前>[_ID].png
  for (const file of top.files.filter(isImage)) {
    const parsed = parseClothingFileName(file);
    const label = parsed?.categoryName ?? FALLBACK.category;
    const name = (parsed?.itemName ?? stem(file)).replace(/^_+/, '') || stem(file);
    // ファイル名の末尾に ID があれば ID に含める（同じ名前の服を後から足しても、既存の ID が変わらない）
    const explicitId = parsed && parsed.uniqueId !== stem(file) ? parsed.uniqueId : null;
    sources.push({
      file: path.join(clothingDir, file),
      name,
      idName: explicitId ? `${name}_${explicitId}` : name,
      categoryId: label.toLowerCase(),
      label,
      layer: parsed?.layerOrder ?? FALLBACK.layer,
      menuOrder: parsed?.categoryOrder ?? FALLBACK.menuOrder,
      overlap: parsed?.allowOverlap ?? false,
      movable: false,
      unparsed: !parsed,
    });
  }
  return sources;
}

async function buildDoll(dollDir: string, dollId: string, writer: Writer, warnings: string[]): Promise<ManifestDoll | null> {
  const dollFiles = (await list(path.join(dollDir, 'dolls'))).files.filter(isImage);
  if (dollFiles.length === 0) {
    warnings.push(`${dollDir}: dolls/ にドール画像が無いので飛ばしました`);
    return null;
  }
  let dollImage: Cutout | null;
  try {
    dollImage = await cutout(path.join(dollDir, 'dolls', dollFiles[0]), writer);
  } catch (error) {
    warnings.push(`${dollDir}: ドール画像を読めなかったので飛ばしました（${(error as Error).message}）`);
    return null;
  }
  if (!dollImage) {
    warnings.push(`${dollDir}: ドール画像が全部透明なので飛ばしました`);
    return null;
  }
  for (const note of dollImage.notes) warnings.push(`${dollId} のドール画像: ${note}`);

  const categories = new Map<string, ManifestCategory>();
  const items: ManifestItem[] = [];
  const usedIds = new Set<string>();
  for (const src of await clothingSources(path.join(dollDir, 'clothing'))) {
    let cut: Cutout | null;
    try {
      cut = await cutout(src.file, writer);
    } catch (error) {
      warnings.push(`${src.file}: 読めなかったので飛ばしました（${(error as Error).message}）`);
      continue;
    }
    if (!cut) {
      warnings.push(`${src.file}: 全部透明なので飛ばしました`);
      continue;
    }
    for (const note of cut.notes) warnings.push(`${src.file}: ${note}`);
    if (src.unparsed) warnings.push(`${src.file}: 名前が規則に合わないので「${FALLBACK.category}」に入れました`);

    // カテゴリは最初に出てきた服の値で決まる。違う値の服は、服のほうに持たせる
    let category = categories.get(src.categoryId);
    if (!category) {
      category = { id: src.categoryId, label: src.label, layer: src.layer, menuOrder: src.menuOrder, overlap: src.overlap, movable: src.movable };
      categories.set(src.categoryId, category);
    }
    const item: ManifestItem = {
      id: uniqueId(`${dollId}/${src.categoryId}/${src.idName}`, usedIds),
      name: src.name,
      category: src.categoryId,
      image: cut.image,
      thumb: cut.thumb,
    };
    if (src.layer !== category.layer) item.layer = src.layer;
    if (src.overlap !== category.overlap) item.overlap = src.overlap;
    items.push(item);
  }

  return {
    id: dollId,
    name: dollId,
    image: dollImage.image,
    categories: [...categories.values()],
    items,
    backgrounds: await backgrounds(path.join(dollDir, 'backgrounds'), `${dollId}/bg`, writer, warnings),
  };
}

export async function buildContent(presetDir: string, outDir: string): Promise<BuildReport> {
  const dollDirs = (await list(presetDir)).dirs.filter((d) => /^doll-/i.test(d));
  if (dollDirs.length === 0) throw new Error(`${presetDir} に doll-* フォルダがありません`);

  // 出力先の manifest.json と files/ だけを作り直す（README などは残す）。
  // 関係ないフォルダの files/ を消さないよう、空か、前回の出力があるフォルダだけを受け付ける
  await fs.mkdir(outDir, { recursive: true });
  const existing = await list(outDir);
  const hasContent = existing.dirs.some((d) => d !== '.git') || existing.files.some((f) => !/^(README\.md|\.nojekyll|\.gitignore)$/i.test(f));
  if (hasContent && !existing.files.includes('manifest.json')) {
    throw new Error(`${outDir} は素材の出力先ではないようです（manifest.json がありません）。空のフォルダか、前回の出力先を指定してください`);
  }
  await fs.rm(path.join(outDir, 'files'), { recursive: true, force: true });
  await fs.rm(path.join(outDir, 'manifest.json'), { force: true });
  await fs.mkdir(path.join(outDir, 'files'), { recursive: true });

  const writer = new Writer(outDir);
  const warnings: string[] = [];
  const dolls: ManifestDoll[] = [];
  for (const dir of dollDirs) {
    const doll = await buildDoll(path.join(presetDir, dir), dir.replace(/^doll-/i, ''), writer, warnings);
    if (doll) dolls.push(doll);
  }
  if (dolls.length === 0) throw new Error('取り込めるドールがありませんでした:\n' + warnings.join('\n'));
  const shared = await backgrounds(path.join(presetDir, 'backgrounds'), 'bg', writer, warnings);

  const manifest: Manifest = { version: 1, dolls, backgrounds: shared };
  // アプリが読めない一覧は書き出さない（書き出すと、全端末で読み込みに失敗する）
  parseManifest(JSON.parse(JSON.stringify(manifest)));
  await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
  return {
    dolls: dolls.length,
    items: dolls.reduce((n, d) => n + d.items.length, 0),
    backgrounds: shared.length + dolls.reduce((n, d) => n + d.backgrounds.length, 0),
    warnings,
  };
}
