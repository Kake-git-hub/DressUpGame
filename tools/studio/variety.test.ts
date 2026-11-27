import { describe, expect, it } from 'vitest';
import type { ManifestDoll } from '../../src/content/manifest.ts';
import type { TextAi } from './ai.ts';
import { planItems, planSet } from './generate.ts';
import { MAX_HINTS_USED, drawHints, readVariety, recentRules, varietyKind, varietyRules } from './variety.ts';
import type { Rng } from './variety.ts';

// 決まった並びの乱数（くじの結果を毎回同じにする）
function seeded(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const doll = {
  id: 'd',
  name: 'd',
  categories: ['ドレス', 'くつ', 'ヘアスタイル', 'かお', 'ぼうし', 'ソックス', 'うしろがみ'].map((id) => ({ id, label: id })),
} as unknown as ManifestDoll;

function recorder(reply: (prompt: string) => unknown) {
  const calls: { prompt: string; schema: Record<string, unknown> }[] = [];
  const text: TextAi = {
    json: async <T>(input: { prompt: string; schema: Record<string, unknown> }) => {
      calls.push(input);
      return reply(input.prompt) as T;
    },
  };
  return { text, calls };
}

describe('カテゴリの種類', () => {
  it('ラベルから、軸の表を選ぶ', () => {
    expect(varietyKind('ドレス')).toBe('garment');
    expect(varietyKind('トップス')).toBe('garment');
    expect(varietyKind('くつ')).toBe('shoes');
    expect(varietyKind('ソックス')).toBe('small');
    expect(varietyKind('てぶくろ')).toBe('small');
    expect(varietyKind('ぼうし')).toBe('hat');
    expect(varietyKind('ヘアスタイル')).toBe('hair');
    expect(varietyKind('かお')).toBe('face');
    expect(varietyKind('マント')).toBe('garment');
  });
});

describe('くじ', () => {
  it('軸ごとに 1 つまで。乱数が違えば、並びも中身も変わる', () => {
    const a = drawHints('garment', seeded(1));
    expect(new Set(a.map((h) => h.axis)).size).toBe(a.length);
    expect(a.length).toBe(5);
    const many = new Set(Array.from({ length: 30 }, (_, i) => drawHints('garment', seeded(i + 10)).map((h) => h.text).join('|')));
    expect(many.size).toBeGreaterThan(25);
  });

  it('カテゴリに合わない軸は出さない（髪・顔に柄はない。くつの形は、くつの候補から）', () => {
    for (let i = 0; i < 50; i++) {
      expect(drawHints('hair', seeded(i)).map((h) => h.axis)).not.toContain('pattern');
      expect(drawHints('face', seeded(i)).map((h) => h.axis)).not.toContain('pattern');
      const shape = drawHints('shoes', seeded(i)).find((h) => h.axis === 'shape')!;
      expect(shape.text).not.toMatch(/flared|ruffle|collar/);
      expect(drawHints('small', seeded(i)).map((h) => h.axis)).not.toContain('shape');
    }
  });

  it('ぶつかる組み合わせは、同時に出さない', () => {
    for (let i = 0; i < 300; i++) {
      const texts = drawHints('shoes', seeded(i)).map((h) => h.text);
      expect(texts.includes('sandals') && texts.includes('a cosy winter look')).toBe(false);
    }
  });

  it('引かない軸を指定できる（セットの形）', () => {
    for (let i = 0; i < 20; i++) expect(drawHints('garment', seeded(i), ['shape']).map((h) => h.axis)).not.toContain('shape');
  });

  it('乱数が 1 に近くても、表の外を指さない', () => {
    expect(drawHints('garment', () => 0.999999).every((h) => typeof h.text === 'string')).toBe(true);
  });
});

describe('企画の AI への指示', () => {
  it('細かさの決め方と、使う数（最大 3）を書く。テーマが勝つ', () => {
    const rules = varietyRules([]).join('\n');
    expect(rules).toMatch(/precise.*none of the hints/);
    expect(rules).toMatch(/broad: use 2 or 3/);
    expect(rules).toMatch(/never more than 3/);
    expect(rules).toMatch(/theme always wins/);
    expect(MAX_HINTS_USED).toBe(3);
  });

  it('最近の服は 5 件まで。無ければ何も足さない', () => {
    expect(recentRules([])).toEqual([]);
    const lines = recentRules(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(lines.filter((l) => l.startsWith('- '))).toHaveLength(5);
  });

  it('返事の細かさを読む（知らない値は null）', () => {
    expect(readVariety({ specificity: 'broad', decided: [], hints: ['x'] }, ['o']).specificity).toBe('broad');
    expect(readVariety({ specificity: 'wild' }, []).specificity).toBeNull();
    expect(readVariety(undefined, []).used).toEqual([]);
  });
});

describe('planItems に、くじと最近の服が入る', () => {
  const reply = () => ({ items: [{ category: 'ドレス', name: 'はるの ドレス', description: 'A dress.', colors: ['#ffffff'], specificity: 'broad', decided: [], hints: ['pattern: stripes'] }] });

  it('カテゴリの行に、引いたヒントを番号つきで並べる。返事の細かさを品目に付ける', async () => {
    const { text, calls } = recorder(reply);
    const [item] = await planItems(text, doll, { theme: 'はる', count: 1, categories: ['ドレス'], style: '', rng: seeded(3) });
    const expected = drawHints('garment', seeded(3));
    expect(calls[0].prompt).toContain(`- ドレス: (1) `);
    for (const h of expected) expect(calls[0].prompt).toContain(h.text);
    expect(item.variety?.specificity).toBe('broad');
    expect(item.variety?.offered).toHaveLength(expected.length);
    // 返事の形に、先に細かさを書かせる
    const props = Object.keys(((calls[0].schema.properties as Record<string, { items: { properties: object } }>).items.items.properties));
    expect(props.slice(0, 3)).toEqual(['decided', 'specificity', 'hints']);
  });

  it('同じカテゴリの最近の服だけを添える', async () => {
    const { text, calls } = recorder(reply);
    await planItems(text, doll, { theme: 'はる', count: 1, categories: ['ドレス'], style: '', rng: seeded(3), recent: { ドレス: ['A pink dress with dots.'], くつ: ['Red boots.'] } });
    expect(calls[0].prompt).toContain('A pink dress with dots.');
    expect(calls[0].prompt).not.toContain('Red boots.');
  });

  it('写真から顔を作るときは、くじも最近の服も使わない', async () => {
    const { text, calls } = recorder(() => ({ items: [{ category: 'かお', name: 'かお', description: 'A face.', colors: [] }] }));
    await planItems(text, doll, { theme: 'x', count: 1, categories: ['かお'], style: '', photo: Buffer.from('p'), rng: seeded(1), recent: { かお: ['Old face.'] } });
    expect(calls[0].prompt).not.toMatch(/Hints \(/);
    expect(calls[0].prompt).not.toContain('Old face.');
  });
});

describe('planSet に、セット全体のくじが入る', () => {
  it('形は引かない。最近の服（セットのカテゴリ）を添える。返事の細かさを返す', async () => {
    const { text, calls } = recorder(() => ({
      name: 'はるの セット',
      specificity: 'normal',
      decided: ['pink'],
      hints: [],
      items: [
        { category: 'ドレス', name: 'ドレス', description: 'A dress.', colors: [] },
        { category: 'くつ', name: 'くつ', description: 'Shoes.', colors: [] },
      ],
    }));
    const result = await planSet(text, doll, { theme: 'ピンクの はる', categories: ['ドレス', 'くつ'], style: '', rng: seeded(5), recent: { くつ: ['Blue sneakers.'] } });
    expect(calls[0].prompt).toMatch(/hints are for the whole set/);
    expect(calls[0].prompt).not.toMatch(/shape\/style:/);
    expect(calls[0].prompt).toContain('Blue sneakers.');
    expect(result.variety.specificity).toBe('normal');
    expect(result.items).toHaveLength(2);
  });
});
