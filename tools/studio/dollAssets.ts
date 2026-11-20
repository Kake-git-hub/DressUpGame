/**
 * ドールの型（絵・輪郭・型紙）と、保存用の絵づくり
 *
 * PC のスタジオ（素材フォルダから読む）と、サーバーの関数（公開されている素材から読む）の両方で使う。
 * どこから読むかは AssetSource が決める。
 */
import sharp from 'sharp';
import type { Box, ManifestDoll } from '../../src/content/manifest.ts';
import { defaultRegion, estimateBodyParts } from '../../src/pipeline/bodyParts.ts';
import { hairFromMask, hairThumbs } from '../../src/pipeline/hairLayers.ts';
import { hairFrontBottom, splitHair, splitsHair } from '../../src/pipeline/hairSplit.ts';
import { ContentError } from '../content/manifestEdit.ts';
import type { ItemInput } from '../content/manifestEdit.ts';
import type { TemplateData } from './generate.ts';
import { dollTemplateFromImage, padTemplate, workPad } from './processGenerated.ts';
import type { DollTemplate } from './processGenerated.ts';
import { pngToRgba } from './silhouette.ts';

export interface AssetSource {
  // 素材の置き場からの相対パス（files/…、studio/masters/…）。無ければ null
  readFile(file: string): Promise<Buffer | null>;
  // 保存されている型紙（studio/templates.json。ドールの ID → 型紙）。無ければ {}
  readTemplates(): Promise<Record<string, TemplateData>>;
}

type Image = { rgba: Uint8ClampedArray; width: number; height: number };
export type HairLayers = Image & { back?: Uint8ClampedArray; thumbFrom?: Uint8ClampedArray; backThumbFrom?: Uint8ClampedArray };

// くつのサムネイル用: 靴の絵の下に、靴の中の肌を重ねた絵
function withUnder(rgba: Uint8ClampedArray, under: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(under);
  for (let i = 0; i < out.length; i += 4) {
    const a = rgba[i + 3] / 255;
    if (a === 0) continue;
    const b = out[i + 3] / 255;
    const alpha = a + b * (1 - a);
    for (let c = 0; c < 3; c++) out[i + c] = Math.round((rgba[i + c] * a + out[i + c] * b * (1 - a)) / alpha);
    out[i + 3] = Math.round(alpha * 255);
  }
  return out;
}

export class DollAssets {
  private readonly source: AssetSource;
  private readonly templates = new Map<string, DollTemplate>();
  constructor(source: AssetSource) {
    this.source = source;
  }

  // ドールの画像が変わったかもしれないとき、読み込んだ型を捨てる
  clear(): void {
    this.templates.clear();
  }

  async dollTemplate(doll: ManifestDoll): Promise<DollTemplate> {
    const key = `${doll.id}\n${doll.image.file}`;
    let template = this.templates.get(key);
    if (!template) {
      const data = await this.source.readFile(doll.image.file);
      if (!data) throw new ContentError(`ドールの画像（${doll.image.file}）を読めませんでした`, 500);
      template = await dollTemplateFromImage(data, doll.image);
      this.templates.set(key, template);
    }
    return template;
  }

  // 余白を足した、作業用の型（生成と切り抜きはこの上で行う）
  async workTemplate(doll: ManifestDoll): Promise<DollTemplate> {
    const key = `${doll.id}\n${doll.image.file}\nwork`;
    let template = this.templates.get(key);
    if (!template) {
      const base = await this.dollTemplate(doll);
      template = padTemplate(base, workPad(base.canvasW));
      this.templates.set(key, template);
    }
    return template;
  }

