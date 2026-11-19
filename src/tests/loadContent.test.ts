/**
 * 配信された一覧ファイルを、アプリの型に変換するテスト
 */
import { describe, it, expect, vi } from 'vitest';
import { loadContent, resolveContentUrl, DEFAULT_CONTENT_URL, backItemId, BACK_HAIR_TYPE } from '../content/loadContent';
import type { Manifest } from '../content/manifest';

const BASE = 'https://example.test/content/';

const manifest: Manifest = {
  version: 1,
  dolls: [
    {
      id: 'アニメ',
      name: 'アニメ',
      image: { file: 'files/doll.webp', canvasW: 1024, canvasH: 1024, box: { x: 300, y: 50, w: 400, h: 900 } },
      categories: [
        { id: 'トップス', label: 'トップス', layer: 4, menuOrder: 5, overlap: false, movable: false },
        { id: 'かざり', label: 'かざり', layer: 11, menuOrder: 9, overlap: true, movable: true },
      ],
      items: [
        {
          id: 'アニメ/トップス/セーター',
          name: 'セーター',
          category: 'トップス',
          image: { file: 'files/a.webp', canvasW: 1024, canvasH: 1024, box: { x: 292, y: 240, w: 440, h: 280 } },
          thumb: 'files/at.webp',
        },
        {
          id: 'アニメ/トップス/チア',
          name: 'チア',
          category: 'トップス',
          image: { file: 'files/b.webp', canvasW: 495, canvasH: 1024, box: { x: 10, y: 20, w: 30, h: 40 } },
          thumb: 'files/bt.webp',
          layer: 5,
          overlap: true,
        },
        {
          id: 'アニメ/かざり/ほし',
          name: 'ほし',
          category: 'かざり',
          image: { file: 'files/c.webp', canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 10, h: 10 } },
          thumb: 'files/ct.webp',
        },
      ],
      backgrounds: [{ id: 'アニメ/bg/1', name: '1', file: 'files/bg1.jpg', thumb: 'files/bg1t.jpg' }],
    },
  ],
  backgrounds: [{ id: 'bg/shared', name: 'shared', file: 'files/s.jpg', thumb: 'files/st.jpg' }],
};

const okFetch = (body: unknown) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;

