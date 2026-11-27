/**
 * テーマの細かさで、生成の幅を変える（v0.47.0）: くじの表・細かさ・くじ・頼みに足す行・テーマを測る
 */
import { describe, expect, it } from 'vitest';
import { axesFor, drawHints, levelOf, widthKind, widthLines } from './themeWidth.ts';
import type { WidthKind } from './themeWidth.ts';

const seq = (...values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

describe('カテゴリの種類', () => {
  it('名前から決める。知らない名前は「そのほか」', () => {
    expect(widthKind('ドレス')).toBe('dress');
    expect(widthKind('トップス')).toBe('tops');
    expect(widthKind('ボトムス')).toBe('bottoms');
    expect(widthKind('くつ')).toBe('shoes');
    expect(widthKind('ぼうし')).toBe('hat');
    expect(widthKind('ヘアスタイル')).toBe('hair');
    expect(widthKind('かお')).toBe('face');
    for (const label of ['アクセサリー', 'てぶくろ', 'ソックス', 'インナー', 'つばさ']) expect(widthKind(label)).toBe('other');
  });
});

describe('くじの表', () => {
  const kinds: WidthKind[] = ['dress', 'tops', 'bottoms', 'shoes', 'hat', 'hair', 'face', 'other', 'set'];
  it('どの種類にも、くじを引ける軸が 3 つ以上ある。軸の id は種類の中で重ならない', () => {
    for (const kind of kinds) {
      const axes = axesFor(kind, 'おんなのこ');
      expect(axes.filter((a) => a.options.length > 0).length, kind).toBeGreaterThanOrEqual(3);
      expect(new Set(axes.map((a) => a.id)).size, kind).toBe(axes.length);
    }
  });
  it('入れてはいけない候補が無い（季節を選ぶ素材・はだ色のくつ・ひざまでの髪）', () => {
    for (const kind of kinds) for (const axis of axesFor(kind, 'おんなのこ')) for (const o of axis.options) expect(o.en, `${kind}/${axis.id}`).not.toMatch(/velvet|corduroy|knit|fleece|knee-length hair|to the knees/i);
    for (const axis of axesFor('shoes', 'おんなのこ')) for (const o of axis.options) expect(o.en).not.toMatch(/beige|nude|peach|skin/i);
  });
  it('セットには、形の軸があるが、候補は無い（測るだけ）', () => {
    expect(axesFor('set', 'おんなのこ').find((a) => a.id === 'shape')?.options).toEqual([]);
  });
  it('おとこのこ には、女の子向けに寄った候補（リボン・フリル・ツインテール…）を出さない。おんなのこ には出す', () => {
    const all = (name: string) => kinds.flatMap((k) => axesFor(k, name).flatMap((a) => a.options));
    expect(all('おとこのこ').some((o) => o.frilly)).toBe(false);
    expect(all('おとこのこ').map((o) => o.en).join(' ')).not.toMatch(/ribbon|frill|ruffle|lace|pearl|tulle|twin tails|braid/i);
    expect(all('おんなのこ').some((o) => o.frilly)).toBe(true);
  });
});

describe('細かさ', () => {
  it('言っている軸の数 +（話題が 2 つ以上なら 1）: 2 以上 = きっちり、1 = ふつう、0 = ひろく', () => {
    expect(levelOf([], ['spring'])).toBe('wide');
    expect(levelOf([], [])).toBe('wide');
    expect(levelOf(['colour'], [])).toBe('normal');
    expect(levelOf([], ['sea', 'princess'])).toBe('normal');
    expect(levelOf(['colour', 'decoration'], [])).toBe('tight');
    expect(levelOf(['colour'], ['sea', 'princess'])).toBe('tight');
  });
});

describe('くじ', () => {
  const axes = axesFor('dress', 'おんなのこ');
  it('きっちり = 0 個、ふつう = 1〜2 個、ひろく = 2〜3 個', () => {
    for (const r of [0, 0.3, 0.6, 0.999]) {
      expect(drawHints('tight', [], axes, () => r)).toEqual([]);
      expect(drawHints('normal', ['colour'], axes, () => r).length).toBeGreaterThanOrEqual(1);
      expect(drawHints('normal', ['colour'], axes, () => r).length).toBeLessThanOrEqual(2);
      expect(drawHints('wide', [], axes, () => r).length).toBeGreaterThanOrEqual(2);
      expect(drawHints('wide', [], axes, () => r).length).toBeLessThanOrEqual(3);
    }
  });
  it('テーマが言っている軸からは引かない。1 つの軸からは 1 つだけ', () => {
    for (let i = 0; i < 200; i++) {
      const hints = drawHints('wide', ['colour', 'pattern'], axes, Math.random);
      expect(hints.some((h) => h.axis === 'colour' || h.axis === 'pattern')).toBe(false);
      expect(new Set(hints.map((h) => h.axis)).size).toBe(hints.length);
    }
  });
  it('乱数が同じなら、同じくじ', () => {
    expect(drawHints('wide', [], axes, seq(0.1, 0.5, 0.9, 0.3))).toEqual(drawHints('wide', [], axes, seq(0.1, 0.5, 0.9, 0.3)));
  });
  it('引ける軸が足りない（言っていない軸に、候補が無い）ときは、引けた分だけ。落ちない', () => {
    const withOptions = axes.filter((a) => a.options.length > 0).map((a) => a.id);
    expect(drawHints('wide', withOptions, axes, Math.random)).toEqual([]);
    expect(drawHints('wide', withOptions.slice(1), axes, Math.random)).toHaveLength(1);
  });
});

describe('頼みに足す行', () => {
  const hints = [{ axis: 'pattern', en: 'polka dots', ja: 'みずたま' }];
  it('きっちり: そのとおりに、足さない、の 1 文だけ。最近の服は添えない', () => {
    const lines = widthLines('tight', [], ['A red dress.']).join('\n');
    expect(lines).toMatch(/Follow it exactly/);
    expect(lines).not.toContain('A red dress.');
  });
  it('ふつう・ひろく: ヒントと「テーマが勝つ・合わないヒントは捨てる」。最近の服と「違うものに」', () => {
    const lines = widthLines('wide', hints, ['A red dress.', 'A blue dress.']).join('\n');
    expect(lines).toContain('- pattern: polka dots');
    expect(lines).toMatch(/theme always wins/i);
    expect(lines).toMatch(/season or mood/i);
    expect(lines).toContain('- A red dress.');
    expect(lines).toMatch(/clearly different/i);
  });
  it('ヒントも最近の服も無ければ、何も足さない', () => {
    expect(widthLines('wide', [], [])).toEqual([]);
  });
});
