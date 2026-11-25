/**
 * 交換の QR コードを読む: カメラ（背面）の絵を、jsqr で読む。
 * ?studio=fake のときだけ、カメラの代わりに、印を直接入れる欄を出す（確認とテスト用）
 */
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { diag } from '../services/diag';
import { cameraProblemOf } from './tradeFlow';
import type { CameraProblem } from './tradeFlow';

const SCAN_GAP_MS = 150;
const MAX_SIDE = 480; // 読むときの絵の大きさ（大きいと遅い）

const PROBLEM_TEXT: Record<CameraProblem, string> = {
  denied: 'カメラを つかえないよ',
  none: 'カメラが みつからないよ',
  error: 'カメラが ひらかないよ',
};

interface QrScanProps {
  onCode: (code: string) => void;
  test: boolean; // 確認用の入力欄を出す
}

export function QrScan({ onCode, test }: QrScanProps) {
  const video = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  });
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [typed, setTyped] = useState('');

  useEffect(() => {
    let alive = true;
    let stream: MediaStream | null = null;
    let timer = 0;
    const stop = () => {
      alive = false;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };
    const fail = (error: unknown) => {
      const kind = cameraProblemOf(error);
      diag.note('trade', kind === 'error' ? `camera error=${(error as { name?: string } | null)?.name ?? 'unknown'}` : `camera ${kind}`);
      if (alive) setProblem(kind);
    };
    if (!navigator.mediaDevices?.getUserMedia) {
      fail(new DOMException('', 'NotFoundError'));
      return stop;
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (!alive) return;
      const el = video.current;
      if (el && ctx && el.readyState >= 2 && el.videoWidth > 0) {
        const scale = Math.min(1, MAX_SIDE / Math.max(el.videoWidth, el.videoHeight));
        canvas.width = Math.round(el.videoWidth * scale);
        canvas.height = Math.round(el.videoHeight * scale);
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const found = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });
        if (found?.data) {
          stop();
          onCodeRef.current(found.data);
          return;
        }
      }
      timer = window.setTimeout(tick, SCAN_GAP_MS);
    };
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (!alive) {
          s.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = s;
        diag.note('trade', 'camera ok');
        const el = video.current;
        if (el) {
          el.srcObject = s;
          void el.play().catch(() => undefined);
        }
        tick();
      })
      .catch(fail);
    return stop;
  }, []);

  return (
    <div className="trade-scan">
      {problem ? (
        <div className="trade-camera-error" data-testid="trade-camera-error">
          <p className="trade-big">{PROBLEM_TEXT[problem]}</p>
          <p>おとなの ひとに きいてね</p>
          {problem === 'denied' && <p className="trade-small">端末の設定で、このアプリ（ブラウザ）のカメラを許可してください</p>}
        </div>
      ) : (
        <>
          <video ref={video} className="trade-video" playsInline muted />
          <p>あいての がめんの QR コードを うつしてね</p>
        </>
      )}
      {test && (
        <form
          className="trade-test"
          onSubmit={(event) => {
            event.preventDefault();
            if (typed.trim()) onCodeRef.current(typed.trim());
          }}
        >
          <input value={typed} onChange={(event) => setTyped(event.target.value)} data-testid="trade-scan-test" aria-label="テスト用のコード" />
          <button type="submit">よむ</button>
        </form>
      )}
    </div>
  );
}
