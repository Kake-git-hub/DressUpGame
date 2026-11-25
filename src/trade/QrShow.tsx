/**
 * 交換の QR コードを出す（中身は、読み取りの印だけ）
 */
import { useMemo } from 'react';
import { qrSvg } from '../home/share';

export function QrShow({ code }: { code: string }) {
  const svg = useMemo(() => qrSvg(code), [code]);
  return <div className="trade-qr" data-testid="trade-qr" role="img" aria-label="こうかんの QR コード" dangerouslySetInnerHTML={{ __html: svg }} />;
}
