/**
 * スタジオの各タブ
 */
import { isHairCategory } from '../pipeline/hairSplit';
import { useEffect, useRef, useState } from 'react';
import type { Box, Manifest, ManifestDoll } from '../content/manifest';
import { ApiError, api, contentUrl } from './api';
import type { Job, PlannedItem, Status, TemplateData } from './api';
import { ItemCard } from './ItemCard';
import { forgetParts } from './partsCache';
import { STYLE_PRESETS, findStyle } from './stylePresets';
import type { CardSource } from './ItemCard';

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));
const stem = (file: string) => file.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '').slice(0, 40);

interface Common {
  doll: ManifestDoll;
  onChanged: () => void | Promise<void>;
}

/* ---------- 服を追加（手持ちの画像） ---------- */

export function AddItems({ doll, onChanged }: Common) {
  const [color, setColor] = useState('#00ff00');
  const [bg, setBg] = useState('#ffffff');
  const [cards, setCards] = useState<CardSource[]>([]);
  const [busy, setBusy] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const counter = useRef(0);

  const addFiles = async (files: File[]) => {
    setErrors([]);
    for (const file of files) {
      setBusy((n) => n + 1);
      try {
        const r = await api.process(doll.id, file);
        const key = `file-${counter.current++}`;
        setCards((list) => [
          ...list,
          {
            key,
            name: stem(file.name),
            category: '',
            cutUrl: `data:image/png;base64,${r.png}`,
            sourceUrl: `data:image/png;base64,${r.source}`,
            shapeUrl: r.shape ? `data:image/png;base64,${r.shape}` : null,
            warnings: r.warnings,
            notes: [],
          },
        ]);
      } catch (e) {
        setErrors((list) => [...list, `${file.name}: ${message(e)}`]);
      }
      setBusy((n) => n - 1);
    }
  };
  const remove = (key: string) => setCards((list) => list.filter((c) => c.key !== key));

  return (
    <section>
      <p>
        AI が作った画像（ドールが単色のシルエット、背景も単色）を選ぶと、切り抜きと位置合わせを自動で行います。切り抜き済みの透過画像も、そのまま入れられます。
      </p>
      <label
        className="drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles([...e.dataTransfer.files]);
        }}
      >
        画像を選ぶ（複数可。ここにドロップもできます）
        <input type="file" accept="image/*" multiple data-testid="add-files" onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </label>
      <details>
        <summary>AI に渡す基準画像（ほかの AI で手作業で作るとき用）</summary>
        <div className="row">
          <label>シルエット <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
          <label>背景 <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></label>
          <a className="button" href={api.silhouetteUrl(doll.id, color, bg)} download={`${doll.name}-シルエット.png`} data-testid="silhouette-link">ダウンロード</a>
        </div>
        <p className="hint">服に使う色から遠い色を選んでください（緑の服ならマゼンタ）。黒は暗い服の影と区別できないので避けます。「テーマから作る」では、品目ごとに自動で選びます。</p>
      </details>
      {busy > 0 && <p data-testid="add-busy">処理中…（残り {busy} 枚）</p>}
      {errors.map((e, i) => (
        <p key={i} className="error">{e}</p>
      ))}
      {cards.map((card) => (
        <ItemCard key={card.key} doll={doll} source={card} onDiscard={() => remove(card.key)} onSaved={() => { remove(card.key); void onChanged(); }} />
      ))}
    </section>
  );
}

/* ---------- 生成の進み具合を見る ---------- */

function useJob(id: string | null): Job | null {
  const [job, setJob] = useState<Job | null>(null);
  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = async () => {
      try {
        const j = await api.job(id);
        if (stop) return;
        setJob(j);
        if (!j.done) setTimeout(() => void tick(), 1500);
      } catch {
        if (!stop) setTimeout(() => void tick(), 4000);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id]);
  return id && job?.id === id ? job : null;
}

