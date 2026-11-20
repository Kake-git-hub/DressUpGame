/**
 * 髪を、「本物のドールに描かせた絵」から取り出す純粋関数
 *
 * AI には、ドールの本物の上半身の拡大図（顔なし）を渡して、髪型を描いてもらう。
 * ドールは動かないので、大きさや位置を推定しなくてよい。返ってきた絵のうち、
 *  - ドールの外で、背景でない所
 *  - ドールの上で、渡した絵と色が違う所
 * が髪。ドールの上に描かれた髪（前髪、体の前にたれた三つ編み）は前髪としてドールの上に、
 * 髪の全体は後ろ髪としてドールの下に描く。体の裏は、髪の地の色でなめらかに塗る（ドールの内側だけ）。
 */
import { alphaBBox } from './alpha';
import type { Pixels } from './alpha';
import { cutOutClothing } from './cutout';
import { cleanKeyEdge } from './edgeClean';
import type { Rgb } from './keyColors';
import { components, dilate, erode } from './morph';
import { baseColorSource, fillSmooth } from './smoothFill';

export interface HairExtract {
  rgba: Uint8ClampedArray; // 髪の全体（塗りつぶしなし）。ふちの背景色は取ってある
  front: Uint8Array; // 前の範囲（0 / 255）
  unlike: number; // 後ろ髪 → ドール → 前髪と重ね直した絵が、AI の絵と違う画素の割合（0〜1）
  stray: number; // 髪から離れた所で、ドールが描き変えられた画素の割合（ドールの画素に対して）
  closeToSkin: number; // ドールの上の髪のうち、下の絵との色の差がわずかな画素の割合（大きいと、髪が欠けている疑い）
}

// 渡した絵との色の差がこれ以下なら「変わっていない」。変えていない肌は 93% が 8 未満、うすいピンクの髪はほぼすべて 20 以上（2026-11-20 の試作）
export const HAIR_SAME = 16;
// サムネイルで、ドールの体を表す色（うすい灰むらさき）
export const THUMB_BODY: Rgb = [226, 222, 236];

// 以下の長さ（px）と広さ（画素数）は、幅 1024 の絵での値。絵の幅に合わせて縮める
const BASE_WIDTH = 1024;
const SPECK_AREA = 40; // ドールの上の、これより小さい描き変えは捨てる
const HOLE_AREA = 80; // 髪に囲まれた、これ以下の「変わっていない」穴は髪にする（色が下の絵と同じだった所）
const OUTSIDE_CORE = 2; // 外の髪: この太さの芯を持たないかたまり（ドールのふちのにじみ）は捨てる
const FRONT_THIN = 3; // 前: これより細い所（後ろ髪のふちが体の輪郭線にかぶっただけの所）は前にしない
const FRONT_GROW = 6; // 前: 太い所からこの範囲の髪（毛先）と、この範囲の体の外の髪は前に入れる
const FRONT_AREA = 150; // 前: これより小さいかたまりは前にしない
const BRIDGE = 4; // 髪のかたまりを数えるとき、この幅のすき間はつながっているとみなす
const STRAY_SHARE = 0.05; // 外の髪につながらず、いちばん大きい髪のこの割合より小さいかたまりは、髪ではない描き変え
const TUCK = 8; // 髪に接する体のふちを、この幅だけ塗る（境目にすき間を作らない）
const EDGE_REACH = 3; // ふちの背景色を取る幅
// 肌と接する髪のふち: 色の差 FEATHER_START〜FEATHER_FULL を、不透明度 0.5〜1 にする
const FEATHER_START = 12;
const FEATHER_FULL = 36;
// 色の差が HAIR_SAME からこの幅までの髪は「わずかな差」
const MARGINAL = 6;
// 重ね直した絵と AI の絵の色の差がこれより大きい画素を「違う」と数える
const UNLIKE_DISTANCE = 60;

