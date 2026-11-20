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
  ...(owner ? { owner } : {}),
});
// 偽の裏側: サーバーにある服の ID と、取りに行ったときに失敗する ID
function server(ids: string[], broken: string[] = []) {
  const fetched: string[] = [];
  return {
    fetched,
    async listMyItems(): Promise<MyItemInfo[]> {
      return ids.map((id) => {
        const { id: itemId, dollId, item, createdAt } = myItem(id, ME);
        return { id: itemId, dollId, item, createdAt };
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
    expect(await syncLibrary(backend, library, ME)).toEqual({ added: 2, removed: 0, failed: 0 });
    expect(backend.fetched).toEqual(['my:2', 'my:3']);
    expect(await ids(library)).toEqual(['my:1', 'my:2', 'my:3']);
    expect((await library.all()).every((i) => i.owner === ME)).toBe(true);
  });

  it('サーバーから消えた自分の服は、端末からも消す', async () => {
    await library.put(myItem('my:1', ME));
    await library.put(myItem('my:2', ME));
    expect(await syncLibrary(server(['my:2']), library, ME)).toEqual({ added: 0, removed: 1, failed: 0 });
    expect(await ids(library)).toEqual(['my:2']);
  });

  it('ほかの利用者だったころの服（利用者が替わった・持ち主の印が無い）は、サーバーに無くても消さない', async () => {
    await library.put(myItem('my:old', 'ZZZZ9999'));
    await library.put(myItem('my:unknown'));
    await library.put(myItem('my:mine', ME));
    expect(await syncLibrary(server([]), library, ME)).toEqual({ added: 0, removed: 1, failed: 0 });
    expect(await ids(library)).toEqual(['my:old', 'my:unknown']);
  });

  it('1 点を取れなくても、ほかの服は取る。取れなかった数を返す（次に開いたとき、もう一度ためす）', async () => {
    const backend = server(['my:1', 'my:2', 'my:3'], ['my:2']);
    expect(await syncLibrary(backend, library, ME)).toEqual({ added: 2, removed: 0, failed: 1 });
    expect(await ids(library)).toEqual(['my:1', 'my:3']);
    expect(await syncLibrary(server(['my:1', 'my:2', 'my:3']), library, ME)).toEqual({ added: 1, removed: 0, failed: 0 });
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
    expect(await syncLibrary(backend, broken, ME)).toEqual({ added: 0, removed: 0, failed: 3 });
    expect(backend.fetched).toEqual(['my:1']);
  });
});
