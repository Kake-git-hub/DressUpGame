/**
 * 一覧の「ならべかえ」: カテゴリ・セット・服の絵を小さく詰めて並べ、つかんで動かすと、その順番がゲームのメニューの順番になる。
 * 数字は入れない。服の絵を押すと「くわしく」のその服へ。
 */
import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { ManifestDoll } from '../content/manifest';
import { itemSetIds } from '../content/manifest';
import { ApiError, api, contentUrl } from './api';
import { dropIndex, menuEntries, moveInList, renumberMenu, sortCategories } from './order';

interface Props {
  doll: ManifestDoll;
  onChanged: () => void | Promise<void>;
  onOpenItem: (itemId: string) => void;
}

// つかんでいるもの。group: 同じ group の中でだけ落とせる（カテゴリの帯・セットの段・カテゴリごとの服の段）
type Dragged = { group: string; id: string };
type Mark = { group: string; id: string; after: boolean };

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));
// 絵の右半分なら後ろ、左半分なら前
const isAfter = (e: DragEvent<HTMLElement>) => {
  const rect = e.currentTarget.getBoundingClientRect();
  return e.clientX > rect.left + rect.width / 2;
};

export function SortView({ doll, onChanged, onOpenItem }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [dragged, setDragged] = useState<Dragged | null>(null);
  const [mark, setMark] = useState<Mark | null>(null);
  // 保存して読み直すまでの間は、落としても無視する（画面の並びが古いので、前の並べ替えを戻してしまう）
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const categories = sortCategories(doll.categories, doll.items);
  const sets = doll.sets ?? [];

  const guard = async (fn: () => Promise<unknown>) => {
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    }
    try {
      await onChanged();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  // 並べ替えられるものの、つかむ・上を通る・落とすの手続き。ids は、その group のいまの並び
  const draggable = (group: string, id: string, ids: string[], save: (next: string[]) => Promise<unknown>) => ({
    draggable: true,
    onDragStart: (e: DragEvent<HTMLElement>) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      setDragged({ group, id });
    },
    onDragEnd: () => {
      setDragged(null);
      setMark(null);
    },
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragged?.group !== group) return; // ほかの段には落とせない
      e.preventDefault();
      const after = isAfter(e);
      if (mark?.id !== id || mark.after !== after || mark.group !== group) setMark({ group, id, after });
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      const from = dragged?.group === group ? ids.indexOf(dragged.id) : -1;
      setDragged(null);
      setMark(null);
      if (from < 0 || saving.current) return;
      const to = dropIndex(from, ids.indexOf(id), isAfter(e));
      if (to === from) return; // 同じ所: 何も送らない
      void guard(() => save(moveInList(ids, from, to)));
    },
  });
  const markClass = (group: string, id: string) =>
    [dragged?.group === group && dragged.id === id ? 'dragging' : '', mark?.group === group && mark.id === id ? (mark.after ? 'drop-after' : 'drop-before') : ''].filter(Boolean).join(' ') || undefined;

  // カテゴリの帯: カテゴリと、セットがあれば「セット」（ゲームのメニューと同じ並び）
  const entries = menuEntries(categories, sets.length > 0, doll.setsOrder);
  const entryIds = entries.map((e) => e.id);
  const saveEntries = (next: string[]) => {
    const { order, setsOrder } = renumberMenu(next.map((id) => entries.find((e) => e.id === id)!));
    return api.reorderCategories(doll.id, order, setsOrder);
  };
  const setIds = sets.map((s) => s.id);
  return (
    <section className={busy ? 'sort-view saving' : 'sort-view'} data-testid="sort-view" aria-busy={busy}>
      {error && <p className="error">{error}</p>}
      <p className="hint">カテゴリも服もセットも、つかんで動かすと、その順番がゲームのメニューの順番になります。服を押すと「くわしく」でその服が開きます。</p>
      <div className="sort-box sort-categories">
        <span className="hint">カテゴリの順番:</span>
        {entries.map((e) => (
          <span
            key={e.id}
            className={['sort-chip', e.kind === 'sets' ? 'sort-chip-sets' : '', markClass('categories', e.id)].filter(Boolean).join(' ')}
            data-testid="sort-category"
            data-id={e.id}
            {...draggable('categories', e.id, entryIds, saveEntries)}
          >
            ≡ {e.kind === 'sets' ? 'セット' : e.category.label}
            <span className="hint">{e.kind === 'sets' ? sets.length : doll.items.filter((i) => i.category === e.id).length}</span>
          </span>
        ))}
      </div>
      {entries.map((e) => {
        if (e.kind === 'sets')
          return (
        <div key={e.id} className="sort-box" data-testid={`sort-row-${e.id}`}>
          <h3>
            セット <span className="hint">{sets.length} 組</span>
          </h3>
          <div className="sort-row">
            {sets.map((s) => (
              <div
                key={s.id}
                className={['sort-thumb sort-set', markClass('sets', s.id)].filter(Boolean).join(' ')}
                title={s.name}
                data-testid="sort-set"
                data-id={s.id}
                {...draggable('sets', s.id, setIds, (next) => api.reorderSets(doll.id, next))}
              >
                {doll.items
                  .filter((i) => itemSetIds(i).includes(s.id))
                  .slice(0, 4)
                  .map((i) => (
                    <img key={i.id} src={contentUrl(i.thumb)} alt="" loading="lazy" draggable={false} />
                  ))}
              </div>
            ))}
          </div>
        </div>
          );
        const c = e.category;
        const items = doll.items.filter((i) => i.category === c.id);
        const ids = items.map((i) => i.id);
        const group = `items:${c.id}`;
        return (
          <div key={c.id} className="sort-box" data-testid={`sort-row-${c.id}`}>
            <h3>
              {c.label} <span className="hint">{items.length} 点</span>
            </h3>
            <div className="sort-row">
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className={['sort-thumb', markClass(group, item.id)].filter(Boolean).join(' ')}
                  title={`${item.name}（押すと「くわしく」で開く）`}
                  data-testid="sort-item"
                  data-id={item.id}
                  onClick={() => onOpenItem(item.id)}
                  {...draggable(group, item.id, ids, (next) => api.reorderItems(doll.id, c.id, next))}
                >
                  <img src={contentUrl(item.thumb)} alt={item.name} loading="lazy" draggable={false} />
                  <i>{index + 1}</i>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}
