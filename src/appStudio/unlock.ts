/**
 * 「つくる」を出す端末かどうか
 *
 * 販売を始めるまでは、作者が教えた URL（?studio=1）を 1 回開いた端末にだけ「つくる」のボタンを出す（次からは覚えている）。
 * ?studio=fake は、端末の中だけで動く偽物の裏側（開発と確認用）。?studio=0 で消す。
 * この小さな部分だけは、ゲームの最初の読み込みに入る（スタジオの画面そのものは、開いたときに読み込む）。
 * 保護者の確認は、覚えない: 「つくる」を開くたびに、毎回たずねる（大人が開いたあと、子どもがそのまま開けないように）。
 */
export type StudioMode = 'real' | 'fake';

const KEY = 'dressup_studio';

export function readStudioMode(search: string, storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage): StudioMode | null {
  try {
    const value = new URLSearchParams(search).get('studio');
    if (value === '1') storage.setItem(KEY, 'real');
    else if (value === 'fake') storage.setItem(KEY, 'fake');
    else if (value === '0') storage.removeItem(KEY);
    const saved = storage.getItem(KEY);
    return saved === 'real' || saved === 'fake' ? saved : null;
  } catch {
    return null;
  }
}

// ホーム画面のアプリは、Safari とは保存が別なので、URL では出せない。
// 版数を 5 回続けて押すと、あいことばを聞く: studio = 本物、fake = 確認用、off = 消す。変わったら true
export function unlockByWord(word: string | null, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): boolean {
  try {
    const value = (word ?? '').trim().toLowerCase();
    if (value === 'studio') storage.setItem(KEY, 'real');
    else if (value === 'fake') storage.setItem(KEY, 'fake');
    else if (value === 'off') storage.removeItem(KEY);
    else return false;
    return true;
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
