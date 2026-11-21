/**
 * アプリの中のスタジオ: 「何を作るか・テーマ・絵柄」を選んで服を作り、できた服を自分のメニューに入れる。
 * 大人（保護者）が使う画面なので、文は漢字かな交じり。
 * チケット・生成・保存は、裏側（StudioBackend）が行う。この画面は、頼んで、進み具合を見て、結果を端末の控えに入れるだけ。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackendError, SET_MAX, SET_MIN, THEME_MAX, ticketCost } from '../cloud/backend';
import type { MyItem, StudioBackend, StudioCandidate, StudioJob, StudioPreview, StudioTarget, StudioUser } from '../cloud/backend';
import type { Library } from '../cloud/library';
import { syncLibrary } from '../cloud/sync';
import type { ManifestCategory } from '../content/manifest';
import { isBackHairCategory } from '../pipeline/hairSplit';
import { DEFAULT_STYLE_ID, STYLE_PRESETS } from '../studio/stylePresets';
import type { DollData } from '../types';

interface Props {
  backend: StudioBackend | null; // null = 用意できなかった
  doll: DollData;
  categories: ManifestCategory[];
  library: Library;
  onClose: () => void;
  onLibraryChanged: () => void | Promise<void>;
  demo?: boolean; // 確認用（偽物の裏側）。絵は色の四角で、チケットもにせもの
}

const SET = '__set';
// 色のテーマ（3 色）の、最初の色
const DEFAULT_COLORS = ['#ff8fc7', '#ffffff', '#8fc9ff'];
const COLOR_LABELS = ['メイン', 'サブ', 'アクセント'];
// できた服を、ドールに着せて見せる枠の大きさ（px）。せまい画面では小さくする
const stageSize = () => Math.max(110, Math.min(200, Math.floor(window.innerWidth * 0.36)));
const isFaceLabel = (label: string) => /かお|顔|face|メイク|makeup/i.test(label);
// 写真から作れる「顔」のカテゴリ（サーバーの isFaceCategory と同じ見分け方）
const isPhotoFace = (label: string) => /かお|顔|face|メイク|おけしょう|化粧/i.test(label) && !/かみ|髪|ヘア|hair/i.test(label);
// 送る前に、写真を小さくする（長い辺 1024px の JPEG。向きは写真の情報どおりに直す）
const PHOTO_SIDE = 1024;
async function shrinkPhoto(file: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const k = Math.min(1, PHOTO_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    return blob ?? file;
  } catch {
    return file; // 小さくできなければ、そのまま（大きすぎれば、サーバーが断る）
  }
}
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
  const STAGE = stageSize();
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
  // 色のテーマ（3 色）は、まだ AI には渡していない（画面だけ）。写真は、顔を似せるために使う
  const [colors, setColors] = useState<string[]>(DEFAULT_COLORS);
  const [photo, setPhoto] = useState<Blob | null>(null);
  // 写真から顔を作るカテゴリ（無いドールでは、写真は使えない）
  const faceTarget = targets.find((c) => isPhotoFace(c.label));
  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);
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
      let signedIn: StudioUser;
      try {
        signedIn = await backend.signIn();
        if (stopped) return;
        setUser(signedIn);
        for (const job of await backend.pendingJobs()) {
          if (stopped) return;
          stops.push(backend.watchJob(job.id, upsertJob));
        }
      } catch (e) {
        // つながらないときは、確かめ方も添える
        if (!stopped) setProblem(e instanceof BackendError && e.code === 'offline' ? `${e.message}（インターネットにつながっているか確かめて、開き直してください）` : messageOf(e));
        return;
      }
      // 端末の控えを、サーバーの一覧に合わせる（足りない服を取る・消した服を消す）。できなくても、作ることはできる（知らせだけ出す）
      try {
        const synced = await syncLibrary(backend, library, signedIn.userCode);
        if (stopped) return;
        if (synced.added > 0 || synced.removed > 0) await refreshLibrary();
        if (synced.failed > 0) setError(`自分の服のうち ${synced.failed} 点を、この端末に取り込めませんでした。開き直すと、もう一度ためします。`);
      } catch (e) {
        if (!stopped) setError(messageOf(e));
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
    : !text && !photo
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
      const { jobId } = await backend.startJob({ dollId: doll.id, theme: text, styleId, target: current, ...(photo ? { photo } : {}) });
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
  // ほかのドールの服（公開をやめたドールの服も、ここで見て消せる）
  const others = myItems.filter((i) => i.dollId !== doll.id);

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
            {problem}
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
              <label className="studio-group">
                <span className="studio-label">① 何を作る？</span>
                <select className="studio-select" value={target} onChange={(e) => setTarget(e.target.value)} disabled={photo !== null} data-testid="studio-target">
                  {targets.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                  {targets.length >= SET_MIN && <option value={SET}>セット</option>}
                </select>
              </label>
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

              <div className="studio-group">
                <span className="studio-label">② テーマ</span>
                <div className="studio-theme-row">
                  <input
                    value={theme}
                    maxLength={THEME_MAX}
                    onChange={(e) => setTheme(e.target.value)}
                    placeholder={photo ? 'なくても作れます（例: にっこり）' : '例: うみのおひめさま'}
                    aria-label="テーマ"
                    data-testid="studio-theme"
                  />
                  {/* 顔写真をとる（スマホ・iPad ではカメラが開く。パソコンでは画像を選ぶ）。その顔に似せた「顔」を作る */}
                  <label className={`studio-photo-button${faceTarget ? '' : ' disabled'}`} title={faceTarget ? '顔写真をとる' : 'このドールには、顔のカテゴリがありません'} data-testid="studio-photo-button">
                    📷
                    <input
                      type="file"
                      accept="image/*"
                      capture="user"
                      disabled={!faceTarget}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file || !faceTarget) return;
                        void shrinkPhoto(file).then((small) => {
                          setPhoto(small);
                          setTarget(faceTarget.id);
                        });
                      }}
                      data-testid="studio-photo-input"
                    />
                  </label>
                </div>
                {photoUrl && (
                  <div className="studio-photo-box">
                    <div className="studio-photo" data-testid="studio-photo">
                      <img src={photoUrl} alt="とった写真" />
                      <button type="button" onClick={() => setPhoto(null)} aria-label="写真をはずす" data-testid="studio-photo-remove">
                        ✕
                      </button>
                    </div>
                    <p className="studio-hint" data-testid="studio-photo-note">
                      この写真の顔に似せた「{faceTarget?.label}」を作ります。写真は顔を作るためだけに使い、作り終わったらサーバーから消します。
                    </p>
                  </div>
                )}
              </div>

              <div className="studio-group">
                <span className="studio-label">③ 色のテーマ</span>
                <div className="studio-colors">
                  {colors.map((color, i) => (
                    <label key={i} className="studio-color">
                      <input type="color" value={color} onChange={(e) => setColors((list) => list.map((c, j) => (j === i ? e.target.value : c)))} data-testid={`studio-color-${i}`} />
                      <span>{COLOR_LABELS[i]}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label className="studio-group">
                <span className="studio-label">④ 絵柄</span>
                <select className="studio-select" value={styleId} onChange={(e) => setStyleId(e.target.value)} data-testid="studio-style">
                  {STYLE_PRESETS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>

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
                              {!c.preview && <p className="studio-hint">絵を読み込めませんでした。開き直すと、もう一度ためします（だめなら「捨てる」で消せます）。</p>}
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

            {others.length > 0 && (
              <section>
                <h3>ほかのドールの服（{others.length} 点）</h3>
                <p className="studio-hint">ドールを切り替えると着られます。いまは選べないドールの服も、ここで消せます。</p>
                <div className="studio-my-items" data-testid="studio-other-items">
                  {others.map((item) => (
                    <figure key={item.id} data-testid="studio-other-item">
                      <BlobImage blob={item.files[item.item.thumb]} alt={item.item.name} />
                      <figcaption>{item.item.name}</figcaption>
                      <button type="button" disabled={working !== null} onClick={() => window.confirm(`「${item.item.name}」を消しますか？`) && void remove(item)} data-testid="studio-other-delete">
                        消す
                      </button>
                    </figure>
                  ))}
                </div>
              </section>
            )}

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
