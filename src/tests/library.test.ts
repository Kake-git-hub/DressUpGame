import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyItem } from '../cloud/backend';
import { mergeMyItems, openLibrary } from '../cloud/library';
import { BACK_HAIR_TYPE } from '../content/loadContent';
import type { LoadedContent } from '../content/loadContent';

const blob = (text: string) => new Blob([text], { type: 'image/png' });
const image = (file: string, box = { x: 392, y: 300, w: 240, h: 200 }) => ({ file, canvasW: 1024, canvasH: 1024, box });
const myItem = (id: string, extra: Partial<MyItem> = {}, itemExtra: Partial<MyItem['item']> = {}): MyItem => ({
  id,
  dollId: 'アニメ',
  item: { id, name: `服 ${id}`, category: 'トップス', image: image('image'), thumb: 'thumb', ...itemExtra },
  files: { image: blob(`image-${id}`), thumb: blob(`thumb-${id}`) },
  createdAt: 1,
  ...extra,
});

describe('端末の中の「自分の服」（IndexedDB）', () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  it('入れる・読む・消す。絵（Blob）も一緒に残る。開き直しても残る', async () => {
    const library = openLibrary(factory);
    expect(await library.all()).toEqual([]);
    await library.put(myItem('my:1'));
    await library.put(myItem('my:2', { createdAt: 2 }));
    const again = openLibrary(factory);
    const items = await again.all();
    expect(items.map((i) => i.id)).toEqual(['my:1', 'my:2']);
    expect(items[0].files.image).toBeDefined();
    expect(items[0].item.name).toBe('服 my:1');
    await again.remove('my:1');
    expect((await library.all()).map((i) => i.id)).toEqual(['my:2']);
  });

  it('同じ ID をもう一度入れると、置き換わる', async () => {
    const library = openLibrary(factory);
    await library.put(myItem('my:1'));
    await library.put(myItem('my:1', {}, { name: 'あたらしい' }));
    const items = await library.all();
    expect(items).toHaveLength(1);
    expect(items[0].item.name).toBe('あたらしい');
  });

  it('IndexedDB が使えない端末では、読むと空（落ちない）。書くと、保存できなかったことが分かる（黙って失わない）', async () => {
    const library = openLibrary(null);
    expect(await library.all()).toEqual([]);
    await expect(library.put(myItem('my:1'))).rejects.toThrow(/保存できません/);
    await expect(library.remove('my:1')).rejects.toThrow(/保存できません/);
    const broken = { open: () => { throw new Error('使えません'); } } as unknown as IDBFactory;
    expect(await openLibrary(broken).all()).toEqual([]);
    await expect(openLibrary(broken).put(myItem('my:1'))).rejects.toThrow(/保存できません/);
  });

  it('開くのに返事が無いときは、待ちつづけない', async () => {
    const hanging = { open: () => ({}) } as unknown as IDBFactory;
    const library = openLibrary(hanging, 50);
    expect(await library.all()).toEqual([]);
    await expect(library.put(myItem('my:1'))).rejects.toThrow(/保存できません/);
  });
});

