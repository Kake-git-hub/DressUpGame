/**
 * 「つくる」を出す端末かどうか
 *
 * 「つくる」と「クローゼット」は、だれにでも出す（v0.50.0 から。何も覚えていなければ、本物の裏側）。
 * ?studio=0（あいことば off）で、その端末では隠す（隠したことを覚える）。?studio=1（あいことば studio）で、もどす。
 * ?studio=fake（あいことば fake）は、端末の中だけで動く偽物の裏側（開発と確認用）。
 * この小さな部分だけは、ゲームの最初の読み込みに入る（スタジオの画面そのものは、開いたときに読み込む）。
 * 遊ぶだけの人には、つなぎ役も Firebase も読み込ませない: 起動のときに用意するのは、前に開いた端末だけ（下の bootsAtStart）。
 * 保護者の確認は、覚えない: 「つくる」を開くたびに、毎回たずねる（大人が開いたあと、子どもがそのまま開けないように）。
 */
export type StudioMode = 'real' | 'fake';

const KEY = 'dressup_studio';
const USED_KEY = 'dressup_studio_used'; // 「つくる」「クローゼット」を、1 回でも開いた端末の印

export function readStudioMode(search: string, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): StudioMode | null {
  // URL で頼まれていれば、その読み込みは、そのとおりにする（覚えられなくても）
  const value = new URLSearchParams(search).get('studio');
  const asked = value === '1' ? 'real' : value === 'fake' ? 'fake' : value === '0' ? 'off' : null;
  try {
    if (asked) storage.setItem(KEY, asked);
    else {
      const saved = storage.getItem(KEY);
      return saved === 'off' ? null : saved === 'fake' ? 'fake' : 'real';
    }
  } catch {
    // 保存が使えない端末: 覚えない。URL が無ければ、出す
    if (!asked) return 'real';
  }
  return asked === 'off' ? null : asked;
}

// ホーム画面のアプリは、Safari とは保存が別なので、URL では変えられない。
// 版数を 5 回続けて押すと、あいことばを聞く: studio = 本物、fake = 確認用、off = 隠す。変わったら true
export function unlockByWord(word: string | null, storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try {
    const value = (word ?? '').trim().toLowerCase();
    if (value === 'studio') storage.setItem(KEY, 'real');
    else if (value === 'fake') storage.setItem(KEY, 'fake');
    else if (value === 'off') storage.setItem(KEY, 'off');
    else return false;
    return true;
  } catch {
    return false;
  }
}

// 「つくる」「クローゼット」を開いた（支払い・ログインから戻って、つなぎ役が要る）ことを覚える
export function markStudioUsed(storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(USED_KEY, '1');
  } catch {
    // 覚えられなくても動く（次も、開いたときに用意する）
  }
}

// つなぎ役（サーバーとのやり取り）を、起動のときに用意するか。しない端末では、「つくる」「クローゼット」を開いたときに用意する。
// 偽物は、端末の中だけなので、いつも。本物は、前に開いた端末と、前の版で教えた端末（real を覚えている）だけ
export function bootsAtStart(mode: StudioMode | null, storage: Pick<Storage, 'getItem'> = localStorage): boolean {
  if (mode === 'fake') return true;
  if (mode === null) return false;
  try {
    return storage.getItem(USED_KEY) === '1' || storage.getItem(KEY) === 'real';
  } catch {
    return false;
  }
}

// 入口の問い: 2 けた × 1 けた の掛け算を、漢数字で出す（子どもには読みにくく、大人にはすぐ解ける）
const KANJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export interface GateQuestion {
  text: string;
  answer: number;
}
export function gateQuestion(random: () => number = Math.random): GateQuestion {
  const a = 11 + Math.floor(random() * 9); // 11〜19
  const b = 2 + Math.floor(random() * 8); // 2〜9
  return { text: `十${KANJI[a - 10]} かける ${KANJI[b]} は？`, answer: a * b };
}
