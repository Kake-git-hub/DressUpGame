/**
 * 公開済みの素材への、1 回きりの手直し（画像生成は使わない）
 *
 *   npm run content:fix -- outline <素材フォルダ> <ドールの ID>
 *     ドールの画像・2 倍の元画像（studio/masters）・顔の品目の、輪郭線に混ざった背景の緑を取る（形は変えない）
 *   npm run content:fix -- back-thumbs <素材フォルダ>
 *     後ろ髪のある品目に、うしろがみのサムネイル（体の裏の塗りつぶしを、うすい体の形で隠した絵）を足す
 *   npm run content:fix -- copy-items <素材フォルダ> <もとのドールの ID> <さきのドールの ID>
 *     もとのドールの服を全部、さきのドールにも置く（ドールをまとめるとき用。位置はそのままなので、体の形が違う所は合わない）
 *   npm run content:fix -- hair-shadows <素材フォルダ> [ドールの ID]
 *     前髪と後ろ髪に分かれた髪から、髪が肌に落とした影（前髪の下の額など）を取る（色スライダーで、影だけが色変わりしないように）
 *
 * 画像の名前は中身のハッシュなので、直した画像は新しい名前になる。古い画像は消さない（公開のときに、使われていない画像として消える）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import type { ManifestImage } from '../../src/content/manifest.ts';
import { cleanKeyEdge } from '../../src/pipeline/edgeClean.ts';
import { fillUnderDoll, hairThumbs } from '../../src/pipeline/hairLayers.ts';
import { skinShadowMask } from '../../src/pipeline/skinShadow.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import { encodeCutout, encodeLayer, encodeThumb, uniqueId } from './encode.ts';
import type { FileWriter } from './encode.ts';
import { ContentError, ContentStore } from './manifestEdit.ts';

// ドールを作ったときの背景（tools/studio/makeDoll.ts の DOLL_BACKGROUND と同じ）
const KEY: Rgb = [0, 255, 0];
const FACE_LABEL = /かお|顔|face/i;
const reachFor = (width: number) => Math.max(1, Math.round((3 * width) / 1024));

async function readRaw(file: string): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}
const lossless = (rgba: Uint8ClampedArray, width: number, height: number) =>
  sharp(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), { raw: { width, height, channels: 4 } }).webp({ lossless: true, effort: 6 }).toBuffer();

// 画像 1 枚の輪郭線を直して書き出し、新しい名前を返す（画像の大きさ・位置は同じ）
async function cleanImage(dir: string, image: ManifestImage, writer: FileWriter): Promise<string> {
  const { rgba, width, height } = await readRaw(path.join(dir, image.file));
  cleanKeyEdge(rgba, width, height, KEY, reachFor(Math.round((width * image.canvasW) / image.box.w)));
  return writer.write(await lossless(rgba, width, height), 'webp');
}

export async function cleanDollOutline(contentDir: string, dollId: string, faceCategory?: string): Promise<{ doll: string; master: string | null; faces: number }> {
  const store = new ContentStore(contentDir);
  return store.edit(async (manifest, writer) => {
    const doll = manifest.dolls.find((d) => d.id === dollId);
    if (!doll) throw new ContentError(`ドール「${dollId}」がありません`, 404);
    const before = doll.image.file;
    doll.image.file = await cleanImage(store.dir, doll.image, writer);

    // 2 倍の元画像: ドールの画像と同じ基本名で探し、直して新しい名前で置く
    const baseOf = (file: string) => path.basename(file, path.extname(file));
    const masters = path.join(store.dir, 'studio', 'masters');
    const oldMaster = path.join(masters, `${baseOf(before)}.webp`);
    let master: string | null = null;
    try {
      const { rgba, width, height } = await readRaw(oldMaster);
      cleanKeyEdge(rgba, width, height, KEY, reachFor(Math.round((width * doll.image.canvasW) / doll.image.box.w)));
      const data = await lossless(rgba, width, height);
      const newMaster = path.join(masters, `${baseOf(doll.image.file)}.webp`);
      await fs.writeFile(newMaster, data);
      if (newMaster !== oldMaster) await fs.rm(oldMaster, { force: true });
      master = path.relative(store.dir, newMaster).split(path.sep).join('/');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !/missing|exist/i.test((error as Error).message)) throw error;
    }

    // 顔の品目は、頭を輪郭線ごと「お面」として重ねるので、同じように直す
    const faceIds = new Set(doll.categories.filter((c) => (faceCategory ? c.id === faceCategory : FACE_LABEL.test(c.label))).map((c) => c.id));
    let faces = 0;
    for (const item of doll.items) {
      if (!faceIds.has(item.category)) continue;
      item.image.file = await cleanImage(store.dir, item.image, writer);
      faces++;
    }
    return { doll: doll.image.file, master, faces };
  });
}

// 画像を、そのキャンバスの大きさの RGBA に置く
async function placed(dir: string, image: ManifestImage, width: number, height: number): Promise<Uint8ClampedArray> {
  const out = new Uint8ClampedArray(width * height * 4);
  const { data } = await sharp(path.join(dir, image.file)).ensureAlpha().resize(image.box.w, image.box.h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const dx = Math.round((width - image.canvasW) / 2) + image.box.x;
  const dy = Math.round((height - image.canvasH) / 2) + image.box.y;
  for (let y = 0; y < image.box.h; y++) {
    const ty = y + dy;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < image.box.w; x++) {
      const tx = x + dx;
      if (tx < 0 || tx >= width) continue;
      out.set(data.subarray((y * image.box.w + x) * 4, (y * image.box.w + x) * 4 + 4), (ty * width + tx) * 4);
    }
  }
  return out;
}

export async function addBackThumbs(contentDir: string): Promise<number> {
  const store = new ContentStore(contentDir);
  return store.edit(async (manifest, writer) => {
    let added = 0;
    for (const doll of manifest.dolls) {
      for (const item of doll.items) {
        if (!item.back || item.backThumb) continue;
        const { canvasW: width, canvasH: height } = item.back;
        const dollRgba = await placed(store.dir, doll.image, width, height);
        const alpha = new Uint8Array(width * height);
        for (let p = 0; p < alpha.length; p++) alpha[p] = dollRgba[p * 4 + 3];
        const thumbs = hairThumbs(await placed(store.dir, item.image, width, height), await placed(store.dir, item.back, width, height), alpha, width, height);
        const thumb = await encodeThumb(thumbs.back, width, height, writer);
        if (!thumb) continue;
        item.backThumb = thumb;
        added++;
      }
    }
    return added;
  });
}

/**
 * もとのドールの服を全部、さきのドールにも置く（もとの服は消さない）。
 * 絵は同じファイルを指す（増えない）。位置・隠す所・重ね順の上書きはそのまま。さきに無いカテゴリは、もとの設定で作る。
 * さきに同じ絵の服がもうあれば、写さない（2 回実行しても増えない）
 */
