/**
 * PWA自動更新のユニットテスト
 * アプリを開いたとき・画面に戻ったときに更新を確認する
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setupAutoUpdate } from '../pwaUpdate';
import type { RegisterSW } from '../pwaUpdate';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

// registerSW の代役。登録完了を任意のタイミングで起こせる
function fakeRegister() {
  const update = vi.fn(async () => {});
  let registered: ((reg: { update: () => Promise<void> } | undefined) => void) | undefined;
  const register: RegisterSW = (options) => {
    registered = (reg) => options.onRegisteredSW?.('sw.js', reg as ServiceWorkerRegistration | undefined);
    return async () => {};
  };
  return { register, update, complete: () => registered?.({ update }), completeWithout: () => registered?.(undefined) };
}

describe('setupAutoUpdate', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    setVisibility('visible');
  });

  it('登録が済んだらすぐ更新を確認する（アプリを開いたとき）', () => {
    const f = fakeRegister();
    dispose = setupAutoUpdate(f.register);
    expect(f.update).not.toHaveBeenCalled();
    f.complete();
    expect(f.update).toHaveBeenCalledTimes(1);
  });

  it('画面に戻ってきたら更新を確認する', () => {
    const f = fakeRegister();
    dispose = setupAutoUpdate(f.register);
    f.complete();
    setVisibility('hidden');
    expect(f.update).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    expect(f.update).toHaveBeenCalledTimes(2);
  });

  it('登録前に画面へ戻っても何も起きない', () => {
    const f = fakeRegister();
    dispose = setupAutoUpdate(f.register);
    setVisibility('visible');
    expect(f.update).not.toHaveBeenCalled();
  });

  it('Service Worker が使えない環境（登録なし）でも落ちない', () => {
    const f = fakeRegister();
    dispose = setupAutoUpdate(f.register);
    f.completeWithout();
    expect(() => setVisibility('visible')).not.toThrow();
  });

  it('更新確認が失敗（オフライン）しても例外を外に出さない', async () => {
    const f = fakeRegister();
    f.update.mockRejectedValue(new Error('offline'));
    dispose = setupAutoUpdate(f.register);
    f.complete();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.update).toHaveBeenCalledTimes(1);
  });

  it('immediate: true で登録する（読み込み完了を待たずに登録）', () => {
    const register = vi.fn<RegisterSW>(() => async () => {});
    dispose = setupAutoUpdate(register);
    expect(register.mock.calls[0][0].immediate).toBe(true);
  });
});
