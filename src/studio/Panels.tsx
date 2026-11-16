/**
 * スタジオの各タブ
 */
import { useEffect, useRef, useState } from 'react';
import type { Box, Manifest, ManifestDoll } from '../content/manifest';
import { ApiError, api, contentUrl } from './api';
import type { Job, PlannedItem, Status, TemplateData } from './api';
import { ItemCard } from './ItemCard';
import type { CardSource } from './ItemCard';

const message = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : String(e));
const stem = (file: string) => file.replace(/\.[^.]+$/, '').replace(/[\\/]/g, '').slice(0, 40);

interface Common {
  doll: ManifestDoll;
  onChanged: () => void | Promise<void>;
}

/* ---------- 服を追加（手持ちの画像） ---------- */

export function AddItems({ doll, onChanged }: Common) {
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
          { key, name: stem(file.name), category: '', cutUrl: `data:image/png;base64,${r.png}`, sourceUrl: `data:image/png;base64,${r.source}`, warnings: r.warnings, notes: [] },
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

export function Generate({ doll, status, onChanged }: Common & { status: Status }) {
  const [theme, setTheme] = useState('');
  const [count, setCount] = useState(6);
  const [categories, setCategories] = useState<string[]>([]);
  const [plan, setPlan] = useState<PlannedItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const available = status.ai.text && status.ai.image;

  const makePlan = async () => {
    setBusy(true);
    setError(null);
    try {
      setPlan((await api.plan({ dollId: doll.id, theme, count, categories })).items);
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  };
  const start = async (items: PlannedItem[]) => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.startJob(doll.id, items);
      setJobIds((list) => [id, ...list]);
      setPlan(null);
      void onChanged();
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  };
  const edit = (index: number, change: Partial<PlannedItem>) => setPlan((list) => list!.map((item, i) => (i === index ? { ...item, ...change } : item)));

  return (
    <section>
      {!available && (
        <p className="error" data-testid="generate-unavailable">
          自動生成を使うには、スタジオのサーバーを起動する PC の環境変数に ANTHROPIC_API_KEY（Claude）と GEMINI_API_KEY（Gemini）を設定してください。キーは画面には入力しません。
        </p>
      )}
      <div className="form">
        <label>
          テーマ
          <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例: うみのおひめさま" data-testid="theme" />
        </label>
        <label>
          品目数
          <input type="number" min={1} max={status.budget.perRun / status.budget.maxAttempts} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <div className="checks">
          カテゴリ（選ばなければ全部）:
          {doll.categories.map((c) => (
            <label key={c.id}>
              <input type="checkbox" checked={categories.includes(c.id)} onChange={(e) => setCategories((list) => (e.target.checked ? [...list, c.id] : list.filter((x) => x !== c.id)))} />
              {c.label}
            </label>
          ))}
        </div>
        <button className="primary" onClick={() => void makePlan()} disabled={busy || !available || !theme.trim()}>
          {busy && !plan ? '考え中…' : '品目の案を作る'}
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {plan && (
        <div className="plan" data-testid="plan">
          <h3>品目の案（直せます）</h3>
          {plan.map((item, i) => (
            <div key={i} className="plan-row">
              <select value={item.category} onChange={(e) => edit(i, { category: e.target.value })}>
                {doll.categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
              <input value={item.name} onChange={(e) => edit(i, { name: e.target.value })} />
              <textarea value={item.description} onChange={(e) => edit(i, { description: e.target.value })} rows={2} />
              <span className="swatches">
                {item.colors.map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
              <button onClick={() => setPlan((list) => list!.filter((_, k) => k !== i))}>外す</button>
            </div>
          ))}
          <p>
            画像生成は最大 <b>{plan.length * status.budget.maxAttempts}</b> 枚（{plan.length} 点 × 作り直しを含めて {status.budget.maxAttempts} 回まで）。今日は {status.budget.usedToday} / {status.budget.perDay} 枚を使用済み。
          </p>
          <button className="primary" onClick={() => void start(plan)} disabled={busy || plan.length === 0}>この内容で作る</button>
        </div>
      )}
      {jobIds.map((id) => (
        <JobCards key={id} id={id} doll={doll} onChanged={onChanged} onRedo={(item) => void start([item])} />
      ))}
    </section>
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
            <p key={i} className={c.status === 'failed' ? 'error' : ''}>
              {c.item.name}: {STATUS_LABEL[c.status]} {c.notes.join(' / ')}
              {c.status === 'failed' && <button onClick={() => { hide(i); onRedo(c.item as PlannedItem); }}>作り直す</button>}
            </p>
          );
        }
        return (
          <ItemCard
            key={i}
            doll={doll}
            source={{ key: `${id}-${i}`, name: c.item.name, category: c.item.category ?? '', cutUrl: api.jobImageUrl(id, i), sourceUrl: api.jobImageUrl(id, i, 'source'), warnings: c.warnings, notes: c.notes }}
            onDiscard={() => hide(i)}
            onSaved={() => { hide(i); void onChanged(); }}
            onRedo={() => { hide(i); onRedo(c.item as PlannedItem); }}
          />
        );
      })}
    </div>
  );
}

