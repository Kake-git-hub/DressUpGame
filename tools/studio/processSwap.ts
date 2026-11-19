/**
 * 差し替え式の品目（くつ・てぶくろ）の取り出し
 *
 * ドールの本物の脚（腕）を拡大した図に「靴をはかせて」と頼み、返ってきた絵から品目を取り出す。
 *  - 差し替える範囲（足首から先・手首から先）: 背景以外をまるごと品目にする。靴の中に見える足の甲も、品目の絵の一部になる。
 *    着ているあいだ、ドールのその範囲は隠す（hide）。ドールの足の形と靴の形が合わなくても、はみ出さない。
 *  - 範囲の外（すね・前腕）: 元の図と違う所だけを品目にする（ブーツの筒など）。変わっていない肌は入れない
 *    （入れると、靴下やそでの上に肌がかぶさる）。
 */
import sharp from 'sharp';
import { alphaBBox } from '../../src/pipeline/alpha.ts';
import type { Box } from '../../src/pipeline/alpha.ts';
import { cutOutClothing } from '../../src/pipeline/cutout.ts';
import { diffMatte, matchToReference } from '../../src/pipeline/diffMatte.ts';
import { FRAME_SIZE } from '../../src/pipeline/frames.ts';
import type { Tile } from '../../src/pipeline/frames.ts';
import type { Rgb } from '../../src/pipeline/keyColors.ts';
import { pasteTile, toTile } from './frame.ts';
import type { DollTemplate, ProcessResult, ProcessWarning } from './processGenerated.ts';

export interface SwapResult extends ProcessResult {
  hide: Uint8Array; // キャンバス大の不透明度。着ているあいだドールを隠す所
}

// 範囲の外で、はっきり描き変えられた画素（ドールの上）がこの割合を超えたら、AI が脚（腕）ごと描き直した疑いがある
const REPAINT_LIMIT = 0.6;
// 位置合わせの倍率がこの範囲の端に張りついたら、元の図と合っていない
const SCALE_MIN = 0.93;
const SCALE_MAX = 1.07;
// 元の図との違い（diffMatte の不透明度）を、この px だけ太らせて使う（品目のふちのやわらかい所を欠かさない）
const GROW = 3;
// 肌の色合わせ: 変わっていない画素がこれより少なければ、合わせない
const MIN_MATCH_PIXELS = 200;
const EDGE_MARGIN = 0.03;
// 範囲の外の品目は、この太さ（枠の幅 ÷ CORE_PER の 2 倍 + 1 px 四方）の芯を持つかたまりだけ残す
const CORE_PER = 200;
// 元の図と違う画素が、枠の画素数をこれで割った数より少なければ「何も描かれていない」
const EMPTY_DIVISOR = 1500;

async function tileOf(image: Buffer, tile: Tile): Promise<Uint8ClampedArray> {
  const data = await sharp(image)
    .removeAlpha()
    .ensureAlpha()
    .resize(FRAME_SIZE, FRAME_SIZE, { fit: 'fill', kernel: 'lanczos3' })
    .extract({ left: tile.to.x, top: tile.to.y, width: tile.to.w, height: tile.to.h })
    .raw()
    .toBuffer();
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
}

function grow(alpha: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const tmp = new Uint8Array(alpha.length);
  const out = new Uint8Array(alpha.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let k = Math.max(0, x - r); k <= Math.min(width - 1, x + r); k++) m = Math.max(m, alpha[y * width + k]);
      tmp[y * width + x] = m;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let k = Math.max(0, y - r); k <= Math.min(height - 1, y + r); k++) m = Math.max(m, tmp[k * width + x]);
      out[y * width + x] = m;
    }
  }
  return out;
}

// mask のひと続きのかたまりのうち、まわり r px がすべて mask の画素（芯）を持つものだけを残す
function withCore(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const total = width * height;
  const run = new Uint8Array(total);
  const core = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    let length = 0;
    for (let x = 0; x < width; x++) {
      length = mask[y * width + x] ? length + 1 : 0;
      if (length >= r * 2 + 1) run[y * width + x - r] = 1;
    }
  }
  for (let x = 0; x < width; x++) {
    let length = 0;
    for (let y = 0; y < height; y++) {
      length = run[y * width + x] ? length + 1 : 0;
      if (length >= r * 2 + 1) core[(y - r) * width + x] = 1;
    }
  }
  const keep = new Uint8Array(total);
  const stack = new Int32Array(total);
  for (let start = 0; start < total; start++) {
    if (!core[start] || keep[start]) continue;
    let top = 0;
    stack[top++] = start;
    keep[start] = 1;
    while (top > 0) {
      const p = stack[--top];
      const x = p % width;
      for (const n of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
        if (n >= 0 && n < total && mask[n] && !keep[n]) {
          keep[n] = 1;
          stack[top++] = n;
        }
      }
    }
  }
  return keep;
}

