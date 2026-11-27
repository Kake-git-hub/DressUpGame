import { describe, expect, it, vi } from 'vitest';
import { startsOnHome } from '../home/homeMode';
import { copyText, qrSvg, shareUrl } from '../home/share';

describe('ホーム画面から始めるか', () => {
  it('ふつうは、ホームから。?home=0 のときだけ、すぐゲーム（テストと確認用）', () => {
    expect(startsOnHome('')).toBe(true);
    expect(startsOnHome('?content=e2e-content/')).toBe(true);
    expect(startsOnHome('?home=1')).toBe(true);
    expect(startsOnHome('?studio=fake&home=0')).toBe(false);
    expect(startsOnHome('?home=0')).toBe(false);
  });
  it('覚えない: ?home=0 で開いたあと、ふつうに開けば、またホームから', () => {
    localStorage.clear();
    expect(startsOnHome('?home=0')).toBe(false);
    expect(startsOnHome('')).toBe(true);
    expect(localStorage.length).toBe(0);
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
