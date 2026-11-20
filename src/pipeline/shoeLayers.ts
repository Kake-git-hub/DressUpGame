/**
 * 靴を、「本物の脚の拡大図に描かせた絵」から取り出す純粋関数
 *
 * AI は、はだしの足を靴に描き替える（足の向きや幅も変わる）。足首の線より下は、新しい絵が元の足の代わりになる。
 * その絵を 3 つに分ける:
 *  - 靴: ほかの服と同じ重なりで描く。足首より上は、渡した絵と違う所だけ（ブーツの筒、ストラップ）
 *  - 肌: 靴の開きやストラップのあいだに見える足の肌。ドールのすぐ上に描く（靴下をはけば、靴下がその上にのる）
 *  - 隠す所: 線より下で、新しい絵の外になる所。ドールと、靴より下の服（靴下）から消す
 */
import type { Pixels } from './alpha';
import { cutOutClothing } from './cutout';
import { cleanKeyEdge } from './edgeClean';
import { pixelDistance } from './keyColors';
import type { Rgb } from './keyColors';
import { components, dilate, erode } from './morph';

export interface ShoeExtract {
  shoe: Uint8ClampedArray; // 靴（ほかの服と同じ重なり）
  under: Uint8ClampedArray; // 肌（ドールのすぐ上）
  hide: Uint8Array; // 隠す所（0 / 255）
  // 警告の材料
  drawn: number; // 渡した絵と違う画素（絵の端の帯を除く）
  body: number; // 足首より上の、ドールの画素
  changed: number; // そのうち、描き変えられたのに肌の色に近い画素（AI が脚ごと描き直した疑い）
  kept: number; // 靴として残った画素
  close: number; // 描き足された所で、背景色に近い色の画素（靴が背景と一緒に消えた疑い）
  cutOff: boolean; // 絵の上の端まで描き足されている（丈が長すぎて切れた疑い）
  shoePixels: number; // 線より下の、靴の画素
  skinPixels: number; // 線より下の、肌の画素
}

// 渡した絵との色の差がこれ以下なら「変わっていない」（髪と同じ値）
const SAME = 16;
// ドールの肌の色（明るい所〜影）との距離がこれ未満なら「肌」
export const SKIN_NEAR = 22;
const SHADE_FROM = 0.78;
const SHADE_TO = 1.03;
const SHADE_STEP = 0.05;
// 描き直しの判定に使う、ゆるい「肌の色に近い」
const SKIN_LIKE = 90;
// 以下の長さ（px）と広さ（画素数）は、幅 1024 の絵での値
const BASE_WIDTH = 1024;
const SKIN_AREA = 60; // これより小さい肌のかけらは捨てる
const LINE_CLOSE = 3; // 肌に囲まれた、この太さまでの線（指の線）は肌に入れる
const THIN = 2; // 渡した絵との違いのうち、これより細い線は、輪郭のずれとみなす
const SHOE_CORE = 2; // この太さの芯を持たない靴のかけら（輪郭のずれの消し残り）は捨てる
const HIDE_INSET = 2; // 隠す所は、新しい絵のふちよりこれだけ内側まで
const FEATHER = 10; // 肌の上の端を、足首の線からこの幅で少しずつ見せる
const EDGE_REACH = 3;
const EDGE_MARGIN = 0.03; // 絵の端のこの割合の帯は、AI が絵をずらすと渡した絵と合わなくなるので、数えない
const TOP_BAND = 0.02;
const TOP_BAND_SHARE = 0.03;
// 背景と一緒に消えた所で、背景色そのものではない色（背景色との距離が CLEAN〜CLOSE）が、この太さ以上のかたまりであれば、靴が欠けた疑い。
// 輪郭のまわりの、背景と混ざった細い帯は数えない
const CLOSE_THICK = 4;
const CLEAN_DISTANCE = 30;
const CLOSE_DISTANCE = 110;

/**
 * image: AI の絵（位置合わせ済み・不透明）。reference: AI に渡した絵。dollAlpha: ドールの不透明度。
 * zoneTop: 足首の線の y（これより下を差し替える）
 */
