/**
 * 注文の演出・チケットを切る演出（OrderShow）と、作りかけの知らせ（jobNotice）のテスト
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderShow } from '../appStudio/OrderShow';
import { CROWDED_MS, jobNotice } from '../appStudio/jobNotice';
import type { StudioJob } from '../cloud/backend';

afterEach(cleanup);
const lines = ['トップス ・ アニメ', '「うみのおひめさま」'];

describe('注文の演出', () => {
  it('ordering: 伝票に頼んだ内容が出て、「とじないでね」と出る。ボタンは無い', () => {
    render(<OrderShow phase={{ kind: 'ordering' }} lines={lines} onDone={() => undefined} />);
    const show = screen.getByTestId('order-show');
    expect(show.dataset.phase).toBe('ordering');
    expect(show.textContent).toContain('ようふくやさん');
    expect(show.textContent).toContain('ごちゅうもん');
    expect(show.textContent).toContain('トップス ・ アニメ');
    expect(show.textContent).toContain('「うみのおひめさま」');
    expect(show.textContent).toContain('ごちゅうもんを つたえています…');
    expect(show.textContent).toContain('この がめんを とじないでね');
    expect(screen.queryAllByRole('button')).toEqual([]);
  });

  it('ticket: 使った枚数と残りが出て、OK で onDone', () => {
    const onDone = vi.fn();
    render(<OrderShow phase={{ kind: 'ticket', cost: 2, left: 3, admin: false }} lines={lines} onDone={onDone} />);
    const show = screen.getByTestId('order-show');
    expect(show.dataset.phase).toBe('ticket');
    expect(show.textContent).toContain('チョキン！');
    expect(screen.getByTestId('order-ticket-count').textContent).toBe('チケット 2 まい つかいました（のこり 3 まい）');
    expect(show.textContent).toContain('ごちゅうもん かんりょう！');
    expect(show.textContent).toContain('もう とじても だいじょうぶ。');
    expect(show.textContent).toContain('できたら クローゼットに とどきます。');
    expect(show.textContent).not.toContain('とじないでね');
    // 切れたチケットは、使った枚数だけ
    expect(screen.getAllByTestId('order-ticket')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('ticket: 枚数が多いときも、切れたチケットの絵は 6 枚まで（枚数は文で分かる）', () => {
    render(<OrderShow phase={{ kind: 'ticket', cost: 9, left: 0, admin: false }} lines={lines} onDone={() => undefined} />);
    expect(screen.getAllByTestId('order-ticket')).toHaveLength(6);
    expect(screen.getByTestId('order-ticket-count').textContent).toBe('チケット 9 まい つかいました（のこり 0 まい）');
  });

  it('ticket（管理者）: チケットは切らない（チョキンと枚数の行が無い）', () => {
    render(<OrderShow phase={{ kind: 'ticket', cost: 1, left: 0, admin: true }} lines={lines} onDone={() => undefined} />);
    const show = screen.getByTestId('order-show');
    expect(show.textContent).not.toContain('チョキン');
    expect(screen.queryByTestId('order-ticket-count')).toBeNull();
    expect(screen.queryAllByTestId('order-ticket')).toEqual([]);
    expect(show.textContent).toContain('ごちゅうもん かんりょう！');
  });

  it('refused: 理由と「チケットは つかっていません」が出て、もどるで onDone', () => {
    const onDone = vi.fn();
    render(<OrderShow phase={{ kind: 'refused', message: 'チケットが足りません（のこり 0 枚、必要 1 枚）' }} lines={lines} onDone={onDone} />);
    const show = screen.getByTestId('order-show');
    expect(show.dataset.phase).toBe('refused');
    expect(show.textContent).toContain('ごちゅうもんを うけられませんでした。');
    expect(show.textContent).toContain('チケットは つかっていません。');
    expect(show.textContent).toContain('チケットが足りません（のこり 0 枚、必要 1 枚）');
    fireEvent.click(screen.getByRole('button', { name: 'もどる' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('注文の演出（結果が分からないとき）', () => {
  it('unsure: 「チケットは つかっていません」とは言わない。たしかめ方を伝える', () => {
    const onDone = vi.fn();
    render(<OrderShow phase={{ kind: 'unsure', message: 'サーバーから返事がありません' }} lines={lines} onDone={onDone} />);
    const show = screen.getByTestId('order-show');
    expect(show.dataset.phase).toBe('unsure');
    expect(show.textContent).toContain('ごちゅうもんが とどいたか わかりません。');
    expect(show.textContent).toContain('チケットの のこりと クローゼットを たしかめてね。');
    expect(show.textContent).not.toContain('チケットは つかっていません');
    expect(screen.getByTestId('order-reason').textContent).toBe('サーバーから返事がありません');
    fireEvent.click(screen.getByRole('button', { name: 'もどる' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe('作りかけの知らせ', () => {
  const job = (statuses: StudioJob['candidates'][number]['status'][], createdAt = 1000): StudioJob => ({
    id: 'j',
    dollId: 'd',
    done: false,
    tickets: statuses.length,
    createdAt,
    candidates: statuses.map((status, index) => ({ index, name: `ふく${index}`, categoryId: 'トップス', status, notes: [] })),
  });
  it('どれかが作成中・もう服になっていれば、作っています', () => {
    expect(jobNotice(job(['working', 'waiting']), 1000 + CROWDED_MS * 10)).toBe('working');
    expect(jobNotice(job(['kept', 'waiting']), 1000 + CROWDED_MS * 10)).toBe('working');
  });
  it('全部が順番待ちなら、待っています。60 秒たったら、こみあっています', () => {
    expect(CROWDED_MS).toBe(60_000);
    expect(jobNotice(job(['waiting', 'waiting']), 1000 + 59_000)).toBe('waiting');
    expect(jobNotice(job(['waiting', 'waiting']), 1000 + 60_001)).toBe('crowded');
  });
  it('端末の時計がずれていて、作った時刻のほうが先でも、待っています（落ちない）', () => {
    expect(jobNotice(job(['waiting'], 9_999_999), 1000)).toBe('waiting');
  });
});
