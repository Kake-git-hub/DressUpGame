import { describe, expect, it } from 'vitest';
import { computeLayout } from '../components/layout';

const none = { top: 0, bottom: 0 };

describe('画面の配置', () => {
  it('横: キャンバスは画面いっぱい、メニューは左 160・右のボタン 60', () => {
    expect(computeLayout(1180, 820, { top: 24, bottom: 0 })).toEqual({
      orientation: 'landscape',
      canvas: { top: 0, width: 1180, height: 820 },
      menuOffset: 160,
      rightOffset: 60,
      itemRows: 0,
      menuHeight: 0,
    });
    // 正方形の画面は横
    expect(computeLayout(800, 800, none).orientation).toBe('landscape');
  });
  it('縦（iPad 820×1180）: 正方形は幅いっぱい、服の行は 2 段', () => {
    expect(computeLayout(820, 1180, none)).toEqual({
      orientation: 'portrait',
      canvas: { top: 0, width: 820, height: 820 },
      menuOffset: 0,
      rightOffset: 0,
      itemRows: 2,
      menuHeight: 308,
    });
  });
  it('縦（スマホ 390×844）: 服の行は 3 段まで', () => {
    const l = computeLayout(390, 844, none);
    expect(l.canvas).toEqual({ top: 0, width: 390, height: 390 });
    expect(l.itemRows).toBe(3);
    expect(l.menuHeight).toBe(392);
    expect(computeLayout(390, 2000, none).itemRows).toBe(3);
  });
  it('縦（iPad 768×1024、上のあき 24）: 上のあきの下に置き、服の行は 1 段', () => {
    const l = computeLayout(768, 1024, { top: 24, bottom: 0 });
    expect(l.canvas).toEqual({ top: 24, width: 768, height: 768 });
    expect(l.itemRows).toBe(1);
    expect(l.menuHeight).toBe(224);
  });
  it('縦で高さが足りないとき: 正方形を小さくして、メニューを画面の中に収める', () => {
    expect(computeLayout(360, 640, none).canvas.height).toBe(360);
    const l = computeLayout(600, 610, none);
    expect(l.canvas).toEqual({ top: 0, width: 600, height: 386 });
    expect(l.itemRows).toBe(1);
    // 下のあき（ホームの線の分）も引く
    expect(computeLayout(600, 610, { top: 0, bottom: 20 }).canvas.height).toBe(366);
    // どんなに低くても、正方形は 120 より小さくしない
    expect(computeLayout(200, 250, none).canvas.height).toBe(120);
  });
  it('どの大きさでも、正方形 + メニュー + あき は画面の高さを越えない（正方形が下限のときを除く）', () => {
    for (const [w, h] of [[360, 640], [390, 844], [414, 896], [768, 1024], [820, 1180], [1024, 1366], [600, 900]]) {
      for (const insets of [none, { top: 24, bottom: 20 }, { top: 59, bottom: 34 }]) {
        const l = computeLayout(w, h, insets);
        expect(l.orientation).toBe('portrait');
        expect(insets.top + l.canvas.height + l.menuHeight + insets.bottom).toBeLessThanOrEqual(h);
        expect(l.canvas.height).toBeLessThanOrEqual(w);
      }
    }
  });
});
