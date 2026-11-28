import { describe, expect, it } from 'vitest';
import { bootsAtStart, gateQuestion, markStudioUsed, readStudioMode, unlockByWord } from '../appStudio/unlock';

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

describe('「つくる」を出す端末かどうか', () => {
  it('何も覚えていなければ、出す（本物）。?studio=fake は偽物。?studio=0 で隠し、次からも隠れたまま。?studio=1 でもどす', () => {
    const storage = memory();
    expect(readStudioMode('', storage)).toBe('real');
    expect(readStudioMode('?content=x', storage)).toBe('real');
    // 何も頼まれていなければ、何も書かない
    expect(storage.getItem('dressup_studio')).toBeNull();
    expect(readStudioMode('?studio=fake', storage)).toBe('fake');
    expect(readStudioMode('?other=1', storage)).toBe('fake');
    expect(readStudioMode('?studio=0', storage)).toBeNull();
    expect(storage.getItem('dressup_studio')).toBe('off');
    expect(readStudioMode('', storage)).toBeNull();
    // 知らない値は、何もしない
    expect(readStudioMode('?studio=yes', storage)).toBeNull();
    expect(readStudioMode('?studio=1', storage)).toBe('real');
    expect(storage.getItem('dressup_studio')).toBe('real');
    expect(readStudioMode('', storage)).toBe('real');
  });
  it('前の版で覚えた値（real・fake）は、そのまま効く。知らない値は、何も覚えていないのと同じ', () => {
    const storage = memory();
    storage.setItem('dressup_studio', 'fake');
    expect(readStudioMode('', storage)).toBe('fake');
    storage.setItem('dressup_studio', 'real');
    expect(readStudioMode('', storage)).toBe('real');
    storage.setItem('dressup_studio', 'なにか');
    expect(readStudioMode('', storage)).toBe('real');
  });
  it('保存が使えない端末でも、落ちない。その読み込みは、URL のとおり（何も無ければ、本物）', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => {} };
    expect(readStudioMode('', broken)).toBe('real');
    expect(readStudioMode('?studio=1', broken)).toBe('real');
    expect(readStudioMode('?studio=fake', broken)).toBe('fake');
    expect(readStudioMode('?studio=0', broken)).toBeNull();
  });
  it('あいことば（ホーム画面のアプリ用）: studio・fake・off。off は、隠したままにする。ほかの言葉は、何もしない', () => {
    const storage = memory();
    expect(unlockByWord('まちがい', storage)).toBe(false);
    expect(unlockByWord(null, storage)).toBe(false);
    expect(readStudioMode('', storage)).toBe('real');
    expect(unlockByWord(' Fake ', storage)).toBe(true);
    expect(readStudioMode('', storage)).toBe('fake');
    expect(unlockByWord('studio', storage)).toBe(true);
    expect(readStudioMode('', storage)).toBe('real');
    expect(unlockByWord('off', storage)).toBe(true);
    expect(storage.getItem('dressup_studio')).toBe('off');
    expect(readStudioMode('', storage)).toBeNull();
    expect(unlockByWord('studio', storage)).toBe(true);
    expect(readStudioMode('', storage)).toBe('real');
  });
  it('つなぎ役を、起動のときに用意するか: 偽物は、いつも。本物は、前に「つくる」「クローゼット」を開いた端末と、前の版で教えた端末だけ', () => {
    const storage = memory();
    // はじめての端末（遊ぶだけの人）: 用意しない
    expect(bootsAtStart(readStudioMode('', storage), storage)).toBe(false);
    expect(bootsAtStart('fake', storage)).toBe(true);
    expect(bootsAtStart(null, storage)).toBe(false);
    // 開いたら、覚える
    markStudioUsed(storage);
    expect(storage.getItem('dressup_studio_used')).toBe('1');
    expect(bootsAtStart('real', storage)).toBe(true);
    // 隠した端末では、覚えていても、用意しない
    expect(bootsAtStart(null, storage)).toBe(false);
    // 前の版で教えた端末（real を覚えている）
    const old = memory();
    old.setItem('dressup_studio', 'real');
    expect(bootsAtStart(readStudioMode('', old), old)).toBe(true);
    // 保存が使えない端末: 用意しない（落ちない）
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); } };
    expect(bootsAtStart('real', broken)).toBe(false);
    expect(() => markStudioUsed(broken)).not.toThrow();
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
