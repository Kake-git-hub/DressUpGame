import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { HueCanvas } from '../components/HueCanvas';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HueCanvas（色を変えた絵）', () => {
  it('開発モード（StrictMode）でも、色を変えるたびに描き直しを予約する', () => {
    // 前は、後始末で予約を取り消しても「予約あり」の印が残り、開発モード（後始末と準備を 2 回呼ぶ）では、二度と描き直さなかった
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const raf = vi.spyOn(window, 'requestAnimationFrame');
    const { rerender } = render(
      <StrictMode>
        <HueCanvas src="a.png" hue={0} />
      </StrictMode>,
    );
    vi.runAllTimers();
    const before = raf.mock.calls.length;
    rerender(
      <StrictMode>
        <HueCanvas src="a.png" hue={90} />
      </StrictMode>,
    );
    expect(raf.mock.calls.length).toBe(before + 1);
    vi.runAllTimers();
    rerender(
      <StrictMode>
        <HueCanvas src="a.png" hue={120} />
      </StrictMode>,
    );
    expect(raf.mock.calls.length).toBe(before + 2);
  });
});
