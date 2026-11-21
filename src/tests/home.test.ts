import { describe, expect, it, vi } from 'vitest';
import { readHomeEnabled, unlockHomeByWord } from '../home/homeMode';
import { copyText, qrSvg, shareUrl } from '../home/share';

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) };
};

describe('ホーム画面を出す端末かどうか', () => {
  it('ふつうは出さない。?home=1 を 1 回開くと覚える。?home=0 で消す', () => {
    const storage = memory();
    expect(readHomeEnabled('', storage)).toBe(false);
    expect(readHomeEnabled('?home=1', storage)).toBe(true);
    expect(readHomeEnabled('?studio=1', storage)).toBe(true);
    expect(readHomeEnabled('?home=0', storage)).toBe(false);
    expect(readHomeEnabled('?home=yes', storage)).toBe(false);
  });
  it('保存が使えない端末では、出さない（落ちない）', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => {} };
    expect(readHomeEnabled('?home=1', broken)).toBe(false);
  });
  it('あいことば home で出し、nohome で消す。ほかの言葉は、何もしない', () => {
    const storage = memory();
    expect(unlockHomeByWord('studio', storage)).toBe(false);
    expect(unlockHomeByWord(' Home ', storage)).toBe(true);
    expect(readHomeEnabled('', storage)).toBe(true);
    expect(unlockHomeByWord('nohome', storage)).toBe(true);
    expect(readHomeEnabled('', storage)).toBe(false);
  });
});

describe('ともだちにおしえる', () => {
  it('URL は、アプリの入口（? の印は付けない）', () => {
    expect(shareUrl('https://kake-git-hub.github.io', '/DressUpGame/')).toBe('https://kake-git-hub.github.io/DressUpGame/');
  });
  it('QR コードは SVG', () => {
    expect(qrSvg('https://example.com/')).toMatch(/^<svg[\s\S]*<\/svg>$/);
  });
  it('クリップボードにコピーする。使えなければ false', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyText('abc', { clipboard: { writeText } } as unknown as Navigator)).toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
    const denied = { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } } as unknown as Navigator;
    document.execCommand = vi.fn().mockReturnValue(false);
    expect(await copyText('abc', denied)).toBe(false);
    document.execCommand = vi.fn().mockReturnValue(true);
    expect(await copyText('abc', denied)).toBe(true);
  });
});
