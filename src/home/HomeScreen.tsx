/**
 * ホーム画面: 大きな「あそぶ」「つくる」「クローゼット」と、小さめの「ともだちにおしえる」。
 * 「つくる」「クローゼット」は、「つくる」を教えた端末にだけ出す（onCreate・onCloset が渡されたときだけ）。
 * ゲームの最初の読み込みには入れず、ホーム画面を出す端末でだけ読み込む（QR コードの部品も一緒）。
 */
import { useMemo, useState } from 'react';
import { copyText, qrSvg, shareUrl } from './share';
import { InstallHint } from './InstallHint';
import { installPrompts, installStorage } from './installBoot';
import { isStandalone } from './installHint';
import './home.css';

export interface HomeScreenProps {
  onPlay: () => void;
  onCreate?: () => void; // 無ければ、「つくる」を出さない
  onCloset?: () => void; // 無ければ、「クローゼット」を出さない
  closetDot?: boolean; // 新しい服がある・作っている途中
  onGuideReset?: () => void; // 「つかいかた」: 操作ガイドを、また出す
}

type CopyState = 'copying' | 'copied' | 'failed';

export default function HomeScreen({ onPlay, onCreate, onCloset, closetDot = false, onGuideReset }: HomeScreenProps) {
  const [guideAgain, setGuideAgain] = useState(false);
  const url = useMemo(() => shareUrl(window.location.origin, import.meta.env.BASE_URL), []);
  const [shareOpen, setShareOpen] = useState(false);
  const standalone = useMemo(() => isStandalone(window), []);
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
      <div className={`home-main-buttons${onCreate || onCloset ? ' many' : ''}`}>
        <button className="home-button home-play" onClick={onPlay} data-testid="home-play">
          あそぶ
        </button>
        {onCreate && (
          <button className="home-button home-create" onClick={onCreate} data-testid="home-create">
            つくる
          </button>
        )}
        {onCloset && (
          <button className="home-button home-closet" onClick={onCloset} data-testid="home-closet">
            クローゼット
            {closetDot && <span className="home-dot" data-testid="home-closet-dot" aria-label="あたらしい ふくが あります" />}
          </button>
        )}
      </div>
      <button className="home-share-button" onClick={openShare} data-testid="home-share">
        ともだちにおしえる
      </button>
      {onGuideReset && (
        <button
          className="home-guide-button"
          onClick={() => {
            onGuideReset();
            setGuideAgain(true);
          }}
          data-testid="home-guide"
        >
          {guideAgain ? 'つかいかたを また だすよ' : 'つかいかた'}
        </button>
      )}

      {/* まだアプリとして開いていない端末に: ホーム画面への追加・ブックマークの案内（開いたときに 1 回） */}
      <InstallHint store={installPrompts} storage={installStorage} standalone={standalone} userAgent={navigator.userAgent} maxTouchPoints={navigator.maxTouchPoints} />

      {shareOpen && (
        <div className="home-share-overlay" onClick={() => setShareOpen(false)} data-testid="home-share-dialog">
          <div className="home-share-panel" onClick={(e) => e.stopPropagation()}>
            <div className="home-share-qr" data-testid="home-share-qr" dangerouslySetInnerHTML={{ __html: qrSvg(url) }} />
            <p className="home-share-url" data-testid="home-share-url">
              {url}
            </p>
            <p className="home-share-note" data-testid="home-share-note">
              ひらいた ともだちにも、「ホームがめんに ついか」の あんないが でるよ
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
