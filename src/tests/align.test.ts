/**
 * シルエットによる位置合わせのテスト
 */
import { describe, it, expect } from 'vitest';
import { alignToDoll } from '../pipeline/align';

const N = 512; // ドールのキャンバス

type Shape = [number, number, number, number]; // x, y, w, h（0〜1）
// 人型: 頭・胴・腕・脚
const BODY: Shape[] = [
  [0.44, 0.04, 0.12, 0.12],
  [0.4, 0.16, 0.2, 0.34],
  [0.3, 0.18, 0.1, 0.3],
  [0.6, 0.18, 0.1, 0.3],
  [0.4, 0.5, 0.08, 0.44],
  [0.52, 0.5, 0.08, 0.44],
];
const DRESS: Shape = [0.3, 0.16, 0.4, 0.66]; // 頭と足先だけが見える
const TOP: Shape = [0.38, 0.18, 0.24, 0.2];

function inside(shapes: Shape[], u: number, v: number): boolean {
  return shapes.some(([x, y, w, h]) => u >= x && u < x + w && v >= y && v < y + h);
}

function dollMask(): Uint8Array {
  const m = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (inside(BODY, (x + 0.5) / N, (y + 0.5) / N)) m[y * N + x] = 1;
  return m;
}

// 大きさ size の「AI 画像」のマスク。体を (scale, dx, dy)（ドールのキャンバス px、左上基準）で変形して描く
function generated(size: number, cloth: Shape, scale = 1, dx = 0, dy = 0, body: Shape[] = BODY) {
  const silhouette = new Uint8Array(size * size);
  const background = new Uint8Array(size * size);
  const toDoll = N / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // この画素は、変形前のドールのキャンバスのどこか
      const u = (((x + 0.5) * toDoll) * scale + dx) / N;
      const v = (((y + 0.5) * toDoll) * scale + dy) / N;
      const p = y * size + x;
      if (inside([cloth], u, v)) continue; // 服
      if (inside(body, u, v)) silhouette[p] = 1;
      else background[p] = 1;
    }
  }
  return { silhouette, background, width: size, height: size };
}

const doll = dollMask();
const align = (g: ReturnType<typeof generated>) => alignToDoll({ ...g, doll, dollWidth: N, dollHeight: N });

describe('alignToDoll', () => {
  it('ずれていない画像は 等倍・ずれなし', () => {
    const a = align(generated(N, TOP));
    expect(a).toMatchObject({ scale: 1, dx: 0, dy: 0 });
    expect(a.score).toBeGreaterThan(0.95);
  });

  // 元画像を「変形前の座標 = 画素 × scale + (dx, dy)」で作ったので、返る変換はその逆になるはず
  it.each([
    [1.04, 12, -8],
    [0.96, -10, 6],
    [1.0, 15, 0],
    [1.08, -20, -20],
  ])('倍率 %f・ずれ (%i, %i) を元に戻す', (s, dx, dy) => {
    const a = align(generated(N, TOP, s, dx, dy));
    expect(Math.abs(a.scale - s)).toBeLessThan(0.01);
    expect(Math.abs(a.dx - dx)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.dy - dy)).toBeLessThanOrEqual(2);
    expect(a.score).toBeGreaterThan(0.9);
  });

  it('服が体の大半を隠していても（ドレス）、見えている頭と足で合わせる', () => {
    const a = align(generated(N, DRESS, 1.04, 10, -6));
    expect(Math.abs(a.scale - 1.04)).toBeLessThan(0.012);
    expect(Math.abs(a.dx - 10)).toBeLessThanOrEqual(3);
    expect(Math.abs(a.dy + 6)).toBeLessThanOrEqual(3);
  });

  it('シルエットが無ければ 等倍・ずれなし、score 0', () => {
    const g = generated(N, TOP);
    g.silhouette.fill(0);
    expect(align(g)).toEqual({ scale: 1, dx: 0, dy: 0, score: 0 });
  });

  it('別の形のシルエット（ドールと合わない）は score が 0.5 未満', () => {
    const other: Shape[] = [[0.1, 0.4, 0.8, 0.2]]; // 横長の帯
    const a = align(generated(N, [0, 0, 0, 0], 1, 0, 0, other));
    expect(a.score).toBeLessThan(0.5);
  });

  it('元画像の大きさがドールの 2 倍でも同じ結果', () => {
    const a = align(generated(N * 2, TOP, 1.04, 12, -8));
    expect(Math.abs(a.scale - 1.04)).toBeLessThan(0.01);
    expect(Math.abs(a.dx - 12)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.dy + 8)).toBeLessThanOrEqual(2);
  });

  it('縦長の元画像は、動かさないとき縦の中央に置く', () => {
    // 幅 N・高さ 1.5N の画像の中央に、ドールと同じ形がある
    const h = N * 1.5;
    const silhouette = new Uint8Array(N * h);
    const background = new Uint8Array(N * h).fill(1);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (doll[y * N + x]) { silhouette[(y + N / 4) * N + x] = 1; background[(y + N / 4) * N + x] = 0; }
    const a = alignToDoll({ silhouette, background, width: N, height: h, doll, dollWidth: N, dollHeight: N });
    expect(a).toMatchObject({ scale: 1, dx: 0, dy: -N / 4 });
    expect(a.score).toBeGreaterThan(0.95);
  });

  it('1 回の位置合わせが 3 秒以内に終わる', () => {
    const big = 1024;
    const m = new Uint8Array(big * big);
    for (let y = 0; y < big; y++) for (let x = 0; x < big; x++) if (inside(BODY, (x + 0.5) / big, (y + 0.5) / big)) m[y * big + x] = 1;
    const g = generated(2000, TOP, 1.03, 5, 5);
    const t = performance.now();
    alignToDoll({ ...g, doll: m, dollWidth: big, dollHeight: big });
    expect(performance.now() - t).toBeLessThan(3000);
  });
});
