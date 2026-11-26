/**
 * 調整画面の計算（純粋関数）: 枠のつまみ（回す・大きさ）と、スマホ縦の虫めがね
 */

// 回すつまみで、まっすぐ（0 度）に吸い付く幅（度）
export const SNAP_DEG = 4;
// 服の大きさの範囲
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2.5;

// -180〜180 度にそろえる
export function normalizeDeg(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// 回すつまみ: つかんだときの向き（startRotation）に、中心から見た指の角度の差を足す。0 度の近くでは 0 に吸い付く
export function rotateBy(startRotation: number, startAngle: number, angle: number): number {
  const next = normalizeDeg(startRotation + angle - startAngle);
  return Math.abs(next) <= SNAP_DEG ? 0 : next;
}

// 大きさのつまみ: 中心からの距離の比だけ大きく・小さく（向きは変えない）
export function scaleBy(startScale: number, startDistance: number, distance: number, min = MIN_SCALE, max = MAX_SCALE): number {
  return Math.max(min, Math.min(max, startScale * (distance / Math.max(1, startDistance))));
}

// 中心（cx, cy）から見た点の角度（度）と距離
export const angleFrom = (cx: number, cy: number, x: number, y: number): number => (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
export const distanceFrom = (cx: number, cy: number, x: number, y: number): number => Math.hypot(x - cx, y - cy);

// 虫めがねの、いちばん小さい高さ（px）。これより低い端末では出さない
export const LOUPE_MIN_HEIGHT = 160;
export const LOUPE_MIN_ZOOM = 1.5;
export const LOUPE_MAX_ZOOM = 2.5;

export interface Box {
  w: number;
  h: number;
}

// 虫めがねの倍率: 服の枠（画面の px）が、虫めがねの 6 割に収まるくらい（1.5〜2.5 倍）
export function loupeZoom(loupe: Box, frame: Box): number {
  const fit = 0.6 * Math.min(loupe.w / Math.max(1, frame.w), loupe.h / Math.max(1, frame.h));
  return Math.max(LOUPE_MIN_ZOOM, Math.min(LOUPE_MAX_ZOOM, fit));
}

// 虫めがねの中に描く「大きくしたキャンバス」の左上（虫めがねの中の px）。
// view = 虫めがねのまん中に見せる点（画面の px。もとのキャンバスの上の点）、canvas = もとのキャンバスの左上（画面の px）
export function loupeCanvasAt(view: { x: number; y: number }, canvas: { left: number; top: number }, loupe: Box, zoom: number): { left: number; top: number } {
  return { left: loupe.w / 2 - (view.x - canvas.left) * zoom, top: loupe.h / 2 - (view.y - canvas.top) * zoom };
}

// 服の中心（画面の px。もとのキャンバスの上）が、虫めがねの中でまん中から外れすぎたか（ふちから margin より外 = 見えにくい）
export function outsideLoupe(center: { x: number; y: number }, view: { x: number; y: number }, loupe: Box, zoom: number, margin = 24): boolean {
  const x = loupe.w / 2 + (center.x - view.x) * zoom;
  const y = loupe.h / 2 + (center.y - view.y) * zoom;
  return x < margin || y < margin || x > loupe.w - margin || y > loupe.h - margin;
}
