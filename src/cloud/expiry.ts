// 買ったチケットの期限の計算（アプリと、サーバー側の財布で同じ計算を使う）
export const LOT_MONTHS = 6;

const JST = 9 * 3600 * 1000;

// 日本時間の暦で、months か月あとの同じ日・同じ時刻。その日が無い月は月末
export function addMonthsJst(at: number, months: number): number {
  const d = new Date(at + JST); // UTC の値として読むと、日本時間の暦になる
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const year = Math.floor(total / 12);
  const month = total - year * 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), last);
  return (
    Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()) - JST
  );
}
