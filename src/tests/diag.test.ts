import { describe, expect, it, vi } from 'vitest';
import { createDiag, diagReport, reportIssueUrl } from '../services/diag';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe('きろく（端末の上で起きたことの覚え書き）', () => {
  it('書いた順に残り、時刻（開いてからの秒）が付く', () => {
    let t = 1000;
    const diag = createDiag({ storage: memoryStorage(), now: () => t });
    diag.note('start', 'v1');
    t = 3500;
    diag.note('set', 7);
    expect(diag.lines()).toEqual(['0.0 start v1', '2.5 set 7']);
  });

  it('多くなったら、古い行から捨てる', () => {
    const diag = createDiag({ storage: memoryStorage(), now: () => 0, max: 3 });
    for (let i = 1; i <= 5; i++) diag.note('n', i);
    expect(diag.lines()).toEqual(['0.0 n 3', '0.0 n 4', '0.0 n 5']);
  });

  it('長い行は切る。エラーは、名前と文にする', () => {
    const diag = createDiag({ storage: memoryStorage(), now: () => 0 });
    diag.note('warn', 'x'.repeat(1000));
    diag.note('error', new TypeError('だめ'));
    diag.note('obj', { a: 1 });
    expect(diag.lines()[0].length).toBeLessThanOrEqual(310);
    expect(diag.lines()[1]).toBe('0.0 error TypeError: だめ');
    expect(diag.lines()[2]).toBe('0.0 obj {"a":1}');
  });

  it('端末に残す: 開き直すと、前の回の行を「前の回」として読める（落ちて開き直ったときのため）', () => {
    const storage = memoryStorage();
    const first = createDiag({ storage, now: () => 0 });
    first.note('set', 7);
    first.note('warn', 'WebGLコンテキストがロストしました');
    const second = createDiag({ storage, now: () => 0 });
    expect(second.previous()).toEqual(['0.0 set 7', '0.0 warn WebGLコンテキストがロストしました']);
    expect(second.lines()).toEqual([]);
    second.note('start');
    // 3 回めから見ると、前の回は 2 回めの行
    expect(createDiag({ storage, now: () => 0 }).previous()).toEqual(['0.0 start']);
  });

  it('続けて何行も来たら、端末に残すのは、まとめて 1 回（アプリを重くしない）。あとから、最後の行まで残る', () => {
    vi.useFakeTimers();
    try {
      const storage = memoryStorage();
      const setItem = vi.spyOn(storage, 'setItem');
      let t = 0;
      const diag = createDiag({ storage, now: () => t });
      for (let i = 0; i < 50; i++) diag.note('warn', i);
      expect(setItem).toHaveBeenCalledTimes(10); // 1 秒に 10 回までは、すぐ残す
      t = 300;
      vi.advanceTimersByTime(300);
      expect(setItem).toHaveBeenCalledTimes(11);
      expect(createDiag({ storage, now: () => 0 }).previous()).toHaveLength(50);
    } finally {
      vi.useRealTimers();
    }
  });

  it('端末に残せなくても（保存が使えない・中身が壊れている）、止まらない', () => {
    const broken = {
      getItem: () => {
        throw new Error('使えません');
      },
      setItem: () => {
        throw new Error('使えません');
      },
    };
    const diag = createDiag({ storage: broken, now: () => 0 });
    expect(() => diag.note('a')).not.toThrow();
    expect(diag.lines()).toEqual(['0.0 a']);
    expect(createDiag({ storage: memoryStorage({ dressup_diag: '{こわれた' }), now: () => 0 }).previous()).toEqual([]);
  });

  it('install: 警告・エラーの出力と、つかまえていない例外を書き留める（もとの出力は、そのまま出す）', () => {
    const warn = vi.fn();
    const error = vi.fn();
    const log = vi.fn();
    const fakeConsole = { warn, error, log };
    const listeners = new Map<string, (event: unknown) => void>();
    const target = { addEventListener: (type: string, fn: (event: unknown) => void) => void listeners.set(type, fn) };
    const diag = createDiag({ storage: memoryStorage(), now: () => 0 });
    diag.install(fakeConsole, target);
    fakeConsole.warn('服画像の読み込みに失敗', new Error('404'));
    fakeConsole.error('こわれた');
    fakeConsole.log('ふつうの出力');
    listeners.get('error')!({ message: 'Script error', filename: 'main.js', lineno: 12 });
    listeners.get('unhandledrejection')!({ reason: new RangeError('大きすぎ') });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(diag.lines()).toEqual([
      '0.0 warn 服画像の読み込みに失敗 Error: 404',
      '0.0 error こわれた',
      '0.0 uncaught Script error main.js:12',
      '0.0 rejection RangeError: 大きすぎ',
    ]);
  });

  it('報告の文: 版・端末・描画の状態・前の回・今回の行が、1 つの文になる', () => {
    const storage = memoryStorage();
    createDiag({ storage, now: () => 0 }).note('set', 7);
    const diag = createDiag({ storage, now: () => 0 });
    diag.note('start');
    const text = diagReport(diag, { version: '0.35.1', userAgent: 'iPad', standalone: true, viewport: '820x1180@2', gl: { lost: true, maxTexture: 4096 } });
    expect(text).toContain('v0.35.1');
    expect(text).toContain('iPad');
    expect(text).toContain('standalone: true');
    expect(text).toContain('820x1180@2');
    expect(text).toContain('"lost":true');
    expect(text.indexOf('0.0 set 7')).toBeGreaterThan(text.indexOf('前の回'));
    expect(text.indexOf('0.0 start')).toBeGreaterThan(text.indexOf('今回'));
  });
});