export function extractShoe(image: Pixels, reference: Pixels, dollAlpha: ArrayLike<number>, width: number, height: number, background: Rgb, zoneTop: number): ShoeExtract {
  const total = width * height;
  const k = width / BASE_WIDTH;
  const px = (v: number) => Math.max(1, Math.round(v * k));
  const area = (v: number) => Math.max(1, Math.round(v * k * k));
  const below = (p: number) => p >= zoneTop * width;

  const cut = new Uint8ClampedArray(image);
  cutOutClothing(cut, width, height, { background, silhouette: null });

  // 渡した絵と違う所（まわり 1px のうち、いちばん近い色との距離）
  const changed = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let best = Infinity;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1) && best > SAME * SAME; yy++) {
        for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) {
          const j = (yy * width + xx) * 4;
          const d = (image[i] - reference[j]) ** 2 + (image[i + 1] - reference[j + 1]) ** 2 + (image[i + 2] - reference[j + 2]) ** 2;
          if (d < best) best = d;
        }
      }
      if (best > SAME * SAME) changed[y * width + x] = 1;
    }
  }

  // 輪郭のずれでできる細い線（脚のふちが 1px ずれただけの所）は、描き足しに数えない
  const thick = dilate(erode(changed, width, height, px(THIN)), width, height, px(THIN));

  // ドールの肌の色（中央値）と、AI の絵との全体の色の差（変えていない肌での中央値）
  const median = (values: number[]) => (values.length ? values.sort((a, b) => a - b)[values.length >> 1] : 0);
  const tone: number[][] = [[], [], []];
  const shift: number[][] = [[], [], []];
  for (let p = 0; p < total; p += 3) {
    if (dollAlpha[p] < 255) continue;
    for (let c = 0; c < 3; c++) tone[c].push(reference[p * 4 + c]);
    if (!changed[p]) for (let c = 0; c < 3; c++) shift[c].push(image[p * 4 + c] - reference[p * 4 + c]);
  }
  const skin = (tone[0].length ? tone.map(median) : [224, 190, 170]) as Rgb;
  const drift = shift.map(median);
  const skinNear = (i: number) => {
    for (let shade = SHADE_FROM; shade <= SHADE_TO + 1e-9; shade += SHADE_STEP) {
      if (Math.hypot(image[i] - skin[0] * shade, image[i + 1] - skin[1] * shade, image[i + 2] - skin[2] * shade) < SKIN_NEAR) return true;
    }
    return false;
  };

  // 肌: 線より下で、背景でなく、肌の色の所。肌に囲まれた細い線も入れる
  const solid = new Uint8Array(total);
  const skinMask = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    solid[p] = cut[p * 4 + 3] >= 128 ? 1 : 0;
    skinMask[p] = solid[p] && below(p) && skinNear(p * 4) ? 1 : 0;
  }
  components(skinMask, width, height, (pixels, count) => {
    if (count < area(SKIN_AREA)) for (let n = 0; n < count; n++) skinMask[pixels[n]] = 0;
  });
  {
    const closed = erode(dilate(skinMask, width, height, px(LINE_CLOSE)), width, height, px(LINE_CLOSE));
    for (let p = 0; p < total; p++) if (closed[p] && solid[p] && below(p)) skinMask[p] = 1;
  }

  // 靴: 背景でも肌でもない所。線より上は、渡した絵と違い、肌の色でもない所だけ
  const shoeMask = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (!solid[p] || skinMask[p]) continue;
    shoeMask[p] = below(p) || (thick[p] && !skinNear(p * 4)) ? 1 : 0;
  }
  {
    const core = erode(shoeMask, width, height, px(SHOE_CORE));
    components(shoeMask, width, height, (pixels, count) => {
      for (let n = 0; n < count; n++) if (core[pixels[n]]) return;
      for (let n = 0; n < count; n++) shoeMask[pixels[n]] = 0;
    });
  }

  const shoe = new Uint8ClampedArray(total * 4);
  const under = new Uint8ClampedArray(total * 4);
  const nearShoe = dilate(shoeMask, width, height, 1);
  const feather = px(FEATHER);
  let shoePixels = 0;
  let skinPixels = 0;
  let kept = 0;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (shoeMask[p] || (nearShoe[p] && !solid[p] && cut[i + 3] >= 8 && dollAlpha[p] < 20)) {
      shoe[i] = cut[i];
      shoe[i + 1] = cut[i + 1];
      shoe[i + 2] = cut[i + 2];
      shoe[i + 3] = cut[i + 3];
      if (shoeMask[p]) {
        kept++;
        if (below(p)) shoePixels++;
      }
    } else if (skinMask[p]) {
      skinPixels++;
      for (let c = 0; c < 3; c++) under[i + c] = Math.max(0, Math.min(255, image[i + c] - drift[c]));
      const y = Math.floor(p / width);
      under[i + 3] = Math.round(255 * Math.max(0, Math.min(1, (y - zoneTop) / feather)));
    }
  }
  cleanKeyEdge(shoe, width, height, background, px(EDGE_REACH));

  // 隠す所
  const hide = new Uint8Array(total);
  {
    const picture = new Uint8Array(total);
    for (let p = 0; p < total; p++) picture[p] = shoeMask[p] | skinMask[p];
    const inside = erode(picture, width, height, px(HIDE_INSET));
    for (let p = Math.max(0, zoneTop * width); p < total; p++) if (!inside[p]) hide[p] = 255;
  }

  // 警告の材料
  const nearKey = new Uint8Array(total);
  for (let p = 0; p < total; p++) {
    if (solid[p]) continue;
    const d = pixelDistance(image, p * 4, background);
    if (d >= CLEAN_DISTANCE && d < CLOSE_DISTANCE) nearKey[p] = 1;
  }
  const lost = dilate(erode(nearKey, width, height, px(CLOSE_THICK)), width, height, px(CLOSE_THICK));
  let drawn = 0;
  let body = 0;
  let repainted = 0;
  let close = 0;
  let top = 0;
  const edge = Math.round(Math.min(width, height) * EDGE_MARGIN);
  const band = Math.max(2, Math.round(height * TOP_BAND));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const inner = x >= edge && x < width - edge && y >= edge && y < height - edge;
      if (thick[p] && inner) {
        drawn++;
        if (y < edge + band) top++;
      }
      if (lost[p] && inner) close++;
      if (y < zoneTop && dollAlpha[p] >= 128) {
        body++;
        if (thick[p] && pixelDistance(image, p * 4, skin) < SKIN_LIKE) repainted++;
      }
    }
  }
  return { shoe, under, hide, drawn, body, changed: repainted, kept, close, cutOff: top > width * band * TOP_BAND_SHARE, shoePixels, skinPixels };
}
