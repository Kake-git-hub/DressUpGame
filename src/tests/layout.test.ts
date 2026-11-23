import { describe, expect, it } from 'vitest';
import { computeLayout, portraitTile } from '../components/layout';

const none = { top: 0, bottom: 0 };

describe('縦の、服の絵の大きさ', () => {
  it.each([
    [390, 104],
    [375, 100],
    [360, 96],
    [430, 115],
    [820, 120],
    [810, 115],
    [768, 130],
    [1024, 127],
    [320, 84],
    [240, 84],
  ])('幅 %i → 絵 %i（右端に、次の服が 3〜7 割のぞく）', (w, tile) => {
    expect(portraitTile(w)).toBe(tile);
    const seen = (w - 8) / (tile + 8); // 見える点数
    expect(seen - Math.floor(seen)).toBeGreaterThanOrEqual(0.3);
    expect(seen - Math.floor(seen)).toBeLessThanOrEqual(0.7);
  });
});

describe('画面の配置', () => {
  it('横: キャンバスは画面いっぱい、メニューは左 160・右のボタン 60', () => {
    expect(computeLayout(1180, 820, { top: 24, bottom: 0 })).toEqual({
      orientation: 'landscape',
      canvas: { top: 0, width: 1180, height: 820 },
      menuOffset: 160,
      rightOffset: 60,
      itemRows: 0,
      itemTile: 0,
      menuHeight: 0,
      phone: false,
    });
    // 正方形の画面は横
    expect(computeLayout(800, 800, none).orientation).toBe('landscape');
  });
  it('縦（iPad 820×1180）: 服は 120px・2 段。正方形は、少し小さくして 776', () => {
    expect(computeLayout(820, 1180, none)).toEqual({
      orientation: 'portrait',
      canvas: { top: 0, width: 820, height: 776 },
      menuOffset: 0,
      rightOffset: 0,
      itemRows: 2,
      itemTile: 120,
      menuHeight: 404,
      phone: false,
    });
  });
  it('縦（スマホ 390×844）: 服は 104px・2 段まで（どんなに縦長でも、3 段にしない）', () => {
    const l = computeLayout(390, 844, none);
    expect(l.canvas).toEqual({ top: 0, width: 390, height: 390 });
    expect(l.itemRows).toBe(2);
    expect(l.itemTile).toBe(104);
    expect(l.menuHeight).toBe(372);
    expect(l.phone).toBe(true);
    expect(computeLayout(390, 2000, none).itemRows).toBe(2);
    expect(computeLayout(390, 2000, none).menuHeight).toBe(372);
  });
  it('スマホで、2 段にするとドールが 1 割より小さくなるとき: ドールは縮めず、服を 1 段にする', () => {
    // Safari の中で開いた 390×664
    const a = computeLayout(390, 664, none);
    expect(a.canvas.height).toBe(390);
    expect([a.itemRows, a.itemTile, a.menuHeight]).toEqual([1, 104, 256]);
    // 小さいスマホ 375×667
    const b = computeLayout(375, 667, none);
    expect(b.canvas.height).toBe(375);
    expect([b.itemRows, b.itemTile, b.menuHeight, b.phone]).toEqual([1, 100, 252, true]);
    const c = computeLayout(360, 640, none);
    expect(c.canvas.height).toBe(360);
    expect([c.itemRows, c.itemTile, c.menuHeight]).toEqual([1, 96, 248]);
  });
  it('タブレット（幅 600 以上）は、ドールを 75% まで縮めても 2 段にする（iPad 768×1024、上のあき 24）', () => {
    const l = computeLayout(768, 1024, { top: 24, bottom: 0 });
    expect(l.canvas).toEqual({ top: 24, width: 768, height: 576 });
    expect([l.itemRows, l.itemTile, l.menuHeight, l.phone]).toEqual([2, 130, 424, false]);
  });
  it('縦で高さが足りないとき: 服は 1 段。正方形を小さくして、メニューを画面の中に収める', () => {
    const l = computeLayout(600, 610, none);
    expect(l.canvas).toEqual({ top: 0, width: 600, height: 338 });
    expect([l.itemRows, l.itemTile, l.menuHeight, l.phone]).toEqual([1, 120, 272, false]);
    // 下のあき（ホームの線の分）も引く
    expect(computeLayout(600, 610, { top: 0, bottom: 20 }).canvas.height).toBe(318);
    // どんなに低くても、正方形は 120 より小さくしない
    expect(computeLayout(200, 250, none).canvas.height).toBe(120);
    expect(computeLayout(200, 250, none).itemRows).toBe(1);
  });
  it('どの大きさでも、正方形 + メニュー + あき は画面の高さを越えない（正方形が下限のときを除く）。服は 2 段まで', () => {
    for (const [w, h] of [[360, 640], [390, 844], [414, 896], [768, 1024], [820, 1180], [1024, 1366], [600, 900], [390, 664], [375, 667], [320, 700], [240, 480]]) {
      for (const insets of [none, { top: 24, bottom: 20 }, { top: 59, bottom: 34 }]) {
        const l = computeLayout(w, h, insets);
        expect(l.orientation).toBe('portrait');
        expect(insets.top + l.canvas.height + l.menuHeight + insets.bottom).toBeLessThanOrEqual(h);
        expect(l.canvas.height).toBeLessThanOrEqual(w);
        expect(l.itemRows).toBeGreaterThanOrEqual(1);
        expect(l.itemRows).toBeLessThanOrEqual(2);
        expect(l.menuHeight).toBe(84 + 56 + l.itemRows * (l.itemTile + 12));
        expect(l.phone).toBe(w < 600);
      }
    }
  });
});
