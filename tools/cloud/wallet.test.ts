import { describe, expect, it } from 'vitest';
import type { Lot } from './store';
import { addFree, addLot, addMonthsJst, draw, expire, merge, readWallet, reclaim, refundTicket, usable, walletFields } from './wallet';

const t = (s: string) => new Date(s).getTime();
const NOW = t('2026-11-25T10:00+09:00');
const L = (id: string, left: number, expiresAt = t('2027-05-25T10:00+09:00')): Lot => ({
  id,
  count: left,
  left,
  boughtAt: NOW,
  expiresAt,
});

describe('addMonthsJst', () => {
  it('同じ日・同じ時刻の 6 か月あと', () => {
    expect(addMonthsJst(t('2026-11-25T10:00+09:00'), 6)).toBe(t('2027-05-25T10:00+09:00'));
  });
  it('その日が無い月は月末', () => {
    expect(addMonthsJst(t('2026-08-31T23:30+09:00'), 6)).toBe(t('2027-02-28T23:30+09:00'));
  });
  it('日本時間の暦で数える（UTC では前日）', () => {
    expect(addMonthsJst(t('2026-11-30T23:30+09:00'), 6)).toBe(t('2027-05-30T23:30+09:00'));
  });
});

describe('readWallet / walletFields', () => {
  it('古い形は free へ', () => {
    const w = readWallet({ tickets: 7 } as never, NOW);
    expect(w.free).toBe(7);
    expect(usable(w, NOW)).toBe(7);
    expect(walletFields(w, NOW)).toEqual({ free: 7, lots: [], tickets: 7, ticketsWritten: 7 });
  });
  it('手で増やした分は free へ', () => {
    const w = readWallet({ free: 2, lots: [L('A', 5)], tickets: 10, ticketsWritten: 7 }, NOW);
    expect(w.free).toBe(5);
    expect(usable(w, NOW)).toBe(10);
  });
  it('手で減らした分は free から、足りなければ lot から', () => {
    const w = readWallet({ free: 2, lots: [L('A', 5)], tickets: 4, ticketsWritten: 7 }, NOW);
    expect(w.free).toBe(0);
    expect(w.lots[0].left).toBe(4);
  });
  it('切れた lot は配った分に化けない', () => {
    const w = readWallet({ free: 2, lots: [L('A', 5, NOW - 1)], tickets: 7, ticketsWritten: 7 }, NOW);
    expect(usable(w, NOW)).toBe(2);
    expect(w.free).toBe(2);
    expect(walletFields(w, NOW).lots).toEqual([]);
  });
  it('数でない tickets は 0', () => {
    expect(readWallet({ tickets: NaN } as never, NOW).free).toBe(0);
  });
  it('減らす差は、切れた lot からは引かず、0 未満にしない', () => {
    const w = readWallet({ free: 0, lots: [L('A', 5, NOW - 1)], tickets: 0, ticketsWritten: 3 }, NOW);
    expect(w.lots[0].left).toBe(5);
    expect(w.free).toBe(0);
  });
});

describe('draw / refundTicket', () => {
  const A = L('A', 3, t('2027-06-01T00:00+09:00'));
  const B = L('B', 2, t('2027-05-01T00:00+09:00'));
  const w = { free: 4, lots: [A, B] };
  it('期限の近い順、最後に free', () => {
    const r = draw(w, 6, NOW)!;
    expect(r.draws).toEqual([{ lot: 'B', n: 2 }, { lot: 'A', n: 3 }, { n: 1 }]);
    expect(r.wallet.free).toBe(3);
    expect(r.wallet.lots.map((l) => l.left)).toEqual([0, 0]); // 使い切っても期限までは残す
  });
  it('切れた lot からは引かない', () => {
    const r = draw({ free: 1, lots: [L('X', 5, NOW - 1)] }, 1, NOW)!;
    expect(r.draws).toEqual([{ n: 1 }]);
    expect(draw({ free: 1, lots: [L('X', 5, NOW - 1)] }, 2, NOW)).toBeNull();
  });
  const draws = [{ lot: 'B', n: 2 }, { lot: 'A', n: 3 }, { n: 1 }];
  it('index の行き先へ戻す', () => {
    const base = { free: 0, lots: [L('A', 0), L('B', 0)].map((l) => ({ ...l, left: 1, expiresAt: A.expiresAt })) };
    const r1 = refundTicket(base, draws, 1, NOW);
    expect(r1.lots.find((l) => l.id === 'B')!.left).toBe(2);
    expect(r1.free).toBe(0);
    expect(refundTicket(base, draws, 5, NOW).free).toBe(1);
  });
  it('lot が切れていれば free へ、draws 無し・範囲外も free へ', () => {
    const dead = { free: 0, lots: [{ ...B, expiresAt: NOW - 1 }] };
    expect(refundTicket(dead, draws, 1, NOW).free).toBe(1);
    expect(refundTicket(w, undefined, 0, NOW).free).toBe(5);
    expect(refundTicket(w, draws, 99, NOW).free).toBe(5);
  });
  it('使い切った lot へも、期限つきで戻る（保存して読み直しても）', () => {
    const r = draw({ free: 0, lots: [B] }, 2, NOW)!;
    expect(r.wallet.lots[0].left).toBe(0);
    const saved = walletFields(r.wallet, NOW);
    expect(saved.lots).toHaveLength(1);
    expect(saved.tickets).toBe(0);
    const back = readWallet(saved, NOW);
    const refunded = refundTicket(back, r.draws, 1, NOW);
    expect(refunded.lots[0].left).toBe(1);
    expect(refunded.free).toBe(0);
  });
  it('cost が正の整数でなければ null', () => {
    for (const c of [0, -1, 1.5, NaN, Infinity]) expect(draw(w, c, NOW)).toBeNull();
  });
  it('lot が財布に無ければ free へ', () => {
    expect(refundTicket({ free: 0, lots: [] }, draws, 0, NOW).free).toBe(1);
  });
});

describe('expire / merge / reclaim / add', () => {
  it('expire は切れた分を返して落とす', () => {
    const r = expire({ free: 1, lots: [L('X', 4, NOW - 1), L('Y', 2)] }, NOW);
    expect(r.expired).toEqual([{ lot: 'X', n: 4 }]);
    expect(r.wallet.lots.map((l) => l.id)).toEqual(['Y']);
  });
  it('merge は free を足し、同じ id は 1 回', () => {
    const r = merge({ free: 1, lots: [L('A', 2)] }, { free: 3, lots: [L('A', 2), L('B', 4)] });
    expect(r.free).toBe(4);
    expect(r.lots.map((l) => [l.id, l.left, l.expiresAt])).toEqual([
      ['A', 2, L('A', 2).expiresAt],
      ['B', 4, L('B', 4).expiresAt],
    ]);
  });
  it('reclaim は最大 n 枚', () => {
    const r = reclaim({ free: 0, lots: [L('A', 7)] }, 'A', 5);
    expect(r.taken).toBe(5);
    expect(r.wallet.lots[0].left).toBe(2);
    const r2 = reclaim({ free: 0, lots: [L('A', 2)] }, 'A', 5);
    expect(r2.taken).toBe(2);
    expect(reclaim({ free: 0, lots: [] }, 'A', 5).taken).toBe(0);
    for (const n of [-3, NaN, Infinity]) expect(reclaim({ free: 0, lots: [L('A', 2)] }, 'A', n).taken).toBe(0);
  });
  it('addFree / addLot', () => {
    expect(addLot(addFree({ free: 1, lots: [] }, 2), L('A', 3))).toEqual({ free: 3, lots: [L('A', 3)] });
  });
});
