/**
 * 拡大図の「枠」を決める純粋関数
 *
 * 髪・帽子・靴・手袋は、ドール全体の図ではなく、その部位のまわりだけを大きく写した図に描かせる
 * （同じ大きさの画像でも、部位あたりの画素が増えて細部がつぶれない）。
 * 枠 = キャンバス上の範囲（from）と、それを生成画像のどこに写すか（to）の組。手袋は左右の腕を 1 枚に並べるので 2 枚組。
 */
import type { Box } from './alpha';
import type { BodyParts } from './bodyParts';

export interface Tile {
  from: Box; // 作業用キャンバス上の範囲
  to: Box; // 生成画像（1 辺 FRAME_SIZE）の中の位置。from と同じ縦横比
}

export const FRAME_SIZE = 1024;
const PANEL_GAP = 64; // 手の図: 左右の 2 枚のあいだの、背景だけの帯（px）
export type FrameKind = 'upper' | 'feet' | 'hands';

// カテゴリ名から、拡大図の種類を決める。全身の図で作るもの（服・靴下）と、別の作り方をする顔は null
export function frameKind(label: string): FrameKind | null {
  if (/くつした|靴下|ソックス|タイツ|sock/i.test(label)) return null;
  if (/くつ|靴|shoe|ブーツ|boot/i.test(label)) return 'feet';
  if (/てぶくろ|手袋|glove/i.test(label)) return 'hands';
  if (/ぼうし|帽子|hat|かんむり|ティアラ|かみ|まえがみ|髪|ヘア|hair/i.test(label)) return 'upper';
  return null;
}

// 中心 (cx)・上端 top・大きさ w×h の箱を、キャンバスに収まるようにずらす（大きすぎれば、縦横比を保って縮める）
function fit(cx: number, top: number, w: number, h: number, canvasW: number, canvasH: number): Box {
  const k = Math.min(1, canvasW / w, canvasH / h);
  const bw = Math.floor(w * k);
  const bh = Math.floor(h * k);
  const x = Math.max(0, Math.min(canvasW - bw, Math.round(cx - bw / 2)));
  const y = Math.max(0, Math.min(canvasH - bh, Math.round(top)));
  return { x, y, w: bw, h: bh };
}

export function frameTiles(kind: FrameKind, parts: BodyParts, canvasW: number, canvasH: number): Tile[] {
  const tall = parts.feet.y + parts.feet.h - parts.head.y;
  const full: Box = { x: 0, y: 0, w: FRAME_SIZE, h: FRAME_SIZE };
  if (kind === 'upper') {
    // キャンバスの上端から腰の下まで
    const size = parts.hips.y + parts.hips.h;
    return [{ from: fit(parts.head.x + parts.head.w / 2, 0, size, size, canvasW, canvasH), to: full }];
  }
  if (kind === 'feet') {
    // すねの途中から、足の下の余白まで
    const bottom = Math.min(canvasH, parts.feet.y + parts.feet.h + tall * 0.06);
    const top = parts.feet.y - parts.legs.h * 0.55;
    const size = Math.max(bottom - top, parts.feet.w * 1.3);
    return [{ from: fit(parts.feet.x + parts.feet.w / 2, bottom - size, size, size, canvasW, canvasH), to: full }];
  }
  // 手: 左右それぞれ、腕の下のほうから指先まで。縦長の図を、すき間を空けて左右に並べる。
  // 胴が写りこまないように、枠の内側の端を腕の内側の端にそろえる
  const panelW = (FRAME_SIZE - PANEL_GAP) / 2;
  return (
    [
      [parts.armLeft, parts.handLeft, 0, true],
      [parts.armRight, parts.handRight, panelW + PANEL_GAP, false],
    ] as const
  ).map(([arm, hand, toX, left]) => {
    const x0 = Math.min(arm.x, hand.x);
    const x1 = Math.max(arm.x + arm.w, hand.x + hand.w);
    const bottom = Math.max(arm.y + arm.h, hand.y + hand.h) + tall * 0.03;
    const w = Math.max((x1 - x0) * 1.25, hand.w * 1.5);
    const h = (w * FRAME_SIZE) / panelW;
    const box = fit(left ? x1 - w / 2 : x0 + w / 2, bottom - h, w, h, canvasW, canvasH);
    return { from: box, to: { x: toX, y: 0, w: panelW, h: FRAME_SIZE } };
  });
}

// 差し替える範囲（着ているあいだドールを隠し、アイテムの絵がまるごと代わりになる所）
export function swapZones(kind: 'feet' | 'hands', parts: BodyParts): Box[] {
  return kind === 'feet' ? [parts.feet] : [parts.handLeft, parts.handRight];
}
