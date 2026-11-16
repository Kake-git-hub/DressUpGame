// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Budget } from './budget.ts';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'budget-'));
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe('Budget', () => {
  it('同時に使っても数え落とさず、上限を超えない', async () => {
    const budget = new Budget(path.join(dir, 'a/usage.json'), { perDay: 5, perRun: 5 });
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => budget.spend()));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(await budget.usedToday()).toBe(5);
  });
  it('日付が変わると 0 に戻る。壊れた記録も 0 から', async () => {
    let day = '2026-11-16';
    const file = path.join(dir, 'usage.json');
    const budget = new Budget(file, { perDay: 2, perRun: 2 }, () => day);
    await budget.spend();
    await budget.spend();
    await expect(budget.spend()).rejects.toThrow(/今日の上限/);
    day = '2026-11-17';
    expect(await budget.usedToday()).toBe(0);
    await fs.writeFile(file, '{こわれた');
    expect(await budget.usedToday()).toBe(0);
  });
  it('check: 1 回の上限と、今日の残りを見る', async () => {
    const budget = new Budget(path.join(dir, 'usage.json'), { perDay: 4, perRun: 3 });
    await expect(budget.check(4)).rejects.toThrow(/1 回の実行/);
    await budget.spend();
    await budget.spend();
    await expect(budget.check(3)).rejects.toThrow(/今日の上限/);
    await expect(budget.check(2)).resolves.toBeUndefined();
  });
});
