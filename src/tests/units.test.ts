import { describe, expect, it } from 'vitest';
import { stageUnit, toCanvasOffsets, toDollOffsets } from '../engine/units';

describe('調整値の単位（ドールの絵の px ⇄ キャンバスの px）', () => {
  it('ドールの絵の 1px は、キャンバスの高さ × 0.9 ÷ 1024', () => {
    expect(stageUnit(820)).toBe(0.720703125);
    expect(stageUnit(1024)).toBeCloseTo(0.9, 10);
  });
  it('位置のずれだけを直す（大きさ・向き・色は変えない）', () => {
    expect(toCanvasOffsets({ adjustOffsetX: 100, adjustOffsetY: -50, adjustScale: 2 }, 0.5)).toEqual({ adjustOffsetX: 50, adjustOffsetY: -25, adjustScale: 2 });
  });
  it('値が無い項目は足さない', () => {
    expect(toCanvasOffsets({ id: 'a' } as { id: string; adjustOffsetX?: number; adjustOffsetY?: number }, 0.5)).toEqual({ id: 'a' });
    expect(toDollOffsets({ adjustOffsetX: 30 }, 0.5)).toEqual({ adjustOffsetX: 60 });
  });
  it('行って戻ると元の値', () => {
    const x = { adjustOffsetX: 123.4, adjustOffsetY: -56.7 };
    const back = toDollOffsets(toCanvasOffsets(x, 0.72), 0.72);
    expect(back.adjustOffsetX).toBeCloseTo(123.4, 9);
    expect(back.adjustOffsetY).toBeCloseTo(-56.7, 9);
  });
  it('縮尺が 0 や不正でも、値を壊さない（そのまま返す）', () => {
    expect(toDollOffsets({ adjustOffsetX: 30 }, 0)).toEqual({ adjustOffsetX: 30 });
    expect(toCanvasOffsets({ adjustOffsetX: 30 }, Number.NaN)).toEqual({ adjustOffsetX: 30 });
  });
});
