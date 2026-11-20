import { describe, it, expect, vi } from 'vitest';

vi.mock('pixi.js', () => ({ Application: class {}, Container: class {}, Graphics: class {}, Sprite: class {}, Assets: {}, ColorMatrixFilter: class {}, Texture: class {} }));

import { itemPivot } from '../engine/PixiEngine';

describe('itemPivot（拡大・回転の軸）', () => {
  const placed = { canvasW: 1000, canvasH: 1000, box: { x: 300, y: 100, w: 200, h: 400 } };
  it('ふつうは、服そのものの中心', () => {
    expect(itemPivot(placed, { width: 200, height: 400 })).toEqual({ x: 100, y: 200, fromCanvasCenter: { x: -100, y: -200 } });
  });
  it('pivot を持つ服（うしろがみ）は、そこが軸。テクスチャが box と違う大きさでも合う', () => {
    // 軸は、キャンバスの中心から (-50, -350) = キャンバス上の (450, 150) = 服の絵の中の (150, 50)
    expect(itemPivot({ ...placed, pivot: { x: -50, y: -350 } }, { width: 200, height: 400 })).toEqual({ x: 150, y: 50, fromCanvasCenter: { x: -50, y: -350 } });
    expect(itemPivot({ ...placed, pivot: { x: -50, y: -350 } }, { width: 100, height: 200 })).toEqual({ x: 75, y: 25, fromCanvasCenter: { x: -50, y: -350 } });
  });
});