  // 拡大図のもとにする、高解像度の作業用の型。置き場の studio/masters/ に、ドールの画像と同じ名前の
  // 整数倍の画像があればそれを使う。無ければ、ふつうの作業用の型（scale 1）
  async hiTemplate(doll: ManifestDoll): Promise<{ template: DollTemplate; scale: number }> {
    const key = `${doll.id}\n${doll.image.file}\nhi`;
    const cached = this.templates.get(key);
    const work = await this.workTemplate(doll);
    if (cached) return { template: cached, scale: cached.canvasW / work.canvasW };
    const name = doll.image.file.split('/').pop()!.replace(/\.[^.]+$/, '');
    const data = await this.source.readFile(`studio/masters/${name}.webp`);
    if (!data) return { template: work, scale: 1 };
    const meta = await sharp(data).metadata();
    const scale = Math.round((meta.width ?? 0) / doll.image.box.w);
    if (!(scale >= 2 && scale <= 4)) return { template: work, scale: 1 };
    const { canvasW, canvasH, box } = doll.image;
    const base = await dollTemplateFromImage(data, { file: doll.image.file, canvasW: canvasW * scale, canvasH: canvasH * scale, box: { x: box.x * scale, y: box.y * scale, w: box.w * scale, h: box.h * scale } });
    const template = padTemplate(base, workPad(canvasW) * scale);
    this.templates.set(key, template);
    return { template, scale };
  }

  // 型紙: 保存されたものがあればそれ、無ければ輪郭から推定する。あとから増えたカテゴリの範囲は補う
  async templateData(doll: ManifestDoll): Promise<TemplateData> {
    const all = await this.source.readTemplates();
    const template = await this.dollTemplate(doll);
    let data: TemplateData | undefined = all[doll.id];
    if (!data || !data.parts || !data.regions) {
      const parts = estimateBodyParts(template.mask, template.canvasW, template.canvasH);
      if (!parts) throw new ContentError('ドールの画像が全部透明です', 500);
      data = { parts, regions: {} };
    }
    // 以前の型紙にあった絵柄の項目は使わない（絵柄は「テーマから作る」で選ぶ）
    data = { parts: data.parts, regions: { ...data.regions } };
    for (const c of doll.categories) {
      if (!(c.id in data.regions)) data.regions[c.id] = defaultRegion(c.label, data.parts, template.canvasW, template.canvasH);
    }
    return data;
  }

  // 型紙（ドールのキャンバス上の位置）を、作業用のキャンバス上の位置に直す
  async workData(doll: ManifestDoll): Promise<TemplateData> {
    const data = await this.templateData(doll);
    const pad = workPad(doll.image.canvasW);
    const shift = (b: Box): Box => ({ ...b, x: b.x + pad, y: b.y + pad });
    return {
      parts: Object.fromEntries(Object.entries(data.parts).map(([k, b]) => [k, shift(b)])) as TemplateData['parts'],
      regions: Object.fromEntries(Object.entries(data.regions).map(([k, b]) => [k, b ? shift(b) : null])),
    };
  }

  // 髪を、前髪（ドールの上）と後ろ髪（ドールの下）に分ける。髪でなければ、そのまま返す。
  // force: カテゴリの名前にかかわらず分ける。shape: AI が描いた体と髪の形。front: 前髪の範囲（あれば、これで分ける）
  async hairLayers(doll: ManifestDoll, category: string, image: Image, force = false, shape: Uint8Array | null = null, front: Uint8Array | null = null): Promise<HairLayers> {
    const label = doll.categories.find((c) => c.id === category)?.label ?? category;
    // うしろがみを別の品目として作るドールでは、髪は分けない（髪のカテゴリは前髪だけ）
    if (!force && !splitsHair(label, doll.categories.map((c) => c.label))) return image;
    // 服は、ドールのキャンバスか、余白を足した作業用のキャンバス。大きさに合うほうの型を使う
    let template = await this.dollTemplate(doll);
    if (template.canvasW !== image.width) template = await this.workTemplate(doll);
    if (template.canvasW !== image.width || template.canvasH !== image.height) return image; // 大きさの違いは、保存のときに断られる
    const alpha = new Uint8Array(image.width * image.height);
    for (let p = 0; p < alpha.length; p++) alpha[p] = template.rgba[p * 4 + 3];
    let split: { front: Uint8ClampedArray; back: Uint8ClampedArray } | null;
    if (front) {
      split = hairFromMask(image.rgba, front, alpha, image.width, image.height);
    } else {
      // 前に残すのは、頭のまわりの前髪だけ
      const head = (await this.templateData(doll)).parts.head;
      const padY = Math.round((image.height - doll.image.canvasH) / 2);
      split = splitHair(image.rgba, alpha, image.width, image.height, undefined, { frontBottom: hairFrontBottom(head) + padY, bodyShape: shape ?? undefined });
    }
    if (!split) return image;
    const thumbs = hairThumbs(split.front, split.back, alpha, image.width, image.height);
    return { rgba: split.front, width: image.width, height: image.height, back: split.back, thumbFrom: thumbs.hair, backThumbFrom: thumbs.back };
  }

