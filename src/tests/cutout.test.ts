/**
 * 背景・シルエットの除去と、位置合わせのテスト
 */
import { describe, it, expect } from 'vitest';
import { chooseKeyColors, colorDistance, detectKeyColors } from '../pipeline/keyColors';
import type { Rgb } from '../pipeline/keyColors';
import { closeColorRatio, cutOutClothing } from '../pipeline/cutout';

type Rgba = [number, number, number, number];
const W = 64;
const H = 96;

function image(fill: Rgba): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) px.set(fill, i * 4);
  return px;
}
function rect(px: Uint8ClampedArray, x0: number, y0: number, w: number, h: number, c: Rgba) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) px.set(c, (y * W + x) * 4);
}
const alpha = (px: Uint8ClampedArray, x: number, y: number) => px[(y * W + x) * 4 + 3];
const rgb = (px: Uint8ClampedArray, x: number, y: number) => Array.from(px.slice((y * W + x) * 4, (y * W + x) * 4 + 3));

const WHITE: Rgba = [255, 255, 255, 255];
const GREEN: Rgba = [10, 250, 5, 255];
const RED: Rgba = [200, 30, 40, 255];
const MAGENTA: Rgba = [200, 20, 200, 255];
const BLACK: Rgba = [5, 5, 5, 255];
const NAVY: Rgba = [20, 25, 45, 255];

// 白背景に緑のシルエット（縦長）、胴に赤い服
function sample(bg: Rgba = WHITE, sil: Rgba = GREEN, cloth: Rgba = RED): Uint8ClampedArray {
  const px = image(bg);
  rect(px, 24, 8, 16, 80, sil); // 体
  rect(px, 16, 30, 32, 30, cloth); // 服（体より広い）
  return px;
}

// 体の形（sample の体と同じ）
const DOLL = (() => {
  const mask = new Uint8Array(W * H);
  for (let y = 8; y < 88; y++) for (let x = 24; x < 40; x++) mask[y * W + x] = 1;
  return { mask, width: W, height: H };
})();
const detect = (px: Uint8ClampedArray) => detectKeyColors(px, W, H, { doll: DOLL });

describe('detectKeyColors', () => {
  it('白背景と緑シルエットを検出する', () => {
    const keys = detect(sample());
    expect(keys.background).toEqual([255, 255, 255]);
    expect(keys.silhouette).not.toBeNull();
    expect(colorDistance(keys.silhouette!, [10, 250, 5])).toBeLessThan(6);
  });
  it('シルエットが無い画像（背景と、色がばらついた服だけ）では null', () => {
    const px = image(WHITE);
    // 1 画素ごとに色が大きく違う服
    for (let y = 30; y < 60; y++) {
      for (let x = 16; x < 48; x++) px.set([(x * 37) % 256, (y * 53) % 256, ((x + y) * 29) % 200, 255], (y * W + x) * 4);
    }
    expect(detectKeyColors(px, W, H).silhouette).toBeNull();
  });
  it('マゼンタ背景・黒シルエットでも検出する', () => {
    const keys = detect(sample(MAGENTA, BLACK, RED));
    expect(colorDistance(keys.background, [200, 20, 200])).toBeLessThan(2);
    expect(colorDistance(keys.silhouette!, [5, 5, 5])).toBeLessThan(6);
  });
  it('hint を渡すと、服のほうが広くてもその色をシルエットとする', () => {
    const px = image(WHITE);
    rect(px, 28, 4, 8, 20, GREEN); // 見えているシルエットは少ない
    rect(px, 8, 24, 48, 68, RED); // 単色の大きな服
    expect(colorDistance(detectKeyColors(px, W, H).silhouette!, [200, 30, 40])).toBeLessThan(6);
    expect(colorDistance(detectKeyColors(px, W, H, { color: [0, 255, 0] }).silhouette!, [10, 250, 5])).toBeLessThan(6);
  });
  it('ドールの形を渡すと、体からはみ出す単色の服より、体の内側の色をシルエットとする', () => {
    expect(colorDistance(detectKeyColors(sample(), W, H).silhouette!, [200, 30, 40])).toBeLessThan(6); // 手がかりなしでは服を選んでしまう
    expect(colorDistance(detect(sample()).silhouette!, [10, 250, 5])).toBeLessThan(6);
  });
  it('全部が背景なら null', () => {
    expect(detectKeyColors(image(WHITE), W, H).silhouette).toBeNull();
  });
});

