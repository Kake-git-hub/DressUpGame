/**
 * クローゼット: 自分の服（作った服。あとの段階で、届けてもらった服・交換でもらった服も）の一覧と、直す画面。
 * 子どもも使う画面なので、ひらがな中心。
 *
 * 見るだけなら、つながっていなくてもよい（端末の控えから出す）。直す・消すは、サーバーにつながっているときだけ。
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { MyItem } from '../cloud/backend';
import type { Library } from '../cloud/library';
import type { CloudSession } from '../cloud/session';
import { BlobImage } from '../cloud/Stage';
import type { ManifestCategory } from '../content/manifest';
import type { DollData } from '../types';
import { ClosetItem } from './ClosetItem';
import { closetDolls, closetGroups } from './closetView';

export interface ClosetProps {
  session: CloudSession;
  library: Library;
  dolls: DollData[]; // ゲームに出ているドール
  categoriesByDoll: Record<string, ManifestCategory[]>;
  currentDollId: string;
  onClose: () => void;
  onLibraryChanged: () => void | Promise<void>; // 端末の控えを変えた（ゲームのメニューに重ね直す）
}

const NO_CATEGORIES: ManifestCategory[] = [];

export function Closet({ session, library, dolls, categoriesByDoll, currentDollId, onClose, onLibraryChanged }: ClosetProps) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const [items, setItems] = useState<MyItem[] | null>(null);
  const [chosenDoll, setChosenDoll] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const reload = useCallback(async () => setItems(await library.all()), [library]);
  // 開いている間は、進み具合をこまめに聞く。開いたときに、つなぐ（まだなら）
  useEffect(() => {
    session.setFast(true);
    void session.connect();
    return () => session.setFast(false);
  }, [session]);
  // 服が届いた・ほかの端末で変わった（つなぎ役が控えを書き換えた）ときも、読み直す
  const stamp = `${state.jobs.map((job) => `${job.id}:${job.done}`).join(',')}|${state.newItemIds.join(',')}|${state.status}`;
  useEffect(() => {
    let alive = true;
    void library.all().then((all) => {
      if (alive) setItems(all);
    });
    return () => {
      alive = false;
    };
  }, [library, stamp]);

  const tabs = useMemo(() => closetDolls(items ?? [], dolls, currentDollId), [items, dolls, currentDollId]);
  const dollId = tabs.some((doll) => doll.id === chosenDoll) ? chosenDoll! : (tabs[0]?.id ?? '');
  const groups = useMemo(() => closetGroups(items ?? [], dollId, categoriesByDoll[dollId] ?? NO_CATEGORIES), [items, dollId, categoriesByDoll]);
  const open = openId ? (items?.find((item) => item.id === openId) ?? null) : null;
  const openGroup = open ? (groups.find((group) => group.items.some((item) => item.id === open.id))?.items ?? [open]) : [];
  const online = state.status === 'ready';
  const labelOf = (forDoll: string, id: string) => categoriesByDoll[forDoll]?.find((c) => c.id === id)?.label ?? id;
  // 作りかけの品目（どのドールの分も）
  const making = state.jobs.filter((job) => !job.done).flatMap((job) => job.candidates.filter((c) => c.status === 'waiting' || c.status === 'working').map((c) => ({ key: `${job.id}:${c.index}`, label: labelOf(job.dollId, c.categoryId) })));

  const changed = async () => {
    await reload();
    await onLibraryChanged();
  };
  const show = (item: MyItem) => {
    session.markSeen(item.id);
    setOpenId(item.id);
  };

  return (
    <div className="closet-overlay" data-testid="closet">
      <div className="closet-panel">
        <header className="closet-header">
          <h2>
            <span aria-hidden="true">👗</span> クローゼット
          </h2>
          <button type="button" className="closet-close" onClick={onClose} aria-label="とじる" data-testid="closet-close">
            ✕
          </button>
        </header>

        {state.status === 'problem' && (
          <p className="closet-note" data-testid="closet-offline">
            いまは サーバーに つながっていません。みることは できます。
          </p>
        )}

        {making.length > 0 && (
          <div className="closet-making" data-testid="closet-making">
            <span className="closet-making-title">つくっています…</span>
            {making.map((m) => (
              <span key={m.key} className="closet-making-chip">
                <span className="closet-spinner" aria-hidden="true" />
                {m.label}
              </span>
            ))}
          </div>
        )}

        {tabs.length > 1 && (
          <div className="closet-dolls" role="tablist">
            {tabs.map((doll) => (
              <button key={doll.id} type="button" role="tab" aria-selected={doll.id === dollId} className={doll.usable ? '' : 'unusable'} onClick={() => setChosenDoll(doll.id)} data-testid="closet-doll">
                {doll.name}
              </button>
            ))}
          </div>
        )}
        {tabs.length === 1 && !tabs[0].usable && (
          <p className="closet-note" data-testid="closet-unusable">
            {tabs[0].name}の ふくです（きることは できません。けすことは できます）
          </p>
        )}

        {items === null ? (
          <p className="closet-empty">よみこみちゅう…</p>
        ) : tabs.length === 0 ? (
          <p className="closet-empty" data-testid="closet-empty">
            まだ ふくが ありません。「つくる」で つくれるよ
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.categoryId || 'other'} className="closet-group" data-testid="closet-group">
              <h3>{group.label}</h3>
              <div className="closet-grid">
                {group.items.map((item) => (
                  <button key={item.id} type="button" className="closet-item" onClick={() => show(item)} data-testid="closet-item" data-new={state.newItemIds.includes(item.id) ? 'true' : undefined} data-hue={item.hue}>
                    <span className="closet-thumb">
                      <BlobImage blob={item.files[item.item.thumb]} alt="" hue={item.hue} />
                    </span>
                    {state.newItemIds.includes(item.id) && (
                      <span className="closet-new" data-testid="closet-new">
                        NEW
                      </span>
                    )}
                    <span className="closet-name">{item.item.name}</span>
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      {open && (
        <ClosetItem
          key={open.id}
          item={open}
          doll={dolls.find((doll) => doll.id === open.dollId) ?? null}
          group={openGroup}
          online={online}
          backend={session.backend}
          library={library}
          onChanged={changed}
          onGone={() => {
            // ほかの端末で消されていた: 閉じて、サーバーの一覧に合わせ直す
            setOpenId(null);
            void session.refresh().then(reload);
          }}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}
