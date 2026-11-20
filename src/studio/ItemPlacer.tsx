/**
 * 保存済みの服の位置と大きさを、あとから直す画面（一覧から開く）
 * ドールに着せた見た目で、服をドラッグして動かし、倍率を変える。保存すると、ゲームで最初に着せたときの位置が変わる。
 * 座標は、キャンバスの中心を 0 にした px（服のキャンバスが余白つきで大きくても、同じ点になる）
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ManifestDoll, ManifestImage, ManifestItem } from '../content/manifest';
import { ApiError, api, contentUrl } from './api';

interface Placement {
  scale: number;
  dx: number;
  dy: number;
}
const NO_CHANGE: Placement = { scale: 1, dx: 0, dy: 0 };
const MIN_SCALE = 0.2;
const MAX_SCALE = 5;
const clampScale = (s: number) => Math.round(Math.max(MIN_SCALE, Math.min(MAX_SCALE, s)) * 1000) / 1000;

// 服の中心（キャンバスの中心から）。大きさは、ここを軸に変える
const pivotOf = (image: ManifestImage) => ({
  x: image.box.x + image.box.w / 2 - image.canvasW / 2,
  y: image.box.y + image.box.h / 2 - image.canvasH / 2,
});

// 絵 1 枚を、キャンバスの中心を 0 にした座標で置く
function Layer({ image, testId }: { image: ManifestImage; testId?: string }) {
  return (
    <image
      href={contentUrl(image.file)}
      x={image.box.x - image.canvasW / 2}
      y={image.box.y - image.canvasH / 2}
      width={image.box.w}
      height={image.box.h}
      preserveAspectRatio="none"
      data-testid={testId}
    />
  );
}

export function ItemPlacer({ doll, item, onClose, onSaved }: { doll: ManifestDoll; item: ManifestItem; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [t, setT] = useState<Placement>(NO_CHANGE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; from: Placement } | null>(null);
  const W = doll.image.canvasW;
  const H = doll.image.canvasH;
  const pivot = pivotOf(item.image);
  const changed = t.scale !== 1 || t.dx !== 0 || t.dy !== 0;

  const nudge = useCallback((dx: number, dy: number, factor = 1) => setT((p) => ({ scale: clampScale(p.scale * factor), dx: p.dx + dx, dy: p.dy + dy })), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const step = e.shiftKey ? 10 : 1;
      const keys: Record<string, () => void> = {
        ArrowLeft: () => nudge(-step, 0),
        ArrowRight: () => nudge(step, 0),
        ArrowUp: () => nudge(0, -step),
        ArrowDown: () => nudge(0, step),
        '+': () => nudge(0, 0, 1.01),
        ';': () => nudge(0, 0, 1.01),
        '-': () => nudge(0, 0, 1 / 1.01),
        Escape: () => !busy && onClose(),
      };
      const fn = keys[e.key];
      if (!fn) return;
      e.preventDefault();
      fn();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, nudge, onClose]);

  // 画面の px → キャンバスの px
  const unit = () => W / (svgRef.current?.getBoundingClientRect().width || W);
  const start = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, from: t };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const k = unit();
    setT({ ...d.from, dx: Math.round(d.from.dx + (e.clientX - d.x) * k), dy: Math.round(d.from.dy + (e.clientY - d.y) * k) });
  };
  const end = () => {
    drag.current = null;
  };
  const wheel = (e: React.WheelEvent) => nudge(0, 0, e.deltaY < 0 ? 1.02 : 1 / 1.02);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.transformItem(item.id, t);
      await onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const transform = `translate(${t.dx + pivot.x} ${t.dy + pivot.y}) scale(${t.scale}) translate(${-pivot.x} ${-pivot.y})`;
  return (
    <div className="dialog-back">
      <div className="dialog placer" data-testid="placer">
        <h2>位置と大きさ: {item.name}</h2>
        <p className="hint">服をドラッグで動かし、ホイール・ボタン・スライダーで大きさを変えます（矢印キーで 1px、Shift を押しながらで 10px）。保存すると、ゲームで最初に着せたときの位置と大きさが変わります。</p>
        <svg
          ref={svgRef}
          className="placer-view"
          viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          onWheel={wheel}
          data-testid="placer-view"
        >
          {item.back && (
            <g transform={transform} opacity={0.95}>
              <Layer image={item.back} />
            </g>
          )}
          <Layer image={doll.image} />
          <g transform={transform}>
            {item.under && <Layer image={item.under} />}
            <Layer image={item.image} testId="placer-item" />
          </g>
        </svg>
        <div className="row">
          <button onClick={() => nudge(-1, 0)} aria-label="左へ">←</button>
          <button onClick={() => nudge(1, 0)} aria-label="右へ">→</button>
          <button onClick={() => nudge(0, -1)} aria-label="上へ">↑</button>
          <button onClick={() => nudge(0, 1)} aria-label="下へ">↓</button>
          <button onClick={() => nudge(0, 0, 1.01)} data-testid="placer-bigger">大きく</button>
          <button onClick={() => nudge(0, 0, 1 / 1.01)} data-testid="placer-smaller">小さく</button>
          <label>
            倍率
            <input type="range" min={50} max={200} step={0.5} value={Math.max(50, Math.min(200, t.scale * 100))} onChange={(e) => setT((p) => ({ ...p, scale: clampScale(Number(e.target.value) / 100) }))} data-testid="placer-scale" />
          </label>
          <span className="hint" data-testid="placer-values">
            ずれ ({t.dx}, {t.dy})・倍率 {(t.scale * 100).toFixed(1)}%
          </span>
          <button onClick={() => setT(NO_CHANGE)} disabled={!changed}>もどす</button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary" onClick={() => void save()} disabled={busy || !changed} data-testid="placer-save">
            {busy ? '保存中…' : '保存'}
          </button>
          <button onClick={onClose} disabled={busy}>やめる</button>
        </div>
      </div>
    </div>
  );
}
