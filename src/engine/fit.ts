/**
 * 自分の服の「はじめの位置」（クローゼットで決める）: 位置・大きさ・向き。
 * x・y は「ドールの絵の px」（units.ts と同じ単位。画面の大きさ・向きが変わっても、ドールに対して同じ所）。
 */
export interface ItemFit {
  x: number;
  y: number;
  scale: number; // 0.3〜2.5
  rotation: number; // -180〜180（度）
}

export const FIT_XY_MAX = 1024;
export const FIT_SCALE_MIN = 0.3;
export const FIT_SCALE_MAX = 2.5;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

// 受け取った値を、はじめの位置に直す。形がおかしければ undefined（呼んだ側が断る）。範囲の外は、範囲に収める
export function normalizeFit(value: unknown): ItemFit | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const nums = [v.x, v.y, v.scale, v.rotation];
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  const [x, y, scale, rotation] = nums as number[];
  return {
    x: round(clamp(x, -FIT_XY_MAX, FIT_XY_MAX), 2),
    y: round(clamp(y, -FIT_XY_MAX, FIT_XY_MAX), 2),
    scale: round(clamp(scale, FIT_SCALE_MIN, FIT_SCALE_MAX), 4),
    rotation: round(clamp(rotation, -180, 180), 2),
  };
}

// もとの位置（何もしていない）か
export const isPlainFit = (fit: ItemFit | null | undefined): boolean => !fit || (fit.x === 0 && fit.y === 0 && fit.scale === 1 && fit.rotation === 0);

export const sameFit = (a: ItemFit | null | undefined, b: ItemFit | null | undefined): boolean =>
  isPlainFit(a) && isPlainFit(b) ? true : !!a && !!b && a.x === b.x && a.y === b.y && a.scale === b.scale && a.rotation === b.rotation;

// 着せたときの調整値（はじめの位置が無ければ、空 = もとの位置）
export function fitAdjustment(fit: ItemFit | null | undefined): { adjustOffsetX?: number; adjustOffsetY?: number; adjustScale?: number; adjustRotation?: number } {
  if (isPlainFit(fit)) return {};
  return { adjustOffsetX: fit!.x, adjustOffsetY: fit!.y, adjustScale: fit!.scale, adjustRotation: fit!.rotation };
}
