/**
 * スタジオの裏側を用意する。fake = 端末の中だけで動く偽物、real = 本物（Firebase のサーバーの関数）
 */
import type { StudioMode } from '../appStudio/unlock';
import { BackendError } from './backend';
import type { StudioBackend } from './backend';
import { createFakeBackend } from './fakeBackend';
import type { FakeOptions } from './fakeBackend';
import { createRemoteBackend } from './remoteBackend';
import type { StudioTransport } from './remoteBackend';

// 偽物の速さなど（テストと確認用。端末の保存から読む）
function fakeOptions(): FakeOptions {
  try {
    const saved = JSON.parse(localStorage.getItem('dressup_fake_options') ?? '{}') as FakeOptions;
    return typeof saved === 'object' && saved !== null ? { delayMs: saved.delayMs, failCategories: saved.failCategories, tickets: saved.tickets, admin: saved.admin, offline: saved.offline, planMs: saved.planMs, oldServer: saved.oldServer } : {};
  } catch {
    return {};
  }
}

// Firebase の部品は、初めて呼ぶときに読み込む（偽物で開いたときには、読み込まない）
function lazyFirebase(): StudioTransport {
  let loaded: Promise<StudioTransport> | null = null;
  const load = (): Promise<StudioTransport> => {
    loaded ??= import('./firebaseTransport')
      .then((module) => module.createFirebaseTransport())
      .catch((error: unknown) => {
        loaded = null;
        console.error('スタジオの部品を読み込めませんでした:', error);
        throw new BackendError('offline', 'スタジオの部品を読み込めませんでした');
      });
    return loaded;
  };
  return {
    call: async (data) => (await load()).call(data),
  };
}

// 裏側は、ページに 1 つだけ（画面を閉じて開き直しても、同じものを使う。進み具合の聞き取りが二重にならない）
let fake: StudioBackend | null = null;
let real: StudioBackend | null = null;

export function createBackend(mode: StudioMode): StudioBackend {
  if (mode === 'fake') return (fake ??= createFakeBackend(fakeOptions()));
  return (real ??= createRemoteBackend(lazyFirebase()));
}