/**
 * image: AI の絵（位置合わせ済み・不透明）。reference: AI に渡した絵。dollAlpha: ドールの不透明度（0〜255）。
 * すべて同じ大きさ。background: 絵の背景色
 */
export function extractHair(image: Pixels, reference: Pixels, dollAlpha: ArrayLike<number>, width: number, height: number, background: Rgb): HairExtract {
  const total = width * height;
  const k = width / BASE_WIDTH;
  const px = (v: number) => Math.max(1, Math.round(v * k));
  const area = (v: number) => Math.max(1, Math.round(v * k * k));
  const doll = new Uint8Array(total);
  let dollCount = 0;
  for (let p = 0; p < total; p++) {
    if (dollAlpha[p] >= 128) {
      doll[p] = 1;
      dollCount++;
    }
  }

  // 背景を消した絵（ドール＋髪）
  const cut = new Uint8ClampedArray(image);
  cutOutClothing(cut, width, height, { background, silhouette: null });

  // ドールの上: 渡した絵との色の差（まわり 1px のうち、いちばん近い色との距離。1px のずれは違いとみなさない）
  const distance = new Float32Array(total);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!doll[p]) continue;
      const i = p * 4;
      let best = Infinity;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1) && best > 0; yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          const j = (yy * width + xx) * 4;
          const d = (image[i] - reference[j]) ** 2 + (image[i + 1] - reference[j + 1]) ** 2 + (image[i + 2] - reference[j + 2]) ** 2;
          if (d < best) best = d;
        }
      }
      distance[p] = Math.sqrt(best);
    }
  }

  const inHair = new Uint8Array(total);
  const outHair = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    // ドールの上で色が変わっていても、背景の色になった所（AI がドールを少し削った所）は髪ではない
    if (doll[p]) inHair[p] = distance[p] > HAIR_SAME && cut[p * 4 + 3] >= 128 ? 1 : 0;
    else outHair[p] = cut[p * 4 + 3] >= 128 ? 1 : 0;
  }
  components(inHair, width, height, (pixels, count) => {
    if (count < area(SPECK_AREA)) for (let n = 0; n < count; n++) inHair[pixels[n]] = 0;
  });
  {
    const core = erode(outHair, width, height, px(OUTSIDE_CORE));
    components(outHair, width, height, (pixels, count) => {
      for (let n = 0; n < count; n++) if (core[pixels[n]]) return;
      for (let n = 0; n < count; n++) outHair[pixels[n]] = 0;
    });
  }

  // 髪から離れた所の描き変え（AI がドールに描き足したもの）は、髪に入れない
  let stray = 0;
  {
    const any = new Uint8Array(total);
    for (let p = 0; p < total; p++) any[p] = inHair[p] | outHair[p];
    const bridged = dilate(any, width, height, px(BRIDGE));
    const pieces: { pixels: Int32Array; size: number; outside: boolean }[] = [];
    components(bridged, width, height, (pixels, count) => {
      const own: number[] = [];
      let outside = false;
      for (let n = 0; n < count; n++) {
        const p = pixels[n];
        if (outHair[p]) outside = true;
        if (inHair[p]) own.push(p);
      }
      let size = own.length;
      if (outside) for (let n = 0; n < count; n++) if (outHair[pixels[n]]) size++;
      pieces.push({ pixels: Int32Array.from(own), size, outside });
    });
    const largest = pieces.reduce((m, piece) => Math.max(m, piece.size), 0);
    for (const piece of pieces) {
      if (piece.outside || piece.size >= largest * STRAY_SHARE) continue;
      for (const p of piece.pixels) inHair[p] = 0;
      stray += piece.pixels.length;
    }
  }

  // 髪に囲まれた小さな穴は、髪の色が下の絵と同じだった所
  {
    const bare = new Uint8Array(total);
    for (let p = 0; p < total; p++) bare[p] = doll[p] && !inHair[p] ? 1 : 0;
    components(bare, width, height, (pixels, count, touchesBorder) => {
      if (touchesBorder || count > area(HOLE_AREA)) return;
      // 体の外の背景に接している穴は、髪に囲まれていない
      for (let n = 0; n < count; n++) {
        const p = pixels[n];
        const x = p % width;
        for (const q of [x > 0 ? p - 1 : p, x < width - 1 ? p + 1 : p, p >= width ? p - width : p, p < total - width ? p + width : p]) {
          if (!doll[q] && !outHair[q]) return;
        }
      }
      for (let n = 0; n < count; n++) inHair[pixels[n]] = 1;
    });
  }

  // 前の範囲
  const front = new Uint8Array(total);
  {
    const thick = dilate(erode(inHair, width, height, px(FRONT_THIN)), width, height, px(FRONT_GROW));
    const on = new Uint8Array(total);
    for (let p = 0; p < total; p++) on[p] = inHair[p] & thick[p];
    components(on, width, height, (pixels, count) => {
      if (count < area(FRONT_AREA)) for (let n = 0; n < count; n++) on[pixels[n]] = 0;
    });
    const near = dilate(on, width, height, px(FRONT_GROW));
    for (let p = 0; p < total; p++) if (on[p] || (outHair[p] && near[p])) front[p] = 255;
  }

  // 髪の全体の絵
  const rgba = new Uint8ClampedArray(total * 4);
  const bare = new Uint8Array(total);
  for (let p = 0; p < total; p++) bare[p] = doll[p] && !inHair[p] ? 1 : 0;
  const nearBare = dilate(bare, width, height, 1);
  const nearOut = dilate(outHair, width, height, 1);
  let marginal = 0;
  let onDoll = 0;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (inHair[p]) {
      onDoll++;
      if (distance[p] <= HAIR_SAME + MARGINAL) marginal++;
      rgba[i] = image[i];
      rgba[i + 1] = image[i + 1];
      rgba[i + 2] = image[i + 2];
      // 肌と接するふちは、色の差に応じて少し透かす（ぎざぎざにしない）
      rgba[i + 3] = nearBare[p] ? Math.round(255 * Math.max(0.5, Math.min(1, (distance[p] - FEATHER_START) / (FEATHER_FULL - FEATHER_START)))) : 255;
    } else if (outHair[p] || (nearOut[p] && !doll[p] && dollAlpha[p] < 20 && cut[i + 3] >= 8)) {
      // 外の髪と、そのやわらかいふち（ドール自身のふちのにじみは入れない）
      rgba[i] = cut[i];
      rgba[i + 1] = cut[i + 1];
      rgba[i + 2] = cut[i + 2];
      rgba[i + 3] = cut[i + 3];
    }
  }
  cleanKeyEdge(rgba, width, height, background, px(EDGE_REACH));

  // 重ね直して、AI の絵と比べる: 背景 → 後ろ髪 → ドール → 前髪
  let unlike = 0;
  if (onDoll > 0 || outHair.includes(1)) {
    const layers = hairFromMask(rgba, front, dollAlpha, width, height);
    for (let p = 0; p < total; p++) {
      const i = p * 4;
      let r = background[0];
      let g = background[1];
      let b = background[2];
      const over = (src: Pixels, a: number) => {
        r = src[i] * a + r * (1 - a);
        g = src[i + 1] * a + g * (1 - a);
        b = src[i + 2] * a + b * (1 - a);
      };
      over(layers.back, layers.back[i + 3] / 255);
      if (doll[p]) over(reference, 1); // 渡した絵は「背景の上のドール」なので、ドールの所はそのまま置く
      else if (!layers.back[i + 3]) over(reference, 1);
      over(layers.front, layers.front[i + 3] / 255);
      if (Math.hypot(r - image[i], g - image[i + 1], b - image[i + 2]) > UNLIKE_DISTANCE) unlike++;
    }
  }

  return { rgba, front, unlike: unlike / total, stray: dollCount ? stray / dollCount : 0, closeToSkin: onDoll ? marginal / onDoll : 0 };
}

