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
  children: unknown[] = [];
  addChild = vi.fn((child: unknown) => {
    this.children.push(child);
    return child;
  });
  removeChildren = vi.fn(() => {
    const removed = [...this.children];
    this.children = [];
    return removed;
  });
  removeChild = vi.fn((child: unknown) => {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
    }
    return child;
  });
  destroy = vi.fn();
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

class MockSprite {
  x = 0;
  y = 0;
  rotation = 0;
  filters: unknown[] | null = null;
  anchor = { set: vi.fn() };
  scale = { set: vi.fn() };

  constructor(_texture?: unknown) {}
}

class MockFilter {
  resources: any;

  constructor(options: any) {
    // PixiのFilterが内部的にresources.*.uniformsへまとめる挙動を最低限再現
    const chroma = options?.resources?.chromaKeyUniforms ?? null;
    if (chroma && typeof chroma === 'object') {
      const uniforms: Record<string, any> = {};
      for (const [key, val] of Object.entries<any>(chroma)) {
        if (val && typeof val === 'object' && 'value' in val) {
          uniforms[key] = (val as any).value;
        }
      }
      this.resources = { chromaKeyUniforms: { uniforms } };
    } else {
      this.resources = options?.resources ?? {};
    }
  }
}

const MockGlProgram = {
  from: vi.fn(() => ({})),
};

const MockAssets = {
  load: vi.fn(async () => ({
    width: 512,
    height: 1024,
    source: { scaleMode: 'linear' },
  })),
};

vi.mock('pixi.js', () => ({
  Application: MockApplication,
  Container: MockContainer,
  Graphics: MockGraphics,
  Sprite: MockSprite,
  Assets: MockAssets,
  Filter: MockFilter,
  GlProgram: MockGlProgram,
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