const inBoxes = (boxes: Box[], x: number, y: number) => boxes.some((b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h);

/**
 * generated: AI が返した絵。reference: AI に渡した拡大図（renderFrame の結果）。doll: 作業用キャンバスの型。
 * tiles: 拡大図の枠。zones: 差し替える範囲（キャンバス上）。background: 拡大図の背景色
 */
export async function processSwap(generated: Buffer, reference: Buffer, doll: DollTemplate, tiles: Tile[], zones: Box[], background: Rgb): Promise<SwapResult> {
  const { canvasW, canvasH } = doll;
  const rgba = new Uint8ClampedArray(canvasW * canvasH * 4);
  const source = new Uint8ClampedArray(canvasW * canvasH * 4);
  const warnings: ProcessWarning[] = [];
  let changed = 0;
  let body = 0;
  let poorFit = false;
  let drawn = 0; // 元の図と違う画素（枠の上）
  let area = 0;
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

    const cut = new Uint8ClampedArray(match.rgba);
    cutOutClothing(cut, w, h, { background, silhouette: null });
    const matte = diffMatte(match.rgba, ref, w, h);
    const diff = new Uint8Array(w * h);
    // 枠の端は、AI が絵をずらしたときに元の図と合わなくなる。端からこの幅は、何も描き足されていないとみなす
    const edge = Math.round(Math.min(w, h) * EDGE_MARGIN);
    for (let y = edge; y < h - edge; y++) {
      for (let x = edge; x < w - edge; x++) {
        const p = y * w + x;
        diff[p] = matte.rgba[p * 4 + 3];
        if (diff[p] >= 128) drawn++;
      }
    }
    area += w * h;
    const near = grow(diff, w, h, GROW);
    const tileZones = zones.map((z) => toTile(z, tile));

    // 元の図のドール（背景でない所）
    const refCut = new Uint8ClampedArray(ref);
    cutOutClothing(refCut, w, h, { background, silhouette: null });

    // 肌の色合わせ: 変わっていないドールの画素で、元の図との色の比（中央値）を取る
    const mine: number[][] = [[], [], []];
    const theirs: number[][] = [[], [], []];
    for (let p = 0; p < w * h; p += 3) {
      if (refCut[p * 4 + 3] < 250 || cut[p * 4 + 3] < 250 || near[p] > 0) continue;
      for (let c = 0; c < 3; c++) {
        mine[c].push(match.rgba[p * 4 + c]);
        theirs[c].push(ref[p * 4 + c]);
      }
    }
    const median = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
    const gain = mine[0].length >= MIN_MATCH_PIXELS ? [0, 1, 2].map((c) => Math.max(0.8, Math.min(1.25, median(theirs[c]) / Math.max(1, median(mine[c]))))) : [1, 1, 1];

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        const inZone = inBoxes(tileZones, x, y);
        if (!inZone) {
          if (refCut[p * 4 + 3] >= 128) {
            body++;
            if (diff[p] >= 128) changed++;
          }
          cut[p * 4 + 3] = Math.min(cut[p * 4 + 3], near[p] >= 128 ? 255 : near[p] * 2);
        }
        for (let c = 0; c < 3; c++) cut[p * 4 + c] = Math.min(255, Math.round(cut[p * 4 + c] * gain[c]));
      }
    }
    for (let p = 0; p < w * h; p++) if (cut[p * 4 + 3] < 8) cut[p * 4 + 3] = 0;
    // 範囲の外の、細い線だけのかけらは捨てる（位置が少し合わなかったときの、輪郭線のずれの消し残り）
    const outside = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (cut[(y * w + x) * 4 + 3] > 0 && !inBoxes(tileZones, x, y)) outside[y * w + x] = 1;
    const keep = withCore(outside, w, h, Math.max(2, Math.round(w / CORE_PER)));
    for (let p = 0; p < w * h; p++) if (outside[p] && !keep[p]) cut[p * 4 + 3] = 0;
    await pasteTile(rgba, canvasW, canvasH, cut, tile);
    await pasteTile(source, canvasW, canvasH, match.rgba, tile);
  }

  const hide = new Uint8Array(canvasW * canvasH);
  for (const z of zones) {
    for (let y = Math.max(0, z.y); y < Math.min(canvasH, z.y + z.h); y++) {
      for (let x = Math.max(0, z.x); x < Math.min(canvasW, z.x + z.w); x++) hide[y * canvasW + x] = doll.rgba[(y * canvasW + x) * 4 + 3];
    }
  }

  if (!alphaBBox(rgba, canvasW, canvasH) || drawn < area / EMPTY_DIVISOR) {
    warnings.push({ code: 'empty', message: '品目が見つかりません（元の絵から何も変わっていませんでした）' });
  } else {
    if (poorFit) warnings.push({ code: 'poor-fit', message: 'AI が絵の大きさや位置を変えたようです。位置がずれているかもしれません' });
    if (body > 0 && changed / body > REPAINT_LIMIT) {
      warnings.push({ code: 'repainted', message: 'AI が脚や腕ごと描き直したようです。肌の色や輪郭がドールと合わないかもしれません' });
    }
  }
  return { rgba, source, width: canvasW, height: canvasH, keyColors: { background, silhouette: null }, alignment, anchorShift: null, partShifts: [], shape: null, closeColorRatio: 0, warnings, hide };
}