  /**
   * 候補の絵（PNG）から、保存するときの入力を作る。
   * png: 服（ドールのキャンバス、または余白つきの作業用のキャンバス）。front: 髪の前髪の範囲。under: くつの中の肌。
   * shape: AI が描いた体と服の形。hide: 着ているあいだドールを隠す所。どれも png と同じ大きさ。
   * 画像が読めない・大きさが合わないときは ContentError（400）
   */
  async itemInput(
    doll: ManifestDoll,
    input: { category: string; name: string; png: Buffer; hide?: Buffer | null; shape?: Buffer | null; front?: Buffer | null; under?: Buffer | null; replaceId?: string; set?: { id: string; name: string } },
  ): Promise<ItemInput> {
    let image: Image;
    let hide: Uint8Array | null = null;
    let shape: Uint8Array | null = null;
    let front: Uint8Array | null = null;
    let under: Uint8ClampedArray | null = null;
    const alphaOf = (layer: Image): Uint8Array => {
      const out = new Uint8Array(layer.width * layer.height);
      for (let p = 0; p < out.length; p++) out[p] = layer.rgba[p * 4 + 3];
      return out;
    };
    try {
      image = await pngToRgba(input.png);
      // 髪の前髪の範囲（不透明度）と、くつの中の肌の絵。どちらも服と同じ大きさ
      if (input.front) {
        const f = await pngToRgba(input.front);
        if (f.width !== image.width || f.height !== image.height) throw new ContentError('前髪の範囲の画像の大きさが服と違います');
        front = alphaOf(f);
      }
      if (input.under) {
        const u = await pngToRgba(input.under);
        if (u.width !== image.width || u.height !== image.height) throw new ContentError('肌の画像の大きさが服と違います');
        under = u.rgba;
      }
      if (input.shape) {
        const s = await pngToRgba(input.shape);
        if (s.width === image.width && s.height === image.height) shape = alphaOf(s);
      }
      if (input.hide) {
        const mask = await pngToRgba(input.hide);
        if (mask.width !== image.width || mask.height !== image.height) throw new ContentError('隠す所の画像の大きさが服と違います');
        // 隠す所は、ドールのキャンバス上の位置で持つ。服が余白つきのキャンバスなら、まん中（ドールのキャンバス）を切り出す
        const padX = (mask.width - doll.image.canvasW) / 2;
        const padY = (mask.height - doll.image.canvasH) / 2;
        if (padX < 0 || padY < 0 || !Number.isInteger(padX) || !Number.isInteger(padY)) throw new ContentError('隠す所の画像の大きさがドールのキャンバスと合いません');
        hide = new Uint8Array(doll.image.canvasW * doll.image.canvasH);
        for (let y = 0; y < doll.image.canvasH; y++) {
          for (let x = 0; x < doll.image.canvasW; x++) hide[y * doll.image.canvasW + x] = mask.rgba[((y + padY) * mask.width + x + padX) * 4 + 3];
        }
      }
    } catch (error) {
      if (error instanceof ContentError) throw error;
      throw new ContentError('画像を読めませんでした');
    }
    const layers = await this.hairLayers(doll, input.category, image, false, shape, front);
    // くつのサムネイルは、靴の中の肌も入れた絵から作る（靴の開きが透けて見えないように）
    const thumbFrom = under && !layers.thumbFrom ? withUnder(image.rgba, under) : layers.thumbFrom;
    return { category: input.category, name: input.name, ...layers, thumbFrom, under, replaceId: input.replaceId, hide, ...(input.set ? { set: input.set } : {}) };
  }
}
