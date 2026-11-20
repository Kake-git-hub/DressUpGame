/**
 * スタジオの各タブ
 */
import { isBackHairCategory, isHairCategory } from '../pipeline/hairSplit';
import { useEffect, useRef, useState } from 'react';
import type { Box, Manifest, ManifestDoll } from '../content/manifest';
import { ApiError, api, contentUrl } from './api';
import type { Job, PlannedItem, SetRef, Status, TemplateData } from './api';
import { ItemCard } from './ItemCard';
import { ItemPlacer } from './ItemPlacer';
import { dropIndex, moveInList } from './order';
import { forgetParts } from './partsCache';
import { STYLE_PRESETS, findStyle } from './stylePresets';
import { useUnsaved } from './unsaved';
import type { CardSource, ItemCardHandle } from './ItemCard';

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
  useUnsaved(`add-${doll.id}`, cards.length + busy);

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
const SET = '__set'; // 「作るもの」でセット（同じテーマの複数パーツ）を選んだとき
// セットに最初から入れないカテゴリ（顔と、うしろがみ）
const isFaceLabel = (label: string) => /かお|顔|face|メイク|makeup/i.test(label);
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
  set?: SetRef; // セットとして作っている
  missing?: string[]; // セットの企画が返さなかったカテゴリ
}

