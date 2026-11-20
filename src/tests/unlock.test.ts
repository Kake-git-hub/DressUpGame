import { describe, expect, it } from 'vitest';
import { gateQuestion, readStudioMode, unlockByWord } from '../appStudio/unlock';

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

describe('「つくる」を出す端末かどうか', () => {
  it('ふつうは出さない。?studio=1 を 1 回開くと覚える。?studio=fake は偽物。?studio=0 で消す', () => {
    const storage = memory();
    expect(readStudioMode('', storage)).toBeNull();
    expect(readStudioMode('?content=x', storage)).toBeNull();
    expect(readStudioMode('?studio=1', storage)).toBe('real');
    expect(readStudioMode('', storage)).toBe('real');
    expect(readStudioMode('?studio=fake', storage)).toBe('fake');
    expect(readStudioMode('?other=1', storage)).toBe('fake');
    expect(readStudioMode('?studio=0', storage)).toBeNull();
    expect(readStudioMode('', storage)).toBeNull();
    // 知らない値は、何もしない
    expect(readStudioMode('?studio=yes', storage)).toBeNull();
  });
  it('保存が使えない端末では、出さない（落ちない）', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => {} };
    expect(readStudioMode('?studio=1', broken)).toBeNull();
  });
  it('あいことばでも出せる（ホーム画面のアプリ用）: studio・fake・off。ほかの言葉は、何もしない', () => {
    const storage = memory();
    expect(unlockByWord('まちがい', storage)).toBe(false);
    expect(unlockByWord(null, storage)).toBe(false);
    expect(readStudioMode('', storage)).toBeNull();
    expect(unlockByWord(' Fake ', storage)).toBe(true);
    expect(readStudioMode('', storage)).toBe('fake');
    expect(unlockByWord('studio', storage)).toBe(true);
    expect(readStudioMode('', storage)).toBe('real');
    expect(unlockByWord('off', storage)).toBe(true);
    expect(readStudioMode('', storage)).toBeNull();
  });
  it('入口の問いは、11〜19 かける 2〜9 を漢数字で出す', () => {
    expect(gateQuestion(() => 0)).toEqual({ text: '十一 かける 二 は？', answer: 22 });
    expect(gateQuestion(() => 0.999)).toEqual({ text: '十九 かける 九 は？', answer: 171 });
    for (let i = 0; i < 50; i++) {
      const q = gateQuestion();
      expect(q.text).toMatch(/^十[一二三四五六七八九] かける [二三四五六七八九] は？$/);
      expect(q.answer).toBeGreaterThanOrEqual(22);
      expect(q.answer).toBeLessThanOrEqual(171);
    }
  });
});
