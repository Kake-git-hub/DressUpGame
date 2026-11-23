import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { BackendError } from '../cloud/backend';
import type { MyItem, MyItemInfo } from '../cloud/backend';
import { openLibrary } from '../cloud/library';
import type { Library } from '../cloud/library';
import { syncLibrary } from '../cloud/sync';

const ME = 'ABCD2345';
const blob = (text: string) => new Blob([text], { type: 'image/png' });
const myItem = (id: string, owner?: string, createdAt = 1): MyItem => ({
  id,
  dollId: 'アニメ',
  item: { id, name: `服 ${id}`, category: 'トップス', image: { file: 'image', canvasW: 1024, canvasH: 1024, box: { x: 1, y: 2, w: 3, h: 4 } }, thumb: 'thumb' },
  files: { image: blob(`image-${id}`), thumb: blob(`thumb-${id}`) },
  createdAt,
  hue: 0,
  order: createdAt,
  updatedAt: createdAt,
  notes: [],
  ...(owner ? { owner } : {}),
});
// 偽の裏側: サーバーにある服の ID と、取りに行ったときに失敗する ID
// changed: サーバーの側で、名前・色・順番が変わっている服（ID → 変わったあとの中身）
function server(ids: string[], broken: string[] = [], changed: Record<string, Partial<MyItemInfo>> = {}) {
  const fetched: string[] = [];
  return {
    fetched,
    async listMyItems(): Promise<MyItemInfo[]> {
      return ids.map((id) => {
        const { files: _files, owner: _owner, ...info } = myItem(id, ME);
        void _files;
        void _owner;
        return { ...info, ...changed[id] };
      });
    },
    async fetchMyItem(id: string): Promise<MyItem> {
      fetched.push(id);
      if (broken.includes(id)) throw new BackendError('offline', 'つながりません');
      return myItem(id, ME);
    },
  };
}
const ids = async (library: Library) => (await library.all()).map((i) => i.id).sort();

describe('端末の控えを、サーバーの一覧に合わせる', () => {
  let library: Library;
  beforeEach(() => {
    library = openLibrary(new IDBFactory());
  });

  it('端末に無い服だけを取る（もうある服の絵は、取り直さない）', async () => {
    await library.put(myItem('my:1', ME));
    const backend = server(['my:1', 'my:2', 'my:3']);
    expect(await syncLibrary(backend, library, ME)).toEqual({ added: 2, removed: 0, failed: 0, updated: 0 });
    expect(backend.fetched).toEqual(['my:2', 'my:3']);
    expect(await ids(library)).toEqual(['my:1', 'my:2', 'my:3']);
    expect((await library.all()).every((i) => i.owner === ME)).toBe(true);
  });

  it('サーバーから消えた自分の服は、端末からも消す', async () => {
    await library.put(myItem('my:1', ME));
    await library.put(myItem('my:2', ME));
    expect(await syncLibrary(server(['my:2']), library, ME)).toEqual({ added: 0, removed: 1, failed: 0, updated: 0 });
    expect(await ids(library)).toEqual(['my:2']);
  });

  it('ほかの利用者だったころの服（利用者が替わった・持ち主の印が無い）は、サーバーに無くても消さない', async () => {
    await library.put(myItem('my:old', 'ZZZZ9999'));
    await library.put(myItem('my:unknown'));
    await library.put(myItem('my:mine', ME));
    expect(await syncLibrary(server([]), library, ME)).toEqual({ added: 0, removed: 1, failed: 0, updated: 0 });
    expect(await ids(library)).toEqual(['my:old', 'my:unknown']);
  });

  it('1 点を取れなくても、ほかの服は取る。取れなかった数を返す（次に開いたとき、もう一度ためす）', async () => {
    const backend = server(['my:1', 'my:2', 'my:3'], ['my:2']);
    expect(await syncLibrary(backend, library, ME)).toEqual({ added: 2, removed: 0, failed: 1, updated: 0 });
    expect(await ids(library)).toEqual(['my:1', 'my:3']);
    expect(await syncLibrary(server(['my:1', 'my:2', 'my:3']), library, ME)).toEqual({ added: 1, removed: 0, failed: 0, updated: 0 });
  });

  it('一覧を取れなかったら、端末の控えには手を付けない（失敗を伝える）', async () => {
    await library.put(myItem('my:1', ME));
    const backend = { ...server([]), listMyItems: async () => Promise.reject(new BackendError('offline', 'つながりません')) };
    await expect(syncLibrary(backend, library, ME)).rejects.toMatchObject({ code: 'offline' });
    expect(await ids(library)).toEqual(['my:1']);
  });

  it('端末に保存できないときは、絵を取りに行くのをやめる（1 点目で分かる）', async () => {
    const broken = openLibrary(null);
    const backend = server(['my:1', 'my:2', 'my:3']);
    expect(await syncLibrary(backend, broken, ME)).toEqual({ added: 0, removed: 0, failed: 3, updated: 0 });
    expect(backend.fetched).toEqual(['my:1']);
  });

  it('updatedAt が違う服は、名前・色・順番だけ直す（絵は取り直さない）', async () => {
    await library.put(myItem('my:a', ME));
    await library.put(myItem('my:b', ME));
    const before = (await library.all()).find((i) => i.id === 'my:a')!;
    const changed = { 'my:a': { item: { ...before.item, name: 'あたらしいなまえ' }, hue: 90, order: 50, updatedAt: 99, notes: ['注意'] } };
    const backend = server(['my:a', 'my:b'], [], changed);
    const result = await syncLibrary(backend, library, ME);
    expect(result).toEqual({ added: 0, removed: 0, failed: 0, updated: 1 });
    expect(backend.fetched).toEqual([]);
    const after = (await library.all()).find((i) => i.id === 'my:a')!;
    expect(after).toMatchObject({ hue: 90, order: 50, updatedAt: 99, notes: ['注意'], owner: ME });
    expect(after.item.name).toBe('あたらしいなまえ');
    expect(Object.keys(after.files).sort()).toEqual(['image', 'thumb']); // 絵は、そのまま残る
    // もう一度合わせても、何も変えない
    expect((await syncLibrary(backend, library, ME)).updated).toBe(0);
  });

  it('前の版の控え（色・順番の無い服）は、0・作った時刻として読める。サーバーと同じなら、直さない', async () => {
    const old = myItem('my:old', ME, 7) as unknown as Record<string, unknown>;
    for (const key of ['hue', 'order', 'updatedAt', 'notes']) delete old[key];
    await library.put(old as unknown as MyItem);
    const [read] = await library.all();
    expect(read).toMatchObject({ hue: 0, order: 7, updatedAt: 7, notes: [] });
    const backend = server(['my:old'], [], { 'my:old': { createdAt: 7, order: 7, updatedAt: 7 } });
    expect((await syncLibrary(backend, library, ME)).updated).toBe(0);
  });
});
