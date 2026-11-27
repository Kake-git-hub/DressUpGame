/**
 * クローゼットの、服 1 点の画面: 名前・既定の色・並び・消す
 *
 * 直す・消すは、サーバーを先に変え、通ったら端末の控えを変える（通らなければ、何も変えずに知らせる）。
 */
import { mergeInfo } from './mergeInfo';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BackendError, HUE_MAX, HUE_MIN, NAME_MAX, isBackgroundItem } from '../cloud/backend';
import type { MyItem, StudioBackend } from '../cloud/backend';
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
  // はじめの位置: 使えるか（null = 確かめ中、false = サーバーが古い）と、決める画面を開く
  fitReady?: boolean | null;
  onEditFit?: () => void;
}

// 色のスライダーを動かし終えてから、保存するまでの間（動かしている間は、保存しない）
const HUE_SAVE_MS = 400;
const stageSize = () => Math.max(140, Math.min(260, Math.floor(Math.min(window.innerWidth * 0.5, window.innerHeight * 0.36))));


export function ClosetItem({ item, doll, group, online, backend, library, onChanged, onGone, onClose, fitReady = null, onEditFit }: Props) {
  const [name, setName] = useState(item.item.name);
  const [hue, setHue] = useState(item.hue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const hues = useMemo(() => ({ [item.id]: hue }), [item.id, hue]);
  const one = useMemo(() => [item], [item]);
  const layers = useItemLayers(one, hues);
  const [size] = useState(stageSize);
  // 背景: 絵だけを見せる（ドールに着せない）。色・ならび・はじめの位置は、無い
  const background = isBackgroundItem(item);

  // 失敗の扱い: 服がもう無ければ、知らせて閉じる。ほかは、理由を出す
  const failed = (e: unknown): boolean => {
    if (e instanceof BackendError && e.code === 'refused') {
      window.alert('この ふくは、もう ありません（ほかの たんまつで けされたかもしれません）');
      onGone();
      return true;
    }
    setError(e instanceof Error ? e.message : String(e));
    return false;
  };
  // サーバーを変える → 通ったら、端末の控えを変える
  const apply = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      if (failed(e)) return;
    }
    setBusy(false);
  };
  const saveName = () => {
    const next = name.trim().slice(0, NAME_MAX).trim();
    if (!next || next === item.item.name) return setName(item.item.name);
    void apply(async () => {
      const info = await backend.updateMyItem(item.id, { name: next });
      await library.put(mergeInfo(latest.current, info));
      setName(info.item.name);
      await onChanged();
    });
  };

  // 色: 動かしている間は、絵だけ変える。動かし終えたら（0.4 秒）、保存する。
  // 保存の返事では、スライダーを動かさない（待っている間に、さらに動かしていることがある）。
  // 画面を閉じるときは、待たずに保存する（動かしてすぐ「できた」を押しても、色が残る）
  const latest = useRef(item); // いちばん新しい服（名前を変えたあとの控えに、色を書くため）
  useEffect(() => {
    latest.current = item;
  }, [item]);
  const hueTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHue = useRef<number | null>(null); // まだ保存していない色
  const savedHue = useRef(item.hue); // サーバーが通した色
  const alive = useRef(true);
  const saveHue = useRef<() => void>(() => undefined);
  useEffect(() => {
    saveHue.current = () => {
      const next = pendingHue.current;
      pendingHue.current = null;
      if (hueTimer.current) clearTimeout(hueTimer.current);
      hueTimer.current = null;
      if (next === null || next === savedHue.current) return;
      if (alive.current) setError(null);
      void (async () => {
        try {
          const info = await backend.updateMyItem(item.id, { hue: next });
          savedHue.current = info.hue;
          await library.put(mergeInfo(latest.current, info));
          await onChanged();
        } catch (e) {
          if (alive.current) failed(e);
        }
      })();
    };
  });
  const changeHue = (next: number) => {
    setHue(next);
    pendingHue.current = next;
    if (hueTimer.current) clearTimeout(hueTimer.current);
    hueTimer.current = setTimeout(() => saveHue.current(), HUE_SAVE_MS);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      saveHue.current(); // 閉じるとき: まだ保存していない色を、保存する
    };
  }, []);

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
  // はじめの位置を、もとにもどす
  const resetFit = () =>
    apply(async () => {
      const info = await backend.updateMyItem(item.id, { fit: null });
      await library.put(mergeInfo(latest.current, info));
      await onChanged();
    });
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
          <Stage doll={background ? null : doll} layers={layers} size={size} testId="closet-stage" fit={background ? undefined : item.fit} />
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
          {!background && (
            <>
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
            </>
          )}
          {onEditFit && doll && !background && (
            <div className="closet-field">
              <span>はじめの いち</span>
              <div className="closet-row">
                <button type="button" disabled={locked || fitReady !== true} onClick={onEditFit} data-testid="closet-fit">
                  いちを きめる
                </button>
                {item.fit && (
                  <button type="button" disabled={locked || fitReady !== true} onClick={() => void resetFit()} data-testid="closet-fit-reset">
                    もとに もどす
                  </button>
                )}
              </div>
              {online && fitReady === false && (
                <p className="closet-note" data-testid="closet-fit-old">
                  いちを きめるのは、まだ つかえません（サーバーが ふるい はんです）
                </p>
              )}
            </div>
          )}
          {item.set && <p className="closet-set">セット「{item.set.name}」</p>}
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
