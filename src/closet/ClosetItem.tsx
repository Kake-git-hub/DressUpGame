/**
 * クローゼットの、服 1 点の画面: 名前・既定の色・並び・消す
 *
 * 直す・消すは、サーバーを先に変え、通ったら端末の控えを変える（通らなければ、何も変えずに知らせる）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackendError, HUE_MAX, HUE_MIN, NAME_MAX } from '../cloud/backend';
import type { MyItem, MyItemInfo, StudioBackend } from '../cloud/backend';
import { useItemLayers } from '../cloud/itemLayers';
import type { Library } from '../cloud/library';
import { BlobImage, Stage } from '../cloud/Stage';
import type { DollData } from '../types';
import { movedOrder } from './closetView';

interface Props {
  item: MyItem;
  doll: DollData | null; // null = ドールが、いまは使えない（服の絵だけを出す）
  group: MyItem[]; // 同じドール・同じカテゴリの服（並びを変えるため）
  online: boolean; // サーバーにつながっている
  backend: StudioBackend;
  library: Library;
  onChanged: () => Promise<void>; // 端末の控えを変えた（一覧とメニューを読み直す）
  onGone: () => void; // この服が、もう無かった（ほかの端末で消された）
  onClose: () => void;
}

// 色のスライダーを動かし終えてから、保存するまでの間（動かしている間は、保存しない）
const HUE_SAVE_MS = 400;
const stageSize = () => Math.max(140, Math.min(260, Math.floor(Math.min(window.innerWidth * 0.5, window.innerHeight * 0.36))));
const mergeInfo = (item: MyItem, info: MyItemInfo): MyItem => ({ ...item, item: { ...item.item, name: info.item.name }, hue: info.hue, order: info.order, updatedAt: info.updatedAt, notes: info.notes });

export function ClosetItem({ item, doll, group, online, backend, library, onChanged, onGone, onClose }: Props) {
  const [name, setName] = useState(item.item.name);
  const [hue, setHue] = useState(item.hue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const hues = useMemo(() => ({ [item.id]: hue }), [item.id, hue]);
  const one = useMemo(() => [item], [item]);
  const layers = useItemLayers(one, hues);
  const [size] = useState(stageSize);

  // サーバーを変える → 通ったら、端末の控えを変える。服がもう無ければ、知らせて閉じる
  const apply = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      if (e instanceof BackendError && e.code === 'refused') {
        window.alert('この ふくは、もう ありません（ほかの たんまつで けされたかもしれません）');
        onGone();
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  };
  const update = (change: { name?: string; hue?: number }) =>
    apply(async () => {
      const info = await backend.updateMyItem(item.id, change);
      await library.put(mergeInfo(item, info));
      setName(info.item.name);
      setHue(info.hue);
      await onChanged();
    });
  const saveName = () => {
    const next = name.trim().slice(0, NAME_MAX).trim();
    if (!next || next === item.item.name) return setName(item.item.name);
    void update({ name: next });
  };

  // 色: 動かしている間は、絵だけ変える。動かし終えたら、保存する
  const hueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedHue = useRef(item.hue);
  const changeHue = (next: number) => {
    setHue(next);
    if (hueTimer.current) clearTimeout(hueTimer.current);
    hueTimer.current = setTimeout(() => {
      hueTimer.current = null;
      if (next === savedHue.current) return;
      savedHue.current = next;
      void update({ hue: next });
    }, HUE_SAVE_MS);
  };
  useEffect(
    () => () => {
      if (hueTimer.current) clearTimeout(hueTimer.current);
    },
    [],
  );

  const move = (direction: -1 | 1) => {
    const ids = movedOrder(group, item.id, direction);
    if (!ids) return;
    void apply(async () => {
      const changed = await backend.orderMyItems(ids);
      const byId = new Map(group.map((g) => [g.id, g]));
      for (const info of changed) {
        const target = byId.get(info.id);
        if (target) await library.put(mergeInfo(target, info));
      }
      await onChanged();
    });
  };
  const remove = () =>
    apply(async () => {
      await backend.deleteMyItem(item.id);
      await library.remove(item.id);
      await onChanged();
      onClose();
    });

  const index = group.findIndex((g) => g.id === item.id);
  const locked = busy || !online;

  return (
    <div className="closet-sheet-backdrop" data-testid="closet-item-sheet" onClick={onClose}>
      <div className="closet-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="closet-sheet-stage">
          <Stage doll={doll} layers={layers} size={size} testId="closet-stage" />
        </div>
        <div className="closet-sheet-form">
          {!online && (
            <p className="closet-note" data-testid="closet-offline-note">
              インターネットに つながっていないので、いまは なおせません
            </p>
          )}
          <label className="closet-field">
            <span>なまえ</span>
            <input
              value={name}
              maxLength={NAME_MAX}
              disabled={locked}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              aria-label="なまえ"
              data-testid="closet-name"
            />
          </label>
          <div className="closet-field">
            <span>いろ</span>
            <div className="closet-hue-row">
              <input
                type="range"
                className="closet-hue"
                min={HUE_MIN}
                max={HUE_MAX}
                step={1}
                value={hue}
                disabled={!online}
                onChange={(e) => changeHue(Number(e.target.value))}
                aria-label="いろ"
                data-testid="closet-hue"
              />
              <button type="button" disabled={!online || hue === 0} onClick={() => changeHue(0)} data-testid="closet-hue-reset">
                もとのいろ
              </button>
            </div>
          </div>
          <div className="closet-field">
            <span>ならび</span>
            <div className="closet-row">
              <button type="button" disabled={locked || index <= 0} onClick={() => move(-1)} data-testid="closet-move-front">
                ◀ まえへ
              </button>
              <button type="button" disabled={locked || index < 0 || index >= group.length - 1} onClick={() => move(1)} data-testid="closet-move-back">
                うしろへ ▶
              </button>
            </div>
          </div>
          {item.set && <p className="closet-set">セット「{item.set.name}」</p>}
          {item.notes.length > 0 && (
            <p className="closet-note" data-testid="closet-item-notes">
              {item.notes.join(' ')}
            </p>
          )}
          {error && (
            <p className="closet-error" data-testid="closet-error">
              {error}
            </p>
          )}
          <div className="closet-row closet-sheet-actions">
            <button type="button" className="danger" disabled={locked} onClick={() => setConfirming(true)} data-testid="closet-delete">
              けす
            </button>
            <button type="button" className="primary" onClick={onClose} data-testid="closet-item-done">
              できた
            </button>
          </div>
        </div>

        {confirming && (
          <div className="closet-confirm" data-testid="closet-confirm">
            <div className="closet-confirm-thumb">
              <BlobImage blob={item.files[item.item.thumb]} alt="" hue={hue} />
            </div>
            <p>
              「{item.item.name}」を けしますか？
              <br />
              （もとに もどせません）
            </p>
            <div className="closet-row">
              <button type="button" className="danger" disabled={locked} onClick={() => void remove()} data-testid="closet-delete-yes">
                けす
              </button>
              <button type="button" onClick={() => setConfirming(false)} data-testid="closet-delete-no">
                やめる
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
