/**
 * 「つくる」の、支払いまわりの準備と知らせ（買うボタンを出すか・支払いから戻ったときの確かめ・足されたことなどのお知らせ）
 *
 * - 開いたとき: お店の様子（shop）を聞く。まだ伝えていない「足された支払い」は、1 つずつ知らせて、伝えた印を付ける
 * - 支払いから戻ったとき（?pay=done）: 3 秒おきに purchase で聞く。30 秒たっても足されなければ、あとで見てもらう
 * - ようこそ・もうすぐ切れるチケットの知らせ
 * カード・金額・支払いの番号は、きろくに書かない。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BackendError } from '../cloud/backend';
import type { CloudSession } from '../cloud/session';
import { formatJstDate } from '../cloud/expiry';
import type { WireShop } from '../cloud/wire';
import { diag } from '../services/diag';
import { forgetSession, pendingSession } from './payReturn';
import type { PayReturn } from './payReturn';

export type ReturnStatus = 'checking' | 'paid' | 'slow' | 'other' | 'expired' | 'cancel';
export interface PayReturnState {
  status: ReturnStatus;
  added: number;
}
export interface PayNotice {
  id: number;
  text: string;
}

export const POLL_MS = 3000;
export const GIVE_UP_MS = 30_000;
const SOON_MS = 14 * 24 * 3600 * 1000;
export const NOTICED_KEY = 'dressup_lot_noticed'; // 「もうすぐ切れる」を知らせた期限（lot ごと）

export const RETURN_TEXT: Record<Exclude<ReturnStatus, 'paid'>, string> = {
  checking: 'お支払いを たしかめています…',
  slow: 'お支払いの確認に じかんが かかっています。あとで チケットの のこりを 見てね',
  other: 'お支払いは うけつけました。ホーム画面の アプリを ひらくと、チケットが ふえています',
  expired: 'お支払いは かんりょうしませんでした（チケットは ふえていません）',
  cancel: 'お支払いを やめました',
};

function readNoticed(): number[] {
  try {
    const value = JSON.parse(localStorage.getItem(NOTICED_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((v): v is number => typeof v === 'number') : [];
  } catch {
    return [];
  }
}
function writeNoticed(list: number[]): void {
  try {
    localStorage.setItem(NOTICED_KEY, JSON.stringify(list.slice(-50)));
  } catch {
    // 保存できなくても動く
  }
}

export function usePay(session: CloudSession, payReturn: PayReturn | null) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  const { user, welcome } = state;
  const ready = user !== null;
  const [shop, setShop] = useState<WireShop | null>(null);
  const [returned, setReturned] = useState<PayReturnState | null>(payReturn?.kind === 'cancel' ? { status: 'cancel', added: 0 } : payReturn?.kind === 'done' ? { status: 'checking', added: 0 } : null);
  const [notices, setNotices] = useState<PayNotice[]>([]);
  const welcomed = useRef<number | null>(null); // 開発用の二重実行で、2 回出さない
  const add = (text: string) => setNotices((list) => [...list, { id: (list.at(-1)?.id ?? 0) + 1, text }]);

  // 戻り: やめた
  useEffect(() => {
    if (payReturn?.kind !== 'cancel') return;
    diag.note('pay', 'return', 'cancel');
    forgetSession();
  }, [payReturn]);

  // お店の様子と、足された支払いの知らせ・戻りの確かめ
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const backend = session.backend;
    const returnId = payReturn?.kind === 'done' ? payReturn.session : null;
    const pending = returnId ?? pendingSession();

    // 足されたことを知らせて、伝えた印を付ける
    const credited = async (id: string, tickets: number, notify = true) => {
      if (notify) add(`チケットが ${tickets} 枚 ふえました`);
      forgetSession();
      await backend.shopAck(id).catch(() => undefined);
    };

    const watchReturn = (id: string) => {
      const started = Date.now();
      diag.note('pay', 'return', 'done');
      const step = async () => {
        if (cancelled) return;
        let result: 'paid' | 'expired' | 'other' | 'open' = 'open';
        let tickets = 0;
        try {
          const p = await backend.purchase(id);
          if (cancelled) return;
          tickets = p.added || p.tickets;
          if (p.status === 'paid') result = 'paid';
          else if (p.status === 'expired') result = 'expired';
          if (result === 'paid') diag.note('pay', 'result', `paid added=${p.added}`);
        } catch (error) {
          if (cancelled) return;
          if (error instanceof BackendError && error.payRefusal === 'other') result = 'other';
          // つながらないだけなら、また聞く
        }
        if (result === 'paid') {
          setReturned({ status: 'paid', added: tickets });
          await credited(id, tickets, false);
        } else if (result === 'expired' || result === 'other') {
          diag.note('pay', 'result', result);
          setReturned({ status: result, added: 0 });
          if (result === 'expired') forgetSession();
        } else if (Date.now() - started >= GIVE_UP_MS) {
          diag.note('pay', 'result', 'slow');
          setReturned({ status: 'slow', added: 0 });
        } else {
          timer = setTimeout(() => void step(), POLL_MS);
        }
      };
      void step();
    };

    void (async () => {
      try {
        if (!(await backend.canPay())) return;
        const got = await backend.shop();
        if (cancelled) return;
        diag.note('pay', 'shop', `open=${got.open}`, `packs=${got.packs.length}`);
        setShop(got);
        // 覚えた番号が無い端末（Safari で戻った・別の端末）でも分かるように、まだ伝えていない分を 1 つずつ知らせる
        for (const a of got.announce) {
          if (a.session === returnId) continue;
          add(`チケットが ${a.tickets} 枚 ふえました`);
          await backend.shopAck(a.session).catch(() => undefined);
        }
        if (cancelled) return;
        if (returnId) watchReturn(returnId);
        else if (pending) {
          // 前に支払いへ移ったまま、結果を見ていなかった分
          const p = await backend.purchase(pending).catch(() => null);
          if (cancelled || !p) return;
          if (p.added > 0) await credited(pending, p.added);
          else if (p.status !== 'open') forgetSession();
        }
      } catch (error) {
        // 買えないだけ（古いサーバー・つながらない）。ボタンを出さないだけで、「つくる」は使える
        if (returnId && !cancelled && error instanceof BackendError && error.payRefusal === 'other') setReturned({ status: 'other', added: 0 });
        else if (returnId && !cancelled) setReturned({ status: 'slow', added: 0 });
      }
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ready, session, payReturn]);

  // ようこそ（起動のときのログインで足された分。1 回だけ）
  useEffect(() => {
    if (welcome === null || welcomed.current === welcome) return;
    welcomed.current = welcome;
    // 外（つなぎ役）から届いた 1 回かぎりの知らせを、画面の知らせにする
    // eslint-disable-next-line react-hooks/set-state-in-effect
    add(`ようこそ！ チケットを ${welcome} 枚 プレゼント`);
    session.clearWelcome();
  }, [welcome, session]);

  // 14 日いないに切れる買った分（その端末で、lot ごとに 1 回）
  useEffect(() => {
    if (!user) return;
    const now = Date.now();
    const noticed = readNoticed();
    const soon = user.lots.filter((lot) => lot.left > 0 && lot.expiresAt > now && lot.expiresAt - now <= SOON_MS && !noticed.includes(lot.expiresAt));
    if (soon.length === 0) return;
    writeNoticed([...noticed, ...soon.map((lot) => lot.expiresAt)]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    for (const lot of soon) add(`${lot.left} 枚の チケットが ${formatJstDate(lot.expiresAt)}で つかえなくなります`);
  }, [user]);

  return { shop, returned, notices, dismiss: (id: number) => setNotices((list) => list.filter((n) => n.id !== id)) };
}