const STATUS_LABEL = { waiting: '待ち', working: '作成中…', passed: '合格', flagged: '注意あり', failed: '失敗' } as const;

/* ---------- テーマから作る ---------- */

const BACKGROUND = '__background'; // 「作るもの」で背景を選んだとき
const remember = {
  get: (key: string): string | null => {
    try {
      return localStorage.getItem(`studio.${key}`);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(`studio.${key}`, value);
    } catch {
      // 保存できなくても動く
    }
  },
};

interface StartedJob {
  id: string;
  kind: 'items' | 'backgrounds';
  styleId: string;
  owner: string | null; // 背景を採用したときの持ち主（null = 全部のドールで使う）
}

export function Generate({ doll, status, onChanged }: Common & { status: Status }) {
  const categories = [...doll.categories].sort((a, b) => a.menuOrder - b.menuOrder);
  const [theme, setTheme] = useState('');
  const [styleId, setStyleId] = useState(() => findStyle(remember.get('style')).id);
  const [target, setTarget] = useState(() => {
    const saved = remember.get(`target.${doll.id}`);
    return saved && (saved === BACKGROUND || doll.categories.some((c) => c.id === saved)) ? saved : (categories[0]?.id ?? BACKGROUND);
  });
  const [count, setCount] = useState(1);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<StartedJob[]>([]);
  const available = status.ai.text && status.ai.image;
  const isBackground = target === BACKGROUND;
  const most = isBackground ? Math.min(10, status.budget.perRun) : Math.max(1, Math.floor(status.budget.perRun / status.budget.maxAttempts));
  const maxImages = isBackground ? count * 2 : count * status.budget.maxAttempts;

  const chooseStyle = (id: string) => {
    setStyleId(id);
    remember.set('style', id);
  };
  const chooseTarget = (id: string) => {
    setTarget(id);
    remember.set(`target.${doll.id}`, id);
  };
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  };
  const startItems = async (items: PlannedItem[], style: string) => {
    const { id } = await api.startJob(doll.id, items, style);
    setJobs((list) => [{ id, kind: 'items', styleId: style, owner: doll.id }, ...list]);
    void onChanged();
  };
  const make = () =>
    guard(async () => {
      if (isBackground) {
        const { id } = await api.startBackgroundJob({ dollId: doll.id, theme, count, styleId });
        setJobs((list) => [{ id, kind: 'backgrounds', styleId, owner: shared ? null : doll.id }, ...list]);
        void onChanged();
        return;
      }
      const { items } = await api.plan({ dollId: doll.id, theme, count, categories: [target], styleId });
      await startItems(items, styleId);
    });

  return (
    <section>
      {!available && (
        <p className="error" data-testid="generate-unavailable">
          自動生成を使うには、スタジオのサーバーを起動する PC の環境変数に ANTHROPIC_API_KEY（Claude）と GEMINI_API_KEY（Gemini）を設定してください。キーは画面には入力しません。
        </p>
      )}
      <div className="form generate-form">
        <label>
          テーマ
          <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例: うみのおひめさま" data-testid="theme" />
        </label>
        <div className="chips" role="radiogroup" aria-label="絵柄">
          <span className="chips-label">絵柄</span>
          {STYLE_PRESETS.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={styleId === s.id} className={styleId === s.id ? 'chip on' : 'chip'} onClick={() => chooseStyle(s.id)} data-testid={`style-${s.id}`}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="chips" role="radiogroup" aria-label="作るもの">
          <span className="chips-label">作るもの</span>
          {categories.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={target === c.id} className={target === c.id ? 'chip on' : 'chip'} onClick={() => chooseTarget(c.id)} data-testid={`target-${c.id}`}>
              {c.label}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={isBackground} className={isBackground ? 'chip on' : 'chip'} onClick={() => chooseTarget(BACKGROUND)} data-testid="target-background">
            背景
          </button>
        </div>
        {isBackground && (
          <label>
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> 全部のドールで使う背景にする（外すと「{doll.name}」専用）
          </label>
        )}
        <div className="row">
          <label>
            枚数
            <input type="number" min={1} max={most} value={count} onChange={(e) => setCount(Math.max(1, Math.min(most, Math.floor(Number(e.target.value)) || 1)))} data-testid="count" />
          </label>
          <button className="primary" onClick={() => void make()} disabled={busy || !available || !theme.trim()} data-testid="make">
            {busy ? '準備中…' : '作る'}
          </button>
          <span className="hint">
            {!isBackground && status.budget.maxAttempts > 1 && `できた絵を検品し、不合格なら直し方を伝えて自動で作り直します（${status.budget.maxAttempts - 1} 回まで）。`}
            画像の生成は最大 {maxImages} 枚（作り直し・書き直しを含む）。今日は {status.budget.usedToday} / {status.budget.perDay} 枚を使用済み。
          </span>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {jobs.map((job) =>
        job.kind === 'items' ? (
          <JobCards key={job.id} id={job.id} doll={doll} onChanged={onChanged} onRedo={(item) => void guard(() => startItems([item], job.styleId))} />
        ) : (
          <BackgroundJob key={job.id} id={job.id} owner={job.owner} onChanged={onChanged} />
        ),
      )}
    </section>
  );
}

// AI に渡した説明文（英語）。うまくいかないときの手がかりに
function Instruction({ text }: { text: string }) {
  return (
    <details className="instruction">
      <summary>AI への指示</summary>
      {text}
    </details>
  );
}

function JobCards({ id, doll, onChanged, onRedo }: Common & { id: string; onRedo: (item: PlannedItem) => void }) {
  const job = useJob(id);
  const [hidden, setHidden] = useState<number[]>([]);
  if (!job) return <p>準備中…</p>;
  const hide = (i: number) => setHidden((list) => [...list, i]);
  return (
    <div className="job" data-testid="job">
      <h3>
        {job.done ? 'できた候補' : '作成中…'}（{job.candidates.filter((c) => c.status === 'passed' || c.status === 'flagged').length} / {job.candidates.length}）
      </h3>
      {job.candidates.map((c, i) => {
        if (hidden.includes(i)) return null;
        if (!c.hasImage || c.status === 'working' || c.status === 'waiting') {
          return (
            <div key={i}>
              <p className={c.status === 'failed' ? 'error' : ''}>
                {c.item.name}: {STATUS_LABEL[c.status]} {c.notes.join(' / ')}
                {c.status === 'failed' && <button onClick={() => { hide(i); onRedo(c.item as PlannedItem); }}>作り直す</button>}
              </p>
              <Instruction text={c.item.description} />
            </div>
          );
        }
        return (
          <div key={`${i}-${c.attempts}`}>
            <ItemCard
              doll={doll}
              source={{ key: `${id}-${i}`, name: c.item.name, category: c.item.category ?? '', cutUrl: api.jobImageUrl(id, i, 'png', c.attempts), sourceUrl: api.jobImageUrl(id, i, 'source', c.attempts), shapeUrl: c.hasShape ? api.jobImageUrl(id, i, 'shape', c.attempts) : null, warnings: c.warnings, notes: c.notes }}
              onDiscard={() => hide(i)}
              onSaved={() => { hide(i); void onChanged(); }}
              onRedo={() => { hide(i); onRedo(c.item as PlannedItem); }}
            />
            <Instruction text={c.item.description} />
          </div>
        );
      })}
    </div>
  );
}

function BackgroundJob({ id, owner, onChanged }: { id: string; owner: string | null; onChanged: () => void | Promise<void> }) {
  const job = useJob(id);
  const [adopted, setAdopted] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!job) return <p>準備中…</p>;
  const adopt = async (i: number, name: string) => {
    setBusy(true);
    setError(null);
    try {
      const blob = await (await fetch(api.jobImageUrl(job.id, i))).blob();
      await api.addBackground(owner, name, blob);
      setAdopted((a) => [...a, i]);
      await onChanged();
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  };
  return (
    <div className="job" data-testid="background-job">
      <h3>{job.done ? '背景の候補' : '背景を作成中…'}</h3>
      {error && <p className="error">{error}</p>}
      <div className="thumbs">
        {job.candidates.map((c, i) =>
          adopted.includes(i) ? null : (
            <figure key={i}>
              {c.hasImage ? <img src={api.jobImageUrl(job.id, i, 'png', c.attempts)} alt={c.item.name} /> : <div className="placeholder">{STATUS_LABEL[c.status]}</div>}
              <figcaption>{c.item.name} {c.notes.join(' / ')}</figcaption>
              <Instruction text={c.item.description} />
              {c.hasImage && (
                <button disabled={busy} onClick={() => void adopt(i, c.item.name)}>
                  採用
                </button>
              )}
            </figure>
          ),
        )}
      </div>
    </div>
  );
}

/* ---------- 背景 ---------- */

export function Backgrounds({ doll, manifest, onChanged }: Common & { manifest: Manifest }) {
  const [shared, setShared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const owner = shared ? null : doll.id;
  const guard = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  };
  const list = [...doll.backgrounds.map((b) => ({ ...b, own: true })), ...manifest.backgrounds.map((b) => ({ ...b, own: false }))];

  return (
    <section>
      <p className="hint">AI で背景を作るときは「テーマから作る」で「背景」を選びます。ここでは手持ちの画像の追加と、背景の整理ができます。</p>
      <label>
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> 全部のドールで使う背景として追加する（外すと「{doll.name}」専用）
      </label>
      <label className="drop">
        背景の画像を選ぶ（複数可）
        <input
          type="file"
          accept="image/*"
          multiple
          data-testid="bg-files"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            void guard(async () => {
              for (const f of files) await api.addBackground(owner, stem(f.name), f);
            });
          }}
        />
      </label>
      {error && <p className="error">{error}</p>}
      <h3>いまの背景（{list.length} 枚）</h3>
      <div className="thumbs" data-testid="bg-list">
        {list.map((b) => (
          <figure key={b.id}>
            <img src={contentUrl(b.thumb)} alt={b.name} loading="lazy" />
            <figcaption>{b.name}{b.own ? '' : '（共通）'}</figcaption>
            <button disabled={busy} onClick={() => confirm(`背景「${b.name}」を消しますか？`) && void guard(() => api.deleteBackground(b.id))}>消す</button>
          </figure>
        ))}
      </div>
    </section>
  );
}