describe('自分の服を、公開の素材に重ねる', () => {
  const content: LoadedContent = {
    dolls: [{ id: 'アニメ', name: 'アニメ', bodyImageUrl: 'https://x/d.webp', canvasW: 1024, canvasH: 1024, box: { x: 300, y: 50, w: 400, h: 900 } }],
    clothing: [
      { id: 'アニメ/トップス/シャツ', name: 'シャツ', type: 'トップス', imageUrl: 'https://x/a.webp', thumbnailUrl: 'https://x/t.webp', position: { x: 0, y: 0 }, baseZIndex: 4, layerOrder: 4, categoryOrder: 1, dollId: 'アニメ', canvasW: 1024, canvasH: 1024, box: { x: 292, y: 240, w: 440, h: 280 } },
    ],
    backgrounds: [],
    categories: {
      アニメ: [
        { id: 'トップス', label: 'トップス', layer: 4, menuOrder: 1, overlap: false, movable: false },
        { id: 'ヘア', label: 'ヘアスタイル', layer: 11, menuOrder: 11, overlap: false, movable: false },
      ],
    },
  };

  it('そのドール・カテゴリの服として足す。絵は data: の URL。mine の印が付く。公開の服はそのまま', async () => {
    const merged = await mergeMyItems(content, [myItem('my:1')]);
    expect(merged.clothing).toHaveLength(2);
    expect(merged.clothing[0]).toEqual(content.clothing[0]);
    const mine = merged.clothing[1];
    expect(mine).toMatchObject({ id: 'my:1', name: '服 my:1', type: 'トップス', dollId: 'アニメ', layerOrder: 4, categoryOrder: 1, mine: true, canvasW: 1024, box: { x: 392, y: 300, w: 240, h: 200 } });
    expect(mine.imageUrl).toMatch(/^data:image\/png;base64,/);
    expect(mine.thumbnailUrl).toMatch(/^data:image\/png;base64,/);
    expect(atob(mine.imageUrl.split(',')[1])).toBe('image-my:1');
    // もとの content は書き換えない
    expect(content.clothing).toHaveLength(1);
  });

  it('一度 data: に直した絵は覚えておく（服が増えた・減ったときに重ね直しても、同じ絵を読み直さない）。中身が替わった絵は、読み直す', async () => {
    const reads = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    try {
      const first = await mergeMyItems(content, [myItem('my:cache-1')]);
      expect(reads).toHaveBeenCalledTimes(2); // 服の絵と、サムネイル
      // 控えを読み直すと、Blob は別のものになる（中身は同じ）
      const again = await mergeMyItems(content, [myItem('my:cache-1'), myItem('my:cache-2')]);
      expect(reads).toHaveBeenCalledTimes(4); // 増えた 1 点の分だけ
      expect(again.clothing[1].imageUrl).toBe(first.clothing[1].imageUrl);
      // 同じ ID で、絵の中身が替わった（大きさが違う）
      const changed = await mergeMyItems(content, [myItem('my:cache-1', { files: { image: blob('a-much-longer-image'), thumb: blob('thumb-my:cache-1') } })]);
      expect(reads).toHaveBeenCalledTimes(5);
      expect(atob(changed.clothing[1].imageUrl.split(',')[1])).toBe('a-much-longer-image');
    } finally {
      reads.mockRestore();
    }
  });

  it('公開の素材に無いドール・カテゴリの服は、足さない（落ちない）。絵が欠けている服も足さない', async () => {
    const merged = await mergeMyItems(content, [
      myItem('my:1', { dollId: '消えたドール' }),
      myItem('my:2', {}, { category: '消えたカテゴリ' }),
      myItem('my:3', { files: { thumb: blob('t') } }),
      myItem('my:4'),
    ]);
    expect(merged.clothing.map((c) => c.id)).toEqual(['アニメ/トップス/シャツ', 'my:4']);
  });

  it('髪（back つき）は、前髪とうしろがみの 2 点になる。セットの印は、セットの ID と名前になる', async () => {
    const hair = myItem(
      'my:h',
      { set: { id: 'my:set-1', name: 'うみのセット' }, files: { image: blob('f'), thumb: blob('t'), back: blob('b') } },
      { category: 'ヘア', back: image('back', { x: 350, y: 30, w: 300, h: 600 }) },
    );
    const merged = await mergeMyItems(content, [hair, myItem('my:1', { set: { id: 'my:set-1', name: 'うみのセット' } })]);
    const front = merged.clothing.find((c) => c.id === 'my:h')!;
    const back = merged.clothing.find((c) => c.type === BACK_HAIR_TYPE)!;
    expect(front).toMatchObject({ sets: [{ id: 'my:set-1', name: 'うみのセット' }], backItemId: back.id, mine: true });
    expect(back.frontItemId).toBe('my:h');
    expect(back.imageUrl).toMatch(/^data:/);
    expect(merged.clothing.find((c) => c.id === 'my:1')).toMatchObject({ sets: [{ id: 'my:set-1', name: 'うみのセット' }] });
  });

  it('壊れた控え（中身が欠けている）が 1 件あっても、ほかの服は出る', async () => {
    const broken = [{ id: 'my:x', dollId: 'アニメ', createdAt: 1 } as unknown as MyItem, { id: 'my:y', dollId: 'アニメ', item: { category: 'トップス' }, files: null, createdAt: 1 } as unknown as MyItem];
    const merged = await mergeMyItems(content, [...broken, myItem('my:1')]);
    expect(merged.clothing.map((c) => c.id)).toEqual(['アニメ/トップス/シャツ', 'my:1']);
  });

  it('種類の分からない絵（type が空）は、PNG として読めるようにする', async () => {
    const untyped = myItem('my:1', { files: { image: new Blob(['i']), thumb: new Blob(['t']) } });
    const merged = await mergeMyItems(content, [untyped]);
    expect(merged.clothing[1].imageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('自分の服が無ければ、同じ content を返す', async () => {
    expect(await mergeMyItems(content, [])).toBe(content);
  });
});
