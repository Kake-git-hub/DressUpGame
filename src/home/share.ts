/**
 * 「ともだちにおしえる」: ゲームの URL（? のあとの、作者用の印は付けない）と、クリップボードへのコピー
 */
import qrcode from 'qrcode-generator';

// ゲームの入口の URL。origin と、アプリの置き場所（/DressUpGame/）から作る
export function shareUrl(origin: string, base: string): string {
  return new URL(base, origin).href;
}

// URL の QR コード（SVG の文字列。大きさは入れ物に合わせて伸びる）
export function qrSvg(text: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

// コピーできたら true。新しい方法（navigator.clipboard）が使えないときは、古い方法でためす
export async function copyText(text: string, nav: Pick<Navigator, 'clipboard'> | undefined = navigator): Promise<boolean> {
  try {
    if (nav?.clipboard?.writeText) {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 古い方法へ
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
