import { describe, expect, it } from 'vitest';
import { angleFrom, distanceFrom, loupeCanvasAt, loupeZoom, normalizeDeg, outsideLoupe, rotateBy, scaleBy } from '../components/adjustMath';

describe('つまみの計算', () => {
  it('角度は -180〜180 にそろう', () => {
    expect(normalizeDeg(190)).toBe(-170);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(540)).toBe(180);
  });

  it('回す: 指の角度の差だけ回り、0 度の近く（4 度まで）は 0 に吸い付く', () => {
    expect(rotateBy(10, 0, 30)).toBe(40);
    expect(rotateBy(10, 0, -7)).toBe(0);
    expect(rotateBy(0, -90, -85)).toBe(5);
    expect(rotateBy(170, 0, 20)).toBe(-170);
  });

  it('大きさ: 距離の比だけ。0.3〜2.5 に収まる', () => {
    expect(scaleBy(1, 100, 150)).toBe(1.5);
    expect(scaleBy(1, 100, 10)).toBe(0.3);
    expect(scaleBy(2, 100, 200)).toBe(2.5);
    expect(scaleBy(1, 0, 0.5)).toBe(0.5); // つかんだ所が中心でも、0 で割らない
  });

  it('中心から見た角度と距離', () => {
    expect(angleFrom(0, 0, 0, 10)).toBe(90);
    expect(distanceFrom(0, 0, 3, 4)).toBe(5);
  });
});

describe('虫めがね', () => {
  it('倍率は、服の枠が 6 割に収まるくらい。1.5〜2.5 倍', () => {
    expect(loupeZoom({ w: 300, h: 300 }, { w: 100, h: 100 })).toBeCloseTo(1.8);
    expect(loupeZoom({ w: 300, h: 300 }, { w: 20, h: 20 })).toBe(2.5);
    expect(loupeZoom({ w: 300, h: 300 }, { w: 300, h: 400 })).toBe(1.5);
  });

  it('見せる点が、虫めがねのまん中に来る', () => {
    const at = loupeCanvasAt({ x: 200, y: 150 }, { left: 0, top: 50 }, { w: 300, h: 200 }, 2);
    // 見せる点は、もとのキャンバスの (200, 100)。2 倍で (400, 200)。それが (150, 100) に来る
    expect(at).toEqual({ left: 150 - 400, top: 100 - 200 });
  });

  it('服の中心が、ふちの近く・外に出たら true', () => {
    const view = { x: 100, y: 100 };
    const box = { w: 300, h: 200 };
    expect(outsideLoupe({ x: 100, y: 100 }, view, box, 2)).toBe(false);
    expect(outsideLoupe({ x: 160, y: 100 }, view, box, 2)).toBe(false); // まん中から 120px 右（ふちまで 30px）
    expect(outsideLoupe({ x: 170, y: 100 }, view, box, 2)).toBe(true); // 140px 右（ふちまで 10px）
    expect(outsideLoupe({ x: 100, y: 40 }, view, box, 2)).toBe(true);
  });
});
