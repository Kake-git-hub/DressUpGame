/**
 * 端末の控え（library.ts）を、サーバーにある「自分の服」の一覧に合わせる。
 *
 * 丸ごと入れ替えはしない（一覧が空で返った・途中で失敗した・利用者が替わった、で控えが全部消えないように）:
 *   - 端末に無い服だけ、絵ごと取って足す
 *   - 消すのは、「いまの利用者の服」で、サーバーから無くなったものだけ
 *     （ほかの利用者だったころの服は、サーバーに無くても、端末で着られるまま残す）
 */
import type { MyItem, MyItemInfo } from './backend';
import type { Library } from './library';

export interface SyncResult {
  added: number;
  removed: number;
  failed: number; // 取れなかった・保存できなかった数（次に開いたとき、もう一度ためす）
}

export interface SyncSource {
  listMyItems(): Promise<MyItemInfo[]>;
  fetchMyItem(id: string): Promise<MyItem>;
}

export async function syncLibrary(backend: SyncSource, library: Library, userCode: string): Promise<SyncResult> {
  const onServer = await backend.listMyItems();
  const local = await library.all();
  const have = new Set(local.map((item) => item.id));
  const wanted = new Set(onServer.map((item) => item.id));
  const result: SyncResult = { added: 0, removed: 0, failed: 0 };

  const missing = onServer.filter((item) => !have.has(item.id));
  for (const [i, info] of missing.entries()) {
    let fetched: MyItem;
    try {
      fetched = await backend.fetchMyItem(info.id);
    } catch {
      result.failed++;
      continue;
    }
    try {
      await library.put(fetched);
      result.added++;
    } catch {
      // 端末に保存できない: 残りを取りに行っても同じなので、やめる
      result.failed += missing.length - i;
      break;
    }
  }
  for (const item of local) {
    if (item.owner !== userCode || wanted.has(item.id)) continue;
    try {
      await library.remove(item.id);
      result.removed++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
