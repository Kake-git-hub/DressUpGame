/**
 * アプリの中のスタジオ: 「何を作るか・テーマ・絵柄」を選んで服を作り、できた服を自分のメニューに入れる。
 * 大人（保護者）が使う画面なので、文は漢字かな交じり。
 * チケット・生成・保存は、裏側（StudioBackend）が行う。この画面は、頼んで、進み具合を見て、結果を端末の控えに入れるだけ。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackendError, SET_MAX, SET_MIN, THEME_MAX, ticketCost } from '../cloud/backend';
import type { MyItem, StudioBackend, StudioCandidate, StudioJob, StudioPreview, StudioTarget, StudioUser } from '../cloud/backend';
import type { Library } from '../cloud/library';
import type { ManifestCategory } from '../content/manifest';
import { isBackHairCategory } from '../pipeline/hairSplit';
import { DEFAULT_STYLE_ID, STYLE_PRESETS } from '../studio/stylePresets';
import type { DollData } from '../types';

interface Props {
  backend: StudioBackend | null; // null = まだ用意できていない
  doll: DollData;
  categories: ManifestCategory[];
  library: Library;
  onClose: () => void;
  onLibraryChanged: () => void | Promise<void>;
  demo?: boolean; // 確認用（偽物の裏側）。絵は色の四角で、チケットもにせもの
}

const SET = '__set';
const STAGE = 200; // できた服を、ドールに着せて見せる枠の大きさ（px）
const isFaceLabel = (label: string) => /かお|顔|face|メイク|makeup/i.test(label);
const messageOf = (e: unknown) => (e instanceof BackendError || e instanceof Error ? e.message : String(e));

// Blob の絵（端末の控え）を表示する
function BlobImage({ blob, alt }: { blob: Blob | undefined; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    let alive = true;
    const reader = new FileReader();
    reader.onload = () => alive && setUrl(String(reader.result));
    reader.readAsDataURL(blob);
    return () => {
      alive = false;
    };
  }, [blob]);
  return url ? <img src={url} alt={alt} draggable={false} /> : null;
}

// ドールに、できた服を着せた絵
function Stage({ doll, preview }: { doll: DollData; preview?: StudioPreview }) {
  const k = STAGE / doll.canvasW;
  // 服のキャンバスは、ドールのキャンバスのまわりに余白を足した大きさのことがある（中心は同じ）
  const padX = preview ? (preview.canvasW - doll.canvasW) / 2 : 0;
  const padY = preview ? (preview.canvasH - doll.canvasH) / 2 : 0;
  return (
    <div className="studio-stage" style={{ width: STAGE, height: (doll.canvasH / doll.canvasW) * STAGE }}>
      <img src={doll.bodyImageUrl} alt="" draggable={false} style={{ left: doll.box.x * k, top: doll.box.y * k, width: doll.box.w * k, height: doll.box.h * k }} />
      {preview && (
        <img
          src={preview.url}
          alt=""
          draggable={false}
          data-preview=""
          style={{ left: (preview.box.x - padX) * k, top: (preview.box.y - padY) * k, width: preview.box.w * k, height: preview.box.h * k }}
        />
      )}
    </div>
  );
}

export function AppStudio({ backend, doll, categories, library, onClose, onLibraryChanged, demo = false }: Props) {
  // うしろがみは、髪と一緒にできるので、選べない
  const targets = [...categories].filter((c) => !isBackHairCategory(c.label)).sort((a, b) => a.menuOrder - b.menuOrder);
  const [user, setUser] = useState<StudioUser | null>(null);
  const [problem, setProblem] = useState<string | null>(null); // 開けなかった理由
  const [jobs, setJobs] = useState<StudioJob[]>([]);
  const [myItems, setMyItems] = useState<MyItem[]>([]);
  const [target, setTarget] = useState<string>(targets[0]?.id ?? SET);
  // セットに入れるもの。最初は、かお以外（多すぎるときは、先頭から上限まで）
  const [setCats, setSetCats] = useState<string[]>(() => targets.filter((c) => !isFaceLabel(c.label)).slice(0, SET_MAX).map((c) => c.id));
  const [theme, setTheme] = useState('');
  const [styleId, setStyleId] = useState(DEFAULT_STYLE_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({}); // 候補に付ける名前（変えたものだけ）
  const [closed, setClosed] = useState<string[]>([]); // 閉じた「できなかった」の知らせ
  const [working, setWorking] = useState<string | null>(null); // 「使う」「捨てる」「消す」の途中
  const watchers = useRef<(() => void)[]>([]);

  const upsertJob = useCallback((job: StudioJob) => setJobs((list) => (list.some((j) => j.id === job.id) ? list.map((j) => (j.id === job.id ? job : j)) : [job, ...list])), []);
  // 端末の控えを読み直して、ゲームのメニューにも重ね直す
  const refreshLibrary = useCallback(async () => {
    setMyItems(await library.all());
    await onLibraryChanged();
  }, [library, onLibraryChanged]);

  // 開いたとき: 利用者を確かめ、作りかけの分を出し、端末の控えをサーバーの一覧に合わせる
  useEffect(() => {
    let stopped = false;
    const stops = watchers.current;
    void library.all().then((items) => !stopped && setMyItems(items));
    if (!backend) return;
    stops.push(backend.onUser((u) => !stopped && setUser(u)));
    void (async () => {
      try {
        const signedIn = await backend.signIn();
        if (stopped) return;
        setUser(signedIn);
        for (const job of await backend.pendingJobs()) {
          if (stopped) return;
          stops.push(backend.watchJob(job.id, upsertJob));
        }
        const items = await backend.listMyItems();
        if (stopped) return;
        await library.replaceAll(items);
        await refreshLibrary();
      } catch (e) {
        if (!stopped) setProblem(messageOf(e));
      }
    })();
    return () => {
      stopped = true;
      for (const stop of stops.splice(0)) stop();
    };
  }, [backend, library, upsertJob, refreshLibrary]);

  const isSet = target === SET;
  const chosen = targets.filter((c) => setCats.includes(c.id)).map((c) => c.id);
  const current: StudioTarget = isSet ? { kind: 'set', categoryIds: chosen } : { kind: 'category', categoryId: target };
  const cost = ticketCost(current);
  const text = theme.trim();
  // 「作る」を押せない理由（押せるなら null）
  const blocked = !user
    ? '準備しています…'
    : !text
      ? 'テーマを入れてください。'
      : isSet && (chosen.length < SET_MIN || chosen.length > SET_MAX)
        ? `セットに入れるものを ${SET_MIN}〜${SET_MAX} 個選んでください（いま ${chosen.length} 個）。`
        : !user.admin && user.tickets < cost
          ? `チケットが足りません（のこり ${user.tickets} 枚、必要 ${cost} 枚）。`
          : null;

  const make = async () => {
    if (!backend || blocked) return;
    setBusy(true);
    setError(null);
    try {
      const { jobId } = await backend.startJob({ dollId: doll.id, theme: text, styleId, target: current });
      watchers.current.push(backend.watchJob(jobId, upsertJob));
    } catch (e) {
      setError(messageOf(e));
    }
    setBusy(false);
  };
  const act = async (key: string, work: () => Promise<void>) => {
    setWorking(key);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(messageOf(e));
    }
    setWorking(null);
  };
  const keyOf = (job: StudioJob, c: StudioCandidate) => `${job.id}:${c.index}`;
  const keep = (job: StudioJob, c: StudioCandidate) =>
    act(keyOf(job, c), async () => {
      const item = await backend!.keep(job.id, c.index, (names[keyOf(job, c)] ?? c.name).trim() || c.name);
      await library.put(item);
      await refreshLibrary();
    });
  const discard = (job: StudioJob, c: StudioCandidate) => act(keyOf(job, c), () => backend!.discard(job.id, c.index));
  const remove = (item: MyItem) =>
    act(item.id, async () => {
      await backend!.deleteMyItem(item.id);
      await library.remove(item.id);
      await refreshLibrary();
    });

  const labelOf = (id: string) => categories.find((c) => c.id === id)?.label ?? id;
  // 出す候補: 作りかけ・できた・できなかった（閉じたものと、もう決めたものは出さない）
  const cards = jobs
    .filter((job) => job.dollId === doll.id)
    .flatMap((job) => job.candidates.filter((c) => c.status !== 'kept' && c.status !== 'discarded' && !closed.includes(keyOf(job, c))).map((c) => ({ job, c })));
  const mine = myItems.filter((i) => i.dollId === doll.id);

  return (
    <div className="studio-overlay" data-testid="app-studio">
      <div className="studio-panel">
        <header className="studio-header">
          <h2>✨ 服を作る</h2>
          {user && (
            <span className="studio-tickets" data-testid="studio-tickets">
              {user.admin ? '管理者（チケットの制限なし）' : `🎫 のこり ${user.tickets} 枚`}
            </span>
          )}
          <button type="button" onClick={onClose} aria-label="とじる" data-testid="studio-close">
            ✕
          </button>
        </header>

        {!backend ? (
          <p className="studio-note" data-testid="studio-unavailable">
            この機能は、まだ準備中です。
          </p>
        ) : problem ? (
          <p className="studio-error" data-testid="studio-problem">
            {problem}（インターネットにつながっているか確かめて、開き直してください）
          </p>
        ) : (
          <>
            {demo && (
              <p className="studio-demo" data-testid="studio-demo">
                確認用の画面です。絵は色の四角で、AI は使いません。チケットも、この端末の中だけのにせものです。
              </p>
            )}
            <p className="studio-note">「{doll.name}」の服を、AI で作ります。作った服は、この端末のメニューにだけ出ます。服 1 点につき、チケットを 1 枚使います。</p>

            <section className="studio-form">
              <div className="studio-group" role="radiogroup" aria-label="何を作るか">
                <span className="studio-label">① 何を作る？</span>
                <div className="studio-chips">
                  {targets.map((c) => (
                    <button key={c.id} type="button" role="radio" aria-checked={target === c.id} className={target === c.id ? 'on' : ''} onClick={() => setTarget(c.id)} data-testid={`studio-target-${c.id}`}>
                      {c.label}
                    </button>
                  ))}
                  {targets.length >= SET_MIN && (
                    <button type="button" role="radio" aria-checked={isSet} className={isSet ? 'on' : ''} onClick={() => setTarget(SET)} data-testid="studio-target-set">
                      セット
                    </button>
                  )}
                </div>
                {isSet && (
                  <div className="studio-set" data-testid="studio-set-categories">
                    <span>セットに入れるもの（{SET_MIN}〜{SET_MAX} 個。選んだものごとに 1 点、色と飾りをそろえて作ります）</span>
                    <div className="studio-checks">
                      {targets.map((c) => (
                        <label key={c.id}>
                          <input type="checkbox" checked={setCats.includes(c.id)} onChange={(e) => setSetCats((list) => (e.target.checked ? [...list, c.id] : list.filter((x) => x !== c.id)))} /> {c.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <label className="studio-group">
                <span className="studio-label">② テーマ</span>
                <input value={theme} maxLength={THEME_MAX} onChange={(e) => setTheme(e.target.value)} placeholder="例: うみのおひめさま" data-testid="studio-theme" />
              </label>

              <div className="studio-group" role="radiogroup" aria-label="絵柄">
                <span className="studio-label">③ 絵柄</span>
                <div className="studio-chips">
                  {STYLE_PRESETS.map((s) => (
                    <button key={s.id} type="button" role="radio" aria-checked={styleId === s.id} className={styleId === s.id ? 'on' : ''} onClick={() => setStyleId(s.id)} data-testid={`studio-style-${s.id}`}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="studio-row">
                <button type="button" className="primary" onClick={() => void make()} disabled={busy || blocked !== null} data-testid="studio-make">
                  {busy ? '準備中…' : `作る（チケット ${cost} 枚）`}
                </button>
                {blocked && (
                  <span className="studio-hint" data-testid="studio-hint">
                    {blocked}
                  </span>
                )}
              </div>
              {error && (
                <p className="studio-error" data-testid="studio-error">
                  {error}
                </p>
              )}
            </section>

            {cards.length > 0 && (
              <section>
                <h3>できた服</h3>
                <div className="studio-cards">
                  {cards.map(({ job, c }) => {
                    const key = keyOf(job, c);
                    return (
                      <div key={key} className="studio-candidate" data-testid="studio-candidate" data-status={c.status}>
                        <Stage doll={doll} preview={c.status === 'done' ? c.preview : undefined} />
                        <div className="studio-candidate-side">
                          <span className="studio-hint">
                            {labelOf(c.categoryId)}
                            {job.set ? ` ・ セット「${job.set.name}」` : ''}
                          </span>
                          {c.status === 'waiting' && <p>順番を待っています…</p>}
                          {c.status === 'working' && <p>作っています…（1 分くらい）</p>}
                          {c.status === 'failed' && (
                            <>
                              <p className="studio-error">{c.notes.join(' ') || '作れませんでした。チケットは戻しました'}</p>
                              <button type="button" onClick={() => setClosed((list) => [...list, key])} data-testid="studio-dismiss">
                                とじる
                              </button>
                            </>
                          )}
                          {c.status === 'done' && (
                            <>
                              <input value={names[key] ?? c.name} onChange={(e) => setNames((n) => ({ ...n, [key]: e.target.value }))} maxLength={20} aria-label="名前" data-testid="studio-candidate-name" />
                              {c.notes.length > 0 && <p className="studio-hint">{c.notes.join(' ')}</p>}
                              <div className="studio-row">
                                <button type="button" className="primary" disabled={working !== null} onClick={() => void keep(job, c)} data-testid="studio-keep">
                                  使う
                                </button>
                                <button type="button" disabled={working !== null} onClick={() => void discard(job, c)} data-testid="studio-discard">
                                  捨てる
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            <section>
              <h3>自分の服（{mine.length} 点）</h3>
              {mine.length === 0 ? (
                <p className="studio-hint">まだありません。作った服を「使う」と、ここと、ゲームのメニューに入ります。</p>
              ) : (
                <div className="studio-my-items" data-testid="studio-my-items">
                  {mine.map((item) => (
                    <figure key={item.id} data-testid="studio-my-item">
                      <BlobImage blob={item.files[item.item.thumb]} alt={item.item.name} />
                      <figcaption>{item.item.name}</figcaption>
                      <button type="button" disabled={working !== null} onClick={() => window.confirm(`「${item.item.name}」を消しますか？`) && void remove(item)} data-testid="studio-my-delete">
                        消す
                      </button>
                    </figure>
                  ))}
                </div>
              )}
            </section>

            {user && (
              <p className="studio-hint">
                利用者コード: <b data-testid="studio-user-code">{user.userCode}</b>（チケットを受け取るときに、作者に伝えるコードです）
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
