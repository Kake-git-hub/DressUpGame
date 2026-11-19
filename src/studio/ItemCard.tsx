/**
 * 服の候補 1 点のカード: ドールに着せたプレビュー、微調整、手直し、カテゴリと名前、保存
 * 手で入れた画像にも、自動生成の候補にも使う。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ManifestDoll } from '../content/manifest';
import { alphaBBox } from '../pipeline/alpha';
import type { Box } from '../pipeline/alpha';
import type { BodyParts } from '../pipeline/bodyParts';
import { hairFrontBottom, isHairCategory, splitHair } from '../pipeline/hairSplit';
import { defaultLimbs, hideMask, limbZones } from '../pipeline/limbZones';
import type { Limb } from '../pipeline/limbZones';
import { ApiError, api, blobToBase64, contentUrl } from './api';
import type { Warning } from './api';
import { loadParts } from './partsCache';



export interface CardSource {
  key: string;
  name: string;
  category: string;
  cutUrl: string; // 切り抜いた服（ドールのキャンバス大の PNG）
  sourceUrl: string; // 切り抜く前（同じ位置合わせ）
  shapeUrl?: string | null; // AI が描いた体と服の形（手足の先を服に合わせるのに使う）
  warnings: Warning[];
  notes: string[];
}

type Tool = 'move' | 'erase' | 'restore';
type View = 'worn' | 'cut' | 'source';
const BRUSHES = [8, 20, 44];

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読めませんでした'));
    img.src = url;
  });
}

interface Props {
  doll: ManifestDoll;
  source: CardSource;
  onSaved: () => void;
  onDiscard: () => void;
  onRedo?: () => void;
}

export function ItemCard({ doll, source, onSaved, onDiscard, onRedo }: Props) {
  // 服のキャンバス。AI で作った服は、ドールのキャンバスのまわりに余白を足した大きさ（中心は同じ）で届く。
  // 読み込むまでは、ドールのキャンバスの大きさにしておく
  const [size, setSize] = useState({ w: doll.image.canvasW, h: doll.image.canvasH });
  const canvasW = size.w;
  const canvasH = size.h;
  const padX = Math.round((canvasW - doll.image.canvasW) / 2);
  const padY = Math.round((canvasH - doll.image.canvasH) / 2);
  // 服のキャンバス上の、ドールの位置
  const box = useMemo(
    () => ({ x: doll.image.box.x + padX, y: doll.image.box.y + padY, w: doll.image.box.w, h: doll.image.box.h }),
    [doll.image.box.x, doll.image.box.y, doll.image.box.w, doll.image.box.h, padX, padY],
  );
  const viewRef = useRef<HTMLCanvasElement>(null);
  const cutRef = useRef<HTMLCanvasElement | null>(null); // 編集中の服
  const images = useRef<{ doll: HTMLImageElement; cut: HTMLImageElement; source: HTMLImageElement; shape: HTMLImageElement | null } | null>(null);
  const hideRef = useRef<HTMLCanvasElement | null>(null); // 着ているあいだドールを隠す所（白）
  const [parts, setParts] = useState<BodyParts | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(source.name);
  const [category, setCategory] = useState(source.category || doll.categories[0]?.id || '');
  const labelOf = (id: string) => doll.categories.find((c) => c.id === id)?.label ?? id;
  // 手足の先を服に合わせる（はみ出したドールの指先などを隠す）。手袋・くつなどは最初から入れる
  const isHair = isHairCategory(labelOf(category));
  const [cutVersion, setCutVersion] = useState(0);
  const splitRef = useRef<{ front: HTMLCanvasElement; back: HTMLCanvasElement } | null>(null);
  const [limbs, setLimbs] = useState<Limb[]>(() => defaultLimbs(labelOf(source.category || doll.categories[0]?.id || '')));
  const [hasHide, setHasHide] = useState(false);
  const [nudge, setNudge] = useState({ scale: 1, dx: 0, dy: 0 });
  const [itemBox, setItemBox] = useState<Box | null>(null); // 動かす前の服の外接矩形（服のキャンバス上）
  // 枠をつかんで動かしている最中か（重い処理＝髪の前後の分け直しは、指を離してから行う）
  const dragRef = useRef<{ kind: 'move' | 'scale'; x: number; y: number; nudge: { scale: number; dx: number; dy: number }; cx: number; cy: number; distance: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [tool, setTool] = useState<Tool>('move');
  const [brush, setBrush] = useState(BRUSHES[1]);
  const [view, setView] = useState<View>('worn');
  const [touched, setTouched] = useState(false); // 手直しをしたか
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const problems = [...source.warnings.map((w) => w.message), ...source.notes];

  // 微調整（倍率はキャンバスの中心が基準）を反映した画像を描く
  const drawNudged = useCallback(
    (ctx: CanvasRenderingContext2D, img: HTMLImageElement) => {
      const { scale, dx, dy } = nudge;
      ctx.setTransform(scale, 0, 0, scale, dx + ((1 - scale) * canvasW) / 2, dy + ((1 - scale) * canvasH) / 2);
      ctx.drawImage(img, 0, 0, canvasW, canvasH);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    },
    [nudge, canvasW, canvasH],
  );

  const paint = useCallback(() => {
    const canvas = viewRef.current;
    const loaded = images.current;
    const cut = cutRef.current;
    if (!canvas || !loaded || !cut) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvasW, canvasH);
    if (view === 'source') {
      drawNudged(ctx, loaded.source);
      return;
    }
    // 髪: 保存のときと同じように、後ろ髪 → ドール → 前髪の順に重ねて見せる（ブラシで直している最中は、分ける前の絵）
    const layers = view === 'worn' && isHair ? splitRef.current : null;
    if (layers) {
      ctx.drawImage(layers.back, 0, 0);
      ctx.drawImage(loaded.doll, box.x, box.y, box.w, box.h);
      ctx.drawImage(layers.front, 0, 0);
      return;
    }
    if (view === 'worn') {
      ctx.drawImage(loaded.doll, box.x, box.y, box.w, box.h);
      if (hideRef.current && hasHide) {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.drawImage(hideRef.current, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    ctx.drawImage(cut, 0, 0);
  }, [view, drawNudged, canvasW, canvasH, box, hasHide, isHair]);

  // 髪を、前髪と後ろ髪に分けて持っておく（切り抜きが変わるたびに作り直す）
  const refreshSplit = useCallback(() => {
    const cut = cutRef.current;
    const loaded = images.current;
    splitRef.current = null;
    if (!cut || !loaded || !isHair) return;
    const pixels = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = canvasW;
      c.height = canvasH;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      draw(ctx);
      return ctx.getImageData(0, 0, canvasW, canvasH).data;
    };
    const dollPixels = pixels((ctx) => ctx.drawImage(loaded.doll, box.x, box.y, box.w, box.h));
    const alpha = new Uint8Array(canvasW * canvasH);
    for (let p = 0; p < alpha.length; p++) alpha[p] = dollPixels[p * 4 + 3];
    // AI が描いた体と髪の形（微調整に合わせて動かす）。後ろ髪の穴を埋める範囲を決めるのに使う
    let bodyShape: Uint8Array | undefined;
    if (loaded.shape) {
      const shapePixels = pixels((ctx) => drawNudged(ctx, loaded.shape!));
      bodyShape = new Uint8Array(canvasW * canvasH);
      for (let p = 0; p < bodyShape.length; p++) bodyShape[p] = shapePixels[p * 4 + 3];
    }
    const split = splitHair(pixels((ctx) => ctx.drawImage(cut, 0, 0)), alpha, canvasW, canvasH, undefined, { ...(parts ? { frontBottom: hairFrontBottom(parts.head) + padY } : {}), bodyShape });
    if (!split) return;
    const toCanvas = (data: Uint8ClampedArray) => {
      const c = document.createElement('canvas');
      c.width = canvasW;
      c.height = canvasH;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), canvasW, canvasH), 0, 0);
      return c;
    };
    splitRef.current = { front: toCanvas(split.front), back: toCanvas(split.back) };
  }, [isHair, canvasW, canvasH, box, parts, padY, drawNudged]);

  // 画像を読む
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      loadImage(contentUrl(doll.image.file)),
      loadImage(source.cutUrl),
      loadImage(source.sourceUrl),
      source.shapeUrl ? loadImage(source.shapeUrl).catch(() => null) : Promise.resolve(null),
      loadParts(doll.id).catch(() => null), // 型紙の部位（手足の先を合わせる・前髪の範囲を決めるのに使う）
    ])
      .then(([d, c, s, shape, p]) => {
        if (cancelled) return;
        images.current = { doll: d, cut: c, source: s, shape };
        setParts(p);
        const canvas = document.createElement('canvas');
        canvas.width = c.naturalWidth;
        canvas.height = c.naturalHeight;
        cutRef.current = canvas;
        // 服の外接矩形（調整の枠に使う）
        const probe = document.createElement('canvas');
        probe.width = c.naturalWidth;
        probe.height = c.naturalHeight;
        const pctx = probe.getContext('2d', { willReadFrequently: true })!;
        pctx.drawImage(c, 0, 0);
        setItemBox(alphaBBox(pctx.getImageData(0, 0, probe.width, probe.height).data, probe.width, probe.height));
        setSize({ w: c.naturalWidth, h: c.naturalHeight });
        setReady(true);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [doll.id, doll.image.file, source.cutUrl, source.sourceUrl, source.shapeUrl]);

  // 隠す所を作る: 手首・すねから先で、AI が描いた形（微調整に合わせて動かす）の外にあるドール
  useEffect(() => {
    const loaded = images.current;
    if (!ready || !loaded?.shape || !parts || limbs.length === 0) {
      setHasHide(false);
      return;
    }
    const layer = (draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = canvasW;
      c.height = canvasH;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      draw(ctx);
      return ctx.getImageData(0, 0, canvasW, canvasH).data;
    };
    const dollPixels = layer((ctx) => ctx.drawImage(loaded.doll, box.x, box.y, box.w, box.h));
    const shapePixels = layer((ctx) => drawNudged(ctx, loaded.shape!));
    const alphaOf = (data: Uint8ClampedArray) => {
      const out = new Uint8Array(canvasW * canvasH);
      for (let p = 0; p < out.length; p++) out[p] = data[p * 4 + 3];
      return out;
    };
    // 型紙の部位はドールのキャンバス上の位置なので、服のキャンバス上の位置に直す
    const shifted = Object.fromEntries(Object.entries(parts).map(([k, b]) => [k, { ...b, x: b.x + padX, y: b.y + padY }])) as BodyParts;
    const mask = hideMask(alphaOf(dollPixels), alphaOf(shapePixels), limbZones(shifted, limbs, canvasW, canvasH), canvasW, canvasH);
    const canvas = hideRef.current ?? document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;
    const image = ctx.createImageData(canvasW, canvasH);
    let any = false;
    for (let p = 0; p < mask.length; p++) {
      image.data.set([255, 255, 255, mask[p]], p * 4);
      if (mask[p] > 0) any = true;
    }
    ctx.putImageData(image, 0, 0);
    hideRef.current = canvas;
    setHasHide(any);
  }, [ready, parts, limbs, drawNudged, canvasW, canvasH, box, padX, padY]);

  // 微調整が変わったら、元の切り抜きから作り直す（手直しは消える）
  useEffect(() => {
    const cut = cutRef.current;
    if (!ready || !cut || !images.current) return;
    const ctx = cut.getContext('2d')!;
    ctx.clearRect(0, 0, canvasW, canvasH);
    drawNudged(ctx, images.current.cut);
    setTouched(false);
    setCutVersion((v) => v + 1);
  }, [ready, drawNudged, canvasW, canvasH]);

  // 切り抜きを作り直したとき・カテゴリを変えたときに、髪の前後を分け直す（手直しは消さない）
  useEffect(() => {
    if (!ready) return;
    if (dragging) splitRef.current = null; // 動かしている最中は分けずに見せる
    else refreshSplit();
    paint();
  }, [ready, cutVersion, refreshSplit, paint, dragging]);

  useEffect(paint, [paint, ready, nudge, hasHide, limbs]);

  const move = (dx: number, dy: number, factor = 1) => setNudge((n) => ({ scale: Math.round(n.scale * factor * 1000) / 1000, dx: n.dx + dx, dy: n.dy + dy }));
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    const step = e.shiftKey ? 10 : 1;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => move(-step, 0),
      ArrowRight: () => move(step, 0),
      ArrowUp: () => move(0, -step),
      ArrowDown: () => move(0, step),
      '+': () => move(0, 0, 1.005),
      ';': () => move(0, 0, 1.005),
      '-': () => move(0, 0, 1 / 1.005),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
    }
  };

  // 枠での調整（ゲームの調整画面と同じ操作）: 絵をつかんで動かす。角のつまみを引っぱって大きさを変える（服の中心が軸）
  const toCanvasPoint = (e: React.PointerEvent, el: Element) => {
    const rect = el.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * canvasW, y: ((e.clientY - rect.top) / rect.height) * canvasH };
  };
  // 微調整後の、服の外接矩形（服のキャンバス上）
  const framed = itemBox
    ? {
        x: nudge.scale * (itemBox.x - canvasW / 2) + canvasW / 2 + nudge.dx,
        y: nudge.scale * (itemBox.y - canvasH / 2) + canvasH / 2 + nudge.dy,
        w: nudge.scale * itemBox.w,
        h: nudge.scale * itemBox.h,
      }
    : null;
  const startDrag = (e: React.PointerEvent, kind: 'move' | 'scale') => {
    const stage = viewRef.current;
    if (!stage || tool !== 'move' || !framed) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toCanvasPoint(e, stage);
    const cx = framed.x + framed.w / 2;
    const cy = framed.y + framed.h / 2;
    dragRef.current = { kind, x: p.x, y: p.y, nudge, cx, cy, distance: Math.max(1, Math.hypot(p.x - cx, p.y - cy)) };
    setDragging(true);
  };
  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const stage = viewRef.current;
    if (!d || !stage) return;
    const p = toCanvasPoint(e, stage);
    if (d.kind === 'move') {
      setNudge({ scale: d.nudge.scale, dx: Math.round(d.nudge.dx + p.x - d.x), dy: Math.round(d.nudge.dy + p.y - d.y) });
      return;
    }
    // 服の中心 (cx, cy) を軸に f 倍する: 新しい倍率 = f × 元の倍率、ずれ = f × (C + d - c) + c - C（C はキャンバスの中心）
    const scale = Math.max(0.2, Math.min(4, Math.round(((d.nudge.scale * Math.hypot(p.x - d.cx, p.y - d.cy)) / d.distance) * 1000) / 1000));
    const f = scale / d.nudge.scale;
    setNudge({
      scale,
      dx: Math.round(f * (canvasW / 2 + d.nudge.dx - d.cx) + d.cx - canvasW / 2),
      dy: Math.round(f * (canvasH / 2 + d.nudge.dy - d.cy) + d.cy - canvasH / 2),
    });
  };
  const endDrag = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
  };

  // 手直し: 消しゴムと復元ブラシ
  const stroke = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cut = cutRef.current;
    const loaded = images.current;
    if (tool === 'move' || !cut || !loaded || e.buttons === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvasW;
    const y = ((e.clientY - rect.top) / rect.height) * canvasH;
    const ctx = cut.getContext('2d')!;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.clearRect(0, 0, canvasW, canvasH);
    if (tool === 'restore') drawNudged(ctx, loaded.source);
    ctx.restore();
    splitRef.current = null; // 直している最中は分けない。指を離したら作り直す
    setTouched(true);
    paint();
  };

  const sameName = doll.items.find((i) => i.name === name.trim() && i.category === category);
  const save = async (replaceId?: string) => {
    const cut = cutRef.current;
    if (!cut) return;
    if (sameName && !replaceId && !conflict) {
      setConflict(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const blob = await new Promise<Blob | null>((resolve) => cut.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('画像を作れませんでした');
      const hideBlob = hasHide && hideRef.current ? await new Promise<Blob | null>((resolve) => hideRef.current!.toBlob(resolve, 'image/png')) : null;
      // 髪: AI が描いた体と髪の形も送る（後ろ髪の穴を、画面と同じように埋めるため）
      let shape: string | undefined;
      if (isHair && images.current?.shape) {
        const c = document.createElement('canvas');
        c.width = canvasW;
        c.height = canvasH;
        drawNudged(c.getContext('2d')!, images.current.shape);
        const shapeBlob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/png'));
        if (shapeBlob) shape = await blobToBase64(shapeBlob);
      }
      await api.addItem({ dollId: doll.id, category, name: name.trim(), png: await blobToBase64(blob), replaceId, hide: hideBlob ? await blobToBase64(hideBlob) : undefined, shape });
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const blocked = !ready || saving || !name.trim() || !category || (problems.length > 0 && !confirmed);
  return (
    <div className="card" data-testid="item-card" tabIndex={0} onKeyDown={onKeyDown}>
      <div className="card-view">
        <div className="card-stage">
          <canvas
            ref={viewRef}
            width={canvasW}
            height={canvasH}
            data-testid="card-canvas"
            className={tool === 'move' ? 'moving' : 'brushing'}
            onPointerDown={(e) => {
              if (tool === 'move') {
                startDrag(e, 'move');
                return;
              }
              e.currentTarget.setPointerCapture(e.pointerId);
              stroke(e);
            }}
            onPointerMove={(e) => (tool === 'move' ? moveDrag(e) : stroke(e))}
            onPointerUp={() => {
              if (tool === 'move') {
                endDrag();
                return;
              }
              if (!isHair) return;
              refreshSplit();
              paint();
            }}
            onPointerCancel={endDrag}
          />
          {/* 調整の枠: 絵をつかんで動かす。右下のつまみで大きさ、右上で元に戻す */}
          {tool === 'move' && view !== 'source' && framed && (
            <div
              className="card-frame"
              data-testid="card-frame"
              style={{ left: `${(framed.x / canvasW) * 100}%`, top: `${(framed.y / canvasH) * 100}%`, width: `${(framed.w / canvasW) * 100}%`, height: `${(framed.h / canvasH) * 100}%` }}
            >
              <button className="card-frame-handle reset" title="位置と大きさをもどす" aria-label="位置と大きさをもどす" onClick={() => setNudge({ scale: 1, dx: 0, dy: 0 })} data-testid="card-frame-reset">
                ↺
              </button>
              <div
                className="card-frame-handle scale"
                title="ひっぱって大きさを変える"
                aria-label="大きさ"
                data-testid="card-frame-scale"
                onPointerDown={(e) => {
                  e.preventDefault();
                  startDrag(e, 'scale');
                }}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                ⤡
              </div>
            </div>
          )}
        </div>
        <div className="row small">
          {(['worn', 'cut', 'source'] as View[]).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {v === 'worn' ? 'ドールに着せる' : v === 'cut' ? '服だけ' : '元の画像'}
            </button>
          ))}
        </div>
      </div>
      <div className="card-side">
        {problems.length > 0 && (
          <div className="warnings" data-testid="card-warnings">
            {problems.map((p, i) => (
              <p key={i}>⚠ {p}</p>
            ))}
            <label>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} data-testid="card-confirm" /> 内容を確かめました
            </label>
          </div>
        )}
        <label>
          カテゴリ
          <select value={category} onChange={(e) => { setCategory(e.target.value); setLimbs(defaultLimbs(labelOf(e.target.value))); setConflict(false); }} data-testid="card-category">
            {doll.categories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label>
          なまえ
          <input value={name} onChange={(e) => { setName(e.target.value); setConflict(false); }} data-testid="card-name" />
        </label>
        <div className="group">
          <span>位置と大きさ（絵をつかんで動かす。枠の右下のつまみで大きさ。矢印キーでも動く。Shift で 10px）</span>
          <div className="row small">
            <button onClick={() => move(-1, 0)}>←</button>
            <button onClick={() => move(1, 0)}>→</button>
            <button onClick={() => move(0, -1)}>↑</button>
            <button onClick={() => move(0, 1)}>↓</button>
            <button onClick={() => move(0, 0, 1.005)}>大きく</button>
            <button onClick={() => move(0, 0, 1 / 1.005)}>小さく</button>
            <button onClick={() => setNudge({ scale: 1, dx: 0, dy: 0 })}>戻す</button>
          </div>
          <span className="hint" data-testid="card-nudge">
            ずれ ({nudge.dx}, {nudge.dy})・倍率 {(nudge.scale * 100).toFixed(1)}%
          </span>
        </div>
        {source.shapeUrl && (
          <div className="group" data-testid="card-limbs">
            <span>手足の先を服に合わせる（服からはみ出したドールの指先などを、着ているあいだ隠す）</span>
            <div className="row small">
              {(['hands', 'feet'] as Limb[]).map((l) => (
                <label key={l}>
                  <input
                    type="checkbox"
                    checked={limbs.includes(l)}
                    onChange={(e) => setLimbs((list) => (e.target.checked ? [...list, l] : list.filter((x) => x !== l)))}
                    data-testid={`limb-${l}`}
                  />
                  {l === 'hands' ? '手の先' : '足の先'}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="group">
          <span>手直し</span>
          <div className="row small">
            <button className={tool === 'move' ? 'on' : ''} onClick={() => setTool('move')}>なし</button>
            <button className={tool === 'erase' ? 'on' : ''} onClick={() => setTool('erase')} data-testid="tool-erase">消しゴム</button>
            <button className={tool === 'restore' ? 'on' : ''} onClick={() => setTool('restore')}>復元</button>
            {BRUSHES.map((b, i) => (
              <button key={b} className={brush === b ? 'on' : ''} onClick={() => setBrush(b)}>{['細', '中', '太'][i]}</button>
            ))}
          </div>
          {touched && <span className="hint">位置や倍率を変えると、手直しは消えます</span>}
        </div>
        {error && <p className="error">{error}</p>}
        {conflict && sameName ? (
          <div className="warnings" data-testid="card-conflict">
            <p>「{name.trim()}」はすでにあります。</p>
            <div className="row">
              <button onClick={() => save()} disabled={blocked}>別の服として追加</button>
              <button onClick={() => save(sameName.id)} disabled={blocked}>置き換える</button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button className="primary" onClick={() => save()} disabled={blocked} data-testid="card-save">
              {saving ? '保存中…' : '保存'}
            </button>
            {onRedo && <button onClick={onRedo} disabled={saving}>作り直す</button>}
            <button onClick={onDiscard} disabled={saving}>捨てる</button>
          </div>
        )}
      </div>
    </div>
  );
}
