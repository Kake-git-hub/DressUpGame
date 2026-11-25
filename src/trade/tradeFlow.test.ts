import { describe, expect, it } from 'vitest';
import type { TradeState } from '../cloud/backend';
import type { TradeRefusal } from '../cloud/wire';
import { cameraProblemOf, refusalText, stageOf } from './tradeFlow';

const state = (status: TradeState['status'], me: 'a' | 'b'): TradeState => ({ id: 't', status, me, myAccepted: false, theirAccepted: false });

describe('stageOf', () => {
  it('まだ交換が始まっていない間は、自分の段階のまま', () => {
    expect(stageOf(null, 'menu')).toBe('menu');
    expect(stageOf(null, 'pick-show')).toBe('pick-show');
    expect(stageOf(null, 'scan')).toBe('scan');
  });
  it('交換が始まったら、様子と自分の側で決まる', () => {
    expect(stageOf(null, 'active')).toBe('loading');
    expect(stageOf(state('open', 'a'), 'active')).toBe('show-qr');
    expect(stageOf(state('claimed', 'a'), 'active')).toBe('partner-choosing');
    expect(stageOf(state('claimed', 'b'), 'active')).toBe('choose');
    expect(stageOf(state('joined', 'a'), 'active')).toBe('confirm');
    expect(stageOf(state('joined', 'b'), 'active')).toBe('confirm');
    expect(stageOf(state('done', 'a'), 'active')).toBe('done');
    expect(stageOf(state('cancelled', 'b'), 'active')).toBe('ended');
  });
});

describe('refusalText', () => {
  it('断りの語ごとの文', () => {
    const table: Record<TradeRefusal, string> = {
      expired: 'もういちど よんでね',
      busy: 'ほかの ひとが こうかんちゅう',
      self: 'じぶんの QR コードだよ',
      unknown: 'よめない QR コードだよ',
      limit: 'きょうは もう こうかんできないよ',
      'not-movable': 'この ふくは いま こうかんできないよ',
    };
    for (const [refusal, text] of Object.entries(table)) expect(refusalText(refusal as TradeRefusal)).toBe(text);
  });
});

describe('cameraProblemOf', () => {
  it('カメラの失敗を、理由に分ける', () => {
    expect(cameraProblemOf(new DOMException('', 'NotAllowedError'))).toBe('denied');
    expect(cameraProblemOf(new DOMException('', 'NotFoundError'))).toBe('none');
    expect(cameraProblemOf(new DOMException('', 'NotReadableError'))).toBe('error');
    expect(cameraProblemOf('x')).toBe('error');
  });
});
