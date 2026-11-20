/**
 * きせかえスタジオ（素材づくりの画面）
 * ゲームとは別のページ。開いたときだけ読み込まれる。
 */
import { useCallback, useEffect, useState } from 'react';
import type { Manifest } from '../content/manifest';
import { ApiError, api } from './api';
import type { Status } from './api';
import { AddItems, Backgrounds, DollPanel, Generate, Library } from './Panels';

const TABS = [
  ['generate', 'テーマから作る'],
  ['add', '画像から追加'],
  ['library', '一覧'],
  ['backgrounds', '背景'],
  ['doll', 'ドールの範囲'],
] as const;
type Tab = (typeof TABS)[number][0];

// 状態と一覧を読む。失敗したら、理由の文字列を返す
const load = (): Promise<[Status, Manifest] | string> =>
  Promise.all([api.status(), api.content()]).catch((e: unknown) => (e instanceof ApiError ? e.message : String(e)));

// 公開されている素材（ほかの PC やクラウドから公開された新しいドールなど）を取り込んでから、状態と一覧を読む。
// 知らせる文は、取り込んだとき・取り込めなかったときだけ（最新なら null）
async function syncAndLoad(): Promise<[string | null, [Status, Manifest] | string]> {
  const synced = await api.sync().catch(() => null);
  return [synced && (synced.updated || synced.behind > 0) ? synced.message : null, await load()];
}

export function Studio() {
  const [status, setStatus] = useState<Status | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dollId, setDollId] = useState('');
  const [tab, setTab] = useState<Tab>('generate');
  const [publishing, setPublishing] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const apply = useCallback((result: [Status, Manifest] | string) => {
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    setStatus(result[0]);
    setManifest(result[1]);
    setError(null);
    setDollId((current) => (result[1].dolls.some((d) => d.id === current) ? current : (result[1].dolls[0]?.id ?? '')));
  }, []);
  const reload = useCallback(() => load().then(apply), [apply]);
  const [syncing, setSyncing] = useState(false);
  const applySynced = useCallback(
    ([note, result]: [string | null, [Status, Manifest] | string]) => {
      setSyncNote(note);
      setSyncing(false);
      apply(result);
    },
    [apply],
  );
  useEffect(() => {
    let cancelled = false;
    void syncAndLoad().then((result) => !cancelled && applySynced(result));
    return () => {
      cancelled = true;
    };
  }, [applySynced]);

  if (error && !manifest) {
    return (
      <div className="studio">
        <h1>きせかえスタジオ</h1>
        <p className="error" data-testid="studio-error">{error}</p>
        <button onClick={() => void reload()}>もう一度</button>
      </div>
    );
  }
  if (!status || !manifest) return <div className="studio">読み込み中…</div>;
  const doll = manifest.dolls.find((d) => d.id === dollId) ?? null;
  const activeTab: Tab = doll ? tab : 'doll';

  return (
    <div className="studio">
      <header>
        <h1>きせかえスタジオ</h1>
        <label>
          ドール
          <select value={dollId} onChange={(e) => setDollId(e.target.value)} data-testid="doll-select">
            {manifest.dolls.map((d) => (
              <option key={d.id} value={d.id}>{d.name}（服 {d.items.length} 点）</option>
            ))}
          </select>
        </label>
        <span className="hint" data-testid="ai-status">
          {status.ai.text && status.ai.image
            ? `自動生成: 今日 ${status.budget.usedToday} / ${status.budget.perDay} 枚`
            : `自動生成は使えません（${[!status.ai.text && 'Claude', !status.ai.image && 'Gemini'].filter(Boolean).join('・')} のキーが未設定）`}
        </span>
        <span className="spacer" />
        <a href={`${import.meta.env.BASE_URL}?content=local-content/`} target="_blank" rel="noreferrer">ゲームで確認</a>
        <button className="primary" onClick={() => setPublishing(true)} data-testid="publish-open">
          公開{status.git.changedFiles > 0 ? `（未公開の変更 ${status.git.changedFiles} 件）` : ''}
        </button>
      </header>
      <nav>
        {TABS.map(([id, label]) => (
          <button key={id} className={activeTab === id ? 'on' : ''} onClick={() => setTab(id)} disabled={!doll && id !== 'doll'} data-testid={`tab-${id}`}>
            {label}
          </button>
        ))}
      </nav>
      {error && <p className="error">{error}</p>}
      {syncNote && (
        <p className={status.git.behind > 0 ? 'error' : 'hint'} data-testid="sync-note">
          {syncNote}
          {status.git.behind > 0 && (
            <button disabled={syncing} onClick={() => { setSyncing(true); void syncAndLoad().then(applySynced); }}>
              もう一度取り込む
            </button>
          )}
        </p>
      )}
      <main>
        {activeTab === 'doll' && <DollPanel doll={doll} onChanged={reload} onAdded={(id) => { setDollId(id); setTab('doll'); void reload(); }} />}
        {doll && activeTab === 'add' && <AddItems key={doll.id} doll={doll} onChanged={reload} />}
        {doll && activeTab === 'generate' && <Generate key={doll.id} doll={doll} status={status} onChanged={reload} />}
        {doll && activeTab === 'backgrounds' && <Backgrounds key={doll.id} doll={doll} manifest={manifest} onChanged={reload} />}
        {doll && activeTab === 'library' && <Library key={doll.id} doll={doll} onChanged={reload} />}
      </main>
      {publishing && <Publish status={status} onClose={() => { setPublishing(false); void reload(); }} />}
    </div>
  );
}

function Publish({ status, onClose }: { status: Status; onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.publish(message);
      setResult({ ok: true, text: `公開しました。数分で iPad に届きます。\n${r.log}` });
    } catch (e) {
      setResult({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    }
    setBusy(false);
  };
  return (
    <div className="dialog-back">
      <div className="dialog" data-testid="publish-dialog">
        <h2>公開</h2>
        {!status.git.isRepo ? (
          <p className="error">素材フォルダ（{status.contentDir}）が git の作業フォルダではないので、公開できません。保存した内容は残っています。</p>
        ) : (
          <>
            <p>
              未公開の変更: {status.git.changedFiles} 件（ブランチ {status.git.branch}）。使われなくなった画像 {status.git.unusedFiles} 個は、公開の前に消します。
            </p>
            <label>
              メモ（任意）
              <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="例: うみのドレスを追加" />
            </label>
          </>
        )}
        {result && <pre className={result.ok ? 'log' : 'log error'} data-testid="publish-result">{result.text}</pre>}
        <div className="row">
          {status.git.isRepo && (
            <button className="primary" onClick={() => void run()} disabled={busy} data-testid="publish-run">
              {busy ? '公開中…' : '公開する'}
            </button>
          )}
          <button onClick={onClose} disabled={busy}>とじる</button>
        </div>
      </div>
    </div>
  );
}