/**
 * 髪の全体 → 後ろ髪（体の裏を塗ったもの）。
 * 塗るのはドールの内側だけ: 同じ行で左右に髪がある所と、髪に接する体のふち。体の外には何も足さない
 */
export function fillUnderDoll(hair: Pixels, dollAlpha: ArrayLike<number>, width: number, height: number): Uint8ClampedArray {
  const total = width * height;
  const back = new Uint8ClampedArray(hair);
  const solid = new Uint8Array(total);
  for (let p = 0; p < total; p++) solid[p] = hair[p * 4 + 3] >= 128 ? 1 : 0;
  if (!solid.includes(1)) return back;
  const k = width / BASE_WIDTH;
  const near = dilate(solid, width, height, Math.max(1, Math.round(TUCK * k)));
  const region = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x++) {
      if (!solid[row + x]) continue;
      if (first < 0) first = x;
      last = x;
    }
    for (let x = 0; x < width; x++) {
      const p = row + x;
      if (solid[p] || dollAlpha[p] < 128) continue;
      if ((first >= 0 && x > first && x < last) || near[p]) region[p] = 1;
    }
  }
  fillSmooth(back, region, baseColorSource(hair, solid, width, height, Math.max(1, Math.round(3 * k))), width, height);
  return back;
}

// 髪の全体と前の範囲 → 前髪（ドールの上に描く）と後ろ髪（ドールの下に描く）
export function hairFromMask(hair: Pixels, front: ArrayLike<number>, dollAlpha: ArrayLike<number>, width: number, height: number): { front: Uint8ClampedArray; back: Uint8ClampedArray } {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    if (front[p] < 128) continue;
    const i = p * 4;
    out[i] = hair[i];
    out[i + 1] = hair[i + 1];
    out[i + 2] = hair[i + 2];
    out[i + 3] = hair[i + 3];
  }
  return { front: out, back: fillUnderDoll(hair, dollAlpha, width, height) };
}

