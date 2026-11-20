/**
 * 靴の取り出し（本物の脚の拡大図に描かせた絵 1 枚 → 靴・肌・隠す所）
 *
 * 拡大図の上で、AI の絵を渡した絵に位置合わせしてから分け（src/pipeline/shoeLayers.ts）、キャンバスに戻す。
 * てぶくろは、まだ processSwap.ts（手首から先を、肌ごと 1 枚に差し替える）のまま。
 */
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import type { Box } from '../../src/pipeline/alpha.ts';
import { cutOutClothing } from '../../src/pipeline/cutout.ts';
import { matchToReference } from '../../src/pipeline/diffMatte.ts';
import type { Tile } from '../../src/pipeline/frames.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import { extractShoe } from '../../src/pipeline/shoeLayers.ts';
import { pasteTile, pasteTileAlpha, toTile } from './frame.ts';
import type { DollTemplate, ProcessWarning } from './processGenerated.ts';
import { SCALE_MAX, SCALE_MIN, tileOf } from './processSwap.ts';
import type { SwapResult } from './processSwap.ts';

export interface ShoeResult extends SwapResult {
  under: Uint8ClampedArray; // 肌（キャンバス大）。ドールのすぐ上に描く
}

// processSwap.ts と同じ値
const REPAINT_LIMIT = 0.25;
const CLOSE_COLOR_LIMIT = 0.05;
const EMPTY_DIVISOR = 1500;
// 線より下の絵のうち、靴の画素がこの割合より少なければ、靴が肌と見分けられていない（肌の色の靴）。
// 本物の絵では、サンダルで 0.5 前後
const SHOE_SHARE_MIN = 0.2;

/**
 * generated: AI が返した絵。reference: AI に渡した拡大図。doll: 作業用キャンバスの型（大きさだけ使う）。
 * tiles: 拡大図の枠。zones: 差し替える範囲（キャンバス上。上の端が足首の線）。background: 拡大図の背景色
 */
export async function processShoe(generated: Buffer, reference: Buffer, doll: DollTemplate, tiles: Tile[], zones: Box[], background: Rgb): Promise<ShoeResult> {
  const { canvasW, canvasH } = doll;
  const rgba = new Uint8ClampedArray(canvasW * canvasH * 4);
  const under = new Uint8ClampedArray(canvasW * canvasH * 4);
  const source = new Uint8ClampedArray(canvasW * canvasH * 4);
  const hide = new Uint8Array(canvasW * canvasH);
  const sum = { drawn: 0, body: 0, changed: 0, kept: 0, close: 0, shoePixels: 0, skinPixels: 0, area: 0 };
  let cutOff = false;
  let poorFit = false;
  let alignment = { scale: 1, dx: 0, dy: 0, score: 1 };

  for (const tile of tiles) {
    const { w, h } = tile.to;
    let image: Uint8ClampedArray;
    try {
      image = await tileOf(generated, tile);
    } catch (error) {
      throw new Error(`画像を読めませんでした（${(error as Error).message}）`);
    }
    const ref = await tileOf(reference, tile);
    const match = matchToReference(image, ref, w, h);
    alignment = { scale: match.scale, dx: match.dx, dy: match.dy, score: 1 };
    if (match.scale <= SCALE_MIN || match.scale >= SCALE_MAX) poorFit = true;

    // 元の図のドール（背景でない所）
    const refCut = new Uint8ClampedArray(ref);
    cutOutClothing(refCut, w, h, { background, silhouette: null });
    const dollAlpha = new Uint8Array(w * h);
    for (let p = 0; p < dollAlpha.length; p++) dollAlpha[p] = refCut[p * 4 + 3];

    const zoneTop = Math.max(0, Math.min(h, Math.min(...zones.map((z) => toTile(z, tile).y))));
    const parts = extractShoe(match.rgba, ref, dollAlpha, w, h, background, zoneTop);
    await pasteTile(rgba, canvasW, canvasH, parts.shoe, tile);
    await pasteTile(under, canvasW, canvasH, parts.under, tile);
    await pasteTile(source, canvasW, canvasH, match.rgba, tile);
    await pasteTileAlpha(hide, canvasW, canvasH, parts.hide, tile);
    sum.drawn += parts.drawn;
    sum.body += parts.body;
    sum.changed += parts.changed;
    sum.kept += parts.kept;
    sum.close += parts.close;
    sum.shoePixels += parts.shoePixels;
    sum.skinPixels += parts.skinPixels;
    sum.area += w * h;
    if (parts.cutOff) cutOff = true;
  }
  for (let i = 3; i < rgba.length; i += 4) {
    if (rgba[i] < 8) rgba[i] = 0;
    if (under[i] < 8) under[i] = 0;
  }

  const warnings: ProcessWarning[] = [];
  if (!alphaBBox(rgba, canvasW, canvasH) || sum.drawn < sum.area / EMPTY_DIVISOR) {
    warnings.push({ code: 'empty', message: '品目が見つかりません（元の絵から何も変わっていませんでした）' });
  } else {
    const shoeShare = sum.shoePixels / Math.max(1, sum.shoePixels + sum.skinPixels);
    if ((sum.kept > 0 && sum.close / sum.kept > CLOSE_COLOR_LIMIT) || shoeShare < SHOE_SHARE_MIN) {
      warnings.push({
        code: 'color-too-close',
        message: shoeShare < SHOE_SHARE_MIN ? 'くつの色がドールの肌の色に近く、くつと肌を見分けられませんでした' : '品目の色が背景の色に近く、一部が欠けているかもしれません',
      });
    }
    if (cutOff) warnings.push({ code: 'touches-edge', message: '品目が拡大図の上の端まで届いています。切れているかもしれません（丈を短くしてください）' });
    if (poorFit) warnings.push({ code: 'poor-fit', message: 'AI が絵の大きさや位置を変えたようです。位置がずれているかもしれません' });
    if (sum.body > 0 && sum.changed / sum.body > REPAINT_LIMIT) {
      warnings.push({ code: 'repainted', message: 'AI が脚や腕ごと描き直したようです。肌の色や輪郭がドールと合わないかもしれません' });
    }
  }
  return {
    rgba,
    under,
    source,
    hide,
    width: canvasW,
    height: canvasH,
    keyColors: { background, silhouette: null },
    alignment,
    anchorShift: null,
    partShifts: [],
    shape: null,
    closeColorRatio: sum.kept > 0 ? sum.close / sum.kept : 0,
    warnings,
  };
}
