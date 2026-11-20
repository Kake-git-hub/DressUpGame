/**
 * 髪の取り出し（本物のドールの上半身の拡大図に描かせた絵 1 枚 → 髪の全体と、前髪の範囲）
 *
 * 拡大図の上で、AI の絵を渡した絵に位置合わせしてから髪を取り出し（src/pipeline/hairLayers.ts）、キャンバスに戻す。
 * 前髪・後ろ髪・体の裏の塗りつぶしは、保存のときに作る（手直しのあとの絵から作るため）。
 */
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import { matchToReference } from '../../src/pipeline/diffMatte.ts';
import type { Tile } from '../../src/pipeline/frames.ts';
import { extractHair } from '../../src/pipeline/hairLayers.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import { pasteTile, pasteTileAlpha } from './frame.ts';
import type { DollTemplate, ProcessResult, ProcessWarning } from './processGenerated.ts';
import { SCALE_MAX, SCALE_MIN, tileOf } from './processSwap.ts';

export interface HairResult extends ProcessResult {
  front: Uint8Array;
}

// 髪の画素が、枠の画素数をこれで割った数より少なければ「何も描かれていない」
const EMPTY_DIVISOR = 1500;
// 髪が、枠の端からこの割合の帯に届いていたら「切れているかもしれない」
const EDGE_BAND = 0.01;
// 髪から離れた所の描き変え（ドールの画素に対する割合）と、重ね直した絵の違い（枠の画素に対する割合）。
// 本物の絵（2026-11-20 の試作 3 点）では、それぞれ 0.003 以下、0.012 以下
const STRAY_LIMIT = 0.01;
const UNLIKE_LIMIT = 0.05;
// ドールの上の髪のうち、下の絵との色の差がわずかな画素の割合。本物の絵（うすいピンクを含む）では 0.09 以下
const CLOSE_TO_SKIN_LIMIT = 0.25;

/**
 * generated: AI が返した絵。reference: AI に渡した拡大図。tileDoll: 枠の中のドール（to の大きさ）。
 * tile: 拡大図の枠。canvasW・canvasH: 戻す先（作業用キャンバス）の大きさ。background: 拡大図の背景色
 */
export async function processHair(generated: Buffer, reference: Buffer, tileDoll: DollTemplate, tile: Tile, canvasW: number, canvasH: number, background: Rgb): Promise<HairResult> {
  const { w, h } = tile.to;
  let image: Uint8ClampedArray;
  try {
    image = await tileOf(generated, tile);
  } catch (error) {
    throw new Error(`画像を読めませんでした（${(error as Error).message}）`);
  }
  const ref = await tileOf(reference, tile);
  const match = matchToReference(image, ref, w, h);
  const dollAlpha = new Uint8Array(w * h);
  for (let p = 0; p < dollAlpha.length; p++) dollAlpha[p] = tileDoll.rgba[p * 4 + 3];
  const hair = extractHair(match.rgba, ref, dollAlpha, w, h, background);

  const rgba = new Uint8ClampedArray(canvasW * canvasH * 4);
  const source = new Uint8ClampedArray(canvasW * canvasH * 4);
  const front = new Uint8Array(canvasW * canvasH);
  await pasteTile(rgba, canvasW, canvasH, hair.rgba, tile);
  await pasteTile(source, canvasW, canvasH, match.rgba, tile);
  await pasteTileAlpha(front, canvasW, canvasH, hair.front, tile);
  for (let p = 0; p < front.length; p++) {
    if (rgba[p * 4 + 3] < 8) rgba[p * 4 + 3] = 0;
    if (rgba[p * 4 + 3] === 0) front[p] = 0;
  }

  const warnings: ProcessWarning[] = [];
  let pixels = 0;
  for (let p = 0; p < w * h; p++) if (hair.rgba[p * 4 + 3] >= 128) pixels++;
  const box = alphaBBox(hair.rgba, w, h);
  if (!box || pixels < (w * h) / EMPTY_DIVISOR) {
    warnings.push({ code: 'empty', message: '髪が見つかりません（元の絵から何も変わっていませんでした）' });
  } else {
    const band = Math.max(1, Math.round(Math.min(w, h) * EDGE_BAND));
    if (box.x < band || box.y < band || box.x + box.w > w - band || box.y + box.h > h - band) {
      warnings.push({ code: 'touches-edge', message: '髪が拡大図の端まで届いています。切れているかもしれません（短く、または小さくしてください）' });
    }
    if (match.scale <= SCALE_MIN || match.scale >= SCALE_MAX) {
      warnings.push({ code: 'poor-fit', message: 'AI が絵の大きさや位置を変えたようです。位置がずれているかもしれません' });
    }
    if (hair.stray > STRAY_LIMIT || hair.unlike > UNLIKE_LIMIT) {
      warnings.push({ code: 'repainted', message: 'AI がドールごと描き直したようです。髪以外の所が変わっているかもしれません' });
    }
    if (hair.closeToSkin > CLOSE_TO_SKIN_LIMIT) {
      warnings.push({ code: 'color-too-close', message: '髪の色がドールの肌の色に近く、髪の一部が欠けているかもしれません' });
    }
  }
  return {
    rgba,
    source,
    front,
    width: canvasW,
    height: canvasH,
    keyColors: { background, silhouette: null },
    alignment: { scale: match.scale, dx: match.dx, dy: match.dy, score: 1 },
    anchorShift: null,
    partShifts: [],
    shape: null,
    closeColorRatio: hair.closeToSkin,
    warnings,
  };
}
