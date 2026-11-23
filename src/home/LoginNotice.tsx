/**
 * ログインの結果の知らせ（ホームでもゲームの画面でも、いちばん手前に出す）。見た目は、共有の窓（home.css の home-share-*）に合わせる。
 * 読み込み直しのあとに出すので、App.tsx から、使うときだけ読み込む。
 */
import './home.css';

export function LoginNotice({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="home-share-overlay home-notice-overlay" role="dialog" aria-modal="true" data-testid="login-notice">
      <div className="home-share-panel">
        <p className="home-notice-text">{message}</p>
        <div className="home-share-actions">
          <button className="primary" onClick={onClose} data-testid="login-notice-ok">
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

export default LoginNotice;
