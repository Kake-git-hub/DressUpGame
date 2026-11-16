/**
 * 先読み（オフライン用にキャッシュへ入れる）のテスト
 */
import { describe, it, expect, vi } from 'vitest';
import { prefetchUrls, contentUrlsForDoll } from '../content/prefetch';
import type { BackgroundData, ClothingItemData, DollData } from '../types';

const geo = { canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 1024, h: 1024 } };

describe('prefetchUrls', () => {
  it('全部取りに行き、成功数を返す', async () => {
    const f = vi.fn(async () => new Response('ok')) as unknown as typeof fetch;
    expect(await prefetchUrls(['a', 'b', 'c'], { fetchImpl: f })).toEqual({ ok: 3, failed: 0 });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('同時に取りに行くのは 4 本まで', async () => {
    let active = 0;
    let peak = 0;
    const f = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response('ok');
    }) as unknown as typeof fetch;
    await prefetchUrls(Array.from({ length: 20 }, (_, i) => `u${i}`), { fetchImpl: f });
    expect(peak).toBe(4);
    expect(f).toHaveBeenCalledTimes(20);
  });

  it('一部が失敗しても残りを取りに行き、件数を返す', async () => {
    const f = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === 'bad') throw new TypeError('Failed to fetch');
      if (String(url) === 'missing') return new Response('', { status: 404 });
      return new Response('ok');
    }) as unknown as typeof fetch;
    expect(await prefetchUrls(['a', 'bad', 'b', 'missing', 'c'], { fetchImpl: f })).toEqual({ ok: 3, failed: 2 });
  });

  it('空なら何もしない', async () => {
    const f = vi.fn() as unknown as typeof fetch;
    expect(await prefetchUrls([], { fetchImpl: f })).toEqual({ ok: 0, failed: 0 });
    expect(f).not.toHaveBeenCalled();
  });

  it('同じ URL は 1 回だけ取りに行く', async () => {
    const f = vi.fn(async () => new Response('ok')) as unknown as typeof fetch;
    await prefetchUrls(['a', 'a', 'b'], { fetchImpl: f });
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe('contentUrlsForDoll', () => {
  const doll: DollData = { id: 'd1', name: 'd1', bodyImageUrl: 'doll.webp', ...geo };
  const item = (id: string, dollId: string): ClothingItemData => ({
    id, name: id, type: 't', imageUrl: `${id}.webp`, thumbnailUrl: `${id}-t.webp`, position: { x: 0, y: 0 }, baseZIndex: 1, dollId, ...geo,
  });
  const bg = (id: string, dollId?: string): BackgroundData => ({ id, name: id, imageUrl: `${id}.jpg`, thumbnailUrl: `${id}-t.jpg`, dollId });

  it('そのドールの画像・服・サムネイル・背景（共通を含む）と一覧ファイルを返す', () => {
    const urls = contentUrlsForDoll('https://x.test/c/', doll, [item('a', 'd1'), item('b', 'd2')], [bg('own', 'd1'), bg('other', 'd2'), bg('shared')]);
    expect(urls).toEqual([
      'https://x.test/c/manifest.json',
      'doll.webp',
      'a-t.webp',
      'own-t.jpg',
      'shared-t.jpg',
      'a.webp',
      'own.jpg',
      'shared.jpg',
    ]);
  });
});
