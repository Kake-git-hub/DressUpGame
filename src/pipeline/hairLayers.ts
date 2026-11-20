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
// 絵の線: まわり（この半径）の髪の明るさの平均の、この割合より暗い画素
const LINE_WINDOW = 10;
const LINE_DARK = 0.8;
// 線で分けた房のうち、ドールの上の髪がこの割合以上ある房は、ドールの外の部分もふくめて前にする
const LOBE_ON_SHARE = 0.3;
// 首より上の画素がこの割合以上ある房は、房ごと前にする（頭のまわりの髪）
const LOBE_ABOVE_SHARE = 0.8;
const LOBE_RIM = 3; // 房と一緒に前に入れる、まわりの線の幅
// 前髪はひとつながりにする: 離れているかたまりは、髪をたどった道でつなぐ。
// 道が通る房がこれより小さければ（三つ編みのひと節など）房ごと前にし、大きければ（後ろ髪の広がり）道のまわりだけを足す
const JOIN_LOBE_AREA = 12000;
const LINE_COST = 3;
const BIG_COST = 6;
// 道のまわりを足すときの、太さの半分（つなぐかたまりの太さに合わせる）の下限と上限
const PATH_MIN = 12;
const PATH_MAX = 40;
const DOLL_EDGE = 5; // ドールからこの範囲にある、細い外の「髪」は、ドールのふちが少しずれただけの所
const EDGE_THIN = 2;
const BRIDGE = 4; // 髪のかたまりを数えるとき、この幅のすき間はつながっているとみなす
const STRAY_SHARE = 0.05; // ドールの上の離れたかたまり: いちばん大きい髪の、この割合より小さければ、髪ではない描き変え
const STRAY_OUTSIDE_SHARE = 0.3; // ドールの外の画素がこの割合より少ないかたまりを「ドールの上のかたまり」とみなす
const STRAY_OUT_AREA = 1500; // ドールの外の離れたかたまり: これより小さければ、髪ではない
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
 * すべて同じ大きさ。background: 絵の背景色。
 * neckY: 首（肩の上）の y。分かっていれば、それより上の髪（頭のまわりの髪）は、ドールの外でも前髪に入れる
 */
