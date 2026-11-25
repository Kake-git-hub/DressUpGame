/**
 * チケットを買う: パックを選ぶ → 最終確認 → 支払いのページへ（同じ画面のまま移る）
 *
 * 最終確認は、特定商取引法 12 条の 6（最終確認画面）の項目をすべて出す。この画面を通さずに、支払いへは進めない。
 * 同意の印を付けるまで「支払いへ進む」は押せない。保護者の確認（AdultGate）は、呼ぶ側が毎回済ませ、通った時刻を adultAt で渡す。
 * 文言は仮（作者の了承を得てから売り始める）。カード・金額・支払いの番号は、きろくに書かない。
 */
import { useMemo, useState } from 'react';
import { BackendError } from '../cloud/backend';
import type { StudioBackend } from '../cloud/backend';
import { addMonthsJst, formatJstDate, LOT_MONTHS } from '../cloud/expiry';
import type { WireShop } from '../cloud/wire';
import { diag } from '../services/diag';
import { rememberSession } from './payReturn';
import './shop.css';

export type Pack = WireShop['packs'][number];

export interface ShopProps {
  backend: StudioBackend;
  packs: Pack[];
  adultAt: number; // 保護者の確認を通った時刻
  onClose: () => void;
  onLogin?: () => void; // ログインが要るとき、ログインの欄へ案内する
  go?: (url: string) => void; // 支払いのページへ移る（既定は location.assign）
}

// 断られたときの文（サーバーの理由 → 画面の文）
const REFUSED: Record<string, string> = {
  login: 'Google で ログインすると かえます',
  closed: 'いまは、チケットを かえません',
  pack: 'このパックは、いまは かえません。もどって えらびなおしてね',
  limit: 'きょうは、これいじょう お支払いの ページを つくれません。あしたに なってから ためしてね',
};
const FAILED = '支払いの ページを ひらけませんでした。インターネットを たしかめて、もう一度 ためしてね';
const LEGAL = [
  { id: 'tokushoho', href: 'legal/tokushoho.html', label: '特定商取引法に基づく表記' },
  { id: 'terms', href: 'legal/terms.html', label: '利用規約' },
  { id: 'privacy', href: 'legal/privacy.html', label: 'プライバシーポリシー' },
];
const baseHref = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export function Shop({ backend, packs, adultAt, onClose, onLogin, go = (url) => window.location.assign(url) }: ShopProps) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [agreed, setAgreed] = useState<number | null>(null); // 同意の印を付けた時刻
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; login: boolean } | null>(null);
  // 有効期限: 買った日から 6 か月（日本時間）。最終確認を出した時刻から数える
  const until = useMemo(() => formatJstDate(addMonthsJst(Date.now(), LOT_MONTHS)), [pack]); // eslint-disable-line react-hooks/exhaustive-deps

  const pay = async () => {
    if (!pack || agreed === null || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const made = await backend.checkout(pack.id, adultAt, agreed);
      diag.note('pay', 'checkout', 'ok');
      rememberSession(made.session);
      go(made.url);
    } catch (error) {
      const reason = error instanceof BackendError ? error.payRefusal : undefined;
      diag.note('pay', 'checkout', reason ? `refused reason=${reason}` : 'failed');
      setMessage({ text: reason && REFUSED[reason] ? REFUSED[reason] : reason === 'other' ? REFUSED.closed : FAILED, login: reason === 'login' });
      setBusy(false);
    }
  };

  return (
    <div className="shop-overlay" data-testid="shop">
      <div className="studio-panel shop-panel">
        {!pack ? (
          <>
            <h2>🎫 チケットを買う</h2>
            <p className="studio-note">チケット 1 枚で、服を 1 点 作れます。どれに しますか？</p>
            <div className="shop-packs">
              {packs.map((p) => (
                <button key={p.id} type="button" className="shop-pack" onClick={() => setPack(p)} data-testid={`shop-pack-${p.id}`}>
                  <b>{p.tickets} 枚</b>
                  <span>{p.price} 円</span>
                </button>
              ))}
            </div>
            <div className="studio-row">
              <button type="button" onClick={onClose} data-testid="shop-close">
                やめる
              </button>
            </div>
          </>
        ) : (
          <>
            <h2>ごちゅうもんの 内容</h2>
            <p className="studio-hint">支払いへ進む前に、よく読んでください。</p>
            <dl className="shop-confirm" data-testid="shop-confirm">
              <dt>ご購入</dt>
              <dd>チケット {pack.tickets} 枚（服 {pack.tickets} 点ぶん）</dd>
              <dt>代金</dt>
              <dd>
                税込 {pack.price} 円
              </dd>
              <dt>支払い</dt>
              <dd>クレジットカードなど（Stripe のページで入力します）。支払いは、その場で確定します</dd>
              <dt>お渡し</dt>
              <dd>支払いのあと、すぐに使えます</dd>
              <dt>有効期限</dt>
              <dd data-testid="shop-until">買った日から 6 か月（{until}まで）。過ぎると使えません</dd>
              <dt>返品・返金</dt>
              <dd>買ったあとの 返品・返金はできません。うまく作れなかった服の チケットは、自動で戻ります。不具合のときは、ご連絡ください</dd>
            </dl>
            <p className="shop-links">
              {LEGAL.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && ' ・ '}
                  <a href={baseHref(l.href)} target="_blank" rel="noopener noreferrer" data-testid={`shop-link-${l.id}`}>
                    {l.label}
                  </a>
                </span>
              ))}
            </p>
            <label className="studio-check">
              <input type="checkbox" checked={agreed !== null} onChange={(e) => setAgreed(e.target.checked ? Date.now() : null)} data-testid="shop-agree" /> 上の内容と利用規約に同意します
            </label>
            {message && (
              <p className="studio-error" data-testid="shop-message">
                {message.text}
              </p>
            )}
            <div className="studio-row">
              <button
                type="button"
                onClick={() => {
                  setPack(null);
                  setAgreed(null);
                  setMessage(null);
                }}
                disabled={busy}
                data-testid="shop-back"
              >
                もどる
              </button>
              {message?.login && onLogin ? (
                <button type="button" className="primary" onClick={onLogin} data-testid="shop-login">
                  ログインへ
                </button>
              ) : (
                <button type="button" className="primary" onClick={() => void pay()} disabled={agreed === null || busy} data-testid="shop-pay">
                  {busy ? 'ひらいています…' : '支払いへ進む'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
