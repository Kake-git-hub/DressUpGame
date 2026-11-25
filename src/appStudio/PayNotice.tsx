/**
 * 「つくる」を出していない端末に、支払いから戻ってきたとき（?pay=done / cancel）の、小さな知らせ。
 * 「つくる」は、出さない。裏側（サーバー）にも、つながない。ゲームの上に、文を出すだけ。
 */
import { useState } from 'react';
import './shop.css';

const TEXT = {
  done: 'お支払いは うけつけました。ホーム画面の アプリで 「つくる」を ひらくと、チケットが ふえています',
  cancel: 'お支払いを やめました',
};

export function PayNotice({ kind }: { kind: 'done' | 'cancel' }) {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className="shop-overlay" data-testid="pay-notice-plain">
      <div className="shop-panel studio-panel">
        <p>{TEXT[kind]}</p>
        <div className="studio-row">
          <button type="button" className="primary" onClick={() => setOpen(false)} data-testid="pay-notice-plain-close">
            とじる
          </button>
        </div>
      </div>
    </div>
  );
}
