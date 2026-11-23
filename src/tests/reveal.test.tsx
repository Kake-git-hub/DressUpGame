/**
 * 服が届いた演出の画面（Reveal）のテスト
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MyItem } from '../cloud/backend';
import { Reveal } from '../reveal/Reveal';
import type { RevealView } from '../reveal/revealView';
import type { DollData } from '../types';

afterEach(cleanup);
const doll = { id: 'girl', name: 'おんなのこ', bodyImageUrl: 'girl.webp', canvasW: 1024, canvasH: 1024, box: { x: 300, y: 50, w: 400, h: 900 } } as DollData;
const item = (id: string): MyItem => ({
  id,
  dollId: 'girl',
  item: { id, name: id, category: 'top', image: { file: 'image', canvasW: 1024, canvasH: 1024, box: { x: 0, y: 0, w: 10, h: 10 } }, thumb: 'thumb' },
  files: {},
  createdAt: 1,
  hue: 0,
  order: 1,
  updatedAt: 1,
  notes: [],
});
const view = (change: Partial<RevealView> = {}): RevealView => ({ kind: 'arrived', items: [item('my:a')], failed: [], doll, title: 'なみのふく', ...change });
function open(v: RevealView, props: { storeFailed?: boolean; canTryOn?: boolean } = {}) {
  const handlers = { onTryOn: vi.fn(), onOpenCloset: vi.fn(), onClose: vi.fn() };
  render(<Reveal view={v} storeFailed={props.storeFailed ?? false} canTryOn={props.canTryOn ?? true} {...handlers} />);
  return handlers;
}

describe('服が届いた演出', () => {
  it('届いた: 見出し・服の名前・ドールが着た絵。3 つのボタンが、それぞれの動きを呼ぶ', () => {
    const handlers = open(view());
    const reveal = screen.getByTestId('reveal');
    expect(reveal.dataset.kind).toBe('arrived');
    expect(reveal.textContent).toContain('あたらしい ふくが とどいたよ！');
    expect(screen.getByTestId('reveal-name').textContent).toBe('なみのふく');
    expect(screen.getByTestId('reveal-stage')).toBeTruthy();
    fireEvent.click(screen.getByTestId('reveal-try'));
    fireEvent.click(screen.getByTestId('reveal-closet'));
    fireEvent.click(screen.getByTestId('reveal-close'));
    expect([handlers.onTryOn.mock.calls.length, handlers.onOpenCloset.mock.calls.length, handlers.onClose.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it('着せられないとき（ドールが使えない・服が端末に無い）は、「きせてみる」を出さない', () => {
    open(view({ doll: null }), { canTryOn: false });
    expect(screen.queryByTestId('reveal-try')).toBeNull();
    expect(screen.getByTestId('reveal-closet')).toBeTruthy();
    // ドールの絵なしで、枠だけ出る（落ちない）
    expect(screen.getByTestId('reveal-stage').querySelector('img[src="girl.webp"]')).toBeNull();
  });

  it('端末に保存できなかったとき: そう添える（演出は出す）', () => {
    open(view({ items: [] }), { storeFailed: true, canTryOn: false });
    expect(screen.getByTestId('reveal-store-failed').textContent).toBe('この たんまつに ほぞんできませんでした（あきが たりないかもしれません）');
    expect(screen.getByTestId('reveal').dataset.kind).toBe('arrived');
  });

  it('一部できなかった: 品目ごとに知らせる', () => {
    open(view({ failed: ['ぼうし', 'くつ'] }));
    expect(screen.getAllByTestId('reveal-failed').map((p) => p.textContent)).toEqual(['ぼうしは つくれませんでした。チケットは もどしました', 'くつは つくれませんでした。チケットは もどしました']);
  });

  it('全部できなかった: とびらも「きせてみる」「クローゼットをみる」も出さず、知らせと「とじる」だけ', () => {
    const handlers = open(view({ kind: 'failed-only', items: [], failed: ['トップス'], title: '' }), { storeFailed: true });
    const reveal = screen.getByTestId('reveal');
    expect(reveal.dataset.kind).toBe('failed-only');
    expect(reveal.textContent).toContain('つくれませんでした');
    expect(reveal.textContent).not.toContain('とどいたよ');
    expect(screen.getByTestId('reveal-failed').textContent).toBe('トップス: チケットは もどしました');
    for (const id of ['reveal-stage', 'reveal-try', 'reveal-closet', 'reveal-name', 'reveal-store-failed']) expect(screen.queryByTestId(id), id).toBeNull();
    fireEvent.click(screen.getByTestId('reveal-close'));
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});
