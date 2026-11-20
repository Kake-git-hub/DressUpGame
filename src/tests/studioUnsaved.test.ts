import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { confirmDiscard, unsavedCount, useUnsaved } from '../studio/unsaved';

describe('スタジオの未保存の候補', () => {
  it('知らせた数を足し、画面から消えたら数えない', () => {
    const a = renderHook(({ n }) => useUnsaved('a', n), { initialProps: { n: 2 } });
    const b = renderHook(() => useUnsaved('b', 1));
    expect(unsavedCount()).toBe(3);
    a.rerender({ n: 0 });
    expect(unsavedCount()).toBe(1);
    b.unmount();
    a.unmount();
    expect(unsavedCount()).toBe(0);
  });
  it('confirmDiscard: 未保存が無ければたずねずに進む。あれば数を出してたずね、答えに従う', () => {
    const asked: string[] = [];
    expect(confirmDiscard('ドールを変える', (t) => (asked.push(t), false))).toBe(true);
    expect(asked).toEqual([]);
    const h = renderHook(() => useUnsaved('c', 2));
    expect(confirmDiscard('ドールを変える', (t) => (asked.push(t), false))).toBe(false);
    expect(asked[0]).toMatch(/2 点/);
    expect(confirmDiscard('ドールを変える', () => true)).toBe(true);
    h.unmount();
  });
});