describe('loadContent', () => {
  it('一覧ファイルを base の manifest.json から取得する', async () => {
    const f = okFetch(manifest);
    await loadContent(BASE, f);
    expect(String((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toBe(`${BASE}manifest.json`);
  });

  it('ドールを変換する（画像は絶対 URL、切り抜き情報つき）', async () => {
    const { dolls } = await loadContent(BASE, okFetch(manifest));
    expect(dolls).toHaveLength(1);
    expect(dolls[0]).toMatchObject({
      id: 'アニメ',
      name: 'アニメ',
      bodyImageUrl: `${BASE}files/doll.webp`,
      canvasW: 1024,
      canvasH: 1024,
      box: { x: 300, y: 50, w: 400, h: 900 },
    });
  });

  it('服を変換する（カテゴリの値を引き継ぐ）', async () => {
    const { clothing } = await loadContent(BASE, okFetch(manifest));
    expect(clothing[0]).toMatchObject({
      id: 'アニメ/トップス/セーター',
      name: 'セーター',
      type: 'トップス',
      imageUrl: `${BASE}files/a.webp`,
      thumbnailUrl: `${BASE}files/at.webp`,
      dollId: 'アニメ',
      layerOrder: 4,
      baseZIndex: 4,
      categoryOrder: 5,
      allowOverlap: false,
      movable: false,
      canvasW: 1024,
      canvasH: 1024,
      box: { x: 292, y: 240, w: 440, h: 280 },
    });
  });

  it('後ろに描く分（back）のある髪は、前髪と「うしろがみ」の 2 点に分ける', async () => {
    const withHair: Manifest = structuredClone(manifest);
    withHair.dolls[0].categories.push({ id: 'ヘア', label: 'ヘアスタイル', layer: 11, menuOrder: 11, overlap: false, movable: false });
    withHair.dolls[0].items.push({
      id: 'アニメ/ヘア/ロング',
      name: 'ロング',
      category: 'ヘア',
      image: { file: 'files/h.webp', canvasW: 1024, canvasH: 1024, box: { x: 400, y: 40, w: 200, h: 150 } },
      thumb: 'files/ht.webp',
      back: { file: 'files/hb.webp', canvasW: 1024, canvasH: 1024, box: { x: 350, y: 30, w: 300, h: 600 } },
    });
    const { clothing } = await loadContent(BASE, okFetch(withHair));
    const front = clothing.find((c) => c.id === 'アニメ/ヘア/ロング')!;
    const back = clothing.find((c) => c.id === backItemId('アニメ/ヘア/ロング'))!;
    // 前髪: もとのカテゴリのまま。対のうしろがみを指す
    expect(front).toMatchObject({ type: 'ヘアスタイル', imageUrl: `${BASE}files/h.webp`, layerOrder: 11, backItemId: back.id });
    // うしろがみ: 別のカテゴリ。ドールの後ろ。メニューでは髪のすぐ次
    expect(back).toMatchObject({
      name: 'ロング',
      type: BACK_HAIR_TYPE,
      imageUrl: `${BASE}files/hb.webp`,
      thumbnailUrl: `${BASE}files/hb.webp`,
      dollId: 'アニメ',
      allowOverlap: false,
      movable: false,
      canvasW: 1024,
      canvasH: 1024,
      box: { x: 350, y: 30, w: 300, h: 600 },
    });
    expect(back.layerOrder).toBeLessThan(0);
    expect(back.categoryOrder).toBeGreaterThan(11);
    expect(back.categoryOrder).toBeLessThan(12);
    expect(back.backItemId).toBeUndefined();
    expect(clothing).toHaveLength(5);
  });

  it('服ごとの layer / overlap の上書きを優先する', async () => {
    const { clothing } = await loadContent(BASE, okFetch(manifest));
    expect(clothing[1]).toMatchObject({ layerOrder: 5, allowOverlap: true, categoryOrder: 5, canvasW: 495 });
  });

  it('重ね着可・自由配置のカテゴリを引き継ぐ', async () => {
    const { clothing } = await loadContent(BASE, okFetch(manifest));
    expect(clothing[2]).toMatchObject({ type: 'かざり', allowOverlap: true, movable: true, layerOrder: 11 });
  });

  it('背景: ドール専用は dollId つき、共通は dollId なし', async () => {
    const { backgrounds } = await loadContent(BASE, okFetch(manifest));
    expect(backgrounds).toHaveLength(2);
    expect(backgrounds[0]).toMatchObject({ id: 'アニメ/bg/1', dollId: 'アニメ', imageUrl: `${BASE}files/bg1.jpg`, thumbnailUrl: `${BASE}files/bg1t.jpg` });
    expect(backgrounds[1].dollId).toBeUndefined();
  });

  it('HTTP 404 なら Error', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(loadContent(BASE, f)).rejects.toThrow();
  });

  it('通信できなければ Error', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(loadContent(BASE, f)).rejects.toThrow();
  });

  it('壊れた JSON なら Error', async () => {
    await expect(loadContent(BASE, okFetch('{broken'))).rejects.toThrow();
  });

  it('ドールが 1 体も無い一覧なら Error（空の画面にしない）', async () => {
    await expect(loadContent(BASE, okFetch({ version: 1, dolls: [], backgrounds: [] }))).rejects.toThrow();
  });

  it('応答が返ってこなければ、時間切れで Error', async () => {
    vi.useFakeTimers();
    const hang = vi.fn((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })
    ) as unknown as typeof fetch;
    const result = expect(loadContent(BASE, hang)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(20_000);
    await result;
    vi.useRealTimers();
  });

  it('形の違う一覧なら Error', async () => {
    await expect(loadContent(BASE, okFetch({ version: 2 }))).rejects.toThrow();
  });
});

describe('resolveContentUrl', () => {
  const PAGE = 'https://kake-git-hub.github.io/DressUpGame/';
  it('指定が無ければ既定の配信 URL', () => {
    expect(resolveContentUrl('', PAGE)).toBe(DEFAULT_CONTENT_URL);
  });
  it('相対パスはページと同じ場所からの相対として使う', () => {
    expect(resolveContentUrl('?content=e2e-content/', PAGE)).toBe(`${PAGE}e2e-content/`);
  });
  it('末尾のスラッシュが無ければ補う', () => {
    expect(resolveContentUrl('?content=e2e-content', PAGE)).toBe(`${PAGE}e2e-content/`);
  });
  it.each(['http://evil.test/', 'https://evil.test/', '//evil.test/', 'javascript:alert(1)', '/\\evil.test/'])(
    '外部を指す値 %s は無視して既定を使う',
    (value) => {
      expect(resolveContentUrl(`?content=${encodeURIComponent(value)}`, PAGE)).toBe(DEFAULT_CONTENT_URL);
    }
  );
  it('ページの外へ出る相対パス（../）も同じオリジンなら使える', () => {
    expect(resolveContentUrl('?content=../other/', PAGE)).toBe('https://kake-git-hub.github.io/other/');
  });
});