/* ---------- 一覧（服とカテゴリの管理） ---------- */

export function Library({ doll, onChanged }: Common) {
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(message(e));
    }
  };
  const categories = [...doll.categories].sort((a, b) => a.menuOrder - b.menuOrder);
  return (
    <section>
      {error && <p className="error">{error}</p>}
      <p className="hint">「重ね順」は大きいほど手前。「並び順」はメニューでの順番（小さいほど先）。</p>
      {categories.map((c) => {
        const items = doll.items.filter((i) => i.category === c.id);
        // 変えた項目だけを送る（続けて別の項目を変えても、前の変更が戻らない）
        const set = (change: Partial<Omit<typeof c, 'id'>>) => void guard(() => api.updateCategory(doll.id, c.id, change));
        return (
          <div key={c.id} className="category" data-testid={`category-${c.id}`}>
            <div className="row">
              <b>{c.label}</b>
              <span>{items.length} 点</span>
              <label>重ね順 <input type="number" defaultValue={c.layer} onBlur={(e) => Number(e.target.value) !== c.layer && set({ layer: Number(e.target.value) })} /></label>
              <label>並び順 <input type="number" defaultValue={c.menuOrder} onBlur={(e) => Number(e.target.value) !== c.menuOrder && set({ menuOrder: Number(e.target.value) })} /></label>
              <label><input type="checkbox" checked={c.overlap} onChange={(e) => set({ overlap: e.target.checked })} /> 重ね着できる</label>
              <label><input type="checkbox" checked={c.movable} onChange={(e) => set({ movable: e.target.checked })} /> 自由配置</label>
              {items.length === 0 && <button onClick={() => void guard(() => api.deleteCategory(doll.id, c.id))}>カテゴリを消す</button>}
            </div>
            <div className="thumbs">
              {items.map((item) => (
                <figure key={item.id} data-testid="library-item">
                  <img src={contentUrl(item.thumb)} alt={item.name} loading="lazy" />
                  <input defaultValue={item.name} aria-label="なまえ" onBlur={(e) => e.target.value.trim() && e.target.value !== item.name && void guard(() => api.updateItem({ id: item.id, name: e.target.value.trim() }))} />
                  <select value={item.category} aria-label="カテゴリ" onChange={(e) => void guard(() => api.updateItem({ id: item.id, category: e.target.value }))}>
                    {doll.categories.map((x) => (
                      <option key={x.id} value={x.id}>{x.label}</option>
                    ))}
                  </select>
                  {isHairCategory(c.label) && !item.back && (
                    <button title="後ろ髪をドールの下に描くようにする（ドールの輪郭線が髪で削られなくなる）" onClick={() => void guard(() => api.splitHair(item.id))} data-testid="split-hair">前髪と後ろ髪に分ける</button>
                  )}
                  {item.back && <span className="hint">前髪・後ろ髪</span>}
                  <button onClick={() => confirm(`「${item.name}」を消しますか？`) && void guard(() => api.deleteItem(item.id))}>消す</button>
                </figure>
              ))}
            </div>
          </div>
        );
      })}
      <div className="form">
        <label>
          新しいカテゴリ
          <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="例: かばん" />
        </label>
        <button
          disabled={!newLabel.trim()}
          onClick={() =>
            void guard(async () => {
              await api.saveCategory(doll.id, { label: newLabel.trim(), layer: 11, menuOrder: Math.max(0, ...doll.categories.map((c) => c.menuOrder)) + 1, overlap: false, movable: false });
              setNewLabel('');
            })
          }
        >
          追加
        </button>
      </div>
    </section>
  );
}

