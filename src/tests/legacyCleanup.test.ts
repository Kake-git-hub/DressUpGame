/**
 * 旧方式のデータ削除のテスト
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanupLegacyData } from '../content/legacyCleanup';

describe('cleanupLegacyData', () => {
  const deleteDatabase = vi.fn();
  beforeEach(() => {
    localStorage.clear();
    deleteDatabase.mockClear();
    vi.stubGlobal('indexedDB', { deleteDatabase });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('初回: 旧方式のキーと IndexedDB を削除し、目印を書く', () => {
    localStorage.setItem('dressup_custom_clothing', '[1]');
    localStorage.setItem('dressup_custom_dolls', '[1]');
    localStorage.setItem('dressup_custom_backgrounds', '[1]');
    localStorage.setItem('dressup_doll_presets', '[1]');
    localStorage.setItem('dressup_outfit', '[{"id":"custom-clothing-1","equipOrder":0}]');
    localStorage.setItem('dressup_current_doll_id', 'custom-doll-1');
    cleanupLegacyData();
    for (const key of ['dressup_custom_clothing', 'dressup_custom_dolls', 'dressup_custom_backgrounds', 'dressup_doll_presets', 'dressup_outfit', 'dressup_current_doll_id']) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(deleteDatabase).toHaveBeenCalledWith('DressUpAssets');
    expect(localStorage.getItem('dressup_content_v1')).not.toBeNull();
  });

  it('ドールの位置と倍率は残す', () => {
    localStorage.setItem('dressup_doll_transform', '{"x":40,"y":50,"scale":1.2}');
    cleanupLegacyData();
    expect(localStorage.getItem('dressup_doll_transform')).toBe('{"x":40,"y":50,"scale":1.2}');
  });

  it('2 回目以降は何も消さない', () => {
    cleanupLegacyData();
    deleteDatabase.mockClear();
    localStorage.setItem('dressup_outfit', '[{"id":"a","equipOrder":0}]');
    localStorage.setItem('dressup_current_doll_id', 'アニメ');
    cleanupLegacyData();
    expect(localStorage.getItem('dressup_outfit')).toBe('[{"id":"a","equipOrder":0}]');
    expect(localStorage.getItem('dressup_current_doll_id')).toBe('アニメ');
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it('IndexedDB が使えなくても落ちない', () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(() => cleanupLegacyData()).not.toThrow();
    expect(localStorage.getItem('dressup_content_v1')).not.toBeNull();
  });
});
