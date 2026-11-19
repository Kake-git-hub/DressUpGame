import { describe, expect, it } from 'vitest';
import { refineAtAnchor } from './align';

// 頭（円）・首・肩のあるドール。大きな髪が頭のほとんどを覆い、顔の小さな窓と、首から下だけがシルエットとして見えている。
// 画像を上へずらすと、首が頭の範囲に入ってきて「シルエットがドールの内側にある画素」が増える。それを改善と数えてはいけない
const W = 300;
const H = 300;
const head = { x: 110, y: 40, w: 80, h: 90 };
function scene(shiftX = 0, shiftY = 0) {
  const doll = new Uint8Array(W * H);
  const silhouette = new Uint8Array(W * H);
  const background = new Uint8Array(W * H);
  const inDoll = (x: number, y: number) => {
    const ex = (x - 150) / 40;
    const ey = (y - 85) / 45;
    if (ex * ex + ey * ey <= 1) return true; // 頭
    if (y >= 125 && y < 150 && Math.abs(x - 150) <= 12) return true; // 首
    return y >= 150 && y < 260 && Math.abs(x - 150) <= 75; // 肩と胴
  };
  // 髪: 頭より一回り大きい楕円（下は肩まで垂れる）。顔の窓だけ空いている
  const inHair = (x: number, y: number) => {
    const ex = (x - 150) / 62;
    const ey = (y - 95) / 80;
    const face = Math.abs(x - 150) <= 18 && y >= 85; // 顔から下（首・胸もと）は髪がかからない
    return ex * ex + ey * ey <= 1 && !face;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (inDoll(x, y)) doll[p] = 1;
      // 生成画像は (shiftX, shiftY) だけずれている
      const sx = x - shiftX;
      const sy = y - shiftY;
      if (inHair(sx, sy)) continue; // 髪（シルエットでも背景でもない）
      if (inDoll(sx, sy)) silhouette[p] = 1;
      else background[p] = 1;
    }
  }
  return { doll, silhouette, background };
}

describe('refineAtAnchor（髪が頭のほとんどを覆うとき）', () => {
  it('ずれていない画像は動かさない（首や肩を頭の範囲に引きこんで、点を稼がない）', () => {
    const shift = refineAtAnchor({ ...scene(), width: W, height: H, box: head });
    expect([shift.dx, shift.dy]).toEqual([0, 0]);
  });
});
