/**
 * ホーム画面（あそぶ・つくる・ともだちにおしえる）を出す端末かどうか
 *
 * まだ作っている途中なので、ふつうは出さない（いつものとおり、すぐゲームの画面）。
 * ?home=1 を 1 回開いた端末にだけ出す（次からは覚えている）。?home=0 で消す。
 * ホーム画面のアプリ用に、版数を 5 回押して聞かれるあいことばでも出せる: home = 出す、nohome = 消す。
 */
const KEY = 'dressup_home';

type Storage3 = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function readHomeEnabled(search: string, storage: Storage3 = localStorage): boolean {
  try {
    const value = new URLSearchParams(search).get('home');
    if (value === '1') storage.setItem(KEY, '1');
    else if (value === '0') storage.removeItem(KEY);
    return storage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

// 変わったら true
export function unlockHomeByWord(word: string | null, storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage): boolean {
  try {
    const value = (word ?? '').trim().toLowerCase();
    if (value === 'home') storage.setItem(KEY, '1');
    else if (value === 'nohome') storage.removeItem(KEY);
    else return false;
    return true;
  } catch {
    return false;
  }
}
