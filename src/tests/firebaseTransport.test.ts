import { describe, expect, it } from 'vitest';
import { BackendError } from '../cloud/backend';
import { toBackendError } from '../cloud/firebaseTransport';

const of = (error: unknown, online = true) => {
  const e = toBackendError(error, online);
  return { code: e.code, message: e.message };
};

describe('Firebase の失敗を、画面に出せる形に直す', () => {
  it('サーバーが理由つきで断ったときは、その理由と文章をそのまま使う', () => {
    expect(of({ code: 'functions/failed-precondition', message: 'チケットが足りません（のこり 0 枚、必要 1 枚）', details: { code: 'no-tickets' } })).toEqual({ code: 'no-tickets', message: 'チケットが足りません（のこり 0 枚、必要 1 枚）' });
    expect(of({ code: 'functions/failed-precondition', message: '今日は上限です', details: { code: 'limit' } }).code).toBe('limit');
    expect(of({ code: 'functions/internal', message: 'サーバーで問題が起きました', details: { code: 'unknown' } })).toEqual({ code: 'unknown', message: 'サーバーで問題が起きました' });
  });
  it('届かなかった・返事が来なかったときは、「つながらない」', () => {
    for (const code of ['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded', 'auth/network-request-failed']) expect(of({ code, message: 'internal' }).code).toBe('offline');
    // 端末がオフラインなら、どの失敗でも「つながっていません」
    expect(of({ code: 'functions/not-found' }, false)).toEqual({ code: 'offline', message: 'インターネットにつながっていません' });
    expect(of(new TypeError('Failed to fetch'), false).code).toBe('offline');
  });
  it('サーバーの用意がまだのとき（関数が無い・匿名のログインが無効）は、準備ができていないと伝える', () => {
    for (const code of ['functions/not-found', 'auth/operation-not-allowed', 'auth/admin-restricted-operation', 'auth/configuration-not-found']) {
      expect(of({ code, message: 'x' })).toMatchObject({ code: 'unknown', message: expect.stringContaining('準備ができていません') });
    }
  });
  it('知らない理由・変な値でも、落ちずに、英語のままの文章は出さない', () => {
    expect(of({ code: 'functions/failed-precondition', message: 'raw english', details: { code: 'hacked' } })).toMatchObject({ code: 'unknown', message: expect.stringMatching(/^うまくいきません/) });
    for (const odd of [null, undefined, 'x', 5, new Error('boom'), { details: null }]) expect(of(odd).code).toBe('unknown');
    const same = new BackendError('refused', 'そのまま');
    expect(toBackendError(same)).toBe(same);
    expect(of({ code: 'functions/resource-exhausted' }).code).toBe('limit');
  });
});
