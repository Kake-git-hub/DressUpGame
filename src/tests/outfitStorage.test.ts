/**
 * outfitStorage のユニットテスト
 * 着ている服は「ID・着た順・調整値」だけを保存する
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  toSavedOutfit,
  fromSavedOutfit,
  saveOutfit,
  loadOutfit,
  isOutfitFromBeforeHairParts,
  OUTFIT_KEY,
  LEGACY_OUTFIT_KEY,
} from '../services/outfitStorage';
import type { ClothingItemData, EquippedItem } from '../types';

const item = (id: string): ClothingItemData => ({
  id,
  name: `name-${id}`,
  type: 'top',
  imageUrl: `/images/${id}.png`,
  position: { x: 0, y: 0 },
  baseZIndex: 10,
  canvasW: 1024,
  canvasH: 1024,
  box: { x: 0, y: 0, w: 1024, h: 1024 },
});

describe('outfitStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('toSavedOutfit は ID・着た順・調整値だけを残す', () => {
    const equipped: EquippedItem = {
      ...item('a'),
      imageUrl: 'data:image/png;base64,' + 'A'.repeat(100000),
      thumbnailUrl: 'data:image/png;base64,' + 'B'.repeat(20000),
      equipOrder: 3,
      adjustScale: 1.2,
    };
    const saved = toSavedOutfit([equipped]);
    expect(saved).toEqual([{ id: 'a', equipOrder: 3, adjustScale: 1.2 }]);
    expect(JSON.stringify(saved).length).toBeLessThanOrEqual(300);
  });

  it('全部の調整値が入っていても 1 枚 300 バイト以下', () => {
    const equipped: EquippedItem = {
      ...item('custom-clothing-1794740732129-h2j7h-012'),
      equipOrder: 123,
      adjustOffsetX: -123.456789012345,
      adjustOffsetY: 234.567890123456,
      adjustScale: 1.234567890123456,
      adjustRotation: -179.1234567890123,
      layerAdjust: 100,
      colorHue: -180,
    };
    expect(JSON.stringify(toSavedOutfit([equipped])).length).toBeLessThanOrEqual(300);
  });

  it('fromSavedOutfit は存在しない ID を黙って外し、他は復元する', () => {
    const out = fromSavedOutfit(
      [
        { id: 'a', equipOrder: 0 },
        { id: 'gone', equipOrder: 1 },
      ],
      [item('a'), item('b')]
    );
    expect(out.map((i) => i.id)).toEqual(['a']);
    expect(out[0].imageUrl).toBe('/images/a.png');
    expect(out[0].equipOrder).toBe(0);
  });

  it('fromSavedOutfit は調整値を引き継ぐ', () => {
    const out = fromSavedOutfit(
      [{ id: 'a', equipOrder: 5, adjustOffsetX: 12, colorHue: -40, adjustRotation: 15 }],
      [item('a')]
    );
    expect(out[0]).toMatchObject({ id: 'a', equipOrder: 5, adjustOffsetX: 12, colorHue: -40, adjustRotation: 15 });
  });

  it('saveOutfit → loadOutfit で往復できる', () => {
    saveOutfit([{ ...item('a'), equipOrder: 2, layerAdjust: 100 }]);
    expect(loadOutfit()).toEqual([{ id: 'a', equipOrder: 2, layerAdjust: 100 }]);
    expect(localStorage.getItem(OUTFIT_KEY)).not.toContain('/images/');
  });

  it('保存データが無ければ [] を返す', () => {
    expect(loadOutfit()).toEqual([]);
  });

  it('loadOutfit は旧形式（画像 URL 入り）を変換し、旧キーを消して新キーに書く', () => {
    localStorage.setItem(
      LEGACY_OUTFIT_KEY,
      JSON.stringify([{ id: 'a', name: 'x', imageUrl: 'data:image/png;base64,AAAA', equipOrder: 2, adjustRotation: 15 }])
    );
    expect(loadOutfit()).toEqual([{ id: 'a', equipOrder: 2, adjustRotation: 15 }]);
    expect(localStorage.getItem(LEGACY_OUTFIT_KEY)).toBeNull();
    expect(JSON.parse(localStorage.getItem(OUTFIT_KEY) ?? 'null')).toEqual([
      { id: 'a', equipOrder: 2, adjustRotation: 15 },
    ]);
  });

  it('新キーがあるときは旧キーを読まずに消す', () => {
    localStorage.setItem(OUTFIT_KEY, JSON.stringify([{ id: 'new', equipOrder: 0 }]));
    localStorage.setItem(LEGACY_OUTFIT_KEY, JSON.stringify([{ id: 'old', equipOrder: 0 }]));
    expect(loadOutfit()).toEqual([{ id: 'new', equipOrder: 0 }]);
    expect(localStorage.getItem(LEGACY_OUTFIT_KEY)).toBeNull();
  });

  it.each(['{broken', '"text"', '{"a":1}', '[1, null, {"equipOrder":1}]', '[{"id":"a","equipOrder":"x"}]'])(
    'loadOutfit は壊れた内容 %s で [] を返す',
    (raw) => {
      localStorage.setItem(OUTFIT_KEY, raw);
      expect(loadOutfit()).toEqual([]);
    }
  );

  it('旧キーの内容が壊れていても [] を返し、旧キーを消す', () => {
    localStorage.setItem(LEGACY_OUTFIT_KEY, '{broken');
    expect(loadOutfit()).toEqual([]);
    expect(localStorage.getItem(LEGACY_OUTFIT_KEY)).toBeNull();
  });

  it('分ける前の保存かどうか: 新しい形式で保存したことが無ければ true', () => {
    localStorage.setItem(OUTFIT_KEY, JSON.stringify([{ id: 'a', equipOrder: 0 }]));
    expect(isOutfitFromBeforeHairParts()).toBe(true);
    saveOutfit([{ ...item('a'), equipOrder: 0 }]);
    expect(isOutfitFromBeforeHairParts()).toBe(false);
  });

  describe('調整値の単位の変換（更新の前の保存は、画面の px）', () => {
    it('目印が無い保存は、位置のずれを横にしたときの縮尺で割って返し、新しい形で書き戻す', () => {
      localStorage.setItem(OUTFIT_KEY, JSON.stringify([{ id: 'a', equipOrder: 0, adjustOffsetX: 144, adjustOffsetY: -72, adjustScale: 1.5 }]));
      const loaded = loadOutfit(0.72);
      expect(loaded[0].adjustOffsetX).toBeCloseTo(200, 9);
      expect(loaded[0].adjustOffsetY).toBeCloseTo(-100, 9);
      expect(loaded[0].adjustScale).toBe(1.5);
      expect(localStorage.getItem('dressup_outfit_units')).toBe('doll');
      // 2 回目は変換しない（縮尺が違っても同じ値）
      expect(loadOutfit(0.5)[0].adjustOffsetX).toBeCloseTo(200, 9);
    });
    it('saveOutfit は目印を付ける。目印のある保存は変換しない', () => {
      saveOutfit([{ id: 'a', equipOrder: 0, adjustOffsetX: 200 } as never]);
      expect(localStorage.getItem('dressup_outfit_units')).toBe('doll');
      expect(loadOutfit(0.72)[0].adjustOffsetX).toBe(200);
    });
    it('保存が無いときも、目印を付けて空を返す', () => {
      expect(loadOutfit(0.72)).toEqual([]);
      expect(localStorage.getItem('dressup_outfit_units')).toBe('doll');
    });
    it('縮尺が 0 のときは、割らずに返す（値を壊さない）', () => {
      localStorage.setItem(OUTFIT_KEY, JSON.stringify([{ id: 'a', equipOrder: 0, adjustOffsetX: 144 }]));
      expect(loadOutfit(0)[0].adjustOffsetX).toBe(144);
    });
  });
});
