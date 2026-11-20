/**
 * スタジオの裏側を用意する。fake = 端末の中だけで動く偽物、real = 本物（Firebase。段階 E3 でつなぐ）
 */
import type { StudioMode } from '../appStudio/unlock';
import type { StudioBackend } from './backend';
import { createFakeBackend } from './fakeBackend';
import type { FakeOptions } from './fakeBackend';

// 偽物の速さなど（テストと確認用。端末の保存から読む）
function fakeOptions(): FakeOptions {
  try {
    const saved = JSON.parse(localStorage.getItem('dressup_fake_options') ?? '{}') as FakeOptions;
    return typeof saved === 'object' && saved !== null ? { delayMs: saved.delayMs, failCategories: saved.failCategories, tickets: saved.tickets, admin: saved.admin } : {};
  } catch {
    return {};
  }
}

// まだ用意できていなければ null（画面は「準備中」と出す）
export function createBackend(mode: StudioMode): StudioBackend | null {
  if (mode === 'fake') return createFakeBackend(fakeOptions());
  return null;
}
