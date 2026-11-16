/**
 * 服の候補 1 点のカード: ドールに着せたプレビュー、微調整、手直し、カテゴリと名前、保存
 * 手で入れた画像にも、自動生成の候補にも使う。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ManifestDoll } from '../content/manifest';
import { ApiError, api, blobToBase64, contentUrl } from './api';
import type { Warning } from './api';

export interface CardSource {
  key: string;
  name: string;
  category: string;
  cutUrl: string; // 切り抜いた服（ドールのキャンバス大の PNG）
  sourceUrl: string; // 切り抜く前（同じ位置合わせ）
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
  const { canvasW, canvasH, box } = doll.image;
  const viewRef = useRef<HTMLCanvasElement>(null);
  const cutRef = useRef<HTMLCanvasElement | null>(null); // 編集中の服
  const images = useRef<{ doll: HTMLImageElement; cut: HTMLImageElement; source: HTMLImageElement } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(source.name);
  const [category, setCategory] = useState(source.category || doll.categories[0]?.id || '');
  const [nudge, setNudge] = useState({ scale: 1, dx: 0, dy: 0 });
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
    if (view === 'worn') ctx.drawImage(loaded.doll, box.x, box.y, box.w, box.h);
    ctx.drawImage(cut, 0, 0);
  }, [view, drawNudged, canvasW, canvasH, box]);

  // 画像を読む
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadImage(contentUrl(doll.image.file)), loadImage(source.cutUrl), loadImage(source.sourceUrl)])
      .then(([d, c, s]) => {
        if (cancelled) return;
        images.current = { doll: d, cut: c, source: s };
        const canvas = document.createElement('canvas');
        canvas.width = canvasW;
        canvas.height = canvasH;
        cutRef.current = canvas;
        setReady(true);
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [doll.image.file, source.cutUrl, source.sourceUrl, canvasW, canvasH]);

  // 微調整が変わったら、元の切り抜きから作り直す（手直しは消える）
  useEffect(() => {
    const cut = cutRef.current;
    if (!ready || !cut || !images.current) return;
    const ctx = cut.getContext('2d')!;
    ctx.clearRect(0, 0, canvasW, canvasH);
    drawNudged(ctx, images.current.cut);
    setTouched(false);
  }, [ready, drawNudged, canvasW, canvasH]);

  useEffect(paint, [paint, ready, nudge]);

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
      await api.addItem({ dollId: doll.id, category, name: name.trim(), png: await blobToBase64(blob), replaceId });
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
        <canvas
          ref={viewRef}
          width={canvasW}
          height={canvasH}
          data-testid="card-canvas"
          className={tool === 'move' ? '' : 'brushing'}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            stroke(e);
          }}
          onPointerMove={stroke}
        />
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
          <select value={category} onChange={(e) => { setCategory(e.target.value); setConflict(false); }} data-testid="card-category">
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
          <span>位置の微調整（矢印キーでも動く。Shift で 10px）</span>
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
