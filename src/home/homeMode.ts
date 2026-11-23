/**
 * ホーム画面（あそぶ・つくる・クローゼット・ともだちにおしえる）から始めるかどうか
 *
 * ホームは、だれにでも、開いたときに出る（v0.35.0 から）。
 * ?home=0 を付けて開いたときだけ、その読み込みに限って、すぐゲームの画面にする（テストと確認用。覚えない）。
 */
export function startsOnHome(search: string): boolean {
  try {
    return new URLSearchParams(search).get('home') !== '0';
  } catch {
    return true;
  }
}
