/**
 * にせの支払いページ（偽物の裏側 ?studio=fake のときだけ。開発・確認・E2E 用）
 *
 * 本物の Stripe のページの代わり。「はらう」「やめる」で結果を決め、アプリの戻りの URL（?pay=done / ?pay=cancel）へ移る。
 * 偽物の設定（payResult）が cancel のときは、「やめる」に、最初の印が付く。
 */
import { useEffect, useRef } from 'react';
import { fakeBackend } from '../cloud/createBackend';
import './shop.css';

export function FakePayPage({ session }: { session: string }) {
  const backend = fakeBackend();
  const first = useRef<HTMLButtonElement>(null);
  const pay = backend.payResult !== 'cancel';
  useEffect(() => first.current?.focus(), []);

  const finish = (result: 'paid' | 'cancel') => {
    backend.fakePay(session, result);
    // いまの引数（studio=fake など）は残して、戻りの引数に付け替える
    const query = new URLSearchParams(window.location.search);
    query.set('pay', result === 'paid' ? 'done' : 'cancel');
    if (result === 'paid') query.set('session', session);
    else query.delete('session');
    window.location.assign(`?${query.toString()}`);
  };

  return (
    <div className="fake-pay" data-testid="fake-pay">
      <div className="studio-panel shop-panel">
        <h2>にせの お支払いページ</h2>
        <p className="studio-demo">確認用です。ほんとうの お金は かかりません。</p>
        <div className="studio-row">
          <button type="button" ref={pay ? first : undefined} className={pay ? 'primary' : ''} onClick={() => finish('paid')} data-testid="fake-pay-ok">
            はらう
          </button>
          <button type="button" ref={pay ? undefined : first} className={pay ? '' : 'primary'} onClick={() => finish('cancel')} data-testid="fake-pay-cancel">
            やめる
          </button>
        </div>
      </div>
    </div>
  );
}