export function extractHair(image: Pixels, reference: Pixels, dollAlpha: ArrayLike<number>, width: number, height: number, background: Rgb, neckY?: number): HairExtract {
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

  // 渡した絵との色の差（まわり 1px のうち、いちばん近い色との距離。1px のずれは違いとみなさない）。
  // 髪は「渡した絵と違う所」。ドールの外でも、渡した絵と同じ所（ドールのふちのにじみ）は髪ではない
  const distance = new Float32Array(total);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!doll[p] && cut[p * 4 + 3] < 128) continue; // 背景
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
    else outHair[p] = cut[p * 4 + 3] >= 128 && distance[p] > HAIR_SAME ? 1 : 0;
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

  // ドールのふちに沿った細い線は、AI がドールの輪郭を少し外へ描いただけの所。髪にしない
  {
    const thickOut = dilate(erode(outHair, width, height, px(EDGE_THIN)), width, height, px(EDGE_THIN));
    const nearDoll = dilate(doll, width, height, px(DOLL_EDGE));
    for (let p = 0; p < total; p++) if (outHair[p] && nearDoll[p] && !thickOut[p]) outHair[p] = 0;
    // ドールの上でも同じ: ふちの帯にある細い線は、輪郭線の色が少し変わっただけの所
    const background = new Uint8Array(total);
    for (let p = 0; p < total; p++) background[p] = doll[p] ? 0 : 1;
    const edgeBand = dilate(background, width, height, px(DOLL_EDGE));
    const thickIn = dilate(erode(inHair, width, height, px(EDGE_THIN)), width, height, px(EDGE_THIN));
    for (let p = 0; p < total; p++) if (inHair[p] && edgeBand[p] && !thickIn[p]) inHair[p] = 0;
  }

  // 髪から離れたかたまりのうち、髪ではない描き変え（AI がドールに描き足したもの、手のふちを少し描き変えた所）は、髪に入れない。
  //  - ほとんどがドールの上にあるかたまり: いちばん大きい髪の STRAY_SHARE より小さければ、描き変え
  //  - ドールの外のかたまり: 腕の後ろを通って分かれた髪のこともあるので、ごく小さいものだけを捨てる
  let stray = 0;
  {
    const any = new Uint8Array(total);
    for (let p = 0; p < total; p++) any[p] = inHair[p] | outHair[p];
    const bridged = dilate(any, width, height, px(BRIDGE));
    const pieces: { pixels: Int32Array; outside: number }[] = [];
    components(bridged, width, height, (pixels, count) => {
      const own: number[] = [];
      let outside = 0;
      for (let n = 0; n < count; n++) {
        const p = pixels[n];
        if (!any[p]) continue;
        own.push(p);
        if (outHair[p]) outside++;
      }
      pieces.push({ pixels: Int32Array.from(own), outside });
    });
    const largest = pieces.reduce((m, piece) => Math.max(m, piece.pixels.length), 0);
    for (const piece of pieces) {
      const size = piece.pixels.length;
      if (size === largest) continue;
      const onDoll = piece.outside < size * STRAY_OUTSIDE_SHARE;
      if (onDoll ? size >= largest * STRAY_SHARE : size >= area(STRAY_OUT_AREA)) continue;
      for (const p of piece.pixels) {
        inHair[p] = 0;
        outHair[p] = 0;
      }
      stray += size;
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
  const front = frontOf(image, inHair, outHair, width, height, px, area, neckY);

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
 * 前の範囲（0 / 255）: ドールの上に描かれた髪と、それをひとつながりにする、あいだの髪。
 *  1. ドールの上の、太さのある髪（細い線は、後ろ髪のふちが体の輪郭線にかぶっただけの所）と、そのすぐ外
 *  2. 髪を、絵の線（輪郭線）で房に分ける。ドールの上の髪を多く含む房は、ドールの外の部分もふくめて、房ごと前にする
 *     （切れ目が絵の線に沿うので、前髪だけを着せても自然に見える）。
 *     首の高さが分かっていれば、ほとんどが首より上にある房（頭のまわりの髪）も、房ごと前にする
 *  3. まだ離れているかたまり（顔の横から首の横を通って胸にたれる房は、首の横でドールの外に出る）は、
 *     髪の中をたどる道でつなぐ。道が通る小さな房は、房ごと前にする。後ろ髪とつながった大きな房は、
 *     首より上を通るなら首より上だけ（切れ目は肩の高さの横線になる）、そうでなければ道のまわりだけ
 * 足すのは髪の画素だけ。後ろ髪にも同じ画素があるので、重ねた見た目は変わらない
 */
function frontOf(image: Pixels, inHair: Uint8Array, outHair: Uint8Array, width: number, height: number, px: (v: number) => number, area: (v: number) => number, neckY?: number): Uint8Array {
  const total = width * height;
  const any = new Uint8Array(total);
  for (let p = 0; p < total; p++) any[p] = inHair[p] | outHair[p];

  // 1. ドールの上の、太さのある髪
  const on = new Uint8Array(total);
  {
    const thick = dilate(erode(inHair, width, height, px(FRONT_THIN)), width, height, px(FRONT_GROW));
    for (let p = 0; p < total; p++) on[p] = inHair[p] & thick[p];
    components(on, width, height, (pixels, count) => {
      if (count < area(FRONT_AREA)) for (let n = 0; n < count; n++) on[pixels[n]] = 0;
    });
  }
  const mask = new Uint8Array(total);
  {
    const near = dilate(on, width, height, px(FRONT_GROW));
    for (let p = 0; p < total; p++) mask[p] = on[p] || (outHair[p] && near[p]) ? 1 : 0;
  }
  if (!mask.includes(1)) return new Uint8Array(total);

  // 2. 絵の線で房に分ける。線 = まわりの髪より、はっきり暗い画素
  const line = hairLines(image, any, width, height, px(LINE_WINDOW));
  const lobe = new Int32Array(total); // 房の番号（1〜）。線と、髪でない所は 0
  const lobeSize: number[] = [0];
  const lobeOn: number[] = [0];
  const lobeAbove: number[] = [0]; // 首より上にある画素
  const neckStart = neckY === undefined ? 0 : Math.max(0, Math.min(height, Math.round(neckY))) * width;
  {
    const open = new Uint8Array(total);
    for (let p = 0; p < total; p++) open[p] = any[p] && !line[p] ? 1 : 0;
    components(open, width, height, (pixels, count) => {
      const id = lobeSize.length;
      let onDoll = 0;
      let above = 0;
      for (let n = 0; n < count; n++) {
        lobe[pixels[n]] = id;
        if (on[pixels[n]]) onDoll++;
        if (pixels[n] < neckStart) above++;
      }
      lobeSize.push(count);
      lobeOn.push(onDoll);
      lobeAbove.push(above);
    });
  }
  const smallLobe = area(JOIN_LOBE_AREA);
  const takeLobe = new Uint8Array(lobeSize.length); // 1 = 房ごと、2 = 首より上だけ
  for (let id = 1; id < lobeSize.length; id++) {
    if (lobeOn[id] >= lobeSize[id] * LOBE_ON_SHARE || lobeAbove[id] >= lobeSize[id] * LOBE_ABOVE_SHARE) takeLobe[id] = 1;
  }
  const addLobes = () => {
    const added = new Uint8Array(total);
    for (let p = 0; p < total; p++) {
      const take = takeLobe[lobe[p]];
      if (take === 1 || (take === 2 && p < neckStart)) added[p] = 1;
    }
    // 房のまわりの線も一緒に（房の外へ数 px。となりの房に少し入っても、同じ髪の画素）
    const grown = dilate(added, width, height, px(LOBE_RIM));
    for (let p = 0; p < total; p++) if (grown[p] && any[p]) mask[p] = 1;
  };
  addLobes();

  // 3. 離れているかたまりを、髪の中の道でつなぐ
  const label = new Int32Array(total);
  const sizes: number[] = [0];
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [{ x0: 0, y0: 0, x1: 0, y1: 0 }];
  components(mask, width, height, (pixels, count) => {
    const id = sizes.length;
    const box = { x0: width, y0: height, x1: 0, y1: 0 };
    for (let n = 0; n < count; n++) {
      const p = pixels[n];
      label[p] = id;
      const x = p % width;
      const y = (p - x) / width;
      if (x < box.x0) box.x0 = x;
      if (x > box.x1) box.x1 = x;
      if (y < box.y0) box.y0 = y;
      if (y > box.y1) box.y1 = y;
    }
    sizes.push(count);
    boxes.push(box);
  });
  if (sizes.length > 2) {
    let main = 1;
    for (let id = 2; id < sizes.length; id++) if (sizes[id] > sizes[main]) main = id;
    // 道の歩きにくさ: 小さな房の中は 1、線は LINE_COST、大きな房（後ろ髪の広がり）は BIG_COST。房に沿って進む道を選ぶ
    const costOf = (p: number) => (mask[p] ? 1 : lobe[p] === 0 ? LINE_COST : lobeSize[lobe[p]] <= smallLobe ? 1 : BIG_COST);
    const distance = new Int32Array(total).fill(-1);
    const parent = new Int32Array(total).fill(-1);
    const buckets: number[][] = Array.from({ length: BIG_COST + 1 }, () => []);
    for (let p = 0; p < total; p++) {
      if (label[p] === main) {
        distance[p] = 0;
        parent[p] = p;
        buckets[0].push(p);
      }
    }
    const reached = new Int32Array(sizes.length).fill(-1);
    let left = sizes.length - 2;
    for (let d = 0, idle = 0; idle <= BIG_COST && left > 0; d++) {
      const bucket = buckets[d % (BIG_COST + 1)];
      if (bucket.length === 0) {
        idle++;
        continue;
      }
      idle = 0;
      const current = bucket.splice(0, bucket.length);
      for (const p of current) {
        if (distance[p] !== d) continue; // もっと近い道で、すでに済んでいる
        const id = label[p];
        if (id > 0 && id !== main && reached[id] < 0) {
          reached[id] = p;
          left--;
        }
        const x = p % width;
        for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p - width, p + width]) {
          if (q < 0 || q >= total || !any[q]) continue;
          const next = d + costOf(q);
          if (distance[q] >= 0 && distance[q] <= next) continue;
          distance[q] = next;
          parent[q] = p;
          buckets[next % (BIG_COST + 1)].push(q);
        }
      }
    }
    const path = new Uint8Array(total);
    let wide = 0;
    for (let id = 1; id < sizes.length; id++) {
      if (id === main || reached[id] < 0) continue;
      const box = boxes[id];
      wide = Math.max(wide, Math.max(px(PATH_MIN), Math.min(px(PATH_MAX), Math.round(Math.min(box.x1 - box.x0, box.y1 - box.y0) / 2))));
      for (let p = reached[id]; label[p] !== main; p = parent[p]) {
        const id2 = lobe[p];
        if (id2 > 0 && takeLobe[id2] === 0) {
          // 小さな房は房ごと。後ろ髪とつながった大きな房は、首より上を通るなら、首より上だけ（切れ目は肩の高さの横線になる）
          if (lobeSize[id2] <= smallLobe) takeLobe[id2] = 1;
          else if (p < neckStart) takeLobe[id2] = 2;
        }
        // 首より上で大きな房を通る所は、上の決まりで足りる。それ以外の所は、道のまわりを足す
        if (!(id2 > 0 && takeLobe[id2] === 2)) path[p] = 1;
      }
    }
    addLobes();
    // 大きな房や線の上を通る所は、道のまわりだけを足す
    const band = dilate(path, width, height, Math.max(px(PATH_MIN), wide));
    for (let p = 0; p < total; p++) if (band[p] && any[p] && (lobe[p] === 0 || lobeSize[lobe[p]] > smallLobe || takeLobe[lobe[p]])) mask[p] = 1;
  }
  // 足した房のふちにできた小さなかけらは、前にしない（いちばん大きいかたまりは残す）
  {
    let largest = 0;
    components(mask, width, height, (_pixels, count) => {
      if (count > largest) largest = count;
    });
    components(mask, width, height, (pixels, count) => {
      if (count < area(FRONT_AREA) && count < largest) for (let n = 0; n < count; n++) mask[pixels[n]] = 0;
    });
  }
  const front = new Uint8Array(total);
  for (let p = 0; p < total; p++) if (mask[p]) front[p] = 255;
  return front;
}