describe('cutOutClothing', () => {
  it('背景とシルエットが消え、服だけが残る', () => {
    const px = sample();
    const keys = detect(px);
    cutOutClothing(px, W, H, keys);
    expect(alpha(px, 2, 2)).toBe(0); // 背景
    expect(alpha(px, 32, 15)).toBe(0); // シルエット（頭）
    expect(alpha(px, 32, 80)).toBe(0); // シルエット（脚）
    expect(alpha(px, 32, 45)).toBe(255); // 服
    expect(rgb(px, 32, 45)).toEqual([200, 30, 40]);
  });
  it('服の内側の白いハイライトは残る', () => {
    const px = sample();
    rect(px, 28, 40, 6, 6, WHITE);
    cutOutClothing(px, W, H, detect(px));
    expect(alpha(px, 30, 42)).toBe(255);
  });
  it('シルエットに接する閉じた背景（首飾りの内側）は消える', () => {
    const px = image(WHITE);
    rect(px, 16, 8, 32, 80, GREEN); // 広い体
    // 赤い輪。内側の上半分は白（背景）、下半分は緑（シルエット）
    rect(px, 22, 20, 20, 20, RED);
    rect(px, 26, 24, 12, 6, WHITE);
    rect(px, 26, 30, 12, 6, GREEN);
    cutOutClothing(px, W, H, detectKeyColors(px, W, H));
    expect(alpha(px, 32, 26)).toBe(0); // 輪の内側の白
    expect(alpha(px, 32, 33)).toBe(0); // 輪の内側の緑
    expect(alpha(px, 23, 30)).toBe(255); // 輪そのもの
  });
  it('ふちに混ざったシルエット色（中間色の 1px の帯）は消える', () => {
    const px = sample();
    // 服の上の辺に、緑が 65% まざった帯
    rect(px, 24, 29, 16, 1, [77, 173, 17, 255]);
    cutOutClothing(px, W, H, detect(px));
    expect(alpha(px, 32, 29)).toBe(0);
    expect(alpha(px, 32, 34)).toBe(255);
  });
  it('服の中の、シルエットに近いが同じではない色（距離 60）は残る', () => {
    const px = sample();
    rect(px, 26, 40, 10, 10, [10, 190, 5, 255]); // 緑から 60 離れた色。服の内側
    cutOutClothing(px, W, H, detect(px));
    expect(alpha(px, 31, 45)).toBe(255);
  });
  it('ふちの 1px は半透明になる', () => {
    const px = sample();
    cutOutClothing(px, W, H, detect(px));
    const a = alpha(px, 16, 45); // 服の左端
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(255);
  });
  it('マスク: 消した背景とシルエットが 1 になっている', () => {
    const px = sample();
    const masks = cutOutClothing(px, W, H, detect(px));
    expect(masks.background[2 * W + 2]).toBe(1);
    expect(masks.silhouette[15 * W + 32]).toBe(1);
    expect(masks.background[45 * W + 32]).toBe(0);
    expect(masks.silhouette[45 * W + 32]).toBe(0);
  });
  it('シルエットが無くても（透過済みの画像）、透明な所はそのまま、服は残る', () => {
    const px = image([0, 0, 0, 0]);
    rect(px, 16, 30, 32, 30, RED);
    cutOutClothing(px, W, H, { background: [0, 0, 0], silhouette: null });
    expect(alpha(px, 2, 2)).toBe(0);
    expect(alpha(px, 32, 45)).toBe(255);
  });
});

describe('cutOutClothing（かけら）', () => {
  it('数画素の消し残りは消え、小さくても形のある飾りは残る', () => {
    const px = sample();
    rect(px, 4, 4, 1, 2, [120, 200, 110, 255]); // 背景の中の 2 画素
    rect(px, 50, 70, 4, 4, [30, 40, 200, 255]); // 16 画素の飾り
    cutOutClothing(px, W, H, detect(px));
    expect(alpha(px, 4, 4)).toBe(0);
    expect(alpha(px, 51, 71)).toBeGreaterThan(0);
  });
});

describe('closeColorRatio', () => {
  it('黒シルエットに紺の服だと 0.5 を超える', () => {
    const px = sample(MAGENTA, BLACK, NAVY);
    const keys: { background: Rgb; silhouette: Rgb } = { background: [200, 20, 200], silhouette: [5, 5, 5] };
    cutOutClothing(px, W, H, keys);
    expect(closeColorRatio(px, W, H, keys)).toBeGreaterThan(0.5);
  });
  it('緑シルエットに赤い服だと 0', () => {
    const px = sample();
    const keys = detect(px);
    cutOutClothing(px, W, H, keys);
    expect(closeColorRatio(px, W, H, keys)).toBe(0);
  });
});

describe('chooseKeyColors', () => {
  it('予定色が無ければ、互いに離れた 2 色', () => {
    const k = chooseKeyColors([]);
    expect(colorDistance(k.silhouette, k.background)).toBeGreaterThan(200);
  });
  it('緑の服なら緑を避ける', () => {
    const k = chooseKeyColors([[20, 200, 40], [255, 255, 255]]);
    expect(colorDistance(k.silhouette, [20, 200, 40])).toBeGreaterThan(150);
    expect(colorDistance(k.background, [20, 200, 40])).toBeGreaterThan(150);
    expect(colorDistance(k.background, [255, 255, 255])).toBeGreaterThan(150);
    expect(colorDistance(k.silhouette, k.background)).toBeGreaterThan(150);
  });
  it('黒は選ばない', () => {
    const k = chooseKeyColors([[255, 255, 255], [0, 255, 0], [255, 0, 255]]);
    expect(k.silhouette).not.toEqual([0, 0, 0]);
    expect(k.background).not.toEqual([0, 0, 0]);
  });
});
