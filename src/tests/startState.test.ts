/**
 * 起動時の状態（どのドール・背景・服装で始めるか）を決めるテスト
 */
import { describe, it, expect } from 'vitest';
import { resolveStartState } from '../content/startState';
import type { LoadedContent } from '../content/loadContent';
import type { ClothingItemData } from '../types';

const geo = { canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 1024, h: 1024 } };
const item = (id: string, dollId: string): ClothingItemData => ({
  id, name: id, type: 't', imageUrl: `${id}.webp`, position: { x: 0, y: 0 }, baseZIndex: 1, dollId, ...geo,
});
const content: LoadedContent = {
  dolls: [
    { id: 'A', name: 'A', bodyImageUrl: 'a.webp', ...geo },
    { id: 'B', name: 'B', bodyImageUrl: 'b.webp', ...geo },
  ],
  clothing: [item('A/x', 'A'), item('B/y', 'B')],
  backgrounds: [
    { id: 'A/bg', name: 'a', imageUrl: 'abg.jpg', dollId: 'A' },
    { id: 'B/bg', name: 'b', imageUrl: 'bbg.jpg', dollId: 'B' },
    { id: 'shared', name: 's', imageUrl: 's.jpg' },
  ],
};

describe('resolveStartState', () => {
  it('保存されたドールがあれば、そのドールで始める', () => {
    expect(resolveStartState(content, 'B', null, []).dollId).toBe('B');
  });
  it('保存が無ければ先頭のドール', () => {
    expect(resolveStartState(content, null, null, []).dollId).toBe('A');
  });
  it('保存されたドールが一覧から消えていたら先頭のドール', () => {
    expect(resolveStartState(content, 'gone', null, []).dollId).toBe('A');
  });
  it('そのドールの服だけを復元する（別のドールの服は着せない）', () => {
    const state = resolveStartState(content, 'B', null, [
      { id: 'A/x', equipOrder: 0 },
      { id: 'B/y', equipOrder: 1, adjustScale: 1.2 },
    ]);
    expect(state.outfit.map((i) => i.id)).toEqual(['B/y']);
    expect(state.outfit[0].adjustScale).toBe(1.2);
  });
  it('ドールが増えて先頭が変わっても、保存が無い端末で別ドールの服を着せない', () => {
    // 以前は B だけだった端末（ドールIDは未保存）に、先頭へ A が追加された場合
    const state = resolveStartState(content, null, null, [{ id: 'B/y', equipOrder: 0 }]);
    expect(state.dollId).toBe('A');
    expect(state.outfit).toEqual([]);
  });
  it('背景: そのドールで使えるもの（専用・共通）はそのまま', () => {
    expect(resolveStartState(content, 'A', 'A/bg', []).backgroundId).toBe('A/bg');
    expect(resolveStartState(content, 'A', 'shared', []).backgroundId).toBe('shared');
  });
  it('背景: 別のドール専用・一覧から消えたものは外す', () => {
    expect(resolveStartState(content, 'A', 'B/bg', []).backgroundId).toBeNull();
    expect(resolveStartState(content, 'A', 'gone', []).backgroundId).toBeNull();
  });
  it('ドールが 1 体も無ければ dollId は空', () => {
    expect(resolveStartState({ dolls: [], clothing: [], backgrounds: [] }, 'A', null, []).dollId).toBe('');
  });

  describe('前髪とうしろがみに分ける前の保存', () => {
    const hairContent: LoadedContent = {
      ...content,
      clothing: [{ ...item('A/hair', 'A'), backItemId: 'A/hair#back' }, { ...item('A/hair#back', 'A'), type: 'back' }, item('A/x', 'A')],
    };
    const saved = [{ id: 'A/x', equipOrder: 0 }, { id: 'A/hair', equipOrder: 1, adjustOffsetX: 5, adjustScale: 1.1, colorHue: 40, layerAdjust: 2 }];

    it('髪を着ていたら、対のうしろがみも着せる（位置・大きさ・色は髪と同じ、重なりは引き継がない）', () => {
      const { outfit } = resolveStartState(hairContent, 'A', null, saved, true);
      expect(outfit.map((i) => i.id).sort()).toEqual(['A/hair', 'A/hair#back', 'A/x']);
      const back = outfit.find((i) => i.id === 'A/hair#back')!;
      expect(back).toMatchObject({ adjustOffsetX: 5, adjustScale: 1.1, colorHue: 40 });
      expect(back.layerAdjust).toBeUndefined();
      expect(back.equipOrder).toBeLessThan(1);
      expect(back.equipOrder).toBeGreaterThan(0);
    });

    it('分けたあとの保存なら、うしろがみを足さない（外したうしろがみが戻らない）', () => {
      const { outfit } = resolveStartState(hairContent, 'A', null, saved);
      expect(outfit.map((i) => i.id)).toEqual(['A/x', 'A/hair']);
    });
  });
});
