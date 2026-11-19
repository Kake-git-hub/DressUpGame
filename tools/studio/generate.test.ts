import { describe, expect, it } from 'vitest';
import { categoryKind, categoryRules } from './generate.ts';

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
  it('くつ・ブーツは靴として扱い、足を完全に覆うように描かせる。くつしたは靴ではない', () => {
    for (const label of ['くつ', '靴', 'ブーツ', 'shoes']) expect(categoryKind(label)).toBe('shoes');
    for (const label of ['くつした', 'ソックス', '靴下']) expect(categoryKind(label)).toBeNull();
    expect(categoryRules('くつ').join('\n')).toMatch(/completely covering both feet/);
  });
});