export function Generate({ doll, status, onChanged }: Common & { status: Status }) {
  const categories = [...doll.categories].sort((a, b) => a.menuOrder - b.menuOrder);
  const [theme, setTheme] = useState('');
  const [styleId, setStyleId] = useState(() => findStyle(remember.get('style')).id);
  const [target, setTarget] = useState(() => {
    const saved = remember.get(`target.${doll.id}`);
    return saved && (saved === BACKGROUND || saved === SET || doll.categories.some((c) => c.id === saved)) ? saved : (categories[0]?.id ?? BACKGROUND);
  });
  // セットに入れるカテゴリ（ドールごとに覚える）。最初は、かお・うしろがみ以外の全部
  const [setCats, setSetCats] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(remember.get(`setCategories.${doll.id}`) ?? 'null') as unknown;
      if (Array.isArray(saved)) return saved.filter((id): id is string => typeof id === 'string' && doll.categories.some((c) => c.id === id));
    } catch {
      // 覚えていた内容が読めなければ、最初の選び方に戻す
    }
    return doll.categories.filter((c) => !isFaceLabel(c.label) && !isBackHairCategory(c.label)).map((c) => c.id);
  });
  const toggleSetCat = (id: string, on: boolean) => {
    const next = on ? [...setCats.filter((x) => x !== id), id] : setCats.filter((x) => x !== id);
    setSetCats(next);
    remember.set(`setCategories.${doll.id}`, JSON.stringify(next));
  };
  const [count, setCount] = useState(1);
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<StartedJob[]>([]);
  const available = status.ai.text && status.ai.image;
  const isBackground = target === BACKGROUND;
  const isSet = target === SET;
  const most = isBackground ? Math.min(10, status.budget.perRun) : Math.max(1, Math.floor(status.budget.perRun / status.budget.maxAttempts));
  // セットに入れるカテゴリのうち、いまもあるもの（覚えていたカテゴリが、あとで消されていることがある）
  const setChosen = categories.filter((c) => setCats.includes(c.id) && !isBackHairCategory(c.label)).map((c) => c.id);
  const maxImages = isBackground ? count * 2 : (isSet ? setChosen.length : count) * status.budget.maxAttempts;
  const setReady = setChosen.length >= 2 && setChosen.length <= most;

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
  const startItems = async (items: PlannedItem[], style: string, set?: SetRef, missing?: string[]) => {
    const { id } = await api.startJob(doll.id, items, style, set);
    setJobs((list) => [{ id, kind: 'items', styleId: style, owner: doll.id, set, missing }, ...list]);
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
      if (isSet) {
        // セット: 選んだカテゴリごとに 1 点を、そろえて企画する。画像は 1 点ずつ作る
        const planned = await api.planSet({ dollId: doll.id, theme, categories: setChosen, styleId });
        await startItems(planned.items, styleId, planned.set, planned.missing);
        return;
      }
      const { items } = await api.plan({ dollId: doll.id, theme, count, categories: [target], styleId });
      await startItems(items, styleId);
    });

  return (
    <section>
      {!available && (
        <p className="error" data-testid="generate-unavailable">
          自動生成を使うには、スタジオのサーバーを起動する PC の環境変数に GEMINI_API_KEY（Gemini）を設定してください（ANTHROPIC_API_KEY は無くても動きます。あれば、企画と検品に Claude を使います）。キーは画面には入力しません。
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
          <button type="button" role="radio" aria-checked={isSet} className={isSet ? 'chip on' : 'chip'} onClick={() => chooseTarget(SET)} data-testid="target-set" title="同じテーマで、選んだカテゴリごとに 1 点ずつ、そろえて作る">
            セット
          </button>
        </div>
        {isSet && (
          <div className="chips" data-testid="set-categories">
            <span className="chips-label">セットに入れるもの</span>
            {categories
              .filter((c) => !isBackHairCategory(c.label))
              .map((c) => (
                <label key={c.id}>
                  <input type="checkbox" checked={setCats.includes(c.id)} onChange={(e) => toggleSetCat(c.id, e.target.checked)} /> {c.label}
                </label>
              ))}
            <span className="hint">
              {most >= 2
                ? `選んだものごとに 1 点、色と飾りをそろえて作ります（2〜${most} 個。いま ${setChosen.length} 個）。できた服は、ふつうの服として 1 点ずつ着られます。`
                : '1 回に作れる画像の上限が小さいので、セットは作れません（STUDIO_RUN_IMAGE_LIMIT を大きくしてください）。'}
            </span>
          </div>
        )}
        {isBackground && (
          <label>
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> 全部のドールで使う背景にする（外すと「{doll.name}」専用）
          </label>
        )}
        <div className="row">
          {!isSet && (
            <label>
              枚数
              <input type="number" min={1} max={most} value={count} onChange={(e) => setCount(Math.max(1, Math.min(most, Math.floor(Number(e.target.value)) || 1)))} data-testid="count" />
            </label>
          )}
          <button className="primary" onClick={() => void make()} disabled={busy || !available || !theme.trim() || (isSet && !setReady)} data-testid="make">
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
          <JobCards key={job.id} id={job.id} doll={doll} onChanged={onChanged} missing={job.missing} onRedo={(item) => void guard(() => startItems([item], job.styleId, job.set))} />
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

function JobCards({ id, doll, onChanged, onRedo, missing }: Common & { id: string; onRedo: (item: PlannedItem) => void; missing?: string[] }) {
  const job = useJob(id);
  const [hidden, setHidden] = useState<number[]>([]);
  const [savingAll, setSavingAll] = useState(false);
  const [readyCards, setReadyCards] = useState<string[]>([]); // 絵の読み込みが終わったカード（「候補の番号-何回目の生成か」）
  const cards = useRef(new Map<number, ItemCardHandle>());
  // 保存も「捨てる」もしていない候補（作っている途中のものも）。ドールを変える・ページを閉じる前に確かめる
  useUnsaved(`job-${id}`, job ? job.candidates.filter((c, i) => !hidden.includes(i) && c.status !== 'failed').length : 1);
  if (!job) return <p>準備中…</p>;
  const hide = (i: number) => setHidden((list) => [...list, i]);
  // カードとして出ている候補
  const shown = job.candidates.flatMap((c, i) => (!hidden.includes(i) && c.hasImage && c.status !== 'working' && c.status !== 'waiting' ? [i] : []));
  // 出ているカードが全部、読み込み終わっているか（終わるまでは「ぜんぶ保存」を押せない）
  const allReady = shown.every((i) => readyCards.includes(`${i}-${job.candidates[i].attempts}`));
  // まだ保存していない候補を、いまの名前・カテゴリで順に保存する（確かめが要るカードは飛ばして、そのカードに知らせる）
  const saveAll = async () => {
    setSavingAll(true);
    for (const i of shown) await cards.current.get(i)?.saveIfReady();
    setSavingAll(false);
  };
  return (
    <div className="job" data-testid="job">
      <h3>
        {job.set && <span data-testid="job-set">セット「{job.set.name}」: </span>}
        {job.done ? 'できた候補' : '作成中…'}（{job.candidates.filter((c) => c.status === 'passed' || c.status === 'flagged').length} / {job.candidates.length}）
      </h3>
      {missing && missing.length > 0 && (
        <p className="hint" data-testid="set-missing">
          企画に入らなかったもの: {missing.join('、')}（要るときは、そのカテゴリを選んで 1 点ずつ作ってください）
        </p>
      )}
      {shown.length >= 2 && (
        <div className="row">
          <button className="primary" onClick={() => void saveAll()} disabled={savingAll || !allReady} data-testid="save-all">
            {savingAll ? '保存中…' : !allReady ? '読み込み中…' : `ぜんぶ保存（${shown.length} 点）`}
          </button>
          <span className="hint">いまの名前・カテゴリ・位置のまま保存します。確かめが要るカードは残ります。</span>
        </div>
      )}
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
              ref={(handle) => {
                if (handle) cards.current.set(i, handle);
                else cards.current.delete(i);
              }}
              doll={doll}
              set={job.set}
              onReady={() => setReadyCards((list) => (list.includes(`${i}-${c.attempts}`) ? list : [...list, `${i}-${c.attempts}`]))}
              source={{ key: `${id}-${i}`, name: c.item.name, category: c.item.category ?? '', cutUrl: api.jobImageUrl(id, i, 'png', c.attempts), sourceUrl: api.jobImageUrl(id, i, 'source', c.attempts), shapeUrl: c.hasShape ? api.jobImageUrl(id, i, 'shape', c.attempts) : null, hideUrl: c.hasHide ? api.jobImageUrl(id, i, 'hide', c.attempts) : null, frontUrl: c.hasFront ? api.jobImageUrl(id, i, 'front', c.attempts) : null, underUrl: c.hasUnder ? api.jobImageUrl(id, i, 'under', c.attempts) : null, warnings: c.warnings, notes: c.notes }}
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
  const [adopted, setAdopted] = useState<number[]>([]); // 採用した・使わないことにした候補
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useUnsaved(`bg-${id}`, job ? job.candidates.filter((c, i) => !adopted.includes(i) && c.status !== 'failed').length : 1);
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
                <div className="row">
                  <button disabled={busy} onClick={() => void adopt(i, c.item.name)}>
                    採用
                  </button>
                  <button disabled={busy} onClick={() => setAdopted((a) => [...a, i])} data-testid="bg-discard">
                    使わない
                  </button>
                </div>
              )}
            </figure>
          ),
        )}
      </div>
    </div>
  );
}

