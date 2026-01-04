/**
 * Vitestのセットアップファイル
 */
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// PixiJSのモック（Canvas APIがない環境用）
// classとしてモックする必要がある
class MockApplication {
  stage = {
    addChild: vi.fn(),
  };
  screen = {
    width: 400,
    height: 500,
  };
  renderer = {
    resize: vi.fn(),
  };

  async init() {
    return Promise.resolve();
  }

  destroy() {}
}

class MockContainer {
  label = '';
  addChild = vi.fn();
  removeChildren = vi.fn();
}

class MockGraphics {
  circle() {
    return this;
  }
  fill() {
    return this;
  }
  roundRect() {
    return this;
  }
  arc() {
    return this;
  }
  stroke() {
    return this;
  }
  star() {
    return this;
  }
}

vi.mock('pixi.js', () => ({
  Application: MockApplication,
  Container: MockContainer,
  Graphics: MockGraphics,
  Text: vi.fn(),
  TextStyle: vi.fn(),
}));

// ResizeObserverのモック
const globalAny = globalThis as unknown as { ResizeObserver: unknown };
globalAny.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));