export async function copyItems(contentDir: string, fromDollId: string, toDollId: string): Promise<{ copied: number; skipped: number; categories: string[] }> {
  if (fromDollId === toDollId) throw new ContentError('もとのドールと、さきのドールが同じです');
  const store = new ContentStore(contentDir);
  return store.edit((manifest) => {
    const from = manifest.dolls.find((d) => d.id === fromDollId);
    const to = manifest.dolls.find((d) => d.id === toDollId);
    if (!from) throw new ContentError(`ドール「${fromDollId}」がありません`, 404);
    if (!to) throw new ContentError(`ドール「${toDollId}」がありません`, 404);
    const categories: string[] = [];
    for (const category of from.categories) {
      if (to.categories.some((c) => c.id === category.id) || !from.items.some((i) => i.category === category.id)) continue;
      to.categories.push({ ...category });
      categories.push(category.id);
    }
    const used = new Set(to.items.map((i) => i.id));
    const have = new Set(to.items.map((i) => i.image.file));
    let copied = 0;
    let skipped = 0;
    for (const item of from.items) {
      if (have.has(item.image.file)) {
        skipped++;
        continue;
      }
      to.items.push({ ...structuredClone(item), id: uniqueId(`${to.id}/${item.category}/${item.name}`, used) });
      copied++;
    }
    return { copied, skipped, categories };
  });
}

const MIN_SHADOW_PIXELS = 20;