// 髪の絵の線: まわり（半径 window）の髪の明るさの平均より、はっきり暗い画素。線のすき間をふさぐために 1px 太らせる
function hairLines(image: Pixels, hair: Uint8Array, width: number, height: number, window: number): Uint8Array {
  const total = width * height;
  const w1 = width + 1;
  const sum = new Float64Array(w1 * (height + 1));
  const count = new Int32Array(w1 * (height + 1));
  const light = new Float32Array(total);
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    let rowCount = 0;
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (hair[p]) {
        light[p] = image[p * 4] * 0.3 + image[p * 4 + 1] * 0.59 + image[p * 4 + 2] * 0.11;
        rowSum += light[p];
        rowCount++;
      }
      sum[(y + 1) * w1 + x + 1] = sum[y * w1 + x + 1] + rowSum;
      count[(y + 1) * w1 + x + 1] = count[y * w1 + x + 1] + rowCount;
    }
  }
  const line = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - window);
    const y1 = Math.min(height, y + window + 1);
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      if (!hair[p]) continue;
      const x0 = Math.max(0, x - window);
      const x1 = Math.min(width, x + window + 1);
      const n = count[y1 * w1 + x1] - count[y0 * w1 + x1] - count[y1 * w1 + x0] + count[y0 * w1 + x0];
      const mean = (sum[y1 * w1 + x1] - sum[y0 * w1 + x1] - sum[y1 * w1 + x0] + sum[y0 * w1 + x0]) / Math.max(1, n);
      if (light[p] < mean * LINE_DARK) line[p] = 1;
    }
  }
  const grown = dilate(line, width, height, 1);
  for (let p = 0; p < total; p++) if (!hair[p]) grown[p] = 0;
  return grown;
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