/* ---------- 背景 ---------- */

const SHARED = '__shared'; // コピー先: 全部のドール

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
  // コピーする背景と、コピー先（ドールの ID。SHARED は全部のドール）
  const [picked, setPicked] = useState<string[]>([]);
  const others = manifest.dolls.filter((d) => d.id !== doll.id);
  const [copyTo, setCopyTo] = useState<string>(() => others[0]?.id ?? SHARED);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = () =>
    guard(async () => {
      const target = copyTo === SHARED ? null : copyTo;
      for (const id of picked) await api.copyBackground(id, target);
      setCopied(`${picked.length} 枚を「${target === null ? '全部のドール' : (manifest.dolls.find((d) => d.id === target)?.name ?? target)}」にコピーしました`);
      setPicked([]);
    });

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
      <div className="form" data-testid="bg-copy">
        <span>えらんだ背景（{picked.length} 枚）を</span>
        <select value={copyTo} onChange={(e) => setCopyTo(e.target.value)} aria-label="コピー先" data-testid="bg-copy-to">
          {others.map((d) => (
            <option key={d.id} value={d.id}>{d.name}{d.hidden ? '（ゲームに出さない）' : ''}</option>
          ))}
          <option value={SHARED}>全部のドール（共通の背景）</option>
        </select>
        <button className="primary" disabled={busy || picked.length === 0} onClick={() => { setCopied(null); void copy(); }} data-testid="bg-copy-run">
          にコピー
        </button>
        <button disabled={picked.length === list.length} onClick={() => setPicked(list.map((b) => b.id))}>全部えらぶ</button>
        <button disabled={picked.length === 0} onClick={() => setPicked([])}>えらぶのをやめる</button>
        {copied && <span className="hint" data-testid="bg-copied">{copied}</span>}
        <span className="hint">絵は同じものを使うので、増えません。コピー先にもう同じ背景があれば、そのままです。</span>
      </div>
      <div className="thumbs" data-testid="bg-list">
        {list.map((b) => (
          <figure key={b.id} data-testid="bg-item">
            <label>
              <input type="checkbox" checked={picked.includes(b.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, b.id] : p.filter((x) => x !== b.id)))} data-testid="bg-pick" />
              <img src={contentUrl(b.thumb)} alt={b.name} loading="lazy" />
            </label>
            <figcaption>{b.name}{b.own ? '' : '（共通）'}</figcaption>
            <button disabled={busy} onClick={() => confirm(`背景「${b.name}」を消しますか？`) && void guard(() => api.deleteBackground(b.id))}>消す</button>
          </figure>
        ))}
      </div>
    </section>
  );
}

