/**
 * 服の位置の調整値の単位
 *
 * アプリの状態と保存では「ドールの絵の px」（ドールのキャンバスでの長さ）で持つ。
 * 画面の大きさや向きが変わっても、ドールに対して同じ位置になる。
 * 描画（PixiEngine）と調整画面は「キャンバスの px」で計算するので、渡す直前に直す。
 */

// ドールの絵の 1px が、キャンバスの論理座標で何 px か（PixiEngine: キャンバスの高さ × 0.9 ÷ 1024）
export const stageUnit = (canvasHeight: number): number => (canvasHeight * 0.9) / 1024;

type Offsets = { adjustOffsetX?: number; adjustOffsetY?: number };
const usable = (unit: number): boolean => Number.isFinite(unit) && unit > 0;

function scaleOffsets<T extends Offsets>(value: T, factor: number): T {
  const next = { ...value };
  if (typeof next.adjustOffsetX === 'number') next.adjustOffsetX *= factor;
  if (typeof next.adjustOffsetY === 'number') next.adjustOffsetY *= factor;
  return next;
}

// 状態（ドールの絵の px）→ 描画・調整画面に渡す値（キャンバスの px）
export function toCanvasOffsets<T extends Offsets>(item: T, unit: number): T {
  return usable(unit) ? scaleOffsets(item, unit) : item;
}

// 調整画面から受け取った値（キャンバスの px）→ 状態（ドールの絵の px）
export function toDollOffsets<T extends Offsets>(adjustment: T, unit: number): T {
  return usable(unit) ? scaleOffsets(adjustment, 1 / unit) : adjustment;
}
