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
  it('端末がオフラインなら、どの失敗でも「つながっていません」', () => {
    expect(of({ code: 'functions/not-found' }, false)).toEqual({ code: 'offline', message: 'インターネットにつながっていません' });
    expect(of({ code: 'functions/internal', message: 'internal' }, false).code).toBe('offline');
    expect(of(new TypeError('Failed to fetch'), false).code).toBe('offline');
    expect(of({ code: 'auth/network-request-failed' }).code).toBe('offline');
  });
  it('端末はつながっているのに、サーバーから返事が無いとき（関数がまだ載っていない・起動に失敗した、でもこうなる）は、通信のせいにしない', () => {
    for (const code of ['functions/internal', 'functions/unavailable', 'functions/deadline-exceeded']) {
      const e = of({ code, message: 'internal' });
      expect(e.code).toBe('unknown');
      expect(e.message).toContain('サーバーから返事がありません');
      expect(e.message).toContain('準備ができていない');
      expect(e.message).not.toContain('internal');
    }
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
