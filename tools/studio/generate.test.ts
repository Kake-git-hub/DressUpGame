import { describe, expect, it } from 'vitest';
import type { ManifestDoll } from '../../src/content/manifest.ts';
import type { TextAi } from './ai.ts';
import { categoryKind, categoryRules, hairPrompt, isLongHair, planItems, planSet } from './generate.ts';

describe('categoryKind / categoryRules', () => {
  it('顔のカテゴリは髪を描かせない', () => {
    expect(categoryKind('かお')).toBe('face');
    expect(categoryKind('顔パーツ')).toBe('face');
    expect(categoryRules('かお').join('\n')).toMatch(/no hair/i);
  });
  it('髪型のカテゴリは顔を描かせない', () => {
    for (const label of ['ヘアスタイル', 'かみがた', '髪型', 'かみ', 'hair']) expect(categoryKind(label)).toBe('hair');
    expect(categoryRules('ヘアスタイル').join('\n')).toMatch(/facial features/i);
  });
  it('髪かざりや服は、どちらでもない', () => {
    for (const label of ['かみかざり', 'トップス', 'くつした', 'ぼうし']) {
      expect(categoryKind(label)).toBeNull();
      expect(categoryRules(label)).toEqual([]);
    }
  });
  it('くつ・ブーツは靴として扱う（閉じた靴に限る決まりは無い）。くつしたは靴ではない', () => {
    for (const label of ['くつ', '靴', 'ブーツ', 'shoes']) expect(categoryKind(label)).toBe('shoes');
    for (const label of ['くつした', 'ソックス', '靴下']) expect(categoryKind(label)).toBeNull();
    expect(categoryRules('くつ')).toEqual([]);
  });
});

describe('hairPrompt', () => {
  it('髪が肌に影を落とさないように指示する（影は髪と一緒に色変わりしてしまうため）', () => {
    const prompt = hairPrompt({ category: 'ヘア', name: 'ボブ', description: 'A black bob.', colors: [] }, 'ヘアスタイル', '', [0, 255, 0], null);
    expect(prompt).toMatch(/casts no shadow/);
    expect(prompt).toMatch(/face stays completely blank/);
  });
});

describe('ロングヘア', () => {
  it('説明に "knee-length" などがあれば、ひざまでのロングヘア', () => {
    expect(isLongHair('Knee-length wavy pink hair with a ribbon.')).toBe(true);
    expect(isLongHair('Very long straight hair that reaches the knees.')).toBe(true);
    expect(isLongHair('Long hair down to the knees.')).toBe(true);
    expect(isLongHair('A black bob.')).toBe(false);
    expect(isLongHair('Waist-length twin tails.')).toBe(false);
  });
  it('ロングヘアの指示文は、ひざの下までの図だと伝え、ひざで終わるように頼む。ふつうの髪は腰まで', () => {
    const long = hairPrompt({ category: 'ヘア', name: 'ながいかみ', description: 'Knee-length silver hair.', colors: [] }, 'ヘアスタイル', '', [0, 255, 0], null);
    expect(long).toMatch(/down to just below the knees/);
    expect(long).toMatch(/end at the knees/);
    const short = hairPrompt({ category: 'ヘア', name: 'ボブ', description: 'A black bob.', colors: [] }, 'ヘアスタイル', '', [0, 255, 0], null);
    expect(short).toMatch(/head to hips/);
    expect(short).not.toMatch(/knees/);
  });
});

describe('企画に足す行（extra）', () => {
  const doll = { id: 'd', name: 'おんなのこ', categories: [{ id: 'ドレス', label: 'ドレス' }, { id: 'くつ', label: 'くつ' }] } as unknown as ManifestDoll;
  const capture = () => {
    const prompts: string[] = [];
    const text: TextAi = { json: async <T>(input: { prompt: string }) => { prompts.push(input.prompt); return { name: 'せっと', items: [{ category: 'ドレス', name: 'どれす', description: 'A dress.', colors: ['#ff0000'] }, { category: 'くつ', name: 'くつ', description: 'Shoes.', colors: ['#0000ff'] }] } as T; } };
    return { text, prompts };
  };
  it('planItems: extra が無ければ、頼みの文は変わらない。あれば、最後に足す', async () => {
    const { text, prompts } = capture();
    await planItems(text, doll, { theme: 'はる', count: 1, categories: ['ドレス'], style: 'anime' });
    await planItems(text, doll, { theme: 'はる', count: 1, categories: ['ドレス'], style: 'anime', extra: [] });
    await planItems(text, doll, { theme: 'はる', count: 1, categories: ['ドレス'], style: 'anime', extra: ['Design hints:', '- pattern: polka dots'] });
    expect(prompts[1]).toBe(prompts[0]);
    expect(prompts[2]).toBe(`${prompts[0]}\n\nDesign hints:\n- pattern: polka dots`);
  });
  it('planSet も同じ', async () => {
    const { text, prompts } = capture();
    await planSet(text, doll, { theme: 'はる', categories: ['ドレス', 'くつ'], style: 'anime' });
    await planSet(text, doll, { theme: 'はる', categories: ['ドレス', 'くつ'], style: 'anime', extra: ['X'] });
    expect(prompts[1]).toBe(`${prompts[0]}\n\nX`);
  });
});
