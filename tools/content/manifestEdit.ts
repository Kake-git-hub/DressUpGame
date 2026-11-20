/**
 * 素材フォルダ（manifest.json と files/）の編集
 *
 * 決まり:
 *  - 画像は一覧より先に書く。一覧は検証してから、一時ファイル経由で置き換える（途中で失敗しても食い違わない）
 *  - すでにあるアイテムの ID は変えない
 *  - 書き込むのは manifest.json・files/・studio/ だけ
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { itemSetIds, parseManifest, setItemSets } from '../../src/content/manifest.ts';
import type { Manifest, ManifestBackground, ManifestCategory, ManifestDoll, ManifestImage, ManifestItem, ManifestSet } from '../../src/content/manifest.ts';
import type { Pixels } from '../../src/pipeline/alpha.ts';
import { FileWriter, MAX_SIZE, encodeBackground, encodeCutout, encodeLayer, encodeMask, encodeThumb, uniqueId } from './encode.ts';
import type { ImageWriter } from './encode.ts';

export class ContentError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// 新しいドールに最初から付けるカテゴリ（これまでの素材と同じ並び）
export const DEFAULT_CATEGORIES: ManifestCategory[] = [
  { id: 'かお', label: 'かお', layer: 10, menuOrder: 1, overlap: false, movable: false },
  { id: 'ドレス', label: 'ドレス', layer: 4, menuOrder: 2, overlap: false, movable: false },
  { id: 'ソックス', label: 'ソックス', layer: 1, menuOrder: 3, overlap: false, movable: false },
  { id: 'インナー', label: 'インナー', layer: 2, menuOrder: 4, overlap: false, movable: false },
  { id: 'トップス', label: 'トップス', layer: 4, menuOrder: 5, overlap: false, movable: false },
  { id: 'ボトムス', label: 'ボトムス', layer: 3, menuOrder: 6, overlap: false, movable: false },
  { id: 'くつ', label: 'くつ', layer: 2, menuOrder: 7, overlap: false, movable: false },
  { id: 'ぼうし', label: 'ぼうし', layer: 11, menuOrder: 9, overlap: false, movable: false },
  { id: 'アクセサリー', label: 'アクセサリー', layer: 11, menuOrder: 10, overlap: true, movable: false },
];

// ID・名前に使えない形: 空、前後の空白、制御文字、親フォルダへの移動、バックスラッシュ、先頭や末尾の /
export function checkName(value: unknown, what: string, max = 80): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new ContentError(`${what}は 1〜${max} 文字で入力してください`);
  // eslint-disable-next-line no-control-regex
  if (value !== value.trim() || /[\u0000-\u001f\\]/.test(value) || value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new ContentError(`${what}に使えない文字が入っています: ${JSON.stringify(value)}`);
  }
  return value;
}
// 名前は ID の一部になるので、/ も使えない
function checkPlainName(value: unknown, what: string): string {
  const name = checkName(value, what);
  if (name.includes('/')) throw new ContentError(`${what}に / は使えません`);
  return name;
}

export interface ItemInput {
  category: string;
  name: string;
  rgba: Pixels; // ドールのキャンバスと同じ大きさ
  width: number;
  height: number;
  replaceId?: string; // 指定すると、その ID のまま画像と名前・カテゴリを差し替える
  hide?: Uint8Array | Uint8ClampedArray | null; // 着ているあいだドールを隠す所（キャンバス大の不透明度）。null・無しなら隠さない
  back?: Pixels | null; // ドールの下に描く分（後ろ髪など。rgba と同じ大きさ）。null・無しなら持たない
  thumbFrom?: Pixels; // サムネイルにする絵（無ければ rgba）
  backThumbFrom?: Pixels; // うしろがみのサムネイルにする絵（back があるときだけ使う）
  under?: Pixels | null; // ドールのすぐ上に描く分（くつの中の肌など。rgba と同じ大きさ）。null・無しなら持たない
  // セット（同じテーマで一度に作った服の集まり）。その ID のセットがドールに無ければ作る。
  // 差し替え（replaceId）のときは、指定が無ければ今の印を残す
  set?: { id: string; name: string };
}

// 服の絵（服・サムネイル・隠す所・後ろに描く分・ドールのすぐ上に描く分）を書き出して、一覧に書く形にする。
// 素材フォルダに保存するとき（ContentStore.addItem）と、サーバーの関数が利用者の置き場に保存するときの両方で使う
export interface EncodedItemImages {
  image: ManifestItem['image'];
  thumb: string;
  hide: ManifestItem['image'] | null;
  back: ManifestItem['image'] | null;
  backThumb: string | null;
  under: ManifestItem['image'] | null;
}
export async function encodeItemImages(doll: ManifestDoll, input: ItemInput, writer: ImageWriter): Promise<EncodedItemImages> {
  // 服のキャンバスは、ドールのキャンバスと同じか、まわりに同じ幅の余白を足したもの（中心が同じ）
  const padX = (input.width - doll.image.canvasW) / 2;
  const padY = (input.height - doll.image.canvasH) / 2;
  if (padX < 0 || padX !== padY || !Number.isInteger(padX)) {
    throw new ContentError(`画像の大きさ（${input.width}×${input.height}）がドールのキャンバス（${doll.image.canvasW}×${doll.image.canvasH}）と違います`);
  }
  const encoded = await encodeCutout(input.rgba, input.width, input.height, writer, input.thumbFrom);
  if (!encoded) throw new ContentError('画像が全部透明です');
  if (input.hide && input.hide.length !== doll.image.canvasW * doll.image.canvasH) throw new ContentError('隠す所の大きさがドールのキャンバスと違います');
  const hide = input.hide ? await encodeMask(input.hide, doll.image.canvasW, doll.image.canvasH, writer) : null;
  if (input.back && input.back.length !== input.width * input.height * 4) throw new ContentError('後ろに描く画像の大きさがドールのキャンバスと違います');
  const back = input.back ? await encodeLayer(input.back, input.width, input.height, writer) : null;
  const backThumb = back && input.backThumbFrom ? await encodeThumb(input.backThumbFrom, input.width, input.height, writer) : null;
  if (input.under && input.under.length !== input.width * input.height * 4) throw new ContentError('ドールのすぐ上に描く画像の大きさがドールのキャンバスと違います');
  const under = input.under ? await encodeLayer(input.under, input.width, input.height, writer) : null;
  return { image: encoded.image, thumb: encoded.thumb, hide, back, backThumb, under };
}

// パーツが 1 点も残っていないセットを消す（sets が空になったら、項目ごと消す）
function pruneSets(manifest: Manifest): void {
  for (const doll of manifest.dolls) {
    if (!doll.sets) continue;
    const used = new Set(doll.items.flatMap(itemSetIds));
    doll.sets = doll.sets.filter((x) => used.has(x.id));
    // 重なりの順番は、いまセットに入っている服の分だけ残す（外した・消した服の分は捨てる）
    for (const set of doll.sets) {
      if (!set.layers) continue;
      for (const id of Object.keys(set.layers)) if (!doll.items.some((i) => i.id === id && itemSetIds(i).includes(set.id))) delete set.layers[id];
      if (Object.keys(set.layers).length === 0) delete set.layers;
    }
    if (doll.sets.length === 0) delete doll.sets;
  }
}

export class ContentStore {
  readonly dir: string;
  private readonly writer: FileWriter;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(contentDir: string) {
    this.dir = path.resolve(contentDir);
    this.writer = new FileWriter(this.dir);
  }

  private get manifestPath(): string {
    return path.join(this.dir, 'manifest.json');
  }

  async read(): Promise<Manifest> {
    let text: string;
    try {
      text = await fs.readFile(this.manifestPath, 'utf8');
    } catch {
      throw new ContentError(`${this.manifestPath} がありません。素材フォルダの場所を確かめてください`, 500);
    }
    return parseManifest(JSON.parse(text));
  }

  // 素材フォルダがまだ空なら、空の一覧を作る
  async init(): Promise<void> {
    try {
      await fs.access(this.manifestPath);
    } catch {
      await fs.mkdir(path.join(this.dir, 'files'), { recursive: true });
      await this.save({ version: 1, dolls: [], backgrounds: [] });
    }
  }

  private async save(manifest: Manifest): Promise<void> {
    // アプリが読めない一覧は書き出さない
    const checked = parseManifest(JSON.parse(JSON.stringify(manifest)));
    const tmp = `${this.manifestPath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(checked, null, 1) + '\n');
    await fs.rename(tmp, this.manifestPath);
  }

  // 読む → 変える → 書く、を 1 つずつ順に行う（同時に来た変更で一覧が壊れない）
  private change<T>(fn: (manifest: Manifest) => Promise<T> | T): Promise<T> {
    const run = this.queue.then(async () => {
      const manifest = await this.read();
      const result = await fn(manifest);
      pruneSets(manifest);
      await this.save(manifest);
      return result;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  // 一覧を直接直す（道具のコマンド用）。読む → 変える → 検証して書く、を順番待ちに入れて行う。files への書き出しは writer で
  edit<T>(fn: (manifest: Manifest, writer: FileWriter) => Promise<T> | T): Promise<T> {
    return this.change((manifest) => fn(manifest, this.writer));
  }

  private static doll(manifest: Manifest, dollId: string): ManifestDoll {
    const doll = manifest.dolls.find((d) => d.id === dollId);
    if (!doll) throw new ContentError(`ドール「${dollId}」がありません`, 404);
    return doll;
  }
  private static findItem(manifest: Manifest, itemId: string): { doll: ManifestDoll; item: ManifestItem } {
    for (const doll of manifest.dolls) {
      const item = doll.items.find((i) => i.id === itemId);
      if (item) return { doll, item };
    }
    throw new ContentError(`アイテム「${itemId}」がありません`, 404);
  }

  async addItem(dollId: string, input: ItemInput): Promise<ManifestItem> {
    const name = checkPlainName(input.name, '名前');
    return this.change(async (manifest) => {
      const doll = ContentStore.doll(manifest, dollId);
      if (!doll.categories.some((c) => c.id === input.category)) throw new ContentError(`カテゴリ「${input.category}」がありません`, 404);
      const existing = input.replaceId ? doll.items.find((i) => i.id === input.replaceId) : undefined;
      if (input.replaceId && !existing) throw new ContentError(`置き換えるアイテム「${input.replaceId}」がありません`, 404);
      // セット: 無ければ作る（名前は、最初に保存した服のときのもの）
      let setId: string | undefined;
      if (input.set) {
        // セットの ID は「ドールの ID/セット/名前」なので、名前より長い
        setId = checkName(input.set.id, 'セットの ID', 200);
        if (!doll.sets?.some((x) => x.id === setId)) doll.sets = [...(doll.sets ?? []), { id: setId, name: checkPlainName(input.set.name, 'セットの名前') }];
      }
      const { image, thumb, hide, back, backThumb, under } = await encodeItemImages(doll, input, this.writer);
      const encoded = { image, thumb };
      if (existing) {
        if (back) existing.back = back;
        else delete existing.back;
        if (backThumb) existing.backThumb = backThumb;
        else delete existing.backThumb;
        if (under) existing.under = under;
        else delete existing.under;
        existing.name = name;
        existing.category = input.category;
        existing.image = encoded.image;
        existing.thumb = encoded.thumb;
        if (hide) existing.hide = hide;
        else delete existing.hide;
        if (setId) setItemSets(existing, [...itemSetIds(existing), setId]);
        return existing;
      }
      const item: ManifestItem = {
        id: uniqueId(`${doll.id}/${input.category}/${name}`, new Set(doll.items.map((i) => i.id))),
        name,
        category: input.category,
        image: encoded.image,
        thumb: encoded.thumb,
        ...(hide ? { hide } : {}),
        ...(back ? { back } : {}),
        ...(backThumb ? { backThumb } : {}),
        ...(under ? { under } : {}),
        ...(setId ? { set: setId } : {}),
      };
      doll.items.push(item);
      return item;
    });
  }

  // 改名・カテゴリ移動・重ね順などの変更。ID は変えない。layer / overlap に null を渡すと、カテゴリの値に戻す。
  // set: null で全部のセットから外す。セットの ID で、そのセットにも入れる（ほかのセットからは外さない）。
  // { name } で、新しいセットを作って入れる。leaveSet: そのセットだけから外す
  updateItem(itemId: string, change: { name?: string; category?: string; layer?: number | null; overlap?: boolean | null; set?: null | string | { name: string }; leaveSet?: string }): Promise<ManifestItem> {
    return this.change((manifest) => {
      const { doll, item } = ContentStore.findItem(manifest, itemId);
      if (change.name !== undefined) item.name = checkPlainName(change.name, '名前');
      if (change.category !== undefined) {
        if (!doll.categories.some((c) => c.id === change.category)) throw new ContentError(`カテゴリ「${change.category}」がありません`, 404);
        item.category = change.category;
      }
      if (change.layer === null) delete item.layer;
      else if (change.layer !== undefined) item.layer = change.layer;
      if (change.overlap === null) delete item.overlap;
      else if (change.overlap !== undefined) item.overlap = change.overlap;
      if (change.set === null) delete item.set;
      else if (typeof change.set === 'string') {
        const id = change.set;
        if (!doll.sets?.some((x) => x.id === id)) throw new ContentError(`セット「${id}」がありません`, 404);
        setItemSets(item, [...itemSetIds(item), id]);
      } else if (change.set !== undefined) {
        const set = { id: this.newSetId(doll, change.set.name), name: checkPlainName(change.set.name, 'セットの名前') };
        doll.sets = [...(doll.sets ?? []), set];
        setItemSets(item, [...itemSetIds(item), set.id]);
      }
      if (change.leaveSet !== undefined) setItemSets(item, itemSetIds(item).filter((id) => id !== change.leaveSet));
      return item;
    });
  }

  // ドールの改名と、ゲームに出すかどうか（ID は変えない。hidden: false で項目ごと消す）
  updateDoll(dollId: string, change: { name?: string; hidden?: boolean }): Promise<ManifestDoll> {
    return this.change((manifest) => {
      const doll = ContentStore.doll(manifest, dollId);
      if (change.name !== undefined) doll.name = checkPlainName(change.name, 'ドールの名前');
      if (change.hidden === true) doll.hidden = true;
      else if (change.hidden === false) delete doll.hidden;
      return doll;
    });
  }

  // カテゴリの中の服の並び（メニューでの順番）を変える。ids はそのカテゴリの服の全部を、新しい順に。
  // ほかのカテゴリの服の位置は変えない（そのカテゴリの服がいた場所に、新しい順で入れ直す）
  reorderItems(dollId: string, categoryId: string, ids: string[]): Promise<void> {
    return this.change((manifest) => {
      const doll = ContentStore.doll(manifest, dollId);
      const current = doll.items.filter((i) => i.category === categoryId);
      if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.some((i) => i.id === id))) {
        throw new ContentError('並び替える服が、カテゴリの服と合いません。画面を読み直してください', 409);
      }
      const ordered = ids.map((id) => current.find((i) => i.id === id)!);
      let next = 0;
      doll.items = doll.items.map((i) => (i.category === categoryId ? ordered[next++] : i));
    });
  }

  // 服の位置と大きさを変える（ゲームで最初に着せたときの位置）。服の中心を軸に scale 倍してから、(dx, dy) だけ動かす（キャンバスの px）。
  // 後ろ髪・肌・隠す所も一緒に動かす。キャンバスの外に出た分は切れる。サムネイルは変えない
  async transformItem(itemId: string, t: { scale: number; dx: number; dy: number }): Promise<ManifestItem> {
    const ok = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
    if (!ok(t.scale, 0.2, 5) || !ok(t.dx, -4096, 4096) || !ok(t.dy, -4096, 4096)) throw new ContentError('位置と大きさの値が正しくありません');
    return this.change(async (manifest) => {
      const { item } = ContentStore.findItem(manifest, itemId);
      // 軸: 服の中心（キャンバスの中心からの位置。キャンバスの大きさが違う絵でも同じ点になる）
      const pivot = {
        x: item.image.box.x + item.image.box.w / 2 - item.image.canvasW / 2,
        y: item.image.box.y + item.image.box.h / 2 - item.image.canvasH / 2,
      };
      const move = async (image: ManifestImage, mask: boolean): Promise<ManifestImage | null> => {
        const { canvasW: width, canvasH: height, box } = image;
        const left = Math.round(t.scale * (box.x - width / 2 - pivot.x) + pivot.x + t.dx + width / 2);
        const top = Math.round(t.scale * (box.y - height / 2 - pivot.y) + pivot.y + t.dy + height / 2);
        const w = Math.max(1, Math.round(box.w * t.scale));
        const h = Math.max(1, Math.round(box.h * t.scale));
        const { data } = await sharp(path.join(this.dir, image.file)).ensureAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
        const out = new Uint8ClampedArray(width * height * 4);
        const x0 = Math.max(0, left);
        const x1 = Math.min(width, left + w);
        for (let y = Math.max(0, top); y < Math.min(height, top + h); y++) {
          if (x1 <= x0) break;
          const from = ((y - top) * w + (x0 - left)) * 4;
          out.set(data.subarray(from, from + (x1 - x0) * 4), (y * width + x0) * 4);
        }
        if (!mask) return encodeLayer(out, width, height, this.writer);
        const alpha = new Uint8Array(width * height);
        for (let p = 0; p < alpha.length; p++) alpha[p] = out[p * 4 + 3];
        return encodeMask(alpha, width, height, this.writer);
      };
      const image = await move(item.image, false);
      if (!image) throw new ContentError('服がキャンバスの外に出てしまいます');
      const back = item.back ? await move(item.back, false) : null;
      const under = item.under ? await move(item.under, false) : null;
      const hide = item.hide ? await move(item.hide, true) : null;
      item.image = image;
      if (item.back) {
        if (back) item.back = back;
        else delete item.back;
      }
      if (item.under) {
        if (under) item.under = under;
        else delete item.under;
      }
      if (item.hide) {
        if (hide) item.hide = hide;
        else delete item.hide;
      }
      return item;
    });
  }

  // 新しいセットの ID（ドールの中で重ならない）。セットそのものは、最初の服を保存したときにできる
  newSetId(doll: ManifestDoll, name: string): string {
    return uniqueId(`${doll.id}/セット/${checkPlainName(name, 'セットの名前')}`, new Set((doll.sets ?? []).map((x) => x.id)));
  }

  // セットの名前を変える（ID と、服の印はそのまま）
  renameSet(dollId: string, setId: string, name: string): Promise<ManifestSet> {
    return this.change((manifest) => {
      const set = ContentStore.doll(manifest, dollId).sets?.find((x) => x.id === setId);
      if (!set) throw new ContentError(`セット「${setId}」がありません`, 404);
      set.name = checkPlainName(name, 'セットの名前');
      return { ...set };
    });
  }

  // セットの並び（ゲームのメニューでの順番）を変える。ids はそのドールのセットの全部を、新しい順に
  reorderSets(dollId: string, ids: string[]): Promise<void> {
    return this.change((manifest) => {
      const doll = ContentStore.doll(manifest, dollId);
      const current = doll.sets ?? [];
      if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length || !ids.every((id) => current.some((x) => x.id === id))) {
        throw new ContentError('並び替えるセットが、ドールのセットと合いません。画面を読み直してください', 409);
      }
      doll.sets = ids.map((id) => current.find((x) => x.id === id)!);
    });
  }

  // セットを着たときの、服の重なりの順番（そのセットだけの値。null で服の重ね順に戻す）
  setSetLayer(dollId: string, setId: string, itemId: string, layer: number | null): Promise<ManifestSet> {
    if (layer !== null && (typeof layer !== 'number' || !Number.isFinite(layer))) throw new ContentError('重ね順は数です');
    return this.change((manifest) => {
      const doll = ContentStore.doll(manifest, dollId);
      const set = doll.sets?.find((x) => x.id === setId);
      if (!set) throw new ContentError(`セット「${setId}」がありません`, 404);
      const item = doll.items.find((i) => i.id === itemId);
      if (!item || !itemSetIds(item).includes(setId)) throw new ContentError(`「${itemId}」は、このセットに入っていません`, 404);
      const layers = { ...(set.layers ?? {}) };
      if (layer === null) delete layers[itemId];
      else layers[itemId] = layer;
      if (Object.keys(layers).length > 0) set.layers = layers;
      else delete set.layers;
      return { ...set };
    });
  }

  deleteItem(itemId: string): Promise<void> {
    return this.change((manifest) => {
      const { doll } = ContentStore.findItem(manifest, itemId);
      doll.items = doll.items.filter((i) => i.id !== itemId);
    });
  }

  // 同じ id があれば上書き、無ければ追加
  async upsertCategory(dollId: string, category: ManifestCategory): Promise<ManifestCategory> {
    const checked: ManifestCategory = {
      id: checkPlainName(category.id, 'カテゴリの ID'),
      label: checkPlainName(category.label, 'カテゴリ名'),
      layer: category.layer,
      menuOrder: category.menuOrder,
      overlap: category.overlap,
      movable: category.movable,
    };
    return this.change((manifest) => {
      const doll = ContentStore.doll(manifest, dollId);
      const index = doll.categories.findIndex((c) => c.id === checked.id);
      if (index >= 0) doll.categories[index] = checked;
      else doll.categories.push(checked);
      return checked;
    });
  }

  // カテゴリの一部の項目だけを変える
  updateCategory(dollId: string, categoryId: string, change: Partial<Omit<ManifestCategory, 'id'>>): Promise<ManifestCategory> {
    return this.change((manifest) => {
      const category = ContentStore.doll(manifest, dollId).categories.find((c) => c.id === categoryId);
      if (!category) throw new ContentError(`カテゴリ「${categoryId}」がありません`, 404);
      if (change.label !== undefined) category.label = checkPlainName(change.label, 'カテゴリ名');
      if (change.layer !== undefined) category.layer = change.layer;
      if (change.menuOrder !== undefined) category.menuOrder = change.menuOrder;
      if (change.overlap !== undefined) category.overlap = change.overlap;
      if (change.movable !== undefined) category.movable = change.movable;
      return category;
    });
  }

  // 新しいカテゴリを作る。同じ id があれば Error（既存の設定を上書きしない）
  async createCategory(dollId: string, category: ManifestCategory): Promise<ManifestCategory> {
    const manifest = await this.read();
    if (ContentStore.doll(manifest, dollId).categories.some((c) => c.id === category.id)) {
      throw new ContentError(`カテゴリ「${category.label}」はすでにあります`, 409);
    }
    return this.upsertCategory(dollId, category);
  }

  reorderCategories(dollId: string, order: { id: string; layer: number; menuOrder: number }[]): Promise<void> {
    return this.change((manifest) => {
      const doll = ContentStore.doll(manifest, dollId);
      for (const o of order) {
        const category = doll.categories.find((c) => c.id === o.id);
        if (!category) throw new ContentError(`カテゴリ「${o.id}」がありません`, 404);
        category.layer = o.layer;
        category.menuOrder = o.menuOrder;
      }
    });
  }

  deleteCategory(dollId: string, categoryId: string): Promise<void> {
    return this.change((manifest) => {
      const doll = ContentStore.doll(manifest, dollId);
      if (!doll.categories.some((c) => c.id === categoryId)) throw new ContentError(`カテゴリ「${categoryId}」がありません`, 404);
      const count = doll.items.filter((i) => i.category === categoryId).length;
      if (count > 0) throw new ContentError(`カテゴリ「${categoryId}」には服が ${count} 点あります。先に服を移すか消してください`, 409);
      doll.categories = doll.categories.filter((c) => c.id !== categoryId);
    });
  }

  // dollId が null なら全ドール共通の背景
  async addBackground(dollId: string | null, input: { name: string; data: Buffer }): Promise<ManifestBackground> {
    const name = checkPlainName(input.name, '名前');
    return this.change(async (manifest) => {
      const list = dollId === null ? manifest.backgrounds : ContentStore.doll(manifest, dollId).backgrounds;
      const all = new Set([...manifest.backgrounds, ...manifest.dolls.flatMap((d) => d.backgrounds)].map((b) => b.id));
      const id = uniqueId(dollId === null ? `bg/${name}` : `${dollId}/bg/${name}`, all);
      let background: ManifestBackground;
      try {
        background = await encodeBackground(input.data, id, name, this.writer);
      } catch (error) {
        throw new ContentError(`画像を読めませんでした（${(error as Error).message}）`);
      }
      list.push(background);
      return background;
    });
  }

  // 背景を、ほかのドールにも置く（target が null なら、全部のドールで使う背景）。絵は同じファイルを指す。
  // 置き先にもう同じ絵があれば、それを返す（増やさない）
  copyBackground(id: string, target: string | null): Promise<ManifestBackground> {
    return this.change((manifest) => {
      const source = [...manifest.backgrounds, ...manifest.dolls.flatMap((d) => d.backgrounds)].find((b) => b.id === id);
      if (!source) throw new ContentError(`背景「${id}」がありません`, 404);
      const list = target === null ? manifest.backgrounds : ContentStore.doll(manifest, target).backgrounds;
      const have = list.find((b) => b.file === source.file);
      if (have) return { ...have };
      const all = new Set([...manifest.backgrounds, ...manifest.dolls.flatMap((d) => d.backgrounds)].map((b) => b.id));
      const copy: ManifestBackground = { ...source, id: uniqueId(target === null ? `bg/${source.name}` : `${target}/bg/${source.name}`, all) };
      list.push(copy);
      return { ...copy };
    });
  }

  deleteBackground(id: string): Promise<void> {
    return this.change((manifest) => {
      const lists = [manifest, ...manifest.dolls];
      const owner = lists.find((l) => l.backgrounds.some((b) => b.id === id));
      if (!owner) throw new ContentError(`背景「${id}」がありません`, 404);
      owner.backgrounds = owner.backgrounds.filter((b) => b.id !== id);
    });
  }

  // 透過画像からドールを追加する。長辺 1024px に縮め、正方形のキャンバスの中央に置く
  async addDoll(input: { name: string; data: Buffer; categories?: ManifestCategory[] }): Promise<ManifestDoll> {
    const name = checkPlainName(input.name, 'ドールの名前');
    return this.change(async (manifest) => {
      let data: Buffer;
      let info: sharp.OutputInfo;
      try {
        // 背景が透明かどうかは、余白を切り落とす前の画像で確かめる
        const whole = await sharp(input.data).ensureAlpha().raw().toBuffer();
        let transparent = 0;
        for (let i = 3; i < whole.length; i += 4) if (whole[i] < 8) transparent++;
        if (transparent < whole.length / 4 / 20) {
          throw new ContentError('背景が透明ではないようです。背景を透明にした画像（PNG または WebP）を選んでください');
        }
        ({ data, info } = await sharp(input.data)
          .ensureAlpha()
          .trim({ threshold: 0 })
          .resize({ width: Math.round(MAX_SIZE * 0.96), height: Math.round(MAX_SIZE * 0.96), fit: 'inside', withoutEnlargement: false })
          .raw()
          .toBuffer({ resolveWithObject: true }));
      } catch (error) {
        if (error instanceof ContentError) throw error;
        throw new ContentError(`画像を読めませんでした（${(error as Error).message}）`);
      }
      const canvas = new Uint8ClampedArray(MAX_SIZE * MAX_SIZE * 4);
      const left = Math.round((MAX_SIZE - info.width) / 2);
      const top = Math.round((MAX_SIZE - info.height) / 2);
      for (let y = 0; y < info.height; y++) {
        canvas.set(data.subarray(y * info.width * 4, (y + 1) * info.width * 4), ((top + y) * MAX_SIZE + left) * 4);
      }
      const encoded = await encodeCutout(canvas, MAX_SIZE, MAX_SIZE, this.writer);
      if (!encoded) throw new ContentError('画像が全部透明です');
      const doll: ManifestDoll = {
        id: uniqueId(name, new Set(manifest.dolls.map((d) => d.id))),
        name,
        image: encoded.image,
        categories: (input.categories ?? DEFAULT_CATEGORIES).map((c) => ({ ...c })),
        items: [],
        backgrounds: [],
      };
      manifest.dolls.push(doll);
      return doll;
    });
  }

  // 一覧から参照されていない files/ の画像（このツールが書いた、ハッシュ名のファイルだけ）
  private async unusedFiles(): Promise<string[]> {
    const text = JSON.stringify(await this.read());
    const entries = await fs.readdir(path.join(this.dir, 'files'), { withFileTypes: true }).catch(() => []);
    return entries
      .filter((e) => e.isFile() && /^[0-9a-f]{16}\.(webp|jpg)$/.test(e.name) && !text.includes(`files/${e.name}`))
      .map((e) => e.name)
      .sort();
  }

  // 使われていない画像を消す。消した名前を返す。ほかの変更と重ならないよう、順番待ちに入れる
  removeUnusedFiles(): Promise<string[]> {
    const run = this.queue.then(async () => {
      const names = await this.unusedFiles();
      for (const name of names) await fs.rm(path.join(this.dir, 'files', name), { force: true });
      return names;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  // 使われていない画像の数（公開前の表示用）
  async countUnusedFiles(): Promise<number> {
    return (await this.unusedFiles()).length;
  }

  // 型紙など、スタジオだけが使うデータ（studio/<名前>.json）
  async readStudioData<T>(name: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(path.join(this.dir, 'studio', `${name}.json`), 'utf8')) as T;
    } catch {
      return fallback;
    }
  }
  // 読む → 変える → 書く、を 1 つずつ順に行う
  updateStudioData<T>(name: string, fallback: T, update: (current: T) => T): Promise<T> {
    const run = this.queue.then(async () => {
      const next = update(await this.readStudioData(name, fallback));
      await this.writeStudioData(name, next);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
  async writeStudioData(name: string, value: unknown): Promise<void> {
    if (!/^[a-z0-9-]+$/.test(name)) throw new ContentError('名前が正しくありません');
    const dir = path.join(this.dir, 'studio');
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name}.json`);
    await fs.writeFile(`${file}.tmp`, JSON.stringify(value, null, 1) + '\n');
    await fs.rename(`${file}.tmp`, file);
  }
}