/* ---------- ドールと型紙 ---------- */

const PART_LABELS: Record<string, string> = {
  head: 'あたま', torso: 'むね・おなか', hips: 'こし', legs: 'あし', feet: 'あしさき',
  armLeft: 'うで（左）', armRight: 'うで（右）', handLeft: 'て（左）', handRight: 'て（右）',
};

function BoxInputs({ box, onChange }: { box: Box; onChange: (b: Box) => void }) {
  return (
    <span className="box-inputs">
      {(['x', 'y', 'w', 'h'] as const).map((k) => (
        <input key={k} type="number" aria-label={k} value={box[k]} onChange={(e) => onChange({ ...box, [k]: Number(e.target.value) })} />
      ))}
    </span>
  );
}

export function DollPanel({ doll, onChanged, onAdded }: { doll: ManifestDoll | null; onChanged: () => void | Promise<void>; onAdded: (id: string) => void }) {
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ dollId: string; data: TemplateData } | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dollId = doll?.id;
  // 別のドールの型紙は見せない
  const template = loaded && loaded.dollId === dollId ? loaded.data : null;
  const setTemplate = (data: TemplateData) => dollId && setLoaded({ dollId, data });

  useEffect(() => {
    if (!dollId) return;
    let cancelled = false;
    api.template(dollId).then((data) => !cancelled && setLoaded({ dollId, data }), (e) => !cancelled && setError(message(e)));
    return () => {
      cancelled = true;
    };
  }, [dollId]);

  const add = async () => {
    if (!file) return;
    setError(null);
    try {
      const r = await api.addDoll(name.trim(), file);
      setName('');
      setFile(null);
      onAdded(r.doll.id);
    } catch (e) {
      setError(message(e));
    }
  };
  const change = (t: TemplateData) => {
    setTemplate(t);
    setSaved(false);
  };
  const boxes: [string, Box, string][] = template
    ? [
        ...Object.entries(template.parts).map(([k, b]): [string, Box, string] => [`part:${k}`, b, '#2a7de1']),
        ...Object.entries(template.regions).filter((e): e is [string, Box] => e[1] !== null).map(([k, b]): [string, Box, string] => [`region:${k}`, b, '#e1672a']),
      ]
    : [];

  return (
    <section>
      <details className="form" open={!doll}>
        <summary>ドールを追加</summary>
        <label>
          なまえ
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid="doll-name" />
        </label>
        <label>
          背景が透明な画像（PNG・WebP）
          <input type="file" accept="image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="doll-file" />
        </label>
        <button className="primary" onClick={() => void add()} disabled={!name.trim() || !file} data-testid="doll-add">追加して範囲を作る</button>
      </details>
      {error && <p className="error" data-testid="doll-error">{error}</p>}
      {doll && template && (
        <div className="template" data-testid="template">
          <div className="template-view">
            <svg viewBox={`0 0 ${doll.image.canvasW} ${doll.image.canvasH}`}>
              <image href={contentUrl(doll.image.file)} x={doll.image.box.x} y={doll.image.box.y} width={doll.image.box.w} height={doll.image.box.h} />
              {boxes.map(([key, b, stroke]) => (
                <rect key={key} x={b.x} y={b.y} width={b.w} height={b.h} fill={focus === key ? `${stroke}33` : 'none'} stroke={stroke} strokeWidth={focus === key ? 5 : 1.5} strokeDasharray={key.startsWith('region') ? '10 6' : undefined} />
              ))}
            </svg>
            <p className="hint">青 = 体の部位、だいだいの点線 = カテゴリごとの「あるはずの範囲」。数値はキャンバス（{doll.image.canvasW}px）での位置。</p>
          </div>
          <div className="template-side">
            <h3>範囲: {doll.name}</h3>
            <p className="hint">輪郭から自動で推定しました。ずれていれば直して保存してください（x, y, 幅, 高さ）。体の部位は、服を部位ごとにドールへ合わせるときにも使います。</p>
            <h4>体の部位</h4>
            {Object.entries(template.parts).map(([k, b]) => (
              <div key={k} className="row" onMouseEnter={() => setFocus(`part:${k}`)} onMouseLeave={() => setFocus(null)}>
                <span className="part-name">{PART_LABELS[k] ?? k}</span>
                <BoxInputs box={b} onChange={(nb) => change({ ...template, parts: { ...template.parts, [k]: nb } })} />
              </div>
            ))}
            <h4>カテゴリごとの範囲（自動生成の検品に使う）</h4>
            {doll.categories.map((c) => {
              const region = template.regions[c.id] ?? null;
              return (
                <div key={c.id} className="row" onMouseEnter={() => setFocus(`region:${c.id}`)} onMouseLeave={() => setFocus(null)}>
                  <span className="part-name">{c.label}</span>
                  {region ? <BoxInputs box={region} onChange={(nb) => change({ ...template, regions: { ...template.regions, [c.id]: nb } })} /> : <span className="hint">どこでもよい</span>}
                  <button onClick={() => change({ ...template, regions: { ...template.regions, [c.id]: region ? null : { x: 0, y: 0, w: doll.image.canvasW, h: doll.image.canvasH } } })}>
                    {region ? '範囲なしにする' : '範囲を決める'}
                  </button>
                </div>
              );
            })}
            <div className="row">
              <button className="primary" data-testid="template-save" onClick={() => void api.saveTemplate(doll.id, template).then((t) => { forgetParts(doll.id); setTemplate(t); setSaved(true); void onChanged(); }, (e) => setError(message(e)))}>
                範囲を保存
              </button>
              {saved && <span data-testid="template-saved">保存しました</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
