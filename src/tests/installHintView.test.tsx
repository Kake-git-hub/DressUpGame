/**
 * ホームに出す「ホームがめんに ついか」の案内（まだアプリとして開いていない端末なら、だれにでも出る）
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallHint } from '../home/InstallHint';
import { createInstallPromptStore, finishInstallHint, wantsInstallHint } from '../home/installHint';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.1 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 16; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

const HOUR = 3_600_000;
let clock = Date.UTC(2026, 10, 27, 9);
function show(options: { userAgent: string; touch?: number; standalone?: boolean }) {
  const standalone = options.standalone ?? false;
  const target = new EventTarget();
  const store = createInstallPromptStore(target, { storage: localStorage, standalone: () => standalone, now: () => clock });
  render(<InstallHint store={store} storage={localStorage} standalone={standalone} userAgent={options.userAgent} maxTouchPoints={options.touch ?? 5} now={() => clock} />);
  return { target, store };
}

const promptEvent = (outcome: 'accepted' | 'dismissed') => {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  return event;
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('ホームがめんに ついか の案内', () => {
  it('だれが開いても出る（はじめて開いた端末でも）', () => {
    show({ userAgent: IPHONE });
    expect(screen.getByTestId('install-hint')).toBeTruthy();
  });
  it('追加できた端末には、出さない', () => {
    finishInstallHint(localStorage);
    show({ userAgent: IPHONE });
    expect(screen.queryByTestId('install-hint')).toBeNull();
  });
  it('もうアプリとして開いているなら、出さない', () => {
    show({ userAgent: IPHONE, standalone: true });
    expect(screen.queryByTestId('install-hint')).toBeNull();
  });
  it('iPhone: 共有ボタンから「ホーム画面に追加」の手順を出す。追加のボタンは無い', () => {
    show({ userAgent: IPHONE });
    expect(screen.getByTestId('install-hint').getAttribute('data-kind')).toBe('ios');
    expect(screen.getByTestId('install-hint').textContent).toContain('ホーム画面に追加');
    expect(screen.queryByTestId('install-hint-add')).toBeNull();
  });
  it('パソコン: ブックマークをすすめる', () => {
    show({ userAgent: WINDOWS, touch: 0 });
    expect(screen.getByTestId('install-hint').getAttribute('data-kind')).toBe('bookmark');
    expect(screen.getByTestId('install-hint').textContent).toContain('ブックマーク');
  });
  it('LINE の中の画面: 先にブラウザで開いてもらう', () => {
    show({ userAgent: `${IPHONE} Line/15.18.0` });
    expect(screen.getByTestId('install-hint').getAttribute('data-kind')).toBe('inapp');
    expect(screen.getByTestId('install-hint').textContent).toContain('ブラウザ');
  });
  it('Android: ブラウザが追加の画面を出せると知らせてきたら、「ついかする」のボタンに変わる。追加できたら、消えて、もう出ない', async () => {
    const { target } = show({ userAgent: ANDROID });
    expect(screen.getByTestId('install-hint').getAttribute('data-kind')).toBe('android');
    const event = promptEvent('accepted');
    act(() => {
      target.dispatchEvent(event);
    });
    expect(screen.getByTestId('install-hint').getAttribute('data-kind')).toBe('prompt');
    fireEvent.click(screen.getByTestId('install-hint-add'));
    await waitFor(() => expect(screen.queryByTestId('install-hint')).toBeNull());
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(wantsInstallHint(localStorage, false)).toBe(false);
  });
  it('追加の画面で やめたら、案内は残る（手順の形になる）', async () => {
    const { target } = show({ userAgent: ANDROID });
    act(() => {
      target.dispatchEvent(promptEvent('dismissed'));
    });
    fireEvent.click(screen.getByTestId('install-hint-add'));
    await waitFor(() => expect(screen.getByTestId('install-hint').getAttribute('data-kind')).toBe('android'));
    expect(wantsInstallHint(localStorage, false)).toBe(true);
  });
  it('「あとで」で消える。あそんでホームにもどっても、読み込み直しても、その日は出ない。次の日に開くと、また出る', () => {
    show({ userAgent: IPHONE });
    fireEvent.click(screen.getByTestId('install-hint-later'));
    expect(screen.queryByTestId('install-hint')).toBeNull();
    // あそぶ → もどる、読み込み直し（ホームは作り直される）
    cleanup();
    clock += HOUR;
    show({ userAgent: IPHONE });
    expect(screen.queryByTestId('install-hint')).toBeNull();
    // 次の日
    cleanup();
    clock += 24 * HOUR;
    show({ userAgent: IPHONE });
    expect(screen.getByTestId('install-hint')).toBeTruthy();
  });
  it('窓の外（うすい幕）を押しても、「あとで」と同じ', () => {
    show({ userAgent: IPHONE });
    fireEvent.click(screen.getByTestId('install-hint-overlay'));
    expect(screen.queryByTestId('install-hint')).toBeNull();
    expect(JSON.parse(localStorage.getItem('dressup_install_hint')!).closed).toBe(1);
  });
  it('ほかの方法で追加された（appinstalled）ときも、消えて、もう出ない', () => {
    const { target } = show({ userAgent: ANDROID });
    act(() => {
      target.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByTestId('install-hint')).toBeNull();
    expect(wantsInstallHint(localStorage, false)).toBe(false);
  });
});
