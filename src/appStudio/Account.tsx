/**
 * 「つくる」の中の「アカウント」の欄（Google のアカウントでログイン・ログアウト）。
 *
 * 方法 1（小さい窓）は、ボタンを押した、その場で窓を開かないと、ブラウザ（とくに iPad・iPhone）が止める。
 * だから、準備（口・client_id・端末が空か）は、欄が出たときに済ませておき、onClick では、何も待たずに loginWithPopup を呼ぶ。
 * ボタンは、大きい 1 つ（画面を移る方法）と、「うまくいかないとき」の小さい 1 つ（小さい窓）。
 * ログインの結果の仕上げ（もう使われているときの合わせる・入ったあとの読み込み直し）は、account.ts の settleLogin に任せる。
 * 文は、設計書 7.1・7.2・7.4・8.8 のとおり（大人向け）。メールアドレスは、きろく・console には出さない（画面にだけ出す）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { accountLabel, browserSettleDeps, deviceEmpty, forgetAccount, intentFor, LOGIN_MESSAGES, settleLogin } from '../cloud/account';
import type { AccountInfo, LoginResult } from '../cloud/account';
import type { StudioUser } from '../cloud/backend';
import type { LoginIntent } from '../cloud/googleRedirect';
import type { Library } from '../cloud/library';
import type { CloudSession } from '../cloud/session';

interface Props {
  session: CloudSession;
  library: Library;
  reload?: () => void;
}

const TEXT = {
  heading: 'アカウント',
  lead: 'Google のアカウントでログインすると、ほかの端末でも、同じチケットと服を使えます。',
  redirect: 'Google でログイン',
  fallback: 'うまくいかないとき: ',
  popup: '小さい窓でログイン',
  preparing: '準備しています…',
  unavailable: 'いまは、ログインの準備ができません（インターネットを確かめてください）',
  busy: 'ログインしています…',
  logout: 'ログアウト',
  logoutConfirm: 'ログアウトすると、この端末では、チケットと作った服が見えなくなります。アカウントには残っていて、同じ Google でログインすると戻ります。',
  logoutYes: 'ログアウトする',
  logoutNo: 'やめる',
  logoutFailed: 'ログアウトできませんでした。少し待ってから、もう一度ためしてください',
  logoutOffline: 'ログアウトできませんでした。インターネットを確かめて、もう一度ためしてください',
};

const safeStorage = (pick: () => Storage): Storage | null => {
  try {
    return pick();
  } catch {
    return null;
  }
};

export function Account({ session, library, reload = () => window.location.reload() }: Props) {
  const { account } = session.backend;
  const [info, setInfo] = useState<AccountInfo | null>(null); // null = まだ準備中
  const [unavailable, setUnavailable] = useState(false);
  const [checked, setChecked] = useState<{ stamp: string; empty: boolean } | null>(null); // 「空か」を聞いた結果と、聞いたときの状態
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false); // 小さくたたんでおく（知らせ・確かめ・待ちの間は、開く）
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    // 準備: 口（Firebase の読み込み・いまの利用者）・方法 2 の client_id。押す前に済ませる
    void (async () => {
      try {
        const [now] = await Promise.all([account.prepare(), account.canRedirect().catch(() => false)]);
        if (mounted.current) setInfo(now);
      } catch {
        if (mounted.current) setUnavailable(true);
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, [account]);

  // 端末が空か。欄を出している間に変わることがある（チケットが届いた・注文した）ので、つなぎ役が知らせるたびに、聞き直す。
  // 聞き直している間は、ボタンを押せない（古い「空」のまま「入る」と、届いたチケットや服を置き去りにする）
  const live = useSyncExternalStore(session.subscribe, session.getState);
  const stamp = `${live.user?.userCode}|${live.user?.tickets}|${live.user?.admin}|${live.jobs.length}`;
  const signedIn = info?.kind === 'google';
  useEffect(() => {
    let alive = true;
    const check = () =>
      void deviceEmpty(session.backend).then((isEmpty) => {
        if (alive) setChecked({ stamp, empty: isEmpty });
      });
    check();
    // 作者がよそから配ったチケットは、つなぎ役が知らない。入っていない間は、20 秒おきと、画面に戻ったときにも聞き直す。
    // この聞き直しの間は、前の答えのまま、ボタンを押せる（押せなくなるのは、状態の印が変わったときだけ）
    if (signedIn) {
      return () => {
        alive = false;
      };
    }
    const timer = setInterval(check, 20_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
    };
  }, [session, stamp, signedIn]);
  const empty = checked?.stamp === stamp ? checked.empty : null; // 状態が変わったあと、聞き直しが済むまでは null

  const ready = info !== null && empty !== null;

  // 結果を、欄に反映する。仕上げ（settleLogin）が null を返したら（読み込み直す・画面が移る）、待ちのまま
  const handle = async (result: LoginResult, method: 'popup' | 'redirect', before: StudioUser | null) => {
    let settled: LoginResult | null;
    try {
      settled = await settleLogin(browserSettleDeps(session.backend, library, reload), result, method, before);
    } catch {
      settled = { outcome: 'failed' }; // 中身（メールアドレスなど）が入りうるので、エラーは書き出さない
    }
    if (!settled || !mounted.current) return;
    if (settled.outcome === 'linked') {
      try {
        setInfo(await account.prepare());
      } catch {
        // いまの状態が聞けなくても、文は出す
      }
    }
    if (!mounted.current) return;
    setBusy(false);
    setMessage(LOGIN_MESSAGES[settled.outcome]);
  };

  // 結び付けるか、入るか。合わせる途中（10 分以内の offered の覚え）なら、空でなくても入る
  const intentNow = (): LoginIntent => intentFor(empty === true, safeStorage(() => window.localStorage), Date.now());

  const loginWithPopup = () => {
    // 窓を開くのが、最初。この前に await しない（ブラウザに止められる）
    const pending = account.loginWithPopup(intentNow());
    const before = session.getState().user ?? null;
    setBusy(true);
    setMessage(null);
    void pending.then(
      (result) => handle(result, 'popup', before),
      () => handle({ outcome: 'failed' }, 'popup', before),
    );
  };

  const loginWithRedirect = () => {
    const before = session.getState().user ?? null;
    setBusy(true);
    setMessage(null);
    // 画面が移れば、これは返らない。返ってきたら、移れなかった
    void account.startRedirect(intentNow()).then(
      (result) => handle(result, 'redirect', before),
      () => handle({ outcome: 'failed' }, 'redirect', before),
    );
  };

  const logout = async () => {
    setBusy(true);
    setMessage(null);
    // ログアウト前の利用者コード（ログアウトで、つなぎ役のいまの利用者が、空の利用者に替わることがある）。
    // つなぎ役が知らなければ（つながっていない）、聞く。分からないままログアウトすると、この端末に服が残るので、ログアウトしない
    let userCode = session.getState().user?.userCode;
    if (!userCode) {
      try {
        userCode = (await session.backend.signIn()).userCode;
      } catch {
        userCode = undefined;
      }
    }
    if (!userCode) {
      if (mounted.current) {
        setBusy(false);
        setConfirming(false);
        setMessage(TEXT.logoutOffline);
      }
      return;
    }
    try {
      await account.logout();
    } catch {
      // 何も消さない。Firebase のエラーの中身は、出さない
      if (mounted.current) {
        setBusy(false);
        setConfirming(false);
        setMessage(TEXT.logoutFailed);
      }
      return;
    }
    // うまくいったときだけ、端末の控えから、このアカウントの服を外す。外せなくても、読み込み直す
    try {
      await forgetAccount(library, userCode, safeStorage(() => window.localStorage));
    } catch {
      // 控えが読めなくても、ログアウトはもう済んでいる
    } finally {
      reload();
    }
  };

  const note = unavailable ? TEXT.unavailable : message;

  return (
    <details className="studio-account" data-testid="account-section" open={open || busy || confirming || note !== null} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="studio-account-summary" data-testid="account-summary">
        {info?.kind === 'google' ? `👤 ${accountLabel(info)}` : `${TEXT.heading}（Google でログイン）`}
      </summary>
      {info?.kind === 'google' ? (
        <>
          <div className="studio-row studio-account-row">
            <span className="studio-account-email" data-testid="account-email">
              {info.name.trim() ? `${info.name.trim()} でログイン中` : 'ログイン中'}
            </span>
            {!confirming && (
              <button type="button" onClick={() => setConfirming(true)} disabled={busy} data-testid="account-logout">
                {TEXT.logout}
              </button>
            )}
          </div>
          {confirming && (
            <div className="studio-account-confirm" data-testid="account-logout-confirm">
              <p>{TEXT.logoutConfirm}</p>
              <div className="studio-row">
                <button type="button" onClick={() => void logout()} disabled={busy} data-testid="account-logout-yes">
                  {TEXT.logoutYes}
                </button>
                <button type="button" onClick={() => setConfirming(false)} disabled={busy} data-testid="account-logout-no">
                  {TEXT.logoutNo}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="studio-note">{TEXT.lead}</p>
          <div className="studio-account-buttons">
            <button type="button" onClick={loginWithRedirect} disabled={!ready || busy} data-testid="account-login-redirect">
              {TEXT.redirect}
            </button>
          </div>
          <div className="studio-hint studio-account-fallback">
            <span>{TEXT.fallback}</span>
            <button type="button" className="studio-account-small" onClick={loginWithPopup} disabled={!ready || busy} data-testid="account-login-popup">
              {TEXT.popup}
            </button>
          </div>
          {!ready && !unavailable && <p className="studio-hint">{TEXT.preparing}</p>}
        </>
      )}
      {busy && info?.kind !== 'google' && (
        <p className="studio-hint" data-testid="account-busy">
          {TEXT.busy}
        </p>
      )}
      {note && (
        <p className="studio-account-message" role="status" data-testid="account-message">
          {note}
        </p>
      )}
    </details>
  );
}
