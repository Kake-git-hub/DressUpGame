import { describe, expect, it } from 'vitest';
import { dominantColor, isShadowOf, skinShadowMask } from './skinShadow';

const SKIN = [254, 208, 182];
const SHADOW = [221, 163, 146]; // 本物の絵にあった影の色
const BLACK = [24, 24, 28];

// 幅 W の絵を、行ごとの色の並びから作る
function picture(rows: number[][][]) {
  const height = rows.length;
  const width = rows[0].length;
  const rgba = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) => row.forEach((c, x) => rgba.set([...c, 255], (y * width + x) * 4)));
  return { rgba, width, height };
}

describe('isShadowOf', () => {
  it('肌を少し暗く赤くした色は影', () => {
    expect(isShadowOf(221, 163, 146, 254, 208, 182)).toBe(true);
    expect(isShadowOf(234, 178, 157, 255, 209, 183)).toBe(true);
    expect(isShadowOf(213, 164, 147, 254, 208, 182)).toBe(true);
  });
  it('肌そのもの・髪の色（黒、茶、金、うすいピンク、むらさき）は影ではない', () => {
    expect(isShadowOf(254, 208, 182, 254, 208, 182)).toBe(false);
    expect(isShadowOf(24, 24, 28, 254, 208, 182)).toBe(false);
    expect(isShadowOf(120, 70, 40, 254, 208, 182)).toBe(false);
    expect(isShadowOf(245, 205, 110, 254, 208, 182)).toBe(false);
    expect(isShadowOf(255, 190, 205, 254, 208, 182)).toBe(false);
    expect(isShadowOf(190, 150, 220, 254, 208, 182)).toBe(false);
  });
});

describe('dominantColor', () => {
  it('いちばん多い色を返す（mask の中だけ）', () => {
    const { rgba } = picture([[SKIN, SKIN, SKIN, BLACK, [255, 255, 255]]]);
    const c = dominantColor(rgba, [1, 1, 1, 1, 0])!;
    expect(c.map(Math.round)).toEqual(SKIN);
    expect(dominantColor(rgba, [0, 0, 0, 0, 0])).toBeNull();
  });
  it('warm: 肌らしい色味の中でいちばん多い色（白い下着のほうが広くても、肌を選ぶ）', () => {
    const white = [241, 239, 234];
    const { rgba } = picture([[white, white, white, SKIN, SKIN, BLACK]]);
    expect(dominantColor(rgba, [1, 1, 1, 1, 1, 1])!.map(Math.round)).toEqual(white);
    expect(dominantColor(rgba, [1, 1, 1, 1, 1, 1], true)!.map(Math.round)).toEqual(SKIN);
    expect(dominantColor(rgba, [1, 1, 1, 0, 0, 1], true)).toBeNull();
  });
});

describe('skinShadowMask', () => {
  // 上から: 黒い前髪 4 行 → 影 1 行 → 肌 2 行。全部ドールの上
  const ROWS = 7;
  const row = (c: number[]) => Array.from({ length: 6 }, () => c);
  const under = picture(Array.from({ length: ROWS }, () => row(SKIN)));
  const image = picture([row(BLACK), row(BLACK), row(BLACK), row(BLACK), row(SHADOW), row(SKIN), row(SKIN)]);
  const hair = new Uint8Array(6 * ROWS).fill(1, 0, 30);
  const bare = new Uint8Array(6 * ROWS).fill(1, 30);

  it('前髪の下の、肌に接した影の帯を見つける。髪は残す', () => {
    const shadow = skinShadowMask(image.rgba, under.rgba, hair, bare, 6, ROWS);
    expect([...shadow]).toEqual([...new Uint8Array(6 * ROWS).fill(1, 24, 30)]);
  });

  it('影と肌の境目の、うすい影（ぼかし）も一緒に取る', () => {
    // 濃さ 0.27 の影: 元の絵との色の差は 18（髪として数えられる）
    const faint = [245, 195, 172];
    const black = Array.from({ length: 8 }, () => row(BLACK));
    const soft = picture([...black, row(SHADOW), row(faint), row(SKIN), row(SKIN)]);
    const below = picture(Array.from({ length: 12 }, () => row(SKIN)));
    const shadow = skinShadowMask(soft.rgba, below.rgba, new Uint8Array(72).fill(1, 0, 60), new Uint8Array(72).fill(1, 60), 6, 12);
    expect([...shadow]).toEqual([...new Uint8Array(72).fill(1, 48, 60)]);
  });

  it('髪のかかっていない肌に接していない、影の色の所は残す（髪の中の飾りなど）', () => {
    // 影の色の行を、黒い髪の行ではさむ
    const inside = picture([row(BLACK), row(BLACK), row(SHADOW), row(BLACK), row(BLACK), row(SKIN), row(SKIN)]);
    expect(skinShadowMask(inside.rgba, under.rgba, hair, bare, 6, ROWS).includes(1)).toBe(false);
  });

  it('白い下着が肌より広いドール（ランニングシャツの男の子）でも、額の影を見つける', () => {
    const white = [241, 239, 234];
    // 上から: 黒い前髪 4 行 → 影 1 行 → 肌 2 行 → 白いシャツ 10 行
    const shirt = Array.from({ length: 10 }, () => row(white));
    const below = picture([...Array.from({ length: 7 }, () => row(SKIN)), ...shirt]);
    const worn = picture([row(BLACK), row(BLACK), row(BLACK), row(BLACK), row(SHADOW), row(SKIN), row(SKIN), ...shirt]);
    const total = 6 * 17;
    const shadow = skinShadowMask(worn.rgba, below.rgba, new Uint8Array(total).fill(1, 0, 30), new Uint8Array(total).fill(1, 30), 6, 17);
    expect([...shadow]).toEqual([...new Uint8Array(total).fill(1, 24, 30)]);
  });

  it('髪そのものが影に近い色（ドールの上の髪の 3 割を超える）なら、何も外さない', () => {
    const peach = picture([row(BLACK), row(BLACK), row(BLACK), row(SHADOW), row(SHADOW), row(SKIN), row(SKIN)]);
    expect(skinShadowMask(peach.rgba, under.rgba, hair, bare, 6, ROWS).includes(1)).toBe(false);
  });

  it('白い下着の上の、うす暗い色は影にしない（肌の上だけを見る）', () => {
    const white = [246, 244, 240];
    const underShirt = picture([row(SKIN), row(SKIN), row(SKIN), row(SKIN), row(white), row(SKIN), row(SKIN)]);
    const onShirt = picture([row(BLACK), row(BLACK), row(BLACK), row(BLACK), row([214, 190, 192]), row(SKIN), row(SKIN)]);
    expect(skinShadowMask(onShirt.rgba, underShirt.rgba, hair, bare, 6, ROWS).includes(1)).toBe(false);
  });
});
