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
  hue: 0,
  order: 1,
  updatedAt: 1,
  notes: [],
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

  it('そのドール・カテゴリの服として、公開の服の前に足す。絵は data: の URL。mine の印が付く。公開の服はそのまま', async () => {
    const merged = await mergeMyItems(content, [myItem('my:1')]);
    expect(merged.clothing).toHaveLength(2);
    expect(merged.clothing[1]).toEqual(content.clothing[0]);
    const mine = merged.clothing[0];
    expect(mine).not.toHaveProperty('colorHue'); // 色を決めていない服は、もとの色
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
      expect(again.clothing.find((c) => c.id === 'my:cache-1')!.imageUrl).toBe(first.clothing[0].imageUrl);
      // 同じ ID で、絵の中身が替わった（大きさが違う）
      const changed = await mergeMyItems(content, [myItem('my:cache-1', { files: { image: blob('a-much-longer-image'), thumb: blob('thumb-my:cache-1') } })]);
      expect(reads).toHaveBeenCalledTimes(5);
      expect(atob(changed.clothing[0].imageUrl.split(',')[1])).toBe('a-much-longer-image');
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
    expect(merged.clothing.map((c) => c.id)).toEqual(['my:4', 'アニメ/トップス/シャツ']);
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
    expect(merged.clothing.map((c) => c.id)).toEqual(['my:1', 'アニメ/トップス/シャツ']);
  });

  it('種類の分からない絵（type が空）は、PNG として読めるようにする', async () => {
    const untyped = myItem('my:1', { files: { image: new Blob(['i']), thumb: new Blob(['t']) } });
    const merged = await mergeMyItems(content, [untyped]);
    expect(merged.clothing[0].imageUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('自分の服どうしは、クローゼットの順番（order の大きい順。同じなら新しい順）', async () => {
    const merged = await mergeMyItems(content, [myItem('my:old', { createdAt: 1, order: 1 }), myItem('my:new', { createdAt: 9, order: 9 }), myItem('my:moved', { createdAt: 2, order: 50 })]);
    expect(merged.clothing.map((c) => c.id)).toEqual(['my:moved', 'my:new', 'my:old', 'アニメ/トップス/シャツ']);
  });

  it('既定の色のある服は、着せたときの色（colorHue）と、戻す先（defaultHue）が付き、サムネイルは色を付けた絵になる', async () => {
    const calls: { hue: number; pictures: number }[] = [];
    const tint = async (input: { thumb: string; hue: number; pictures: string[] }) => {
      calls.push({ hue: input.hue, pictures: input.pictures.length });
      expect(atob(input.thumb.split(',')[1])).toBe('thumb-my:red');
      expect(atob(input.pictures[0].split(',')[1])).toBe('image-my:red');
      return `tinted:${input.hue}`;
    };
    const merged = await mergeMyItems(content, [myItem('my:red', { hue: 90 }), myItem('my:plain')], tint);
    const red = merged.clothing.find((c) => c.id === 'my:red')!;
    expect(red).toMatchObject({ colorHue: 90, defaultHue: 90, thumbnailUrl: 'tinted:90' });
    expect(red.imageUrl).toMatch(/^data:image\/png;base64,/); // 着せる絵は、もとのまま（色は、描くときに付く）
    expect(calls).toEqual([{ hue: 90, pictures: 1 }]); // 色の無い服には、呼ばない
    // 同じ色なら、色を付けた絵を覚えている。色が変わったら、作り直す
    await mergeMyItems(content, [myItem('my:red', { hue: 90 })], tint);
    expect(calls).toHaveLength(1);
    const changed = await mergeMyItems(content, [myItem('my:red', { hue: -30 })], tint);
    expect(calls).toHaveLength(2);
    expect(changed.clothing[0]).toMatchObject({ colorHue: -30, defaultHue: -30, thumbnailUrl: 'tinted:-30' });
  });

  it('色を付けた絵を作れなくても、服は出る（サムネイルは、もとの絵）', async () => {
    const merged = await mergeMyItems(content, [myItem('my:red', { hue: 90 })], async () => {
      throw new Error('no canvas');
    });
    expect(merged.clothing[0]).toMatchObject({ id: 'my:red', colorHue: 90, defaultHue: 90 });
    expect(merged.clothing[0].thumbnailUrl).toMatch(/^data:image\/png;base64,/);
  });

  it('髪の既定の色は、うしろがみにも付く。色を決めるのに、前髪とうしろがみの両方の絵を見る', async () => {
    const hair = myItem('my:h', { hue: 45, files: { image: blob('f'), thumb: blob('t'), back: blob('b') } }, { category: 'ヘア', back: image('back', { x: 350, y: 30, w: 300, h: 600 }) });
    let pictures = 0;
    const merged = await mergeMyItems(content, [hair], async (input) => {
      pictures = input.pictures.length;
      return 'tinted';
    });
    expect(pictures).toBe(2);
    expect(merged.clothing.find((c) => c.id === 'my:h')).toMatchObject({ colorHue: 45, defaultHue: 45 });
    expect(merged.clothing.find((c) => c.type === BACK_HAIR_TYPE)).toMatchObject({ colorHue: 45, defaultHue: 45 });
  });

  it('自分のセットは、公開のセットより先に並ぶ印（負の order）を持つ。新しいセットほど先', async () => {
    const part = (id: string, setId: string, createdAt: number) => myItem(id, { createdAt, order: createdAt, set: { id: setId, name: setId } });
    const merged = await mergeMyItems(content, [part('my:a1', 'my:set-a', 100), part('my:a2', 'my:set-a', 110), part('my:b1', 'my:set-b', 200)]);
    const order = (id: string) => merged.clothing.find((c) => c.id === id)!.sets![0].order!;
    expect(order('my:a1')).toBe(-100);
    expect(order('my:a2')).toBe(-100); // 同じセットの服は、同じ値（いちばん古い服の時刻）
    expect(order('my:b1')).toBe(-200);
    expect(order('my:b1')).toBeLessThan(order('my:a1'));
  });

  it('自分の服が無ければ、同じ content を返す', async () => {
    expect(await mergeMyItems(content, [])).toBe(content);
  });
});
