/**
 * チケットを配る（管理者だけに出る）。テストの利用者などに、利用者コードで、無料で配る。
 * 相手の「つくる」の画面のいちばん下に出る利用者コード（8 文字）を教えてもらって入れる。
 */
import { useState } from 'react';
import { BackendError, GIFT_MAX, normalizeUserCode } from '../cloud/backend';
import type { CloudSession } from '../cloud/session';

const messageOf = (e: unknown) => (e instanceof BackendError || e instanceof Error ? e.message : String(e));

export function GiftTickets({ session }: { session: CloudSession }) {
  const [code, setCode] = useState('');
  const [count, setCount] = useState('5');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const clean = normalizeUserCode(code);
  const n = Number(count);
  const problem = !clean ? '利用者コードを入れてください。' : !Number.isInteger(n) || n < 1 || n > GIFT_MAX ? `枚数は 1〜${GIFT_MAX} 枚にしてください。` : null;

  const give = async () => {
    if (problem || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const gift = await session.backend.giveTickets(clean, n);
      setMessage({ ok: true, text: `${gift.userCode} さんに ${n} 枚 配りました（いま ${gift.tickets} 枚）。相手が「つくる」を開き直すと、増えています。` });
      setCode('');
      void session.refresh();
    } catch (e) {
      const unsure = !(e instanceof BackendError) || e.uncertain;
      setMessage({ ok: false, text: unsure ? `${messageOf(e)}（届いたか分かりません。もう一度押す前に、相手のチケットの数を確かめてください）` : messageOf(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="studio-gift" data-testid="gift-section">
      <h3>🎫 チケットを配る（管理者だけ）</h3>
      <p className="studio-hint">相手の「つくる」の画面のいちばん下にある利用者コードを入れます。無料で配れます（1 回 {GIFT_MAX} 枚まで）。</p>
      <div className="studio-row">
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="利用者コード（8 文字）" aria-label="配る相手の利用者コード" maxLength={20} autoCapitalize="characters" autoComplete="off" spellCheck={false} data-testid="gift-code" className="studio-gift-code" />
        <input type="number" inputMode="numeric" min={1} max={GIFT_MAX} value={count} onChange={(e) => setCount(e.target.value)} aria-label="配る枚数" data-testid="gift-count" className="studio-gift-count" />
        <span>枚</span>
        <button type="button" className="primary" onClick={() => void give()} disabled={busy || problem !== null} data-testid="gift-give">
          {busy ? '配っています…' : '配る'}
        </button>
      </div>
      {message && (
        <p className={message.ok ? 'studio-account-message' : 'studio-error'} role="status" data-testid="gift-message">
          {message.text}
        </p>
      )}
    </section>
  );
}
