// チケットの財布（純粋な関数）。配った分（free）と、買った分（lots。期限つき）を持つ。
// 保存（メモリ・Firestore）は、取り引きの中で、これを呼んで書く。
import { addMonthsJst, LOT_MONTHS } from '../../src/cloud/expiry';
import type { Draw, Lot, UserDoc } from './store';

export { addMonthsJst, LOT_MONTHS };

export interface Wallet {
  free: number;
  lots: Lot[]; // 期限切れを含む。使い切った（left 0）まとまりも、期限までは残す（あとの戻しが、期限つきで戻るように）
}

const live = (l: Lot, now: number) => l.expiresAt > now;
const byExpiry = (a: Lot, b: Lot) => a.expiresAt - b.expiresAt;
const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

export function readWallet(user: Pick<UserDoc, 'tickets' | 'free' | 'lots' | 'ticketsWritten'>, now = Date.now()): Wallet {
  const tickets = finite(user.tickets);
  if (user.free === undefined && user.lots === undefined && user.ticketsWritten === undefined) {
    return { free: tickets, lots: [] };
  }
  let free = finite(user.free);
  let lots = (user.lots ?? []).filter((l) => l.left >= 0).map((l) => ({ ...l }));
  const d = user.ticketsWritten === undefined ? 0 : tickets - finite(user.ticketsWritten);
  if (d > 0) free += d;
  else if (d < 0) {
    let need = -d;
    const fromFree = Math.min(free, need);
    free -= fromFree;
    need -= fromFree;
    // 足りない分は、期限の近い順に、期限内の lot から（期限切れからは減らさない）
    for (const l of [...lots].sort(byExpiry)) {
      if (need <= 0) break;
      if (!live(l, now)) continue;
      const t = Math.min(l.left, need);
      l.left -= t;
      need -= t;
    }
  }
  return { free, lots };
}

export function usable(w: Wallet, now: number): number {
  return w.free + w.lots.filter((l) => live(l, now)).reduce((s, l) => s + l.left, 0);
}

// 期限の早い買った分から、足りなければ配った分から。足りなければ null
export function draw(w: Wallet, cost: number, now: number): { wallet: Wallet; draws: Draw[] } | null {
  if (!Number.isInteger(cost) || cost <= 0 || usable(w, now) < cost) return null;
  let need = cost;
  const draws: Draw[] = [];
  const lots = w.lots.map((l) => ({ ...l }));
  for (const l of [...lots].sort(byExpiry)) {
    if (need <= 0) break;
    if (!live(l, now)) continue;
    const n = Math.min(l.left, need);
    if (n <= 0) continue;
    l.left -= n;
    need -= n;
    draws.push({ lot: l.id, n });
  }
  let free = w.free;
  if (need > 0) {
    free -= need;
    draws.push({ n: need });
  }
  return { wallet: { free, lots }, draws };
}

// 品目 index の 1 枚を戻す。draws を 1 枚ずつ並べた列の index 番めの行き先へ（無い・切れた・範囲外は free）
export function refundTicket(w: Wallet, draws: Draw[] | undefined, index: number, now: number): Wallet {
  let target: string | undefined;
  if (draws && Number.isInteger(index) && index >= 0) {
    let i = index;
    for (const d of draws) {
      if (i < d.n) {
        target = d.lot;
        break;
      }
      i -= d.n;
    }
  }
  const lot = target === undefined ? undefined : w.lots.find((l) => l.id === target);
  if (!lot || !live(lot, now)) return { free: w.free + 1, lots: w.lots };
  return { free: w.free, lots: w.lots.map((l) => (l === lot ? { ...l, left: l.left + 1 } : l)) };
}

// 期限の切れた lot を落とす（落とした枚数を返す）
export function expire(w: Wallet, now: number): { wallet: Wallet; expired: { lot: string; n: number }[] } {
  const expired = w.lots.filter((l) => !live(l, now) && l.left > 0).map((l) => ({ lot: l.id, n: l.left }));
  return { wallet: { free: w.free, lots: w.lots.filter((l) => live(l, now)) }, expired };
}

export function addFree(w: Wallet, n: number): Wallet {
  return { free: w.free + n, lots: w.lots };
}

export function addLot(w: Wallet, lot: Lot): Wallet {
  return { free: w.free, lots: [...w.lots, { ...lot }] };
}

// 2 台めの財布を合わせる（同じ id の lot は足さない）
export function merge(a: Wallet, b: Wallet): Wallet {
  const lots = a.lots.map((l) => ({ ...l }));
  for (const l of b.lots) if (!lots.some((x) => x.id === l.id)) lots.push({ ...l });
  return { free: a.free + b.free, lots };
}

// その lot の left から、最大 n 枚を取る
export function reclaim(w: Wallet, lotId: string, n: number): { wallet: Wallet; taken: number } {
  const lot = w.lots.find((l) => l.id === lotId);
  if (!lot) return { wallet: w, taken: 0 };
  const taken = Number.isFinite(n) && n > 0 ? Math.min(lot.left, n) : 0;
  const lots = w.lots.map((l) => (l === lot ? { ...l, left: l.left - taken } : l));
  return { wallet: { free: w.free, lots }, taken };
}

// 書くときの形（tickets = ticketsWritten = 使える枚数。切れた lot は残さない。使い切った lot は期限まで残す）
export function walletFields(w: Wallet, now: number): Pick<UserDoc, 'free' | 'lots' | 'tickets' | 'ticketsWritten'> {
  const lots = w.lots.filter((l) => live(l, now));
  const n = usable({ free: w.free, lots }, now);
  return { free: w.free, lots, tickets: n, ticketsWritten: n };
}
