/**
 * 交換の画面: えらぶ → だす／よむ → えらぶ → こうかんする？ → できた／やめ
 * 子どもも使う画面なので、ひらがな中心。きろくには、名前・合い言葉・印を入れない
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BackendError } from '../cloud/backend';
import type { MyItem, TradeItem, TradeState } from '../cloud/backend';
import type { Library } from '../cloud/library';
import type { CloudSession } from '../cloud/session';
import { BlobImage } from '../cloud/Stage';
import { readStudioMode } from '../appStudio/unlock';
import type { ManifestCategory } from '../content/manifest';
import { closetDolls, closetGroups } from '../closet/closetView';
import { diag } from '../services/diag';
import type { DollData } from '../types';
import { QrScan } from './QrScan';
import { QrShow } from './QrShow';
import { OLD_SERVER_TEXT, isFinished, refusalText, stageOf } from './tradeFlow';
import type { LocalStep } from './tradeFlow';

export interface TradeProps {
  session: CloudSession;
  library: Library;
  dolls: DollData[];
  categoriesByDoll: Record<string, ManifestCategory[]>;
  onClose: () => void;
  onLibraryChanged: () => void | Promise<void>;
}

const POLL_MS = 1500;
const CODE_MS = 60_000;
const NO_CATEGORIES: ManifestCategory[] = [];
// 交換の様子は、前へ戻さない（遅れて届いた返事で、終わった交換が「こうかんする？」に戻らないように）
const RANK: Record<TradeState['status'], number> = { open: 0, claimed: 1, joined: 2, done: 3, cancelled: 3 };

function errorText(error: unknown): string {
  if (error instanceof BackendError) {
    if (error.tradeRefusal) return refusalText(error.tradeRefusal);
    if (error.code === 'offline') return 'いまは サーバーに つながっていないよ';
    if (error.code === 'limit') return refusalText('limit');
  }
  return 'うまく いかなかったよ。もういちど ためしてね';
}

export function Trade({ session, library, dolls, categoriesByDoll, onClose, onLibraryChanged }: TradeProps) {
  const backend = session.backend;
  const [supported, setSupported] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [notMovable, setNotMovable] = useState<ReadonlySet<string>>(new Set());
  const [items, setItems] = useState<MyItem[] | null>(null);
  const [local, setLocal] = useState<LocalStep>('menu');
  const [tradeId, setTradeId] = useState<string | null>(null);
  const [trade, setTrade] = useState<TradeState | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const latestRef = useRef<TradeState | null>(null);
  const [scanKey, setScanKey] = useState(0);
  const stage = stageOf(trade, local);

  // 終わっていない交換の ID（閉じる・ページを離れるときの取り消し用）
  const idRef = useRef<string | null>(null);
  const finishedRef = useRef(false);
  const pollingRef = useRef(false);
  const resultRef = useRef(false);
  const callbacks = useRef({ session, onLibraryChanged });
  useEffect(() => {
    callbacks.current = { session, onLibraryChanged };
  });

  useEffect(() => {
    let alive = true;
    setLoadError(null);
    void backend.canTrade().then(
      (ok) => alive && setSupported(ok),
      (error: unknown) => {
        if (!alive) return;
        if (error instanceof BackendError && error.code === 'old-server') setSupported(false);
        else setLoadError(errorText(error));
      },
    );
    void library.all().then((all) => alive && setItems(all));
    return () => {
      alive = false;
    };
  }, [backend, library, attempt]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // 作っている途中の仕事の服は、出さない
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const makingIds = useMemo(() => new Set(state.jobs.filter((job) => !job.done).flatMap((job) => job.candidates.map((c) => c.itemId).filter((id): id is string => !!id))), [state.jobs]);
  const hasMaking = state.jobs.some((job) => !job.done);
  // 前の利用者の服（端末に残してあるだけ）は、出さない
  const userCode = state.user?.userCode;
  const mine = useMemo(() => (items ?? []).filter((item) => item.owner === userCode), [items, userCode]);
  const choosable = useMemo(() => mine.filter((item) => !makingIds.has(item.id) && !notMovable.has(item.id)), [mine, makingIds, notMovable]);

  const finish = useCallback(async (next: TradeState) => {
    if (resultRef.current) return;
    resultRef.current = true;
    finishedRef.current = true;
    if (next.status === 'done') {
      diag.note('trade', 'result done');
      const { session: s, onLibraryChanged: changed } = callbacks.current;
      if (next.receivedId) s.markNew(next.receivedId);
      try {
        await s.refresh();
        await changed();
      } catch {
        // 一覧は、あとで開いたときに合う
      }
    } else {
      diag.note('trade', `result cancelled reason=${next.reason ?? 'none'}`);
    }
  }, []);

  const apply = useCallback(
    (next: TradeState) => {
      if (finishedRef.current) return; // 終わったあとに届いた返事は、使わない
      const prev = latestRef.current;
      if (prev && prev.id === next.id && RANK[next.status] < RANK[prev.status]) return;
      const merged = prev && prev.id === next.id && prev.myAccepted && !next.myAccepted ? { ...next, myAccepted: true } : next;
      latestRef.current = merged;
      setTrade(merged);
      if (merged.status === 'done' || merged.status === 'cancelled') void finish(merged);
    },
    [finish],
  );

  const poll = useCallback(async () => {
    const id = idRef.current;
    if (!id || pollingRef.current || finishedRef.current) return;
    pollingRef.current = true;
    try {
      const next = await backend.trade(id);
      if (idRef.current === id) apply(next);
    } catch {
      // つぎの 1.5 秒で、また聞く
    } finally {
      pollingRef.current = false;
    }
  }, [backend, apply]);

  const begin = useCallback(
    (id: string) => {
      idRef.current = id;
      latestRef.current = null;
      finishedRef.current = false;
      resultRef.current = false;
      setTradeId(id);
      setLocal('active');
    },
    [],
  );

  // 1.5 秒おきに様子を聞く。戻ってきたら、すぐ聞く
  useEffect(() => {
    if (!tradeId || isFinished(stage)) return;
    const timer = window.setInterval(() => void poll(), POLL_MS);
    const visible = () => document.visibilityState === 'visible' && void poll();
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [tradeId, stage, poll]);

  // QR を出している間、1 分ごとに合い言葉を替える
  useEffect(() => {
    if (!tradeId || stage !== 'show-qr') return;
    const timer = window.setInterval(() => {
      backend.tradeCode(tradeId).then(
        (next) => {
          diag.note('trade', 'code');
          setCode(next);
        },
        () => undefined,
      );
    }, CODE_MS);
    return () => window.clearInterval(timer);
  }, [backend, tradeId, stage]);

  // 閉じる・ページを離れるとき、終わっていない交換をやめる（失敗は無視）
  useEffect(() => {
    const cancel = () => {
      const id = idRef.current;
      if (!id || finishedRef.current) return;
      idRef.current = null;
      backend.tradeCancel(id).catch(() => undefined);
    };
    window.addEventListener('pagehide', cancel);
    return () => {
      window.removeEventListener('pagehide', cancel);
      // 「はい」を押したあと、結果を見ないまま閉じた: 入れ替わったかもしれないので、一覧を合わせ直す（失敗は無視）
      const unseen = !!latestRef.current?.myAccepted && !resultRef.current;
      cancel();
      if (unseen) {
        const { session: s, onLibraryChanged: changed } = callbacks.current;
        void s
          .refresh()
          .then(() => changed())
          .catch(() => undefined);
      }
    };
  }, [backend]);

  const guard = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof BackendError && error.code === 'old-server') setSupported(false);
      else setMessage(errorText(error));
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  // 動かせない服と断られたら、その服は、もう出さない
  const markNotMovable = (error: unknown, itemId: string): unknown => {
    if (error instanceof BackendError && error.tradeRefusal === 'not-movable' && mountedRef.current) setNotMovable((set) => new Set(set).add(itemId));
    return error;
  };

  const showWith = (item: MyItem) =>
    guard(async () => {
      const opened = await backend.tradeOpen(item.id).catch((error: unknown) => {
        throw markNotMovable(error, item.id);
      });
      if (!mountedRef.current) {
        backend.tradeCancel(opened.tradeId).catch(() => undefined); // 閉じたあとに始まった交換は、やめる
        return;
      }
      diag.note('trade', 'open');
      setCode(opened.code);
      setTrade(null);
      begin(opened.tradeId);
      void poll();
    });

  const claim = (text: string) =>
    guard(async () => {
      try {
        const claimed = await backend.tradeClaim(text);
        if (!mountedRef.current) {
          backend.tradeCancel(claimed.tradeId).catch(() => undefined);
          return;
        }
        diag.note('trade', 'join ok');
        begin(claimed.tradeId);
        await poll();
      } catch (error) {
        if (error instanceof BackendError && error.tradeRefusal) diag.note('trade', `join ${error.tradeRefusal}`);
        setScanKey((key) => key + 1); // 読み直す
        throw error;
      }
    });

  const joinWith = (item: MyItem) =>
    guard(async () => {
      if (!tradeId) return;
      await backend.tradeJoin(tradeId, item.id).catch((error: unknown) => {
        throw markNotMovable(error, item.id);
      });
      await poll();
    });

  const accept = () =>
    guard(async () => {
      if (!tradeId) return;
      diag.note('trade', 'accept');
      apply(await backend.tradeAccept(tradeId));
    });

  const cancel = () =>
    guard(async () => {
      if (!tradeId) return;
      await backend.tradeCancel(tradeId);
      await poll();
    });

  const choose = (onPick: (item: MyItem) => void) => <Picker items={choosable} dolls={dolls} categoriesByDoll={categoriesByDoll} onPick={onPick} hasMaking={hasMaking || notMovable.size > 0} disabled={busy} />;
  const cancelButton = (
    <button type="button" className="trade-btn plain" onClick={() => void cancel()} disabled={busy} data-testid="trade-cancel">
      やめる
    </button>
  );

  let body;
  if (loadError) {
    body = (
      <>
        <p className="trade-big" data-testid="trade-message">
          {loadError}
        </p>
        <button type="button" className="trade-btn" onClick={() => setAttempt((n) => n + 1)} data-testid="trade-retry">
          もういちど
        </button>
      </>
    );
  } else if (supported === null || items === null) {
    body = <p className="trade-big">よみこみちゅう…</p>;
  } else if (!supported) {
    body = (
      <p className="trade-big" data-testid="trade-old-server">
        {OLD_SERVER_TEXT}
      </p>
    );
  } else if (mine.length === 0) {
    body = (
      <p className="trade-big" data-testid="trade-no-items">
        こうかんできる ふくが ないよ
      </p>
    );
  } else {
    switch (stage) {
      case 'menu':
        body = (
          <>
            <p className="trade-big">どうする？</p>
            <div className="trade-row">
              <button type="button" className="trade-btn" onClick={() => setLocal('pick-show')} data-testid="trade-show">
                QRコードを だす
              </button>
              <button type="button" className="trade-btn" onClick={() => setLocal('scan')} data-testid="trade-scan">
                QRコードを よむ
              </button>
            </div>
          </>
        );
        break;
      case 'pick-show':
        body = (
          <>
            <p className="trade-big">わたす ふくを えらんでね</p>
            {choose((item) => void showWith(item))}
          </>
        );
        break;
      case 'scan':
        body = <QrScan key={scanKey} onCode={(text) => void claim(text)} test={readStudioMode(window.location.search) === 'fake'} />;
        break;
      case 'show-qr':
        body = (
          <>
            {code && <QrShow code={code} />}
            <p className="trade-big">あいての がめんで よんでね</p>
            {cancelButton}
          </>
        );
        break;
      case 'partner-choosing':
        body = (
          <>
            <p className="trade-big" data-testid="trade-partner-choosing">
              あいてが ふくを えらんでいるよ
            </p>
            <Card item={trade?.mine} />
            {cancelButton}
          </>
        );
        break;
      case 'choose':
        body = (
          <>
            <p className="trade-big">わたす ふくを えらんでね</p>
            {choose((item) => void joinWith(item))}
            {cancelButton}
          </>
        );
        break;
      case 'confirm':
        body = trade && (
          <>
            <div className="trade-swap">
              <Card item={trade.mine} />
              <span className="trade-arrow" aria-hidden="true">
                ⇄
              </span>
              <Card item={trade.theirs} />
            </div>
            <p className="trade-big" data-testid="trade-confirm">
              {trade.mine?.name ?? ''} と {trade.theirs?.name ?? ''}を こうかんする？
            </p>
            {trade.theirAccepted && (
              <p className="trade-ok" data-testid="trade-partner-ok">
                あいては OK
              </p>
            )}
            <div className="trade-row">
              {cancelButton}
              {trade.myAccepted ? (
                <p className="trade-small">あいてを まっているよ…</p>
              ) : (
                <button type="button" className="trade-btn" onClick={() => void accept()} disabled={busy} data-testid="trade-accept">
                  こうかんする
                </button>
              )}
            </div>
          </>
        );
        break;
      case 'done':
        body = (
          <div data-testid="trade-done">
            <p className="trade-big">こうかん できたよ！</p>
            <div className="trade-received">
              <Card item={trade?.theirs} isNew />
            </div>
            <button type="button" className="trade-btn" onClick={onClose} data-testid="trade-to-closet">
              クローゼットで みる
            </button>
          </div>
        );
        break;
      case 'ended':
        body = (
          <p className="trade-big" data-testid="trade-ended">
            こうかんは やめに なったよ
          </p>
        );
        break;
      default:
        body = <p className="trade-big">よみこみちゅう…</p>;
    }
  }

  return (
    <div className="trade-overlay" data-testid="trade">
      <div className="trade-panel">
        <header className="trade-header">
          <h2>
            <span aria-hidden="true">🔁</span> こうかん
          </h2>
          <button type="button" className="trade-close" onClick={onClose} aria-label="とじる" data-testid="trade-close">
            ✕
          </button>
        </header>
        {message && (
          <p className="trade-message" role="alert" data-testid="trade-message">
            {message}
          </p>
        )}
        <div className="trade-body">{body}</div>
      </div>
    </div>
  );
}

function Card({ item, isNew = false }: { item: TradeItem | undefined; isNew?: boolean }) {
  if (!item) return null;
  return (
    <div className="trade-card">
      <span className="trade-thumb">
        <BlobImage blob={item.thumb} alt="" hue={item.hue} />
      </span>
      {isNew && <span className="trade-new">NEW</span>}
      <span className="trade-name">{item.name}</span>
    </div>
  );
}

interface PickerProps {
  items: MyItem[];
  dolls: DollData[];
  categoriesByDoll: Record<string, ManifestCategory[]>;
  onPick: (item: MyItem) => void;
  hasMaking: boolean;
  disabled: boolean;
}

// 渡す服をえらぶ（クローゼットと同じ並び）
function Picker({ items, dolls, categoriesByDoll, onPick, hasMaking, disabled }: PickerProps) {
  const [chosenDoll, setChosenDoll] = useState<string | null>(null);
  const tabs = useMemo(() => closetDolls(items, dolls, ''), [items, dolls]);
  const dollId = tabs.some((doll) => doll.id === chosenDoll) ? chosenDoll! : (tabs[0]?.id ?? '');
  const groups = useMemo(() => closetGroups(items, dollId, categoriesByDoll[dollId] ?? NO_CATEGORIES), [items, dollId, categoriesByDoll]);
  return (
    <div className="trade-picker">
      {tabs.length > 1 && (
        <div className="trade-dolls" role="tablist">
          {tabs.map((doll) => (
            <button key={doll.id} type="button" role="tab" aria-selected={doll.id === dollId} onClick={() => setChosenDoll(doll.id)}>
              {doll.name}
            </button>
          ))}
        </div>
      )}
      {groups.map((group) => (
        <section key={group.categoryId || 'other'}>
          <h3>{group.label}</h3>
          <div className="trade-grid">
            {group.items.map((item) => (
              <button key={item.id} type="button" className="trade-item" onClick={() => onPick(item)} disabled={disabled} data-testid="trade-pick-item">
                <span className="trade-thumb">
                  <BlobImage blob={item.files[item.item.thumb]} alt="" hue={item.hue} />
                </span>
                <span className="trade-name">{item.item.name}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
      {items.length === 0 && <p className="trade-big">こうかんできる ふくが ないよ</p>}
      {hasMaking && <p className="trade-small">つくっている とちゅうの ふくは、できあがってから</p>}
    </div>
  );
}
