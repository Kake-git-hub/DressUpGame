/**
 * ホーム画面: 大きな「あそぶ」「つくる」と、小さめの「ともだちにおしえる」。
 * ゲームの最初の読み込みには入れず、ホーム画面を出す端末でだけ読み込む（QR コードの部品も一緒）。
 */
import { useMemo, useState } from 'react';
import { copyText, qrSvg, shareUrl } from './share';
import './home.css';

export interface HomeScreenProps {
  onPlay: () => void;
  onCreate: () => void;
}

type CopyState = 'copying' | 'copied' | 'failed';

export default function HomeScreen({ onPlay, onCreate }: HomeScreenProps) {
  const url = useMemo(() => shareUrl(window.location.origin, import.meta.env.BASE_URL), []);
  const [shareOpen, setShareOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>('copying');

  // 押したらすぐコピーする（ブラウザは、押した操作の中でないとコピーさせてくれないことがある）
  const openShare = () => {
    setShareOpen(true);
    setCopy('copying');
    void copyText(url).then((ok) => setCopy(ok ? 'copied' : 'failed'));
  };

  return (
    <div className="home-screen" data-testid="home-screen">
      <h1 className="home-title">きせかえ</h1>
      <div className="home-main-buttons">
        <button className="home-button home-play" onClick={onPlay} data-testid="home-play">
          あそぶ
        </button>
        <button className="home-button home-create" onClick={onCreate} data-testid="home-create">
          つくる
        </button>
      </div>
      <button className="home-share-button" onClick={openShare} data-testid="home-share">
        ともだちにおしえる
      </button>

      {shareOpen && (
        <div className="home-share-overlay" onClick={() => setShareOpen(false)} data-testid="home-share-dialog">
          <div className="home-share-panel" onClick={(e) => e.stopPropagation()}>
            <div className="home-share-qr" data-testid="home-share-qr" dangerouslySetInnerHTML={{ __html: qrSvg(url) }} />
            <p className="home-share-url" data-testid="home-share-url">
              {url}
            </p>
            <p className={`home-share-status ${copy}`} data-testid="home-share-status">
              {copy === 'copied' ? 'URL をコピーしたよ！' : copy === 'failed' ? 'コピーできなかったよ。QR コードをよみとってね' : 'コピーしています…'}
            </p>
            <div className="home-share-actions">
              {copy === 'failed' && (
                <button onClick={() => void copyText(url).then((ok) => setCopy(ok ? 'copied' : 'failed'))}>もういちどコピー</button>
              )}
              <button className="primary" onClick={() => setShareOpen(false)} data-testid="home-share-close">
                とじる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