/**
 * サムネイルにする絵。体の裏の塗りつぶしを見せないように、髪の範囲の中のドールの体を、うすい色の形でおおう。
 *  back: 後ろ髪 → 体の形（うしろがみのサムネイル）。hair: 後ろ髪 → 体の形 → 前髪（髪のサムネイル）
 */
export function hairThumbs(front: Pixels, back: Pixels, dollAlpha: ArrayLike<number>, width: number, height: number): { hair: Uint8ClampedArray; back: Uint8ClampedArray } {
  const behind = new Uint8ClampedArray(back);
  const box = alphaBBox(back, width, height) ?? alphaBBox(front, width, height);
  if (box) {
    for (let y = box.y; y < box.y + box.h; y++) {
      for (let x = box.x; x < box.x + box.w; x++) {
        const p = y * width + x;
        const a = dollAlpha[p] / 255;
        if (a === 0) continue;
        const i = p * 4;
        const under = behind[i + 3] / 255;
        const outAlpha = a + under * (1 - a);
        for (let c = 0; c < 3; c++) behind[i + c] = Math.round((THUMB_BODY[c] * a + behind[i + c] * under * (1 - a)) / outAlpha);
        behind[i + 3] = Math.round(outAlpha * 255);
      }
    }
  }
  const whole = new Uint8ClampedArray(behind);
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const a = front[i + 3] / 255;
    if (a === 0) continue;
    const under = whole[i + 3] / 255;
    const outAlpha = a + under * (1 - a);
    for (let c = 0; c < 3; c++) whole[i + c] = Math.round((front[i + c] * a + whole[i + c] * under * (1 - a)) / outAlpha);
    whole[i + 3] = Math.round(outAlpha * 255);
  }
  return { hair: whole, back: behind };
}
