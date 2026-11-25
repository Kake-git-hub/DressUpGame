import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearPayReturn, forgetSession, pendingSession, readPayReturn, rememberSession } from '../appStudio/payReturn';
import { addMonthsJst, formatJstDate } from '../cloud/expiry';

describe('readPayReturn', () => {
  it('3 つの形を読む', () => {
    expect(readPayReturn('?pay=done&session=cs_test_1')).toEqual({ kind: 'done', session: 'cs_test_1' });
    expect(readPayReturn('?studio=fake&pay=fake&session=fake-pay-3')).toEqual({ kind: 'fake', session: 'fake-pay-3' });
    expect(readPayReturn('?pay=cancel')).toEqual({ kind: 'cancel' });
  });
  it('それ以外は null（番号が無い・変な形・知らない値）', () => {
    expect(readPayReturn('')).toBeNull();
    expect(readPayReturn('?pay=done')).toBeNull();
    expect(readPayReturn('?pay=done&session=a b<')).toBeNull();
    expect(readPayReturn('?pay=other&session=x')).toBeNull();
    expect(readPayReturn('?session=x')).toBeNull();
  });
});

describe('clearPayReturn と覚え', () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, '', '/DressUpGame/?content=e2e/&studio=fake&pay=done&session=cs_1#top');
  });
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('pay と session だけを消し、ほかの引数と # は残す', () => {
    clearPayReturn();
    expect(window.location.search).toBe('?content=e2e%2F&studio=fake');
    expect(window.location.hash).toBe('#top');
  });
  it('支払いの番号を覚え・思い出し・忘れる', () => {
    expect(pendingSession()).toBeNull();
    rememberSession('cs_9');
    expect(pendingSession()).toBe('cs_9');
    forgetSession();
    expect(pendingSession()).toBeNull();
  });
});

describe('期限の日付', () => {
  it('日本時間の暦で 6 か月あと。月末・うるう年・表記', () => {
    const at = Date.UTC(2026, 10, 25, 1, 0); // 日本時間 2026-11-25 10:00
    expect(formatJstDate(addMonthsJst(at, 6))).toBe('2027年5月25日');
    expect(formatJstDate(addMonthsJst(Date.UTC(2026, 7, 30, 1), 6))).toBe('2027年2月28日');
    expect(formatJstDate(Date.UTC(2026, 11, 31, 15, 30))).toBe('2027年1月1日'); // UTC では 12/31 でも、日本は翌日
  });
});
