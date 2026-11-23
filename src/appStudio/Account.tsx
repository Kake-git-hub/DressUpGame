/**
 * 「つくる」の中の「アカウント」の欄（Google のアカウントでログイン・ログアウト）。
 *
 * 方法 1（小さい窓）は、ボタンを押した、その場で窓を開かないと、ブラウザ（とくに iPad・iPhone）が止める。
 * だから、準備（口・client_id・端末が空か）は、欄が出たときに済ませておき、onClick では、何も待たずに loginWithPopup を呼ぶ。
 * 文は、設計書 7.1・7.2・7.4 のとおり（大人向け）。メールアドレスは、きろく・console には出さない（画面にだけ出す）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { deviceEmpty, forgetAccount, LOGIN_MESSAGES, NOTICE_KEY } from '../cloud/account';
import type { AccountInfo, LoginResult } from '../cloud/account';
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
  popup: 'Google でログイン（方法 1: 小さい窓）',
  redirect: 'Google でログイン（方法 2: 画面を移る）',
  trial: 'ためしの版です。どちらの方法で、うまくいったか・いかなかったかを、きろく（log）から報告してください。',
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
  const intent: LoginIntent = empty ? 'signin' : 'link';

  // 結果を、欄に反映する。switched は、読み込み直すので、待ちのまま
  const handle = async (result: LoginResult, userBefore: string | null) => {
    if (result.outcome === 'switched') {
      // 入る前の利用者の服だけ、控えから外す（サーバーに残っている。「前の利用者の服」は触らない）
      // 控えが読めなくても、利用者は替わっている。知らせは置き、読み込み直しは、必ずする
      try {
        try {
          if (userBefore) await forgetAccount(library, userBefore, safeStorage(() => window.localStorage));
        } catch {
          // 控えが外せなくても、進む
        }
        try {
          safeStorage(() => window.sessionStorage)?.setItem(NOTICE_KEY, LOGIN_MESSAGES.switched);
        } catch {
          // 知らせが置けなくても、読み込み直す
        }
      } finally {
        reload();
      }
      return;
    }
    if (!mounted.current) return;
    if (result.outcome === 'linked') {
      try {
        setInfo(await account.prepare());
      } catch {
        // いまの状態が聞けなくても、文は出す
      }
    }
    if (!mounted.current) return;
    setBusy(false);
    setMessage(LOGIN_MESSAGES[result.outcome]);
  };

  const loginWithPopup = () => {
    // 窓を開くのが、最初。この前に await しない（ブラウザに止められる）
    const pending = account.loginWithPopup(intent);
    const userBefore = session.getState().user?.userCode ?? null;
    setBusy(true);
    setMessage(null);
    void pending.then(
      (result) => handle(result, userBefore),
      () => handle({ outcome: 'failed' }, userBefore),
    );
  };

  const loginWithRedirect = () => {
    setBusy(true);
    setMessage(null);
    // 画面が移れば、これは返らない。返ってきたら、移れなかった
    void account.startRedirect(intent).then(
      (result) => handle(result, null),
      () => handle({ outcome: 'failed' }, null),
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
    <section className="studio-account" data-testid="account-section">
      <h3>{TEXT.heading}</h3>
      {info?.kind === 'google' ? (
        <>
          <div className="studio-row studio-account-row">
            <span className="studio-account-email" data-testid="account-email">
              {info.email ? `ログイン中: ${info.email}` : 'ログイン中'}
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
            <button type="button" onClick={loginWithPopup} disabled={!ready || busy} data-testid="account-login-popup">
              {TEXT.popup}
            </button>
            <button type="button" onClick={loginWithRedirect} disabled={!ready || busy} data-testid="account-login-redirect">
              {TEXT.redirect}
            </button>
          </div>
          {!ready && !unavailable && <p className="studio-hint">{TEXT.preparing}</p>}
          <p className="studio-hint">{TEXT.trial}</p>
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
    </section>
  );
}