/* ---------- 一覧（服とカテゴリの管理） ---------- */

const NEW_SET = '__new-set';

export function Library({ doll, onChanged }: Common) {
  const [error, setError] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [placing, setPlacing] = useState<string | null>(null); // 位置と大きさを直している服
  const [dragged, setDragged] = useState<{ id: string; category: string } | null>(null); // 並べ替えでつかんでいる服
  const placingItem = doll.items.find((i) => i.id === placing) ?? null;
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
      {(doll.sets ?? []).length > 0 && (
        <div className="category" data-testid="library-sets">
          <div className="row">
            <b>セット</b>
            <span className="hint">同じテーマの服の集まり。ゲームでは、セットを選ぶと全部が一度に着きます。「重ね順」は大きいほど手前で、セットを着たときの重なりの順番になります（空にすると、カテゴリの重ね順）。服は、あとから足したり外したりできます。最後の 1 点が無くなるとセットも消えます。</span>
          </div>
          {(doll.sets ?? []).map((x) => {
            const categoryOf = (id: string) => doll.categories.find((c) => c.id === id);
            const layerOf = (i: (typeof doll.items)[number]) => i.layer ?? categoryOf(i.category)?.layer ?? 0;
            // 手前（重ね順が大きい）から
            const members = doll.items.filter((i) => i.set === x.id).sort((a, b) => layerOf(b) - layerOf(a));
            const others = doll.items.filter((i) => i.set !== x.id);
            return (
              <div key={x.id} className="set-box" data-testid="library-set">
                <div className="row">
                  <input defaultValue={x.name} aria-label="セットのなまえ" onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== x.name && void guard(() => api.renameSet(doll.id, x.id, e.target.value.trim()))} />
                  <span>{members.length} 点</span>
                  <select
                    value=""
                    aria-label="セットに服を足す"
                    onChange={(e) => e.target.value && void guard(() => api.updateItem({ id: e.target.value, set: x.id }))}
                    data-testid="set-add-item"
                  >
                    <option value="">＋ 服を足す…</option>
                    {doll.categories.map((c) => {
                      const list = others.filter((i) => i.category === c.id);
                      return list.length === 0 ? null : (
                        <optgroup key={c.id} label={c.label}>
                          {list.map((i) => (
                            <option key={i.id} value={i.id}>{i.name}{i.set ? `（いまは「${doll.sets?.find((s2) => s2.id === i.set)?.name ?? ''}」）` : ''}</option>
                          ))}
                        </optgroup>
                      );
                    })}
                  </select>
                </div>
                <div className="thumbs">
                  {members.map((i) => (
                    <figure key={i.id} data-testid="set-member">
                      <img src={contentUrl(i.thumb)} alt={i.name} loading="lazy" />
                      <span>{i.name}</span>
                      <span className="hint">{categoryOf(i.category)?.label ?? i.category}</span>
                      <label>
                        重ね順
                        <input
                          key={`${i.id}-${i.layer ?? ''}`}
                          type="number"
                          defaultValue={i.layer ?? ''}
                          placeholder={String(categoryOf(i.category)?.layer ?? '')}
                          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                          onBlur={(e) => {
                            const raw = e.target.value.trim();
                            const next = raw === '' ? null : Number(raw);
                            if (next !== null && !Number.isFinite(next)) return;
                            if (next === (i.layer ?? null)) return;
                            void guard(() => api.updateItem({ id: i.id, layer: next }));
                          }}
                          data-testid="set-member-layer"
                        />
                      </label>
                      <button onClick={() => void guard(() => api.updateItem({ id: i.id, set: null }))} data-testid="set-member-remove">セットから外す</button>
                    </figure>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <p className="hint">「重ね順」は大きいほど手前。「並び順」はメニューでの順番（小さいほど先）。カテゴリの中の服の順番は、絵をドラッグするか ◀ ▶ で変えられます。「位置・大きさ」で、ゲームで最初に着せたときの位置と大きさを直せます。</p>
      {placingItem && <ItemPlacer doll={doll} item={placingItem} onClose={() => setPlacing(null)} onSaved={onChanged} />}
      {categories.map((c) => {
        const items = doll.items.filter((i) => i.category === c.id);
        // 変えた項目だけを送る（続けて別の項目を変えても、前の変更が戻らない）
        const set = (change: Partial<Omit<typeof c, 'id'>>) => void guard(() => api.updateCategory(doll.id, c.id, change));
        // メニューでの並びを変える（from 番目の服を to 番目へ）
        const reorder = (from: number, to: number) => {
          if (from === to || from < 0) return;
          void guard(() => api.reorderItems(doll.id, c.id, moveInList(items, from, to).map((i) => i.id)));
        };
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
              {items.map((item, index) => (
                <figure
                  key={item.id}
                  data-testid="library-item"
                  className={dragged?.id === item.id ? 'dragging' : undefined}
                  onDragOver={(e) => dragged?.category === c.id && e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (!dragged || dragged.category !== c.id) return;
                    const from = items.findIndex((i) => i.id === dragged.id);
                    // 絵の右半分に落としたら後ろ、左半分なら前
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDragged(null);
                    reorder(from, dropIndex(from, index, e.clientX > rect.left + rect.width / 2));
                  }}
                >
                  <img
                    src={contentUrl(item.thumb)}
                    alt={item.name}
                    loading="lazy"
                    draggable
                    title="ドラッグして並べ替え（メニューでの順番）"
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', item.id);
                      setDragged({ id: item.id, category: c.id });
                    }}
                    onDragEnd={() => setDragged(null)}
                  />
                  <div className="row order-buttons">
                    <button onClick={() => reorder(index, index - 1)} disabled={index === 0} aria-label="前へ" title="メニューで前へ" data-testid="item-earlier">◀</button>
                    <span className="hint">{index + 1}</span>
                    <button onClick={() => reorder(index, index + 1)} disabled={index === items.length - 1} aria-label="後ろへ" title="メニューで後ろへ" data-testid="item-later">▶</button>
                  </div>
                  <button onClick={() => setPlacing(item.id)} data-testid="item-place">位置・大きさ</button>
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
                  {item.set ? (
                    <>
                      <span className="hint">セット: {doll.sets?.find((x) => x.id === item.set)?.name ?? ''}</span>
                      <button onClick={() => void guard(() => api.updateItem({ id: item.id, set: null }))} data-testid="leave-set">セットから外す</button>
                    </>
                  ) : (
                    <select
                      value=""
                      aria-label="セットに入れる"
                      data-testid="item-join-set"
                      onChange={(e) => {
                        const value = e.target.value;
                        if (!value) return;
                        if (value === NEW_SET) {
                          const name = prompt('新しいセットのなまえ')?.trim();
                          if (name) void guard(() => api.updateItem({ id: item.id, set: { name } }));
                          return;
                        }
                        void guard(() => api.updateItem({ id: item.id, set: value }));
                      }}
                    >
                      <option value="">セットに入れる…</option>
                      {(doll.sets ?? []).map((x) => (
                        <option key={x.id} value={x.id}>{x.name}</option>
                      ))}
                      <option value={NEW_SET}>＋ 新しいセット</option>
                    </select>
                  )}
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
              await api.saveCategory(doll.id, { label: newLabel.trim(), layer: isBackHairCategory(newLabel) ? -1 : 11, menuOrder: Math.max(0, ...doll.categories.map((c) => c.menuOrder)) + 1, overlap: false, movable: false });
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
  // 「ゲームに出さない」は、押したらすぐ変える（保存が終わって読み直すまで待たない）
  const [hiddenDraft, setHiddenDraft] = useState<{ dollId: string; value: boolean } | null>(null);
  const hiddenNow = hiddenDraft && hiddenDraft.dollId === dollId ? hiddenDraft.value : !!doll?.hidden;
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
      {doll && (
        <div className="form row" data-testid="doll-settings">
          <label>
            ドールのなまえ
            <input
              key={`${doll.id}-${doll.name}`}
              defaultValue={doll.name}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value && value !== doll.name) void api.updateDoll(doll.id, { name: value }).then(() => onChanged(), (err) => setError(message(err)));
              }}
              data-testid="doll-rename"
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={hiddenNow}
              onChange={(e) => {
                const value = e.target.checked;
                setHiddenDraft({ dollId: doll.id, value });
                void api.updateDoll(doll.id, { hidden: value }).then(
                  () => onChanged(),
                  (err) => {
                    setHiddenDraft(null);
                    setError(message(err));
                  },
                );
              }}
              data-testid="doll-hidden"
            />
            ゲームに出さない（スタジオには出ます。服も消えません）
          </label>
        </div>
      )}
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
