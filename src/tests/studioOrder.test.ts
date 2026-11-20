import { describe, expect, it } from 'vitest';
import { dropIndex, moveInList } from '../studio/order';

describe('スタジオの一覧での並べ替え', () => {
  it('moveInList: 前へ・後ろへ・端を越えない', () => {
    expect(moveInList(['a', 'b', 'c'], 1, 0)).toEqual(['b', 'a', 'c']);
    expect(moveInList(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveInList(['a', 'b', 'c'], 2, 9)).toEqual(['a', 'b', 'c']);
    expect(moveInList(['a', 'b', 'c'], 1, -3)).toEqual(['b', 'a', 'c']);
  });
  it('dropIndex: 絵の左半分なら前、右半分なら後ろに入る', () => {
    const drop = (list: string[], from: number, target: number, after: boolean) => moveInList(list, from, dropIndex(from, target, after));
    expect(drop(['a', 'b', 'c', 'd'], 0, 2, false)).toEqual(['b', 'a', 'c', 'd']);
    expect(drop(['a', 'b', 'c', 'd'], 0, 2, true)).toEqual(['b', 'c', 'a', 'd']);
    expect(drop(['a', 'b', 'c', 'd'], 3, 1, false)).toEqual(['a', 'd', 'b', 'c']);
    expect(drop(['a', 'b', 'c', 'd'], 3, 1, true)).toEqual(['a', 'b', 'd', 'c']);
    expect(drop(['a', 'b', 'c', 'd'], 1, 1, true)).toEqual(['a', 'b', 'c', 'd']);
  });
});