// 前髪と後ろ髪に分かれた髪から、髪が肌に落とした影を取る。直した品目の ID と、取った画素数を返す
export async function removeHairShadows(contentDir: string, dollId?: string): Promise<{ id: string; removed: number }[]> {
  const store = new ContentStore(contentDir);
  return store.edit(async (manifest, writer) => {
    if (dollId && !manifest.dolls.some((d) => d.id === dollId)) throw new ContentError(`ドール「${dollId}」がありません`, 404);
    const fixed: { id: string; removed: number }[] = [];
    for (const doll of manifest.dolls) {
      if (dollId && doll.id !== dollId) continue;
      for (const item of doll.items) {
        if (!item.back) continue;
        const { canvasW: width, canvasH: height } = item.image;
        if (item.back.canvasW !== width || item.back.canvasH !== height) continue;
        const total = width * height;
        const dollRgba = await placed(store.dir, doll.image, width, height);
        const front = await placed(store.dir, item.image, width, height);
        const alpha = new Uint8Array(total);
        const hair = new Uint8Array(total);
        const bare = new Uint8Array(total);
        for (let p = 0; p < total; p++) {
          alpha[p] = dollRgba[p * 4 + 3];
          if (alpha[p] < 128) continue;
          if (front[p * 4 + 3] >= 128) hair[p] = 1;
          else bare[p] = 1;
        }
        const shadow = skinShadowMask(front, dollRgba, hair, bare, width, height);
        let removed = 0;
        for (let p = 0; p < total; p++) if (shadow[p]) removed++;
        // ごく小さいもの（輪郭の色むら）は、絵を書き直すほどではない
        if (removed < MIN_SHADOW_PIXELS) continue;
        // 影の所は、前髪からは消す。後ろ髪では体の裏なので、髪の地の色で塗り直す
        const back = await placed(store.dir, item.back, width, height);
        for (let p = 0; p < total; p++) {
          if (!shadow[p]) continue;
          front[p * 4 + 3] = 0;
          back[p * 4 + 3] = 0;
        }
        const filled = fillUnderDoll(back, alpha, width, height);
        const thumbs = hairThumbs(front, filled, alpha, width, height);
        const encoded = await encodeCutout(front, width, height, writer, thumbs.hair);
        const backImage = await encodeLayer(filled, width, height, writer);
        if (!encoded || !backImage) continue;
        item.image = encoded.image;
        item.thumb = encoded.thumb;
        item.back = backImage;
        const backThumb = await encodeThumb(thumbs.back, width, height, writer);
        if (backThumb) item.backThumb = backThumb;
        fixed.push({ id: item.id, removed });
      }
    }
    return fixed;
  });
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (command === 'outline' && rest.length >= 2) {
    const result = await cleanDollOutline(rest[0], rest[1], rest[2]);
    console.log(`ドール: ${result.doll}／元画像: ${result.master ?? '（なし）'}／顔: ${result.faces} 点`);
  } else if (command === 'back-thumbs' && rest.length === 1) {
    console.log(`うしろがみのサムネイルを ${await addBackThumbs(rest[0])} 点に足しました`);
  } else if (command === 'copy-items' && rest.length === 3) {
    const result = await copyItems(rest[0], rest[1], rest[2]);
    console.log(`${result.copied} 点を写しました（もう写してあった ${result.skipped} 点は、そのまま）${result.categories.length ? `。足したカテゴリ: ${result.categories.join('、')}` : ''}`);
  } else if (command === 'hair-shadows' && (rest.length === 1 || rest.length === 2)) {
    const fixed = await removeHairShadows(rest[0], rest[1]);
    for (const f of fixed) console.log(`${f.id}: 影を ${f.removed} 画素取りました`);
    console.log(`${fixed.length} 点を直しました`);
  } else {
    console.log('使い方:\n  fixContent.ts outline <素材フォルダ> <ドールの ID> [顔のカテゴリの ID]\n  fixContent.ts back-thumbs <素材フォルダ>\n  fixContent.ts hair-shadows <素材フォルダ> [ドールの ID]\n  fixContent.ts copy-items <素材フォルダ> <もとのドールの ID> <さきのドールの ID>');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((error: Error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