/* ---------- 背景 ---------- */

export function Backgrounds({ doll, manifest, status, onChanged }: Common & { manifest: Manifest; status: Status }) {
  const [shared, setShared] = useState(false);
  const [theme, setTheme] = useState('');
  const [count, setCount] = useState(3);
  const [jobId, setJobId] = useState<string | null>(null);
  const [adopted, setAdopted] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const job = useJob(jobId);
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
      <div className="form">
        <label>
          テーマから作る
          <input value={theme} onChange={(e) => setTheme(e.target.value)} placeholder="例: うみのなかのおしろ" />
        </label>
        <label>
          枚数
          <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
        <button
          onClick={() => void guard(async () => { setAdopted([]); setJobId((await api.startBackgroundJob({ dollId: doll.id, theme, count })).id); })}
          disabled={busy || !theme.trim() || !(status.ai.text && status.ai.image)}
        >
          作る（最大 {count} 枚）
        </button>
      </div>
      {error && <p className="error">{error}</p>}
      {job && (
        <div className="thumbs">
          {job.candidates.map((c, i) =>
            adopted.includes(i) ? null : (
              <figure key={i}>
                {c.hasImage ? <img src={api.jobImageUrl(job.id, i)} alt={c.item.name} /> : <div className="placeholder">{STATUS_LABEL[c.status]}</div>}
                <figcaption>{c.item.name} {c.notes.join(' / ')}</figcaption>
                {c.hasImage && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void guard(async () => {
                        const blob = await (await fetch(api.jobImageUrl(job.id, i))).blob();
                        await api.addBackground(owner, c.item.name, blob);
                        setAdopted((a) => [...a, i]);
                      })
                    }
                  >
                    採用
                  </button>
                )}
              </figure>
            ),
          )}
        </div>
      )}
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
        const set = (change: Partial<typeof c>) => void guard(() => api.saveCategory(doll.id, { ...c, ...change }));
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
  const [color, setColor] = useState('#00ff00');
  const [bg, setBg] = useState('#ffffff');
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
      <div className="form">
        <b>ドールを追加</b>
        <label>
          なまえ
          <input value={name} onChange={(e) => setName(e.target.value)} data-testid="doll-name" />
        </label>
        <label>
          背景が透明な画像（PNG・WebP）
          <input type="file" accept="image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="doll-file" />
        </label>
        <button className="primary" onClick={() => void add()} disabled={!name.trim() || !file} data-testid="doll-add">追加して型紙を作る</button>
      </div>
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
            <h3>型紙: {doll.name}</h3>
            <p className="hint">輪郭から自動で推定しました。ずれていれば直して保存してください（x, y, 幅, 高さ）。</p>
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
            <h4>絵柄</h4>
            <label>
              絵柄の説明（自動生成のたびに AI に渡す）
              <textarea rows={3} value={template.style} onChange={(e) => change({ ...template, style: e.target.value })} placeholder="例: アニメ調。はっきりした黒い線、やわらかい影、明るい色" data-testid="template-style" />
            </label>
            <label>
              絵柄の見本にする服（3 点まで）
              <select multiple size={5} value={template.styleRefs} onChange={(e) => change({ ...template, styleRefs: [...e.target.selectedOptions].map((o) => o.value).slice(0, 3) })}>
                {doll.items.map((i) => (
                  <option key={i.id} value={i.id}>{i.category} / {i.name}</option>
                ))}
              </select>
            </label>
            <div className="row">
              <button className="primary" data-testid="template-save" onClick={() => void api.saveTemplate(doll.id, template).then((t) => { setTemplate(t); setSaved(true); void onChanged(); }, (e) => setError(message(e)))}>
                型紙を保存
              </button>
              {saved && <span data-testid="template-saved">保存しました</span>}
            </div>
            <h4>AI に渡す基準画像（手で生成するとき用）</h4>
            <div className="row">
              <label>シルエット <input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
              <label>背景 <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} /></label>
              <a className="button" href={api.silhouetteUrl(doll.id, color, bg)} download={`${doll.name}-シルエット.png`} data-testid="silhouette-link">ダウンロード</a>
            </div>
            <p className="hint">服に使う色から遠い色を選んでください（緑の服ならマゼンタ）。黒は暗い服の影と区別できないので避けます。自動生成では、品目ごとに自動で選びます。</p>
          </div>
        </div>
      )}
    </section>
  );
}