describe('ほうこく（GitHub の Issue に、きろくを入れて開く URL）', () => {
  const report = ['きせかえ v0.35.1', 'iPad UA', 'standalone: true / 1024x748@2', 'gl: {"lost":false}', '--- 前の回 ---', '0.0 start v0.35.1', '--- 今回 ---', '0.0 start v0.35.1', '7.3 set parts=7 くつ,てぶくろ', '8.0 clothes n=8'].join('\n');
  const parse = (url: string) => {
    const u = new URL(url);
    return { base: `${u.origin}${u.pathname}`, title: u.searchParams.get('title') ?? '', body: u.searchParams.get('body') ?? '' };
  };

  it('このリポジトリの「新しい Issue」を開く。題に版、本文に、書いた文ときろくが入る', () => {
    const { base, title, body } = parse(reportIssueUrl(report, 'セットを きせたら きえた', '0.35.1'));
    expect(base).toBe('https://github.com/Kake-git-hub/DressUpGame/issues/new');
    expect(title).toBe('[きろく] v0.35.1 セットを きせたら きえた');
    expect(body).toContain('セットを きせたら きえた');
    expect(body).toContain('```\nきせかえ v0.35.1');
    expect(body).toContain('7.3 set parts=7 くつ,てぶくろ');
    expect(body.trimEnd().endsWith('```')).toBe(true);
  });

  it('何も書かなくてもよい。題は「ほうこく」。長い文は、題では 40 字で切る', () => {
    expect(parse(reportIssueUrl(report, '  ', '0.35.1')).title).toBe('[きろく] v0.35.1 ほうこく');
    const long = 'あ'.repeat(100);
    const { title, body } = parse(reportIssueUrl(report, long, '0.35.1'));
    expect(title).toBe(`[きろく] v0.35.1 ${'あ'.repeat(40)}…`);
    expect(body).toContain(long);
  });

  it('URL が長くなりすぎないように、きろくの古い行から省く（はじめの 4 行と、最後の行は残す）', () => {
    const many = [...report.split('\n').slice(0, 4), '--- 今回 ---', ...Array.from({ length: 300 }, (_, i) => `${i}.0 warn 服画像の読み込みに失敗 ${i}`), '999.0 gl lost'].join('\n');
    const url = reportIssueUrl(many, '', '0.35.1');
    expect(url.length).toBeLessThanOrEqual(7000);
    const { body } = parse(url);
    expect(body).toContain('きせかえ v0.35.1');
    expect(body).toContain('gl: {"lost":false}');
    expect(body).toContain('999.0 gl lost');
    expect(body).toContain('299.0 warn');
    expect(body).not.toContain('\n0.0 warn');
    expect(body).toMatch(/（古い \d+ 行は省略）/);
  });
});
